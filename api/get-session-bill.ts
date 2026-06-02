import * as Sentry from "@sentry/node";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import admin from "firebase-admin";
import { UserFacingError } from "./_lib/errors.js";

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

type BillItem = {
  nombre: string;
  name: string;
  cantidad: number;
  quantity: number;
  precio: number;
  price: number;
  subtotal: number;
  observacion: string;
  note: string;
};

type BillPedido = {
  id: string;
  mesa: number;
  total: number;
  items: BillItem[];
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  try {
    const { restaurantId, sessionId, mesa } = req.query;

    if (
      typeof restaurantId !== "string" || !restaurantId.trim() ||
      typeof sessionId !== "string" || !sessionId.trim() ||
      typeof mesa !== "string" || !mesa.trim()
    ) {
      throw new UserFacingError("Parámetros inválidos");
    }

    const mesaNumber = parseInt(mesa, 10);
    if (!Number.isInteger(mesaNumber) || mesaNumber <= 0 || mesaNumber > 500) {
      throw new UserFacingError("Mesa inválida");
    }

    const db = getAdminDb();

    const sessionSnap = await db
      .doc(`restaurants/${restaurantId.trim()}/sessions/${sessionId.trim()}`)
      .get();

    if (!sessionSnap.exists) {
      throw new UserFacingError("Sesión no encontrada");
    }

    const session = sessionSnap.data()!;

    if (session.restaurantId !== restaurantId.trim()) {
      throw new UserFacingError("Sesión no corresponde al restaurante");
    }

    if (session.tableNumber !== mesaNumber) {
      throw new UserFacingError("Sesión no corresponde a la mesa");
    }

    if (session.status !== "active") {
      throw new UserFacingError(
        "Esta mesa ya fue cerrada. Para volver a pedir, escaneá nuevamente el QR."
      );
    }

    const pedidosSnap = await db
      .collection(`restaurants/${restaurantId.trim()}/pedidos`)
      .where("sessionId", "==", sessionId.trim())
      .get();

    const pedidos: BillPedido[] = pedidosSnap.docs
      .filter((docSnap) => {
        const d = docSnap.data();
        return Number(d.mesa) === mesaNumber && d.cancelado !== true;
      })
      .map((docSnap) => {
        const d = docSnap.data();
        const rawItems = Array.isArray(d.items) ? d.items : [];

        const items: BillItem[] = rawItems.map(
          (item: Record<string, unknown>) => ({
            nombre: String(item.nombre || item.name || "Producto"),
            name: String(item.name || item.nombre || "Producto"),
            cantidad: Number(item.cantidad || item.quantity || 1),
            quantity: Number(item.quantity || item.cantidad || 1),
            precio: Number(item.precio || item.price || 0),
            price: Number(item.price || item.precio || 0),
            subtotal: Number(item.subtotal || 0),
            observacion: String(item.observacion || item.note || ""),
            note: String(item.note || item.observacion || ""),
          })
        );

        return {
          id: docSnap.id,
          mesa: Number(d.mesa),
          total: Number(d.total || 0),
          items,
        };
      });

    const total = pedidos.reduce((sum, p) => {
      const t = Number(p.total);
      return sum + (Number.isFinite(t) ? t : 0);
    }, 0);

    return res.status(200).json({ ok: true, pedidos, total });
  } catch (error) {
    console.error("Error en get-session-bill:", error);

    if (!(error instanceof UserFacingError)) {
      Sentry.captureException(error, {
        extra: { restaurantId: req.query.restaurantId, mesa: req.query.mesa },
      });
      await Sentry.flush(2000);
    }

    const message =
      error instanceof UserFacingError
        ? error.message
        : "No se pudo cargar la cuenta. Reintentá.";

    return res.status(400).json({ ok: false, error: message });
  }
}
