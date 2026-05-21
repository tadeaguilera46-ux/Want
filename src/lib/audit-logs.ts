import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { getDb } from "./firebase";

const db = getDb();

export type AuditAction =
  | "pedido_creado"
  | "pedido_listo"
  | "pedido_entregado"
  | "cuenta_solicitada"
  | "cuenta_pagada"
  | "cuenta_cobrada"
  | "cuenta_manual_creada"
  | "producto_agregado_cuenta"
  | "ajuste_cuenta"
  | "precuenta_impresa"
  | "factura_solicitada"
  | "mesa_limpiada"
  | "branding_actualizado"
  | "empleado_actualizado";

type CreateAuditLogInput = {
  restaurantId: string;
  action: AuditAction;
  userUid?: string;
  userEmail?: string;
  userRole?: string;
  mesa?: number;
  pedidoId?: string;
  cuentaId?: string;
  description: string;
};

export async function createAuditLog({
  restaurantId,
  action,
  userUid,
  userEmail,
  userRole,
  mesa,
  pedidoId,
  cuentaId,
  description,
}: CreateAuditLogInput) {
  await addDoc(collection(db, "restaurants", restaurantId, "auditLogs"), {
    action,
    userUid: userUid || null,
    userEmail: userEmail || null,
    userRole: userRole || null,
    mesa: mesa ?? null,
    pedidoId: pedidoId || null,
    cuentaId: cuentaId || null,
    description,
    createdAt: serverTimestamp(),
  });
}