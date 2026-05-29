import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";

admin.initializeApp();

const MP_ACCESS_TOKEN = defineSecret("MP_ACCESS_TOKEN");

const MP_PLANS: Record<string, string> = {
  starter: "fe438d142dab44648be3a09064c905ac",
  pro: "4aa52e5168ef49ac8bad3657378430aa",
  premium: "76d2a6a94b2843bf981e4cfd995a800b",
};

const PLAN_AMOUNTS: Record<string, number> = {
  starter: 70000,
  pro: 90000,
  premium: 115000,
};

// ─── 1. Crear suscripción ────────────────────────────────────────────────────

export const createSubscription = onCall(
  { secrets: [MP_ACCESS_TOKEN], cors: true },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "No autenticado");
    }

    const { restaurantId, plan, payerEmail } = request.data as {
      restaurantId: string;
      plan: "starter" | "pro" | "premium";
      payerEmail: string;
    };

    if (!restaurantId || !plan || !payerEmail) {
      throw new HttpsError("invalid-argument", "Faltan datos requeridos");
    }

    if (!MP_PLANS[plan]) {
      throw new HttpsError("invalid-argument", "Plan inválido");
    }

    // Verificar que el usuario es admin del restaurante
    const staffDoc = await admin
      .firestore()
      .collection("restaurants")
      .doc(restaurantId)
      .collection("staff")
      .doc(request.auth.uid)
      .get();

    if (!staffDoc.exists || staffDoc.data()?.role !== "admin") {
      throw new HttpsError("permission-denied", "No tenés permisos");
    }

    const token = MP_ACCESS_TOKEN.value();

    const body = {
      preapproval_plan_id: MP_PLANS[plan],
      payer_email: payerEmail,
      card_token_id: "",
      back_url: `https://want-livid.vercel.app/admin?billing=success`,
      reason: `WANT ${plan.charAt(0).toUpperCase() + plan.slice(1)}`,
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: PLAN_AMOUNTS[plan],
        currency_id: "ARS",
      },
      status: "pending",
    };

    const response = await fetch("https://api.mercadopago.com/preapproval", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json() as {
      id: string;
      init_point: string;
      status: string;
    };

    if (!data.id) {
      throw new HttpsError("internal", "Error al crear suscripción en MP");
    }

    // Guardar subscriptionId pendiente en Firestore
    await admin
      .firestore()
      .collection("restaurants")
      .doc(restaurantId)
      .update({
        "billing.subscriptionId": data.id,
        "billing.plan": plan,
        "billing.status": "pending",
        "billing.provider": "mercadopago",
        "billing.updatedAt": admin.firestore.FieldValue.serverTimestamp(),
      });

    return {
      subscriptionId: data.id,
      initPoint: data.init_point,
    };
  }
);

// ─── 2. Webhook de Mercado Pago ──────────────────────────────────────────────

export const mpWebhook = onRequest(
  { secrets: [MP_ACCESS_TOKEN] },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method not allowed");
      return;
    }

    const topic = req.query.topic || req.body?.type;
    const resourceId =
      req.query.id ||
      req.body?.data?.id ||
      req.body?.resource?.split("/").pop();

    if (!topic || !resourceId) {
      res.status(200).send("OK");
      return;
    }

    if (topic !== "preapproval" && topic !== "subscription_preapproval") {
      res.status(200).send("OK");
      return;
    }

    try {
      const token = MP_ACCESS_TOKEN.value();

      // Buscar la suscripción en MP
      const mpRes = await fetch(
        `https://api.mercadopago.com/preapproval/${resourceId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      const subscription = await mpRes.json() as {
        id: string;
        status: string;
        preapproval_plan_id: string;
        payer_email: string;
        next_payment_date: string;
      };

      if (!subscription.id) {
        res.status(200).send("OK");
        return;
      }  
      
      // Buscar manualmente si collectionGroup no aplica
      const restaurantsSnap = await admin
        .firestore()
        .collection("restaurants")
        .where("billing.subscriptionId", "==", subscription.id)
        .limit(1)
        .get();

      if (restaurantsSnap.empty) {
        res.status(200).send("OK");
        return;
      }

      const restaurantDoc = restaurantsSnap.docs[0];
      const restaurantId = restaurantDoc.id;

      // Determinar plan por planId de MP
      const planEntry = Object.entries(MP_PLANS).find(
        ([, planId]) => planId === subscription.preapproval_plan_id
      );
      const plan = planEntry ? planEntry[0] : "starter";

      // Mapear status de MP a nuestro modelo
      const statusMap: Record<string, string> = {
        authorized: "active",
        paused: "past_due",
        cancelled: "canceled",
        pending: "pending",
      };

      const billingStatus = statusMap[subscription.status] ?? "pending";

      await admin
        .firestore()
        .collection("restaurants")
        .doc(restaurantId)
        .update({
          plan: billingStatus === "active" ? plan : "starter",
          "billing.status": billingStatus,
          "billing.subscriptionId": subscription.id,
          "billing.provider": "mercadopago",
          "billing.currentPeriodEnd": subscription.next_payment_date
            ? admin.firestore.Timestamp.fromDate(
                new Date(subscription.next_payment_date)
              )
            : null,
          "billing.lastWebhookAt":
            admin.firestore.FieldValue.serverTimestamp(),
          "billing.updatedAt": admin.firestore.FieldValue.serverTimestamp(),
        });

      // Guardar evento en billingEvents
      await admin
        .firestore()
        .collection("restaurants")
        .doc(restaurantId)
        .collection("billingEvents")
        .add({
          type: `mp_${subscription.status}`,
          subscriptionId: subscription.id,
          plan,
          billingStatus,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

      res.status(200).send("OK");
    } catch (error) {
      console.error("mpWebhook error:", error);
      res.status(200).send("OK"); // Siempre 200 a MP para evitar reintentos
    }
  }
);

// ─── 3. Cancelar suscripción ─────────────────────────────────────────────────

export const cancelSubscription = onCall(
  { secrets: [MP_ACCESS_TOKEN], cors: true },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "No autenticado");
    }

    const { restaurantId } = request.data as { restaurantId: string };

    if (!restaurantId) {
      throw new HttpsError("invalid-argument", "Falta restaurantId");
    }

    const staffDoc = await admin
      .firestore()
      .collection("restaurants")
      .doc(restaurantId)
      .collection("staff")
      .doc(request.auth.uid)
      .get();

    if (!staffDoc.exists || staffDoc.data()?.role !== "admin") {
      throw new HttpsError("permission-denied", "No tenés permisos");
    }

    const restaurantDoc = await admin
      .firestore()
      .collection("restaurants")
      .doc(restaurantId)
      .get();

    const subscriptionId = restaurantDoc.data()?.billing?.subscriptionId;

    if (!subscriptionId) {
      throw new HttpsError("not-found", "No hay suscripción activa");
    }

    const token = MP_ACCESS_TOKEN.value();

    const response = await fetch(
      `https://api.mercadopago.com/preapproval/${subscriptionId}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "cancelled" }),
      }
    );

    const data = await response.json() as { status: string };

    if (data.status !== "cancelled") {
      throw new HttpsError("internal", "No se pudo cancelar en MP");
    }

    await admin
      .firestore()
      .collection("restaurants")
      .doc(restaurantId)
      .update({
        plan: "starter",
        "billing.status": "canceled",
        "billing.updatedAt": admin.firestore.FieldValue.serverTimestamp(),
      });

    return { success: true };
  }
);