import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type DocumentData,
  type Timestamp,
} from "firebase/firestore";
import { getDb } from "../lib/firebase";

const db = getDb();

export type SessionStatus = "active" | "closed";

export type SessionClosedReason =
  | "bill_paid"
  | "staff_closed"
  | "table_reset"
  | "unknown";

export interface Session {
  id: string;
  restaurantId: string;
  tableNumber: number;
  status: SessionStatus;
  billRequested?: boolean;
  ordersLocked?: boolean;
  lockedReason?: "bill_requested" | "table_closed" | string | null;
  openedAt?: Timestamp;
  closedAt?: Timestamp | null;
  closedReason?: SessionClosedReason | null;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
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

const isValidTableNumber = (tableNumber: number) => {
  return Number.isInteger(tableNumber) && tableNumber > 0;
};

const assertValidTableNumber = (tableNumber: number) => {
  if (!isValidTableNumber(tableNumber)) {
    throw new Error("Número de mesa inválido");
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

const isValidClosedReason = (
  value: unknown
): value is SessionClosedReason => {
  return (
    value === "bill_paid" ||
    value === "staff_closed" ||
    value === "table_reset" ||
    value === "unknown"
  );
};

const sessionsCollectionRef = (restaurantId: string) => {
  const normalizedRestaurantId = normalizeRestaurantId(restaurantId);
  return collection(db, "restaurants", normalizedRestaurantId, "sessions");
};

export const sessionDocRef = (restaurantId: string, sessionId: string) => {
  const normalizedRestaurantId = normalizeRestaurantId(restaurantId);
  const normalizedSessionId = normalizeSessionId(sessionId);

  return doc(
    db,
    "restaurants",
    normalizedRestaurantId,
    "sessions",
    normalizedSessionId
  );
};

const mapSession = (id: string, data?: DocumentData): Session | null => {
  if (!data) return null;

  const restaurantId = data.restaurantId;
  const tableNumber = data.tableNumber;
  const status = data.status;
  const closedReason = data.closedReason;

  if (typeof restaurantId !== "string" || restaurantId.trim().length === 0) {
    return null;
  }

  if (!isValidTableNumber(tableNumber)) {
    return null;
  }

  if (status !== "active" && status !== "closed") {
    return null;
  }

  if (
    closedReason !== undefined &&
    closedReason !== null &&
    !isValidClosedReason(closedReason)
  ) {
    return null;
  }

  return {
    id,
    restaurantId: restaurantId.trim(),
    tableNumber,
    status,
    billRequested: data.billRequested === true,
    ordersLocked: data.ordersLocked === true,
    lockedReason: data.lockedReason ?? null,
    openedAt: data.openedAt,
    closedAt: data.closedAt ?? null,
    closedReason: closedReason ?? null,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
};

const requireValidSession = (
  id: string,
  data?: DocumentData,
  context = "sesión"
): Session => {
  const session = mapSession(id, data);

  if (!session) {
    throw new Error(`Documento inválido de ${context}: ${id}`);
  }

  return session;
};

export const getSessionById = async (
  restaurantId: string,
  sessionId: string
): Promise<Session | null> => {
  const snapshot = await getDoc(sessionDocRef(restaurantId, sessionId));

  if (!snapshot.exists()) return null;

  return mapSession(snapshot.id, snapshot.data());
};

export const getActiveSessionsByTable = async (
  restaurantId: string,
  tableNumber: number
): Promise<Session[]> => {
  assertValidTableNumber(tableNumber);

  const q = query(
    sessionsCollectionRef(restaurantId),
    where("tableNumber", "==", tableNumber),
    where("status", "==", "active")
  );

  const snapshot = await getDocs(q);

  return snapshot.docs.map((docSnap) =>
    requireValidSession(docSnap.id, docSnap.data(), "session")
  );
};

export const getActiveSessionByTable = async (
  restaurantId: string,
  tableNumber: number
): Promise<Session | null> => {
  const activeSessions = await getActiveSessionsByTable(
    restaurantId,
    tableNumber
  );

  if (activeSessions.length === 0) {
    return null;
  }

  if (activeSessions.length > 1) {
    throw new Error(
      `Inconsistencia: hay ${activeSessions.length} sesiones activas para la mesa ${tableNumber}`
    );
  }

  return activeSessions[0];
};

export const createSession = async (
  restaurantId: string,
  tableNumber: number
): Promise<string> => {
  const normalizedRestaurantId = normalizeRestaurantId(restaurantId);
  assertValidTableNumber(tableNumber);

  const sessionId = crypto.randomUUID();
  const ref = sessionDocRef(normalizedRestaurantId, sessionId);

  await setDoc(ref, {
    restaurantId: normalizedRestaurantId,
    tableNumber,
    status: "active" satisfies SessionStatus,
    openedAt: serverTimestamp(),
    closedAt: null,
    closedReason: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return sessionId;
};

/**
 * Mantengo esta función por compatibilidad,
 * pero para el flujo QR la fuente de verdad debe ser mesas.ts/getOrCreateMesaSession.
 */
export const getOrCreateActiveSession = async (
  restaurantId: string,
  tableNumber: number
): Promise<string> => {
  const activeSession = await getActiveSessionByTable(restaurantId, tableNumber);

  if (activeSession) {
    return activeSession.id;
  }

  return createSession(restaurantId, tableNumber);
};

export const closeSession = async ({
  restaurantId,
  sessionId,
  reason = "unknown",
}: {
  restaurantId: string;
  sessionId: string;
  reason?: SessionClosedReason;
}) => {
  const ref = sessionDocRef(restaurantId, sessionId);
  const snapshot = await getDoc(ref);

  if (!snapshot.exists()) {
    throw new Error("La sesión no existe");
  }

  const session = requireValidSession(snapshot.id, snapshot.data(), "session");

  if (session.status === "closed") {
    return;
  }

  await updateDoc(ref, {
    status: "closed" satisfies SessionStatus,
    closedAt: serverTimestamp(),
    closedReason: reason,
    updatedAt: serverTimestamp(),
  });
};

export const closeActiveSessionByTable = async ({
  restaurantId,
  tableNumber,
  reason = "unknown",
}: {
  restaurantId: string;
  tableNumber: number;
  reason?: SessionClosedReason;
}) => {
  const activeSession = await getActiveSessionByTable(restaurantId, tableNumber);

  if (!activeSession) {
    return null;
  }

  await closeSession({
    restaurantId,
    sessionId: activeSession.id,
    reason,
  });

  return activeSession.id;
};