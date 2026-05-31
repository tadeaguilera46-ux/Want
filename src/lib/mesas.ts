import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  type DocumentData,
  type Timestamp,
} from "firebase/firestore";
import { getDb } from "../lib/firebase";
import {
  getSessionById,
  sessionDocRef,
  type SessionStatus,
} from "./sessions";

const db = getDb();

export type MesaEstado = "available" | "occupied" | "needs_cleaning";

export interface Mesa {
  restaurantId: string;
  numero: number;
  estado: MesaEstado;
  activeSessionId: string | null;
  lastSessionId?: string | null;
  active?: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  cleanedAt?: Timestamp | null;
}

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

const isValidMesaNumber = (numero: number) => {
  return Number.isInteger(numero) && numero > 0;
};

const assertValidMesaNumber = (numero: number) => {
  if (!isValidMesaNumber(numero)) {
    throw new Error("Número de mesa inválido");
  }
};

const isValidMesaEstado = (estado: unknown): estado is MesaEstado => {
  return (
    estado === "available" ||
    estado === "occupied" ||
    estado === "needs_cleaning"
  );
};

export const mesaDocRef = (restaurantId: string, numero: number) => {
  const normalizedRestaurantId = normalizeRestaurantId(restaurantId);
  assertValidMesaNumber(numero);

  return doc(db, "restaurants", normalizedRestaurantId, "mesas", String(numero));
};

const sessionsCollectionRef = (restaurantId: string) => {
  const normalizedRestaurantId = normalizeRestaurantId(restaurantId);

  return collection(db, "restaurants", normalizedRestaurantId, "sessions");
};

const getActiveSessionIdsByMesa = async (
  restaurantId: string,
  numero: number
) => {
  const normalizedRestaurantId = normalizeRestaurantId(restaurantId);
  assertValidMesaNumber(numero);

  const q = query(
    sessionsCollectionRef(normalizedRestaurantId),
    where("tableNumber", "==", numero),
    where("status", "==", "active")
  );

  const snapshot = await getDocs(q);

  return snapshot.docs.map((docSnap) => docSnap.id);
};

const mapMesa = (
  restaurantId: string,
  numero: number,
  data?: DocumentData
): Mesa | null => {
  if (!data) return null;

  if (!isValidMesaEstado(data.estado)) {
    return null;
  }

  const activeSessionId =
    data.activeSessionId === null || typeof data.activeSessionId === "string"
      ? data.activeSessionId
      : null;

  if (
    data.activeSessionId !== undefined &&
    activeSessionId === null &&
    data.activeSessionId !== null
  ) {
    return null;
  }

  const lastSessionId =
    data.lastSessionId === null || typeof data.lastSessionId === "string"
      ? data.lastSessionId
      : null;

  return {
    restaurantId,
    numero,
    estado: data.estado,
    activeSessionId,
    lastSessionId,
    active: data.active !== false,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    cleanedAt: data.cleanedAt ?? null,
  };
};

const requireValidMesa = (
  restaurantId: string,
  numero: number,
  data?: DocumentData
): Mesa => {
  const mesa = mapMesa(restaurantId, numero, data);

  if (!mesa) {
    throw new Error(
      `Documento inválido de mesa: restaurantId=${restaurantId}, mesa=${numero}`
    );
  }

  return mesa;
};

const buildNewSessionData = ({
  restaurantId,
  numero,
}: {
  restaurantId: string;
  numero: number;
}) => ({
  restaurantId,
  tableNumber: numero,
  status: "active" as SessionStatus,
  openedAt: serverTimestamp(),
  closedAt: null,
  cleanedAt: null,
  closedReason: null,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});

export const getMesa = async (
  restaurantId: string,
  numero: number
): Promise<Mesa> => {
  const normalizedRestaurantId = normalizeRestaurantId(restaurantId);
  assertValidMesaNumber(numero);

  const snapshot = await getDoc(mesaDocRef(normalizedRestaurantId, numero));

  if (!snapshot.exists()) {
    return {
      restaurantId: normalizedRestaurantId,
      numero,
      estado: "available",
      activeSessionId: null,
      lastSessionId: null,
      cleanedAt: null,
    };
  }

  return requireValidMesa(normalizedRestaurantId, numero, snapshot.data());
};

export const getMesaActiveSessionId = async (
  restaurantId: string,
  numero: number
): Promise<string | null> => {
  const mesa = await getMesa(restaurantId, numero);

  if (mesa.estado === "available" || !mesa.activeSessionId) {
    return null;
  }

  const session = await getSessionById(restaurantId, mesa.activeSessionId);

  if (!session) {
    throw new Error(
      `Inconsistencia: la mesa ${numero} apunta a una sesión inexistente (${mesa.activeSessionId})`
    );
  }

  if (session.status !== "active") {
    throw new Error(
      `Inconsistencia: la mesa ${numero} apunta a una sesión no activa (${mesa.activeSessionId})`
    );
  }

  return mesa.activeSessionId;
};

