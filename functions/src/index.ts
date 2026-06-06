import * as Sentry from "@sentry/node";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import * as crypto from "crypto";
import { Resend } from "resend";
import { generateKeyPairAndCsr, encryptPrivateKey, decryptPrivateKey } from "./afip/crypto.js";
import { getAfipToken } from "./afip/wsaa.js";
import { getLastInvoiceNumber, issueFECAE } from "./afip/wsfe.js";
import { INVOICE_TYPE_CODES, type InvoiceRequest, type AfipConfig } from "./afip/types.js";

admin.initializeApp();

// Inicializar Sentry una vez — Cloud Functions reutiliza la instancia entre invocaciones calientes.
// DSN via functions/.env (SENTRY_DSN=https://...) o variable de entorno de Firebase.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? "production",
  tracesSampleRate: 0, // Sin tracing en functions — solo captura de errores
});

const MP_ACCESS_TOKEN = defineSecret("MP_ACCESS_TOKEN");
const MP_WEBHOOK_SECRET = defineSecret("MP_WEBHOOK_SECRET");
const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const AFIP_MASTER_KEY = defineSecret("AFIP_MASTER_KEY");

// Entorno AFIP: "homologacion" en dev, "produccion" en prod
const AFIP_ENV = (process.env.AFIP_ENV ?? "produccion") as "homologacion" | "produccion";

const PLAN_LABELS: Record<string, string> = {
  starter: "Starter",
  pro: "Pro",
  premium: "Premium",
};

async function sendEmail(
  apiKey: string,
  to: string,
  subject: string,
  html: string
): Promise<void> {
  const resend = new Resend(apiKey);
  const from = process.env.EMAIL_FROM || "WANT <onboarding@resend.dev>";
  const { error } = await resend.emails.send({ from, to, subject, html });
  if (error) console.error("sendEmail error:", error);
}

