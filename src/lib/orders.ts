import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { getDb } from "../lib/firebase";
import { mesaDocRef } from "./mesas";
import { sessionDocRef, type SessionStatus } from "./sessions";
import type { PedidoInput, PedidoItem } from "./restaurant";

const db = getDb();

const isValidRestaurantId = (restaurantId: string) => {
  return typeof restaurantId === "string" && restaurantId.trim().length > 0;
};

const normalizeRestaurantId = (restaurantId: string) => {
  const normalized = restaurantId.trim();

  if (!isValidRestaurantId(normalized)) {
    throw new Error("Falta restaurantId al crear el pedido");
  }

  return normalized;
};

const isValidMesaNumber = (mesa: number) => {
  return Number.isInteger(mesa) && mesa > 0;
};

const isValidTotal = (total: number) => {
  return typeof total === "number" && Number.isFinite(total) && total >= 0;
};

const validatePedidoItem = (item: PedidoItem, index: number) => {
  if (!item || typeof item !== "object") {
    throw new Error(`Item inválido en posición ${index}`);
  }

  if (typeof item.category !== "string" || item.category.trim().length === 0) {
    throw new Error(`category inválida en item ${index}`);
  }
};

const validatePedidoInput = (pedido: PedidoInput) => {
  if (!isValidRestaurantId(pedido.restaurantId)) {
    throw new Error("Falta restaurantId al crear el pedido");
  }

  if (!isValidMesaNumber(pedido.mesa)) {
    throw new Error("Mesa inválida al crear el pedido");
  }

  if (!Array.isArray(pedido.items) || pedido.items.length === 0) {
    throw new Error("El pedido no tiene items");
  }

  if (!isValidTotal(pedido.total)) {
    throw new Error("Total inválido al crear el pedido");
  }

  pedido.items.forEach(validatePedidoItem);
};

const buildNewSessionData = ({
  restaurantId,
  mesa,
}: {
  restaurantId: string;
  mesa: number;
}) => ({
  restaurantId,
  tableNumber: mesa,
  status: "active" as SessionStatus,
  openedAt: serverTimestamp(),
  closedAt: null,
  closedReason: null,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});

export const crearPedido = async (pedido: PedidoInput) => {
  validatePedidoInput(pedido);

  const restaurantId = normalizeRestaurantId(pedido.restaurantId);
  const mesa = pedido.mesa;

  const tieneComida = pedido.items.some(
    (item: PedidoItem) => item.category !== "drinks"
  );
  const tieneBebidas = pedido.items.some(
    (item: PedidoItem) => item.category === "drinks"
  );

  const pedidosRef = collection(db, "restaurants", restaurantId, "pedidos");
  const pedidoRef = doc(pedidosRef);

  await runTransaction(db, async (transaction) => {
    const mesaRef = mesaDocRef(restaurantId, mesa);
    const mesaSnapshot = await transaction.get(mesaRef);
    const now = serverTimestamp();

    let sessionId: string | null = null;
    let mesaCreatedAt = mesaSnapshot.data()?.createdAt;

    if (mesaSnapshot.exists()) {
      const mesaData = mesaSnapshot.data();
      const mesaEstado = mesaData?.estado;
      const activeSessionId = mesaData?.activeSessionId;

      if (
        activeSessionId &&
        typeof activeSessionId === "string" &&
        (mesaEstado === "occupied" || mesaEstado === "needs_cleaning")
      ) {
        const existingSessionRef = sessionDocRef(restaurantId, activeSessionId);
        const existingSessionSnapshot = await transaction.get(existingSessionRef);

        if (!existingSessionSnapshot.exists()) {
          throw new Error(
            `Inconsistencia: la mesa ${mesa} referencia una sesión inexistente (${activeSessionId})`
          );
        }

        const existingSessionData = existingSessionSnapshot.data();

        if (existingSessionData?.status !== "active") {
          throw new Error(
            `Inconsistencia: la mesa ${mesa} referencia una sesión no activa (${activeSessionId})`
          );
        }

        if (existingSessionData?.tableNumber !== mesa) {
          throw new Error(
            `Inconsistencia: la sesión ${activeSessionId} pertenece a otra mesa`
          );
        }

        sessionId = activeSessionId;
      }
    }

    if (!sessionId) {
      sessionId = crypto.randomUUID();
      const newSessionRef = sessionDocRef(restaurantId, sessionId);

      transaction.set(
        newSessionRef,
        buildNewSessionData({ restaurantId, mesa })
      );
    }

    transaction.set(
      mesaRef,
      {
        restaurantId,
        numero: mesa,
        estado: "occupied",
        activeSessionId: sessionId,
        cleanedAt: null,
        createdAt: mesaCreatedAt ?? now,
        updatedAt: now,
      },
      { merge: true }
    );

    transaction.set(pedidoRef, {
      restaurantId,
      mesa,
      items: pedido.items,
      total: pedido.total,
      sessionId,
      estadoCocina: tieneComida ? "pendiente" : null,
      estadoBarra: tieneBebidas ? "pendiente" : null,
      cancelado: false,
      createdAt: now,
      updatedAt: now,
    });
  });

  return pedidoRef.id;
};