export const getOrCreateMesaSession = async (
  restaurantId: string,
  numero: number
): Promise<string> => {
  const normalizedRestaurantId = normalizeRestaurantId(restaurantId);
  assertValidMesaNumber(numero);

  return runTransaction(db, async (transaction) => {
    const ref = mesaDocRef(normalizedRestaurantId, numero);
    const mesaSnapshot = await transaction.get(ref);
    const now = serverTimestamp();

    if (mesaSnapshot.exists()) {
      const mesa = requireValidMesa(
        normalizedRestaurantId,
        numero,
        mesaSnapshot.data()
      );

      if (mesa.active === false) {
        throw new Error(
          "Esta mesa no está disponible. Consultá al staff."
        );
      }

      if (mesa.activeSessionId) {
        const existingSessionRef = sessionDocRef(
          normalizedRestaurantId,
          mesa.activeSessionId
        );

        const existingSessionSnapshot =
          await transaction.get(existingSessionRef);

        if (!existingSessionSnapshot.exists()) {
          throw new Error(
            `Inconsistencia: la mesa ${numero} referencia una sesión inexistente (${mesa.activeSessionId})`
          );
        }

        const existingSessionData = existingSessionSnapshot.data();
        const status = existingSessionData?.status;
        const tableNumber = existingSessionData?.tableNumber;

        if (status !== "active") {
          throw new Error(
            `Inconsistencia: la mesa ${numero} referencia una sesión cerrada (${mesa.activeSessionId})`
          );
        }

        if (tableNumber !== numero) {
          throw new Error(
            `Inconsistencia: la sesión ${mesa.activeSessionId} pertenece a otra mesa`
          );
        }

        if (mesa.estado !== "occupied") {
          transaction.set(
            ref,
            {
              restaurantId: normalizedRestaurantId,
              numero,
              estado: "occupied",
              activeSessionId: mesa.activeSessionId,
              lastSessionId: null,
              cleanedAt: null,
              createdAt: mesa.createdAt ?? now,
              updatedAt: now,
            },
            { merge: true }
          );
        }

        return mesa.activeSessionId;
      }
    }

    const sessionId = crypto.randomUUID();
    const newSessionRef = sessionDocRef(normalizedRestaurantId, sessionId);

    transaction.set(
      newSessionRef,
      buildNewSessionData({
        restaurantId: normalizedRestaurantId,
        numero,
      })
    );

    transaction.set(
      ref,
      {
        restaurantId: normalizedRestaurantId,
        numero,
        estado: "occupied",
        activeSessionId: sessionId,
        lastSessionId: null,
        cleanedAt: null,
        createdAt: mesaSnapshot.data()?.createdAt ?? now,
        updatedAt: now,
      },
      { merge: true }
    );

    return sessionId;
  });
};

export const markMesaNeedsCleaning = async (
  restaurantId: string,
  numero: number
) => {
  const normalizedRestaurantId = normalizeRestaurantId(restaurantId);
  assertValidMesaNumber(numero);

  const activeSessionIds = await getActiveSessionIdsByMesa(
    normalizedRestaurantId,
    numero
  );

  await runTransaction(db, async (transaction) => {
    const ref = mesaDocRef(normalizedRestaurantId, numero);
    const mesaSnapshot = await transaction.get(ref);
    const now = serverTimestamp();

    if (!mesaSnapshot.exists()) {
      transaction.set(
        ref,
        {
          restaurantId: normalizedRestaurantId,
          numero,
          estado: "needs_cleaning",
          activeSessionId: null,
          lastSessionId: null,
          cleanedAt: null,
          createdAt: now,
          updatedAt: now,
        },
        { merge: true }
      );

      return;
    }

    const mesa = requireValidMesa(
      normalizedRestaurantId,
      numero,
      mesaSnapshot.data()
    );

    const sessionIdToKeep =
      mesa.activeSessionId ?? activeSessionIds[0] ?? mesa.lastSessionId ?? null;

    // Include mesa.activeSessionId (read inside the transaction) to close any
    // session created after the pre-transaction query (TOCTOU fix).
    const allSessionIdsToClose = new Set(activeSessionIds);
    if (mesa.activeSessionId) {
      allSessionIdsToClose.add(mesa.activeSessionId);
    }

    const sessionReads = await Promise.all(
      Array.from(allSessionIdsToClose).map(async (sessionId) => {
        const sessionRef = sessionDocRef(normalizedRestaurantId, sessionId);
        const sessionSnapshot = await transaction.get(sessionRef);

        return {
          sessionRef,
          sessionSnapshot,
        };
      })
    );

    for (const { sessionRef, sessionSnapshot } of sessionReads) {
      if (!sessionSnapshot.exists()) continue;

      const sessionData = sessionSnapshot.data();

      if (
        sessionData?.status === "active" &&
        sessionData?.tableNumber === numero
      ) {
        transaction.update(sessionRef, {
          status: "closed",
          closedAt: now,
          closedReason: "staff_closed",
          updatedAt: now,
        });
      }
    }

    transaction.set(
      ref,
      {
        restaurantId: normalizedRestaurantId,
        numero,
        estado: "needs_cleaning",
        activeSessionId: null,
        lastSessionId: sessionIdToKeep,
        cleanedAt: null,
        createdAt: mesa.createdAt ?? now,
        updatedAt: now,
      },
      { merge: true }
    );
  });
};