function emailWrapper(title: string, body: string): string {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f6f4ef;font-family:sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px">
  <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:24px;overflow:hidden">
    <tr><td style="background:#0a0a0a;padding:32px;text-align:center">
      <span style="color:#fff;font-size:22px;font-weight:900;letter-spacing:-0.5px">WANT</span>
    </td></tr>
    <tr><td style="padding:32px">
      <h1 style="margin:0 0 16px;font-size:22px;font-weight:900;color:#09090b">${title}</h1>
      ${body}
      <p style="margin:32px 0 0;font-size:12px;color:#a1a1aa">WANT © Plataforma SaaS para restaurantes</p>
    </td></tr>
  </table></td></tr></table></body></html>`;
}

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

    // Prevenir doble pago
    const restaurantSnap = await admin
      .firestore()
      .collection("restaurants")
      .doc(restaurantId)
      .get();

    const restaurantSnap2Data = restaurantSnap.data();
    const currentBilling = restaurantSnap2Data?.billing;
    const currentPlan = restaurantSnap2Data?.plan;

    // Caso 1: ya tienen suscripción activa con el mismo plan → bloquear
    if (
      currentBilling?.status === "active" &&
      currentBilling?.subscriptionId &&
      currentPlan === plan
    ) {
      throw new HttpsError(
        "already-exists",
        "Ya tenés una suscripción activa con este plan."
      );
    }

    // Caso 2: hay un checkout en curso hace menos de 10 minutos → bloquear
    if (currentBilling?.status === "pending" && currentBilling?.updatedAt) {
      const updatedAt: Date =
        typeof currentBilling.updatedAt.toDate === "function"
          ? currentBilling.updatedAt.toDate()
          : new Date(currentBilling.updatedAt);
      const minutesElapsed = (Date.now() - updatedAt.getTime()) / 60000;
      if (minutesElapsed < 10) {
        throw new HttpsError(
          "already-exists",
          "Ya hay un proceso de pago en curso. Esperá unos minutos antes de intentar de nuevo."
        );
      }
    }

    const payerEmailResolved = payerEmail || request.auth.token.email || "";

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

    // Crear suscripción vía API de MP para poder incluir back_url de retorno a la app
    const appUrl = process.env.APP_URL || "https://want-livid.vercel.app";
    const token = MP_ACCESS_TOKEN.value();

    const mpRes = await fetch("https://api.mercadopago.com/preapproval", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        preapproval_plan_id: MP_PLANS[plan],
        payer_email: payerEmailResolved,
        back_url: `${appUrl}/payment-required?restaurantId=${restaurantId}`,
        external_reference: restaurantId,
      }),
    });

    if (!mpRes.ok) {
      const errorText = await mpRes.text();
      console.error("MP API error al crear suscripción:", mpRes.status, errorText);
      throw new HttpsError("internal", "No se pudo iniciar el checkout con Mercado Pago");
    }

    const mpData = await mpRes.json() as { id: string; init_point: string };

    return {
      subscriptionId: mpData.id ?? null,
      initPoint: mpData.init_point,
    };
  }
);

// ─── 2. Webhook de Mercado Pago ──────────────────────────────────────────────

export const mpWebhook = onRequest(
  { secrets: [MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET, RESEND_API_KEY] },
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
        console.log("No se encontró restaurante para subscription ID:", subscription.id);
        res.status(200).send("OK");
        return;
      }

      const restaurantDoc = restaurantsSnap.docs[0];
      const restaurantId = restaurantDoc.id;
      const restaurantData = restaurantDoc.data();

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

      const nextBillingDate = subscription.next_payment_date
        ? admin.firestore.Timestamp.fromDate(new Date(subscription.next_payment_date))
        : null;

      // Mapear billingStatus a subscriptionStatus (campo que usan los guards de acceso)
      const subscriptionStatusMap: Record<string, string> = {
        active: "active",
        past_due: "past_due",
        canceled: "blocked",
      };
      const newSubscriptionStatus = subscriptionStatusMap[billingStatus];

      await admin
        .firestore()
        .collection("restaurants")
        .doc(restaurantId)
        .update({
          plan: billingStatus === "active" ? plan : "starter",
          ...(newSubscriptionStatus && { subscriptionStatus: newSubscriptionStatus }),
          ...(billingStatus === "active" && nextBillingDate && { nextBillingDate }),
          "billing.status": billingStatus,
          "billing.subscriptionId": subscription.id,
          "billing.provider": "mercadopago",
          "billing.currentPeriodEnd": nextBillingDate,
          "billing.lastWebhookAt": admin.firestore.FieldValue.serverTimestamp(),
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

      // Si hay una suscripción anterior distinta, cancelarla en MP automáticamente
      if (billingStatus === "active") {
        const prevSubscriptionId = restaurantData?.billing?.subscriptionId;
        if (prevSubscriptionId && prevSubscriptionId !== subscription.id) {
          await fetch(`https://api.mercadopago.com/preapproval/${prevSubscriptionId}`, {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ status: "cancelled" }),
          }).catch((err) => console.warn("No se pudo cancelar suscripción anterior:", err));
        }
      }

      // Registrar pago en payments para que aparezca en el Super Admin
      if (billingStatus === "active") {
        const monthlyPrice = Number(restaurantData?.monthlyPrice ?? 0);
        await admin
          .firestore()
          .collection("restaurants")
          .doc(restaurantId)
          .collection("payments")
          .add({
            restaurantId,
            type: "monthly",
            amount: monthlyPrice,
            plan,
            notes: "Pago automático vía Mercado Pago",
            subscriptionId: subscription.id,
            paidAt: admin.firestore.FieldValue.serverTimestamp(),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });

        // Email de pago confirmado
        const ownerEmail = restaurantData?.ownerEmail ?? subscription.payer_email;
        if (ownerEmail) {
          const planLabel = PLAN_LABELS[plan] ?? plan;
          await sendEmail(
            RESEND_API_KEY.value(),
            ownerEmail,
            `✅ Pago confirmado — WANT ${planLabel}`,
            emailWrapper(
              `¡Tu pago fue confirmado!`,
              `<p style="color:#52525b;line-height:1.6">Tu suscripción al plan <strong>${planLabel}</strong> está activa. Ya podés acceder a tu panel administrativo y operar con normalidad.</p>
               <p style="color:#52525b;line-height:1.6">Gracias por confiar en WANT.</p>`
            )
          );
        }
      }

      res.status(200).send("OK");
    } catch (error) {
      console.error("mpWebhook error:", error);
      Sentry.captureException(error, {
        extra: {
          topic: String(topic ?? ""),
          resourceId: String(resourceId ?? ""),
        },
      });
      await Sentry.flush(2000);
      res.status(200).send("OK"); // Siempre 200 a MP para evitar reintentos
    }
  }
);

