import {
  collection,
  doc,
  serverTimestamp,
  writeBatch,
  type DocumentData,
  type Transaction,
  type WriteBatch,
} from "firebase/firestore";
import { getDb } from "./firebase";

const db = getDb();

export type AuditAction = string;

export type AuditActor = {
  actorUid: string;
  actorEmail?: string | null;
  actorRole: string;
};

export type AuditChanges = {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
};

export type CreateAuditLogInput = AuditActor & {
  restaurantId: string;
  action: AuditAction;
  mesa?: number;
  pedidoId?: string;
  cuentaId?: string;
  sessionId?: string;
  entityType?: string;
  entityId?: string;
  description: string;
  reason?: string;
  changes?: AuditChanges;
  metadata?: Record<string, unknown>;
};

type AuditWriter = Pick<WriteBatch, "set"> | Pick<Transaction, "set">;

const requireText = (value: string, field: string) => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} es obligatorio para auditar.`);
  return normalized;
};

const getEntity = (input: CreateAuditLogInput) => {
  if (input.entityType && input.entityId) {
    return {
      entityType: requireText(input.entityType, "entityType"),
      entityId: requireText(input.entityId, "entityId"),
    };
  }

  if (input.pedidoId) return { entityType: "pedido", entityId: input.pedidoId };
  if (input.cuentaId) return { entityType: "cuenta", entityId: input.cuentaId };
  if (input.sessionId) return { entityType: "session", entityId: input.sessionId };
  if (typeof input.mesa === "number") {
    return { entityType: "mesa", entityId: String(input.mesa) };
  }

  return { entityType: "restaurant", entityId: input.restaurantId };
};

const withoutUndefined = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutUndefined);
  if (
    value &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, nested]) => nested !== undefined)
        .map(([key, nested]) => [key, withoutUndefined(nested)])
    );
  }
  return value;
};

export const buildAuditLogData = (
  input: CreateAuditLogInput
): DocumentData => {
  const actorUid = requireText(input.actorUid, "actorUid");
  const actorRole = requireText(input.actorRole, "actorRole");
  const restaurantId = requireText(input.restaurantId, "restaurantId");
  const action = requireText(input.action, "action");
  const description = requireText(input.description, "description");
  const entity = getEntity(input);

  return {
    restaurantId,
    action,
    actorUid,
    actorEmail: input.actorEmail?.trim() || null,
    actorRole,

    // Compatibilidad temporal con la UI histórica de auditoría.
    userUid: actorUid,
    userEmail: input.actorEmail?.trim() || null,
    userRole: actorRole,

    mesa: typeof input.mesa === "number" ? input.mesa : null,
    pedidoId: input.pedidoId || null,
    cuentaId: input.cuentaId || null,
    sessionId: input.sessionId || null,
    entityType: entity.entityType,
    entityId: entity.entityId,

    description,
    reason: input.reason?.trim() || null,
    changes: withoutUndefined(input.changes || { before: {}, after: {} }),
    metadata: withoutUndefined(input.metadata || {}),
    createdAt: serverTimestamp(),
  };
};

export const writeAuditLog = (
  writer: AuditWriter,
  input: CreateAuditLogInput
) => {
  const auditRef = doc(
    collection(db, "restaurants", input.restaurantId, "auditLogs")
  );
  writer.set(auditRef, buildAuditLogData(input));
  return auditRef.id;
};

export async function createAuditLog(input: CreateAuditLogInput) {
  const batch = writeBatch(db);
  const auditId = writeAuditLog(batch, input);
  await batch.commit();
  return auditId;
}
