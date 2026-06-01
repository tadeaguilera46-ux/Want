import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import * as crypto from "crypto";

admin.initializeApp();

const MP_ACCESS_TOKEN = defineSecret("MP_ACCESS_TOKEN");
const MP_WEBHOOK_SECRET = defineSecret("MP_WEBHOOK_SECRET");

const MP_PLANS: Record<string, string> = {
  starter: "ec0431741ea24561a858ae740135a58c",
  pro: "3d8e990cc99a4c20baeac76f027b4c0d",
  premium: "21d0a8de8a194d269d0f7e38272145d3",
};

// ─── Verificación de firma de Mercado Pago ───────────────────────────────────
// Referencia: https://www.mercadopago.com.ar/developers/es/docs/your-integrations/notifications/webhooks

/**
 * Verifica el header x-signature que MP incluye en cada webhook.
 *
 * Formato del header: "ts=<unix_seconds>,v1=<hmac_sha256_hex>"
 * Mensaje firmado:    "id:[data.id];request-date:[x-request-id];updated-id:[data.id];"
 *
 * Usa comparación en tiempo constante (timingSafeEqual) para evitar timing attacks.
 * Rechaza timestamps con más de 5 minutos de antigüedad para prevenir replay attacks.
 */
function verifyMpWebhookSignature(
  xSignature: string | string[] | undefined,
  xRequestId: string | string[] | undefined,
  dataId: string,
  secret: string
): boolean {
  if (!xSignature || typeof xSignature !== "string") return false;

  const ts = xSignature.match(/ts=([^,]+)/)?.[1] ?? "";
  const v1 = xSignature.match(/v1=([^,]+)/)?.[1] ?? "";

  if (!ts || !v1) return false;

  const tsNum = parseInt(ts, 10);
  if (isNaN(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 300) return false;

  const requestId = typeof xRequestId === "string" ? xRequestId : "";
  const signedMessage = `id:${dataId};request-date:${requestId};updated-id:${dataId};`;

  const computed = crypto
    .createHmac("sha256", secret)
    .update(signedMessage)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(v1, "hex"),
      Buffer.from(computed, "hex")
    );
  } catch {
    return false;
  }
}

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

    // Guardar estado pendiente para que el webhook pueda identificar el restaurante por email
    const payerEmailResolved =
      payerEmail || request.auth.token.email || "";

    await admin
      .firestore()
      .collection("restaurants")
      .doc(restaurantId)
      .update({
        "billing.pendingPlan": plan,
        "billing.payerEmail": payerEmailResolved,
        "billing.status": "pending",
        "billing.provider": "mercadopago",
        "billing.updatedAt": admin.firestore.FieldValue.serverTimestamp(),
      });

    // URL de checkout directo al plan — el usuario ingresa su tarjeta ahí
    const initPoint = `https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=${MP_PLANS[plan]}`;

    return {
      subscriptionId: null,
      initPoint,
    };
  }
);

// ─── 2. Webhook de Mercado Pago ──────────────────────────────────────────────

export const mpWebhook = onRequest(
  { secrets: [MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET] },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method not allowed");
      return;
    }

    // Verificar firma antes de cualquier procesamiento.
    // Si el secret está configurado (producción), la firma es obligatoria.
    // Si está vacío (entorno local sin secret provisionado), se omite.
    const webhookSecret = MP_WEBHOOK_SECRET.value();
    if (webhookSecret) {
      const dataId = String(req.body?.data?.id ?? req.query.id ?? "");
      const valid = verifyMpWebhookSignature(
        req.headers["x-signature"],
        req.headers["x-request-id"],
        dataId,
        webhookSecret
      );
      if (!valid) {
        console.warn("mpWebhook: x-signature inválida — request rechazado");
        res.status(401).send("Unauthorized");
        return;
      }
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
        payer_id: number;
        next_payment_date: string;
      };

      if (!subscription.id) {
        res.status(200).send("OK");
        return;
      }  
      
      // Buscar por email del pagador (guardado al iniciar el flujo)
      let restaurantsSnap = await admin
        .firestore()
        .collection("restaurants")
        .where("billing.payerEmail", "==", subscription.payer_email)
        .limit(1)
        .get();

      // Fallback: buscar por subscriptionId (para suscripciones ya existentes)
      if (restaurantsSnap.empty) {
        restaurantsSnap = await admin
          .firestore()
          .collection("restaurants")
          .where("billing.subscriptionId", "==", subscription.id)
          .limit(1)
          .get();
      }

      if (restaurantsSnap.empty) {
        console.log("No se encontró restaurante para payer_email:", subscription.payer_email);
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