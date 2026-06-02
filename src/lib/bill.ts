import { getDb } from "../lib/firebase";
import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { mesaDocRef } from "./mesas";
import { sessionDocRef } from "./sessions";
import type { CuentaInput, CuentaRecord, EstadoCuenta } from "./restaurant";

const db = getDb();

const BILL_LOCKED_REASON = "bill_requested";

const isValidRestaurantId = (restaurantId: string) => {
  return typeof restaurantId === "string" && restaurantId.trim().length > 0;
};

const normalizeRestaurantId = (restaurantId: string) => {
  const normalized = restaurantId.trim();

  if (!isValidRestaurantId(normalized)) {
    throw new Error("restaurantId inválido");
  }

  return normalized;
};

const isValidMesaNumber = (mesa: number) => {
  return Number.isInteger(mesa) && mesa > 0;
};

const assertValidMesaNumber = (mesa: number) => {
  if (!isValidMesaNumber(mesa)) {
    throw new Error("Mesa inválida");
  }
};

const isValidSessionId = (sessionId: string) => {
  return typeof sessionId === "string" && sessionId.trim().length > 0;
};

const normalizeSessionId = (sessionId: string) => {
  const normalized = sessionId.trim();

  if (!isValidSessionId(normalized)) {
    throw new Error("sessionId inválido");
  }

  return normalized;
};

const assertValidTotal = (total: number) => {
  if (typeof total !== "number" || !Number.isFinite(total) || total < 0) {
    throw new Error("Total inválido");
  }
};

const cuentaDocRef = (restaurantId: string, sessionId: string) =>
  doc(
    db,
    "restaurants",
    normalizeRestaurantId(restaurantId),
    "cuentas",
    normalizeSessionId(sessionId)
  );

const validateCuentaInput = (data: CuentaInput) => {
  if (!isValidRestaurantId(data.restaurantId)) {
    throw new Error("restaurantId inválido");
  }

  assertValidMesaNumber(data.mesa);
  assertValidTotal(data.total);
};

const getActiveSessionIdForMesa = async (restaurantId: string, mesa: number) => {
  const mesaSnapshot = await getDoc(mesaDocRef(restaurantId, mesa));

  if (!mesaSnapshot.exists()) {
    throw new Error("La mesa no existe");
  }

  const mesaData = mesaSnapshot.data();
  const mesaEstado = mesaData?.estado;
  const activeSessionId = mesaData?.activeSessionId;

  if (mesaEstado !== "occupied") {
    throw new Error("La mesa no está ocupada");
  }

  if (typeof activeSessionId !== "string" || !activeSessionId.trim()) {
    throw new Error("La mesa no tiene una sesión activa");
  }

  return normalizeSessionId(activeSessionId);
};

const calcularTotalRealSesion = async ({
  restaurantId,
  mesa,
  sessionId,
}: {
  restaurantId: string;
  mesa: number;
  sessionId: string;
}): Promise<number> => {
  const url = `/api/get-session-bill?restaurantId=${encodeURIComponent(restaurantId)}&sessionId=${encodeURIComponent(sessionId)}&mesa=${encodeURIComponent(String(mesa))}`;
  const response = await fetch(url);
  const data = await response.json() as { ok: boolean; total?: number; error?: string };

  if (!data.ok) {
    throw new Error(data.error || "No se pudo calcular el total de la sesión.");
  }

  return Number(data.total ?? 0);
};

export const getCuentaBySessionId = async (
  restaurantId: string,
  sessionId: string
): Promise<CuentaRecord | null> => {
  const normalizedRestaurantId = normalizeRestaurantId(restaurantId);
  const normalizedSessionId = normalizeSessionId(sessionId);

  const snapshot = await getDoc(
    cuentaDocRef(normalizedRestaurantId, normalizedSessionId)
  );

  if (!snapshot.exists()) return null;

  return {
    id: snapshot.id,
    ...(snapshot.data() as Omit<CuentaRecord, "id">),
  };
};