export const markMesaAvailable = async (
  restaurantId: string,
  numero: number
) => {
  const normalizedRestaurantId = normalizeRestaurantId(restaurantId);
  assertValidMesaNumber(numero);

  const activeSessionIds = await getActiveSessionIdsByMesa(
    normalizedRestaurantId,
    numero
  );

  await runTransaction(db, async (transaction) => {
    const ref = mesaDocRef(normalizedRestaurantId, numero);
    const mesaSnapshot = await transaction.get(ref);
    const now = serverTimestamp();

    let lastSessionId: string | null = null;
    let createdAt: Timestamp | undefined;
    let currentActiveSessionId: string | null = null;

    if (mesaSnapshot.exists()) {
      const mesa = requireValidMesa(
        normalizedRestaurantId,
        numero,
        mesaSnapshot.data()
      );

      lastSessionId =
        mesa.activeSessionId ?? activeSessionIds[0] ?? mesa.lastSessionId ?? null;

      currentActiveSessionId = mesa.activeSessionId ?? null;
      createdAt = mesa.createdAt;
    }

    // Include the session the mesa currently points to (read inside transaction)
    // so a session created after the pre-transaction query is also closed (TOCTOU fix).
    const allSessionIdsToClose = new Set(activeSessionIds);
    if (currentActiveSessionId) {
      allSessionIdsToClose.add(currentActiveSessionId);
    }

    const activeSessionReads = await Promise.all(
      Array.from(allSessionIdsToClose).map(async (sessionId) => {
        const sessionRef = sessionDocRef(normalizedRestaurantId, sessionId);
        const sessionSnapshot = await transaction.get(sessionRef);

        return {
          sessionRef,
          sessionSnapshot,
        };
      })
    );

    let lastSessionRead:
      | {
          sessionRef: ReturnType<typeof sessionDocRef>;
          sessionSnapshot: Awaited<ReturnType<typeof transaction.get>>;
        }
      | null = null;

    if (lastSessionId && !allSessionIdsToClose.has(lastSessionId)) {
      const sessionRef = sessionDocRef(normalizedRestaurantId, lastSessionId);
      const sessionSnapshot = await transaction.get(sessionRef);

      lastSessionRead = {
        sessionRef,
        sessionSnapshot,
      };
    }

    for (const { sessionRef, sessionSnapshot } of activeSessionReads) {
      if (!sessionSnapshot.exists()) continue;

      const sessionData = sessionSnapshot.data();

      if (
        sessionData?.status === "active" &&
        sessionData?.tableNumber === numero
      ) {
        transaction.update(sessionRef, {
          status: "closed",
          closedAt: now,
          closedReason: "table_reset",
          cleanedAt: now,
          updatedAt: now,
        });
      }
    }

    if (lastSessionRead?.sessionSnapshot.exists()) {
      transaction.set(
        lastSessionRead.sessionRef,
        {
          cleanedAt: now,
          updatedAt: now,
        },
        { merge: true }
      );
    }

    transaction.set(
      ref,
      {
        restaurantId: normalizedRestaurantId,
        numero,
        estado: "available",
        activeSessionId: null,
        lastSessionId: null,
        createdAt: createdAt ?? now,
        updatedAt: now,
        cleanedAt: now,
      },
      { merge: true }
    );
  });
};

