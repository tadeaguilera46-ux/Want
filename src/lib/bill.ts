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

export const getCuentaBySessionId = async (
  restaurantId: string,
  sessionId: string
): Promise<CuentaRecord | null> => {
  const normalizedRestaurantId = normalizeRestaurantId(restaurantId);
  const normalizedSessionId = normalizeSessionId(sessionId);

  const snapshot = await getDoc(
    cuentaDocRef(normalizedRestaurantId, normalizedSessionId)
  );

  if (!snapshot.exists()) {
    return null;
  }

  return {
    id: snapshot.id,
    ...(snapshot.data() as Omit<CuentaRecord, "id">),
  };
};

export const pedirCuenta = async (data: CuentaInput) => {
  validateCuentaInput(data);

  const restaurantId = normalizeRestaurantId(data.restaurantId);
  const mesa = data.mesa;

  let cuentaId = "";

  await runTransaction(db, async (transaction) => {
    const mesaRef = mesaDocRef(restaurantId, mesa);
    const mesaSnapshot = await transaction.get(mesaRef);

    if (!mesaSnapshot.exists()) {
      throw new Error("La mesa no existe");
    }

    const mesaData = mesaSnapshot.data();
    const mesaEstado = mesaData?.estado;
    const activeSessionId = mesaData?.activeSessionId;
    const now = serverTimestamp();

    if (mesaEstado !== "occupied") {
      throw new Error("La mesa no está ocupada");
    }

    if (typeof activeSessionId !== "string" || !activeSessionId.trim()) {
      throw new Error("La mesa no tiene una sesión activa");
    }

    const normalizedSessionId = normalizeSessionId(activeSessionId);
    const sessionRef = sessionDocRef(restaurantId, normalizedSessionId);
    const sessionSnapshot = await transaction.get(sessionRef);

    if (!sessionSnapshot.exists()) {
      throw new Error(
        `Inconsistencia: la mesa ${mesa} referencia una sesión inexistente (${normalizedSessionId})`
      );
    }

    const sessionData = sessionSnapshot.data();

    if (sessionData?.status !== "active") {
      throw new Error(
        `Inconsistencia: la mesa ${mesa} referencia una sesión no activa (${normalizedSessionId})`
      );
    }

    if (sessionData?.tableNumber !== mesa) {
      throw new Error(
        `Inconsistencia: la sesión ${normalizedSessionId} pertenece a otra mesa`
      );
    }

    const ref = cuentaDocRef(restaurantId, normalizedSessionId);
    const cuentaSnapshot = await transaction.get(ref);

    cuentaId = normalizedSessionId;

    if (cuentaSnapshot.exists()) {
      const cuentaData = cuentaSnapshot.data() as Omit<CuentaRecord, "id">;

      if (
        typeof cuentaData.sessionId === "string" &&
        cuentaData.sessionId !== normalizedSessionId
      ) {
        throw new Error(
          `Inconsistencia: la cuenta ${normalizedSessionId} no coincide con su sessionId`
        );
      }

      if (
        typeof cuentaData.mesa === "number" &&
        cuentaData.mesa !== mesa
      ) {
        throw new Error(
          `Inconsistencia: la cuenta ${normalizedSessionId} pertenece a otra mesa`
        );
      }

      const nuevoEstado: EstadoCuenta =
        cuentaData.estado === "pagada" || cuentaData.estado === "cerrada"
          ? "pendiente"
          : cuentaData.estado;

      transaction.set(
        ref,
        {
          restaurantId,
          mesa,
          metodo: data.metodo,
          total: data.total,
          splitBill: data.splitBill,
          sessionId: normalizedSessionId,
          estado: nuevoEstado,
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
      total: data.total,
      splitBill: data.splitBill,
      sessionId: normalizedSessionId,
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
    const now = serverTimestamp();

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

    if (estado !== "pagada") {
      transaction.update(cuentaRef, {
        estado,
        updatedAt: now,
      });
      return;
    }

    const mesaRef = mesaDocRef(normalizedRestaurantId, mesaObjetivo);
    const mesaSnapshot = await transaction.get(mesaRef);

    if (!mesaSnapshot.exists()) {
      throw new Error(`La mesa ${mesaObjetivo} no existe`);
    }

    const mesaData = mesaSnapshot.data();
    const activeSessionId = mesaData?.activeSessionId;

    if (
      activeSessionId !== null &&
      activeSessionId !== undefined &&
      activeSessionId !== sessionId
    ) {
      throw new Error(
        `Inconsistencia: la mesa ${mesaObjetivo} tiene otra sesión activa`
      );
    }

    transaction.update(cuentaRef, {
      estado: "pagada",
      updatedAt: now,
    });

    if (sessionData?.status === "active") {
      transaction.update(sessionRef, {
        status: "closed",
        closedAt: now,
        closedReason: "bill_paid",
        updatedAt: now,
      });
    }

    transaction.set(
      mesaRef,
      {
        restaurantId: normalizedRestaurantId,
        numero: mesaObjetivo,
        estado: "needs_cleaning",
        activeSessionId: null,
        cleanedAt: null,
        createdAt: mesaData?.createdAt ?? now,
        updatedAt: now,
      },
      { merge: true }
    );
  });
};