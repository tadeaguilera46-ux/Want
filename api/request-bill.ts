import * as Sentry from "@sentry/node";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import admin from "firebase-admin";
import { UserFacingError, toApiErrorMessage } from "./_lib/errors.js";

if (!Sentry.isInitialized()) {
  Sentry.init({
    dsn: process.env.VITE_SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "production",
  });
}

const getAdminDb = () => {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
    });
  }
  return admin.firestore();
};

type RequestBillBody = {
  restaurantId: string;
  sessionId: string;
  mesa: number;
  metodo: string | null;
  splitBill: boolean;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  try {
    const body = req.body as RequestBillBody;
    const restaurantId = (body?.restaurantId ?? "").trim();
    const sessionId = (body?.sessionId ?? "").trim();
    const metodo = (body?.metodo ?? null) as string | null;
    const splitBill = body?.splitBill === true;

    if (!restaurantId || !sessionId) {
      throw new UserFacingError("Parámetros inválidos");
    }

    const mesaNumber = Number(body?.mesa);
    if (!Number.isInteger(mesaNumber) || mesaNumber <= 0 || mesaNumber > 500) {
      throw new UserFacingError("Mesa inválida");
    }

    const db = getAdminDb();
    const FieldValue = admin.firestore.FieldValue;

    // Calculate total from pedidos (server-side, not trusting client total)
    const pedidosSnap = await db
      .collection(`restaurants/${restaurantId}/pedidos`)
      .where("sessionId", "==", sessionId)
      .get();

    const total = pedidosSnap.docs.reduce((sum, docSnap) => {
      const d = docSnap.data();
      if (Number(d.mesa) !== mesaNumber || d.cancelado === true) return sum;
      const t = Number(d.total || 0);
      return sum + (Number.isFinite(t) ? t : 0);
    }, 0);

    const mesaRef = db.doc(`restaurants/${restaurantId}/mesas/${mesaNumber}`);
    const sessionRef = db.doc(`restaurants/${restaurantId}/sessions/${sessionId}`);
    const cuentaRef = db.doc(`restaurants/${restaurantId}/cuentas/${sessionId}`);

    await db.runTransaction(async (transaction) => {
      // All reads before any writes (Admin SDK requirement)
      const [mesaSnap, sessionSnap, cuentaSnap] = await Promise.all([
        transaction.get(mesaRef),
        transaction.get(sessionRef),
        transaction.get(cuentaRef),
      ]);

      if (!mesaSnap.exists) {
        throw new UserFacingError("La mesa no existe");
      }
      const mesaData = mesaSnap.data()!;
      if (mesaData.estado !== "occupied") {
        throw new UserFacingError("La mesa no está ocupada");
      }
      if (mesaData.activeSessionId !== sessionId) {
        throw new UserFacingError(
          "La sesión ya no coincide con esta mesa. Volvé a pedir la cuenta."
        );
      }

      if (!sessionSnap.exists) {
        throw new UserFacingError("La sesión no existe");
      }
      const sessionData = sessionSnap.data()!;
      if (sessionData.status !== "active") {
        throw new UserFacingError(
          "Esta sesión ya fue cerrada. Para volver a pedir, escaneá nuevamente el QR."
        );
      }
      if (sessionData.tableNumber !== mesaNumber) {
        throw new UserFacingError(
          "Inconsistencia: la sesión no corresponde a esta mesa"
        );
      }

      if (cuentaSnap.exists) {
        const cuentaData = cuentaSnap.data()!;
        if (cuentaData.estado === "pagada" || cuentaData.estado === "cerrada") {
          throw new UserFacingError(
            "La cuenta ya fue procesada. Si hay algún problema, consultá con el personal."
          );
        }
      }

      const now = FieldValue.serverTimestamp();

      // Update session: lock orders and mark bill requested
      transaction.set(
        sessionRef,
        {
          billRequested: true,
          billRequestedAt: now,
          ordersLocked: true,
          lockedReason: "bill_requested",
          updatedAt: now,
        },
        { merge: true }
      );

      // Create or update cuenta
      if (cuentaSnap.exists) {
        const cuentaData = cuentaSnap.data()!;
        transaction.set(
          cuentaRef,
          {
            restaurantId,
            mesa: mesaNumber,
            metodo,
            total,
            splitBill,
            sessionId,
            estado: cuentaData.estado,
            createdAt: cuentaData.createdAt ?? now,
            updatedAt: now,
          },
          { merge: true }
        );
      } else {
        transaction.set(cuentaRef, {
          restaurantId,
          mesa: mesaNumber,
          metodo,
          total,
          splitBill,
          sessionId,
          estado: "pendiente",
          createdAt: now,
          updatedAt: now,
        });
      }

      // Audit log
      const auditRef = db
        .collection(`restaurants/${restaurantId}/auditLogs`)
        .doc();
      transaction.set(auditRef, {
        restaurantId,
        action: "cuenta_solicitada",
        actorUid: `customer:${sessionId}`,
        actorEmail: null,
        actorRole: "customer",
        userUid: `customer:${sessionId}`,
        userEmail: null,
        userRole: "customer",
        mesa: mesaNumber,
        pedidoId: null,
        cuentaId: sessionId,
        sessionId,
        entityType: "cuenta",
        entityId: sessionId,
        description: `Cliente solicito la cuenta de mesa ${mesaNumber}`,
        reason: null,
        changes: {
          before: {
            exists: !cuentaSnap.exists,
            billRequested: sessionData.billRequested ?? false,
          },
          after: { estado: "pendiente", total, billRequested: true },
        },
        metadata: {},
        createdAt: now,
      });
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Error en request-bill:", error);

    if (!(error instanceof UserFacingError)) {
      Sentry.captureException(error, {
        extra: { restaurantId: req.body?.restaurantId, mesa: req.body?.mesa },
      });
      await Sentry.flush(2000);
    }

    const message = toApiErrorMessage(error);
    const status = error instanceof UserFacingError ? 400 : 500;
    return res.status(status).json({ ok: false, error: message });
  }
}