export const pedirCuenta = async (data: CuentaInput) => {
  validateCuentaInput(data);

  const restaurantId = normalizeRestaurantId(data.restaurantId);
  const mesa = data.mesa;

  const activeSessionId = await getActiveSessionIdForMesa(restaurantId, mesa);

  const totalReal = await calcularTotalRealSesion({
    restaurantId,
    mesa,
    sessionId: activeSessionId,
  });

  let cuentaId = "";

  await runTransaction(db, async (transaction) => {
    const mesaRef = mesaDocRef(restaurantId, mesa);
    const mesaSnapshot = await transaction.get(mesaRef);

    if (!mesaSnapshot.exists()) {
      throw new Error("La mesa no existe");
    }

    const mesaData = mesaSnapshot.data();
    const mesaEstado = mesaData?.estado;
    const currentActiveSessionId = mesaData?.activeSessionId;

    if (mesaEstado !== "occupied") {
      throw new Error("La mesa no está ocupada");
    }

    if (currentActiveSessionId !== activeSessionId) {
      throw new Error("La sesión de la mesa cambió. Volvé a pedir la cuenta.");
    }

    const sessionRef = sessionDocRef(restaurantId, activeSessionId);
    const sessionSnapshot = await transaction.get(sessionRef);

    if (!sessionSnapshot.exists()) {
      throw new Error(
        `Inconsistencia: la mesa ${mesa} referencia una sesión inexistente (${activeSessionId})`
      );
    }

    const sessionData = sessionSnapshot.data();

    if (sessionData?.status !== "active") {
      throw new Error(
        `Inconsistencia: la mesa ${mesa} referencia una sesión no activa (${activeSessionId})`
      );
    }

    if (sessionData?.tableNumber !== mesa) {
      throw new Error(
        `Inconsistencia: la sesión ${activeSessionId} pertenece a otra mesa`
      );
    }

    const ref = cuentaDocRef(restaurantId, activeSessionId);
    const cuentaSnapshot = await transaction.get(ref);

    const now = serverTimestamp();
    cuentaId = activeSessionId;

    transaction.set(
      sessionRef,
      {
        billRequested: true,
        billRequestedAt: now,
        ordersLocked: true,
        lockedReason: BILL_LOCKED_REASON,
        updatedAt: now,
      },
      { merge: true }
    );

    if (cuentaSnapshot.exists()) {
      const cuentaData = cuentaSnapshot.data() as Omit<CuentaRecord, "id">;

      if (
        typeof cuentaData.sessionId === "string" &&
        cuentaData.sessionId !== activeSessionId
      ) {
        throw new Error(
          `Inconsistencia: la cuenta ${activeSessionId} no coincide con su sessionId`
        );
      }

      if (typeof cuentaData.mesa === "number" && cuentaData.mesa !== mesa) {
        throw new Error(
          `Inconsistencia: la cuenta ${activeSessionId} pertenece a otra mesa`
        );
      }

      if (
        cuentaData.estado === "pagada" ||
        cuentaData.estado === "cerrada"
      ) {
        throw new Error(
          "La cuenta ya fue procesada. Si hay algún problema, consultá con el personal del local."
        );
      }

      transaction.set(
        ref,
        {
          restaurantId,
          mesa,
          metodo: data.metodo,
          total: totalReal,
          splitBill: data.splitBill,
          sessionId: activeSessionId,
          estado: cuentaData.estado,
          createdAt: cuentaData.createdAt ?? now,
          updatedAt: now,
        },
        { merge: true }
      );

      return;
    }

    transaction.set(ref, {
      restaurantId,
      mesa,
      metodo: data.metodo,
      total: totalReal,
      splitBill: data.splitBill,
      sessionId: activeSessionId,
      estado: "pendiente" as EstadoCuenta,
      createdAt: now,
      updatedAt: now,
    });
  });

  return cuentaId;
};

export const actualizarEstadoCuenta = async (
  restaurantId: string,
  id: string,
  estado: EstadoCuenta,
  mesa?: number
) => {
  const normalizedRestaurantId = normalizeRestaurantId(restaurantId);
  const sessionId = normalizeSessionId(id);

  await runTransaction(db, async (transaction) => {
    const cuentaRef = cuentaDocRef(normalizedRestaurantId, sessionId);
    const cuentaSnapshot = await transaction.get(cuentaRef);

    if (!cuentaSnapshot.exists()) {
      throw new Error("La cuenta no existe");
    }

    const cuentaData = cuentaSnapshot.data() as Omit<CuentaRecord, "id">;

    if (
      typeof cuentaData.sessionId === "string" &&
      cuentaData.sessionId !== sessionId
    ) {
      throw new Error(
        `Inconsistencia: la cuenta ${sessionId} no coincide con su sessionId`
      );
    }

    const mesaObjetivo =
      typeof mesa === "number" ? mesa : Number(cuentaData.mesa);

    if (!Number.isInteger(mesaObjetivo) || mesaObjetivo <= 0) {
      throw new Error("Mesa inválida al actualizar estado de cuenta");
    }

    const sessionRef = sessionDocRef(normalizedRestaurantId, sessionId);
    const sessionSnapshot = await transaction.get(sessionRef);

    if (!sessionSnapshot.exists()) {
      throw new Error(`La sesión ${sessionId} no existe`);
    }

    const sessionData = sessionSnapshot.data();

    if (sessionData?.tableNumber !== mesaObjetivo) {
      throw new Error(
        `Inconsistencia: la cuenta ${sessionId} no pertenece a la mesa ${mesaObjetivo}`
      );
    }

    const now = serverTimestamp();

    if (estado !== "pagada") {
      transaction.update(cuentaRef, {
        estado,
        updatedAt: now,
      });

      return;
    }

    transaction.update(cuentaRef, {
      estado: "pagada",
      paidAt: now,
      updatedAt: now,
    });

    transaction.set(
      sessionRef,
      {
        billRequested: true,
        ordersLocked: true,
        lockedReason: BILL_LOCKED_REASON,
        updatedAt: now,
      },
      { merge: true }
    );
  });
};