// ─── 3. Cancelar suscripción ─────────────────────────────────────────────────

export const cancelSubscription = onCall(
  { secrets: [MP_ACCESS_TOKEN, RESEND_API_KEY], cors: true },
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
        subscriptionStatus: "blocked",
        "billing.status": "canceled",
        "billing.updatedAt": admin.firestore.FieldValue.serverTimestamp(),
      });

    // Email de cancelación
    const ownerEmail = restaurantDoc.data()?.ownerEmail;
    if (ownerEmail) {
      await sendEmail(
        RESEND_API_KEY.value(),
        ownerEmail,
        "Tu suscripción de WANT fue cancelada",
        emailWrapper(
          "Suscripción cancelada",
          `<p style="color:#52525b;line-height:1.6">Tu suscripción fue cancelada correctamente. Tu restaurante quedará con acceso restringido.</p>
           <p style="color:#52525b;line-height:1.6">Si fue un error o querés reactivarla, contactanos por WhatsApp y te ayudamos.</p>`
        )
      );
    }

    return { success: true };
  }
);

// ─── 4. Sync diario de billing ───────────────────────────────────────────────

export const dailyBillingSync = onSchedule(
  {
    schedule: "0 3 * * *",
    timeZone: "America/Argentina/Buenos_Aires",
    secrets: [RESEND_API_KEY],
  },
  async () => {
    const now = admin.firestore.Timestamp.now();
    const in6Days = admin.firestore.Timestamp.fromDate(
      new Date(Date.now() + 6 * 24 * 60 * 60 * 1000)
    );
    const db = admin.firestore();
    const batch = db.batch();
    let updates = 0;

    try {
      // ── Trials vencidos → past_due + email ──────────────────────────────
      const expiredTrials = await db
        .collection("restaurants")
        .where("subscriptionStatus", "==", "trial")
        .where("trialEndsAt", "<", now)
        .get();

      for (const doc of expiredTrials.docs) {
        batch.update(doc.ref, {
          subscriptionStatus: "past_due",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        updates++;

        const ownerEmail = doc.data().ownerEmail;
        const name = doc.data().name ?? "tu restaurante";
        if (ownerEmail) {
          await sendEmail(
            RESEND_API_KEY.value(),
            ownerEmail,
            "Tu prueba gratuita de WANT terminó",
            emailWrapper(
              "Tu trial venció",
              `<p style="color:#52525b;line-height:1.6">El período de prueba de <strong>${name}</strong> terminó. Para seguir usando WANT, elegí un plan y activá tu cuenta.</p>
               <p style="margin:24px 0"><a href="https://want-livid.vercel.app/payment-required?restaurantId=${doc.id}" style="background:#0a0a0a;color:#fff;padding:12px 24px;border-radius:12px;text-decoration:none;font-weight:700">Activar mi cuenta</a></p>`
            )
          );
        }
      }

      // ── Aviso 5 días antes del vencimiento del trial ────────────────────
      const trialWarnings = await db
        .collection("restaurants")
        .where("subscriptionStatus", "==", "trial")
        .where("trialEndsAt", ">", now)
        .where("trialEndsAt", "<", in6Days)
        .get();

      for (const doc of trialWarnings.docs) {
        const trialEndsAt = doc.data().trialEndsAt?.toDate?.();
        if (!trialEndsAt) continue;

        const daysLeft = Math.ceil((trialEndsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        if (daysLeft > 5) continue;

        // Solo mandar si no se mandó ya hoy
        if (doc.data().billing?.trialWarningSentAt) continue;

        const ownerEmail = doc.data().ownerEmail;
        const name = doc.data().name ?? "tu restaurante";
        if (ownerEmail) {
          await sendEmail(
            RESEND_API_KEY.value(),
            ownerEmail,
            `Te quedan ${daysLeft} días de prueba en WANT`,
            emailWrapper(
              `Quedan ${daysLeft} días de trial`,
              `<p style="color:#52525b;line-height:1.6">Tu período de prueba de <strong>${name}</strong> vence en <strong>${daysLeft} días</strong>. Para no perder el acceso, activá tu cuenta antes de que expire.</p>
               <p style="margin:24px 0"><a href="https://want-livid.vercel.app/payment-required?restaurantId=${doc.id}" style="background:#0a0a0a;color:#fff;padding:12px 24px;border-radius:12px;text-decoration:none;font-weight:700">Ver planes y activar</a></p>`
            )
          );

          await doc.ref.update({
            "billing.trialWarningSentAt": admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      }

      // ── Suscripciones activas vencidas → past_due ────────────────────────
      const expiredActive = await db
        .collection("restaurants")
        .where("subscriptionStatus", "==", "active")
        .where("nextBillingDate", "<", now)
        .get();

      expiredActive.docs.forEach((doc) => {
        batch.update(doc.ref, {
          subscriptionStatus: "past_due",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        updates++;
      });

      if (updates > 0) {
        await batch.commit();
      }

      console.log(`dailyBillingSync: ${updates} restaurante(s) actualizados`);
    } catch (error) {
      console.error("dailyBillingSync error:", error);
      Sentry.captureException(error);
      await Sentry.flush(2000);
    }
  }
);

// ─── AFIP: Generar CSR ────────────────────────────────────────────────────────

export const afipGenerateCsr = onCall(
  { secrets: [AFIP_MASTER_KEY], cors: true },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "No autenticado");

    const { restaurantId, cuit, puntoVenta, fiscalCondition, env: reqEnv } = request.data as {
      restaurantId: string;
      cuit: string;
      puntoVenta: number;
      fiscalCondition: "monotributista" | "responsable_inscripto";
      env?: string;
    };

    if (!restaurantId || !cuit || !puntoVenta || !fiscalCondition) {
      throw new HttpsError("invalid-argument", "Faltan datos fiscales");
    }

    // El admin puede elegir el ambiente; si no viene, usa el default del servidor
    const resolvedEnv: "homologacion" | "produccion" =
      reqEnv === "homologacion" ? "homologacion" : (AFIP_ENV ?? "produccion");

    const staffDoc = await admin.firestore()
      .collection("restaurants").doc(restaurantId)
      .collection("staff").doc(request.auth.uid).get();
    if (!staffDoc.exists || staffDoc.data()?.role !== "admin") {
      throw new HttpsError("permission-denied", "No tenés permisos");
    }

    const restaurantDoc = await admin.firestore()
      .collection("restaurants").doc(restaurantId).get();
    const restaurantName = restaurantDoc.data()?.name ?? "Restaurante";

    const { privateKeyPem, csrPem } = generateKeyPairAndCsr(restaurantName, cuit);

    const masterKey = AFIP_MASTER_KEY.value();
    const { encrypted, iv } = encryptPrivateKey(privateKeyPem, masterKey);

    await admin.firestore()
      .collection("restaurants").doc(restaurantId)
      .collection("afipConfig").doc("main")
      .set({
        cuit: cuit.replace(/\D/g, "").replace(/^(\d{2})(\d{8})(\d)$/, "$1-$2-$3"),
        puntoVenta,
        fiscalCondition,
        privateKeyEncrypted: encrypted,
        privateKeyIv: iv,
        csrPem,
        certificate: "",
        status: "pending_certificate",
        env: resolvedEnv,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

    return { csrPem };
  }
);

// ─── AFIP: Guardar certificado ────────────────────────────────────────────────

export const afipSaveCertificate = onCall(
  { cors: true },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "No autenticado");

    const { restaurantId, certificatePem } = request.data as {
      restaurantId: string;
      certificatePem: string;
    };

    if (!restaurantId || !certificatePem?.includes("BEGIN CERTIFICATE")) {
      throw new HttpsError("invalid-argument", "Certificado inválido — debe ser un archivo .crt en formato PEM");
    }

    const staffDoc = await admin.firestore()
      .collection("restaurants").doc(restaurantId)
      .collection("staff").doc(request.auth.uid).get();
    if (!staffDoc.exists || staffDoc.data()?.role !== "admin") {
      throw new HttpsError("permission-denied", "No tenés permisos");
    }

    const configRef = admin.firestore()
      .collection("restaurants").doc(restaurantId)
      .collection("afipConfig").doc("main");

    const config = await configRef.get();
    if (!config.exists || config.data()?.status !== "pending_certificate") {
      throw new HttpsError("failed-precondition", "Primero generá el CSR desde el panel de configuración");
    }

    await configRef.update({
      certificate: certificatePem.trim(),
      status: "active",
      activatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { success: true };
  }
);

// ─── AFIP: Emitir comprobante ─────────────────────────────────────────────────

export const afipIssueInvoice = onCall(
  { secrets: [AFIP_MASTER_KEY], cors: true, timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "No autenticado");

    const invoiceReq = request.data as InvoiceRequest;

    if (!invoiceReq.restaurantId || !invoiceReq.cuentaId) {
      throw new HttpsError("invalid-argument", "Faltan datos de la cuenta");
    }

    const staffDoc = await admin.firestore()
      .collection("restaurants").doc(invoiceReq.restaurantId)
      .collection("staff").doc(request.auth.uid).get();
    if (!staffDoc.exists) throw new HttpsError("permission-denied", "No tenés permisos");

    const configSnap = await admin.firestore()
      .collection("restaurants").doc(invoiceReq.restaurantId)
      .collection("afipConfig").doc("main").get();

    if (!configSnap.exists) {
      throw new HttpsError("failed-precondition", "El restaurante no tiene AFIP configurado");
    }

    const config = configSnap.data() as AfipConfig & { env?: string };
    if (config.status !== "active") {
      throw new HttpsError("failed-precondition", "La configuración AFIP no está activa. Completá el wizard de configuración.");
    }

    const env = (config.env ?? AFIP_ENV) as "homologacion" | "produccion";
    const masterKey = AFIP_MASTER_KEY.value();
    const privateKeyPem = decryptPrivateKey(
      config.privateKeyEncrypted,
      config.privateKeyIv,
      masterKey
    );

    const { token, sign } = await getAfipToken(
      invoiceReq.restaurantId,
      privateKeyPem,
      config.certificate,
      env
    );

    const invoiceType: "A" | "B" | "C" = invoiceReq.invoiceType ??
      (config.fiscalCondition === "monotributista" ? "C" : "B");

    const cbteTypeCode = INVOICE_TYPE_CODES[invoiceType];
    if (!cbteTypeCode) throw new HttpsError("invalid-argument", "Tipo de comprobante inválido");

    const lastNumber = await getLastInvoiceNumber(
      token, sign, config.cuit, config.puntoVenta, cbteTypeCode, env
    );

    const result = await issueFECAE(
      token, sign, config.cuit, config.puntoVenta, lastNumber + 1,
      { ...invoiceReq, invoiceType },
      env
    );

    await admin.firestore()
      .collection("restaurants").doc(invoiceReq.restaurantId)
      .collection("cuentas").doc(invoiceReq.cuentaId)
      .update({
        "invoice.status": "issued",
        "invoice.cae": result.cae,
        "invoice.caeExpiry": result.caeExpiry,
        "invoice.invoiceNumber": result.invoiceNumber,
        "invoice.invoiceType": result.invoiceType,
        "invoice.puntoVenta": result.puntoVenta,
        "invoice.issuedAt": admin.firestore.FieldValue.serverTimestamp(),
      });

    return result;
  }
);