export const closeMesaSessionManually = async (
  restaurantId: string,
  numero: number
) => {
  const normalizedRestaurantId = normalizeRestaurantId(restaurantId);
  assertValidMesaNumber(numero);

  const activeSessionIds = await getActiveSessionIdsByMesa(
    normalizedRestaurantId,
    numero
  );

  await runTransaction(db, async (transaction) => {
    const ref = mesaDocRef(normalizedRestaurantId, numero);
    const mesaSnapshot = await transaction.get(ref);
    const now = serverTimestamp();

    if (!mesaSnapshot.exists()) {
      transaction.set(
        ref,
        {
          restaurantId: normalizedRestaurantId,
          numero,
          estado: "needs_cleaning",
          activeSessionId: null,
          lastSessionId: null,
          cleanedAt: null,
          createdAt: now,
          updatedAt: now,
        },
        { merge: true }
      );

      return;
    }

    const mesa = requireValidMesa(
      normalizedRestaurantId,
      numero,
      mesaSnapshot.data()
    );

    const sessionIdToKeep =
      mesa.activeSessionId ?? activeSessionIds[0] ?? mesa.lastSessionId ?? null;

    // Include mesa.activeSessionId (read inside the transaction) so a session
    // created after the pre-transaction query is also closed (TOCTOU fix).
    const allSessionIdsToClose = new Set(activeSessionIds);
    if (mesa.activeSessionId) {
      allSessionIdsToClose.add(mesa.activeSessionId);
    }

    const sessionReads = await Promise.all(
      Array.from(allSessionIdsToClose).map(async (sessionId) => {
        const sessionRef = sessionDocRef(normalizedRestaurantId, sessionId);
        const sessionSnapshot = await transaction.get(sessionRef);

        return {
          sessionRef,
          sessionSnapshot,
        };
      })
    );

    for (const { sessionRef, sessionSnapshot } of sessionReads) {
      if (!sessionSnapshot.exists()) continue;

      const sessionData = sessionSnapshot.data();

      if (
        sessionData?.status === "active" &&
        sessionData?.tableNumber === numero
      ) {
        transaction.update(sessionRef, {
          status: "closed",
          closedAt: now,
          closedReason: "staff_closed",
          updatedAt: now,
        });
      }
    }

    transaction.set(
      ref,
      {
        restaurantId: normalizedRestaurantId,
        numero,
        estado: "needs_cleaning",
        activeSessionId: null,
        lastSessionId: sessionIdToKeep,
        cleanedAt: null,
        createdAt: mesa.createdAt ?? now,
        updatedAt: now,
      },
      { merge: true }
    );
  });
};

export const createMesaIfNotExists = async (
  restaurantId: string,
  numero: number
) => {
  const normalizedRestaurantId = normalizeRestaurantId(restaurantId);
  assertValidMesaNumber(numero);

  const ref = mesaDocRef(normalizedRestaurantId, numero);
  const snapshot = await getDoc(ref);

  if (snapshot.exists()) return;

  await setDoc(ref, {
    restaurantId: normalizedRestaurantId,
    numero,
    estado: "available",
    activeSessionId: null,
    lastSessionId: null,
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    cleanedAt: null,
  });
};

export const setMesaActive = async (
  restaurantId: string,
  numero: number,
  active: boolean
) => {
  const normalizedRestaurantId = normalizeRestaurantId(restaurantId);
  assertValidMesaNumber(numero);

  const mesa = await getMesa(normalizedRestaurantId, numero);

  if (!active && mesa.estado === "occupied") {
    throw new Error("No se puede desactivar una mesa ocupada");
  }

  if (!active) {
    const activeSessionIds = await getActiveSessionIdsByMesa(
      normalizedRestaurantId,
      numero
    );

    await runTransaction(db, async (transaction) => {
      const ref = mesaDocRef(normalizedRestaurantId, numero);
      const now = serverTimestamp();

      const sessionReads = await Promise.all(
        activeSessionIds.map(async (sessionId) => {
          const sessionRef = sessionDocRef(normalizedRestaurantId, sessionId);
          const sessionSnapshot = await transaction.get(sessionRef);

          return {
            sessionRef,
            sessionSnapshot,
          };
        })
      );

      for (const { sessionRef, sessionSnapshot } of sessionReads) {
        if (!sessionSnapshot.exists()) continue;

        const sessionData = sessionSnapshot.data();

        if (
          sessionData?.status === "active" &&
          sessionData?.tableNumber === numero
        ) {
          transaction.update(sessionRef, {
            status: "closed",
            closedAt: now,
            closedReason: "table_reset",
            updatedAt: now,
          });
        }
      }

      transaction.set(
        ref,
        {
          restaurantId: normalizedRestaurantId,
          numero,
          active,
          estado: "available",
          activeSessionId: null,
          lastSessionId: null,
          updatedAt: now,
        },
        { merge: true }
      );
    });

    return;
  }

  await setDoc(
    mesaDocRef(normalizedRestaurantId, numero),
    {
      restaurantId: normalizedRestaurantId,
      numero,
      active,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
};