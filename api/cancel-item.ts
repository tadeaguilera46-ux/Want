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

type StockMovement = {
  stockItemId: string;
  quantity: number;
};

type PedidoItem = {
  nombre?: string;
  name?: string;
  cantidad?: number;
  quantity?: number;
  precio?: number;
  price?: number;
  subtotal?: number;
  category?: string;
  stockMovements?: StockMovement[];
};

type CancelledItem = {
  itemIndex: number;
  name: string;
  reason: string;
  cancelledAt: number;
  actorUid: string;
  actorEmail: string;
};

type CancelItemBody = {
  restaurantId: string;
  pedidoId: string;
  itemIndex: number;
  reason: string;
};

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

const isFoodItem = (item: PedidoItem) => item.category === "food";
const isDrinkItem = (item: PedidoItem) => item.category === "drinks";

const getItemSubtotal = (item: PedidoItem): number => {
  if (item.subtotal !== undefined) return Number(item.subtotal);
  const price = Number(item.precio ?? item.price ?? 0);
  const qty = Number(item.cantidad ?? item.quantity ?? 1);
  return price * qty;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  // Verify Firebase ID token
  const authHeader = (req.headers.authorization ?? "") as string;
  const rawToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  if (!rawToken) {
    return res.status(401).json({ ok: false, error: "Se requiere autenticación" });
  }

  const db = getAdminDb();
  const FieldValue = admin.firestore.FieldValue;

  let actorUid: string;
  let actorEmail: string;
  try {
    const decoded = await admin.auth().verifyIdToken(rawToken);
    actorUid = decoded.uid;
    actorEmail = decoded.email ?? "";
  } catch {
    return res.status(401).json({ ok: false, error: "Token inválido o expirado" });
  }

  try {
    const { restaurantId, pedidoId, itemIndex, reason } = req.body as CancelItemBody;

    if (!restaurantId?.trim() || !pedidoId?.trim()) {
      throw new UserFacingError("Faltan parámetros obligatorios");
    }
    if (!Number.isInteger(itemIndex) || itemIndex < 0) {
      throw new UserFacingError("Índice de ítem inválido");
    }
    if (!reason?.trim() || reason.trim().length < 3) {
      throw new UserFacingError("El motivo de cancelación es obligatorio (mínimo 3 caracteres)");
    }

    // Verify the caller is active staff with cashier or admin role in this restaurant
    const staffSnap = await db
      .doc(`restaurants/${restaurantId.trim()}/staff/${actorUid}`)
      .get();
    if (!staffSnap.exists || staffSnap.data()?.active !== true) {
      return res.status(403).json({ ok: false, error: "Sin permisos en este restaurante" });
    }
    const staffRole = String(staffSnap.data()?.role ?? "");
    if (staffRole !== "cashier" && staffRole !== "admin") {
      return res.status(403).json({ ok: false, error: "Solo caja o administración puede cancelar ítems" });
    }

    const pedidoRef = db.doc(`restaurants/${restaurantId}/pedidos/${pedidoId}`);

    let cancelledItem: CancelledItem | null = null;
    let pedidoSessionId: string | null = null;
    let totalItemsCount = 0;
    let cancelledItemsCountAfter = 0;

    await db.runTransaction(async (transaction) => {
      const pedidoSnap = await transaction.get(pedidoRef);
      if (!pedidoSnap.exists) {
        throw new UserFacingError("Pedido no encontrado");
      }

      const pedidoData = pedidoSnap.data()!;
      pedidoSessionId = typeof pedidoData.sessionId === "string" ? pedidoData.sessionId.trim() : null;
      const items: PedidoItem[] = Array.isArray(pedidoData.items) ? pedidoData.items : [];
      const existingCancelled: CancelledItem[] = Array.isArray(pedidoData.cancelledItems)
        ? pedidoData.cancelledItems
        : [];

      if (itemIndex >= items.length) {
        throw new UserFacingError("Índice de ítem fuera de rango");
      }
      if (existingCancelled.some((c) => c.itemIndex === itemIndex)) {
        throw new UserFacingError("Este ítem ya fue cancelado");
      }

      const item = items[itemIndex]!;

      // Read stock docs before any writes
      const stockRefs = new Map<string, FirebaseFirestore.DocumentReference>();
      const stockSnaps = new Map<string, FirebaseFirestore.DocumentSnapshot>();
      for (const movement of item.stockMovements ?? []) {
        if (!stockRefs.has(movement.stockItemId)) {
          const ref = db.doc(`restaurants/${restaurantId}/stock/${movement.stockItemId}`);
          stockRefs.set(movement.stockItemId, ref);
          stockSnaps.set(movement.stockItemId, await transaction.get(ref));
        }
      }

      // Build new cancelledItems
      const newEntry: CancelledItem = {
        itemIndex,
        name: (item.nombre ?? item.name ?? "Ítem").trim(),
        reason: reason.trim(),
        cancelledAt: Date.now(),
        actorUid: actorUid.trim(),
        actorEmail: (actorEmail ?? "").trim(),
      };
      cancelledItem = newEntry;
      const newCancelledItems = [...existingCancelled, newEntry];
      const cancelledSet = new Set(newCancelledItems.map((c) => c.itemIndex));

      totalItemsCount = items.length;
      cancelledItemsCountAfter = newCancelledItems.length;

      // Recalculate total excluding all cancelled items
      const newTotal = items.reduce((sum, it, idx) => {
        if (cancelledSet.has(idx)) return sum;
        return sum + getItemSubtotal(it);
      }, 0);

      // Determine if all food/bar items are now cancelled
      const nonCancelledItems = items.filter((_, idx) => !cancelledSet.has(idx));
      const hadFood = items.some(isFoodItem);
      const hadDrinks = items.some(isDrinkItem);
      const hasActiveFood = nonCancelledItems.some(isFoodItem);
      const hasActiveDrinks = nonCancelledItems.some(isDrinkItem);

      const updateData: Record<string, unknown> = {
        cancelledItems: newCancelledItems,
        total: newTotal,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (hadFood && !hasActiveFood) updateData.estadoCocina = null;
      if (hadDrinks && !hasActiveDrinks) updateData.estadoBarra = null;

      transaction.update(pedidoRef, updateData);

      // Return stock for this item
      for (const movement of item.stockMovements ?? []) {
        const stockSnap = stockSnaps.get(movement.stockItemId);
        const stockRef = stockRefs.get(movement.stockItemId);
        if (!stockSnap?.exists || !stockRef) continue;
        const currentQty = Number(stockSnap.data()!.currentQuantity ?? 0);
        transaction.update(stockRef, {
          currentQuantity: currentQty + movement.quantity,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    });

    // If all items in this pedido are now cancelled, check whether the entire session
    // has no active items left — if so, delete the cuenta and unlock the session.
    if (cancelledItemsCountAfter === totalItemsCount && pedidoSessionId) {
      const siblingSnap = await db
        .collection(`restaurants/${restaurantId}/pedidos`)
        .where("sessionId", "==", pedidoSessionId)
        .get();

      const hasActiveItemsElsewhere = siblingSnap.docs.some((docSnap) => {
        if (docSnap.id === pedidoId) return false; // already fully cancelled above
        const d = docSnap.data();
        if (d.cancelado === true) return false;
        const siblingItems: unknown[] = Array.isArray(d.items) ? d.items : [];
        const siblingCancelled: { itemIndex: number }[] = Array.isArray(d.cancelledItems) ? d.cancelledItems : [];
        const cancelledIndices = new Set(siblingCancelled.map((c) => c.itemIndex));
        return siblingItems.some((_, idx) => !cancelledIndices.has(idx));
      });

      if (!hasActiveItemsElsewhere) {
        const cuentaRef = db.doc(`restaurants/${restaurantId}/cuentas/${pedidoSessionId}`);
        const sessionRef = db.doc(`restaurants/${restaurantId}/sessions/${pedidoSessionId}`);
        const [cuentaSnap, sessionSnap] = await Promise.all([cuentaRef.get(), sessionRef.get()]);

        const batch = db.batch();
        if (cuentaSnap.exists) {
          const estado = cuentaSnap.data()?.estado;
          if (estado !== "pagada" && estado !== "cerrada") {
            batch.delete(cuentaRef);
          }
        }
        if (sessionSnap.exists && sessionSnap.data()?.status === "active") {
          batch.update(sessionRef, {
            billRequested: false,
            ordersLocked: false,
            lockedReason: null,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
        await batch.commit();
      }
    }

    // Audit log (best-effort, outside transaction)
    try {
      const auditRef = db.collection(`restaurants/${restaurantId}/auditLogs`).doc();
      await auditRef.set({
        restaurantId,
        action: "cancel_item",
        actorUid: actorUid.trim(),
        actorEmail: (actorEmail ?? "").trim(),
        actorRole: "cashier",
        entityType: "pedido",
        entityId: pedidoId,
        pedidoId,
        description: `Caja canceló el ítem "${cancelledItem ? (cancelledItem as CancelledItem).name : ""}" del pedido ${pedidoId}`,
        reason: reason.trim(),
        changes: {
          before: { cancelled: false, itemIndex },
          after: { cancelled: true, itemIndex },
        },
        metadata: { itemIndex, itemName: cancelledItem ? (cancelledItem as CancelledItem).name : "" },
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (auditErr) {
      console.error("Audit log failed (non-blocking):", auditErr);
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Error en cancel-item:", error);

    if (!(error instanceof UserFacingError)) {
      Sentry.captureException(error, {
        extra: { restaurantId: (req.body as { restaurantId?: string })?.restaurantId },
      });
      await Sentry.flush(2000);
    }

    return res.status(400).json({ ok: false, error: toApiErrorMessage(error) });
  }
}
