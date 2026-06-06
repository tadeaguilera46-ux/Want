import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { pedirCuenta } from "./bill";
import type { CuentaInput, EstadoCuenta, MetodoPago } from "./restaurant";
import type {
  CashierAuditAction,
  CashierDiscountType,
  CashierInvoiceData,
  CashierPayment,
} from "../types/cashier";

const db = getDb();

const normalizeReason = (reason: string) => reason.trim();

const assertReason = (reason: string) => {
  if (normalizeReason(reason).length < 4) {
    throw new Error("Tenés que ingresar un motivo claro.");
  }
};

export const createCashierAuditLog = async ({
  restaurantId,
  action,
  actorUid,
  actorEmail,
  mesa,
  cuentaId,
  pedidoId,
  reason,
  metadata,
}: {
  restaurantId: string;
  action: CashierAuditAction;
  actorUid: string;
  actorEmail?: string | null;
  mesa?: number;
  cuentaId?: string;
  pedidoId?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}) => {
  await addDoc(collection(db, "restaurants", restaurantId, "auditLogs"), {
      restaurantId,
      action,

      actorUid,
      actorEmail: actorEmail || null,

      userUid: actorUid,
      userEmail: actorEmail || null,
      userRole: "cashier",

      mesa: typeof mesa === "number" ? mesa : null,
      cuentaId: cuentaId || null,
      pedidoId: pedidoId || null,

      reason: reason?.trim() || null,
      description: reason?.trim() || action,

      metadata: metadata || {},

      createdAt: serverTimestamp(),
    }
  )};


export const createOrRefreshCashierBill = async ({
  data,
  actorUid,
  actorEmail,
}: {
  data: CuentaInput;
  actorUid: string;
  actorEmail?: string | null;
}) => {
  const cuentaId = await pedirCuenta(data);

  await createCashierAuditLog({
    restaurantId: data.restaurantId,
    action: "cashier_bill_created",
    actorUid,
    actorEmail,
    mesa: data.mesa,
    cuentaId,
    metadata: {
      total: data.total,
      metodo: data.metodo,
      splitBill: data.splitBill,
    },
  });

  return cuentaId;
};

export const updateCashierBillAdjustments = async ({
  restaurantId,
  cuentaId,
  discountType,
  discountValue,
  discountReason,
  manualExtraAmount,
  manualExtraReason,
  actorUid,
  actorEmail,
}: {
  restaurantId: string;
  cuentaId: string;
  discountType: CashierDiscountType;
  discountValue: number;
  discountReason: string;
  manualExtraAmount: number;
  manualExtraReason: string;
  actorUid: string;
  actorEmail?: string | null;
}) => {
  const hasDiscount = discountType !== "none" && Number(discountValue) > 0;
  const hasExtra = Number(manualExtraAmount) > 0;

  if (hasDiscount) assertReason(discountReason);
  if (hasExtra) assertReason(manualExtraReason);

  const cuentaRef = doc(db, "restaurants", restaurantId, "cuentas", cuentaId);
  const snapshot = await getDoc(cuentaRef);

  if (!snapshot.exists()) {
    throw new Error("La cuenta no existe.");
  }

  const cuenta = snapshot.data();

  if (cuenta.estado === "pagada" || cuenta.estado === "cerrada") {
    throw new Error("No se puede editar una cuenta pagada o cerrada.");
  }

  await updateDoc(cuentaRef, {
    discountType,
    discountValue: Number(discountValue || 0),
    discountReason: hasDiscount ? discountReason.trim() : "",
    manualExtraAmount: Number(manualExtraAmount || 0),
    manualExtraReason: hasExtra ? manualExtraReason.trim() : "",
    updatedAt: serverTimestamp(),
  });

  await createCashierAuditLog({
    restaurantId,
    action: hasDiscount
      ? "cashier_discount_applied"
      : "cashier_bill_updated",
    actorUid,
    actorEmail,
    mesa: Number(cuenta.mesa),
    cuentaId,
    reason: hasDiscount ? discountReason : manualExtraReason,
    metadata: {
      discountType,
      discountValue,
      manualExtraAmount,
    },
  });
};

export const registerCashierPayment = async ({
  restaurantId,
  cuentaId,
  mesa,
  payments,
  metodo,
  actorUid,
  actorEmail,
  tip,
}: {
  restaurantId: string;
  cuentaId: string;
  mesa: number;
  payments: CashierPayment[];
  metodo: MetodoPago | null;
  actorUid: string;
  actorEmail?: string | null;
  tip?: number;
}) => {
  if (!payments.length) {
    throw new Error("Agregá al menos un pago.");
  }

  const totalPaid = payments.reduce((sum, payment) => {
    return sum + Number(payment.amount || 0);
  }, 0);

  if (!Number.isFinite(totalPaid) || totalPaid <= 0) {
    throw new Error("El monto pagado no es válido.");
  }

  const cuentaRef = doc(db, "restaurants", restaurantId, "cuentas", cuentaId);
  const snapshot = await getDoc(cuentaRef);

  if (!snapshot.exists()) {
    throw new Error("La cuenta no existe.");
  }

  const cuenta = snapshot.data();

  if (cuenta.estado === "pagada" || cuenta.estado === "cerrada") {
    throw new Error("La cuenta ya está pagada o cerrada.");
  }

  await updateDoc(cuentaRef, {
    metodo,
    payments,
    paidAmount: totalPaid,
    ...(tip && tip > 0 ? { tip } : {}),
    estado: "pagada",
    paidAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await createCashierAuditLog({
    restaurantId,
    action: "cashier_payment_registered",
    actorUid,
    actorEmail,
    mesa,
    cuentaId,
    metadata: {
      payments,
      totalPaid,
      metodo,
    },
  });
};

export const markCashierBillAsUnpaid = async ({
  restaurantId,
  cuentaId,
  reason,
  actorUid,
  actorEmail,
}: {
  restaurantId: string;
  cuentaId: string;
  reason: string;
  actorUid: string;
  actorEmail?: string | null;
}) => {
  assertReason(reason);

  const cuentaRef = doc(db, "restaurants", restaurantId, "cuentas", cuentaId);
  const snapshot = await getDoc(cuentaRef);

  if (!snapshot.exists()) {
    throw new Error("La cuenta no existe.");
  }

  const cuenta = snapshot.data();

  if (cuenta.estado === "pagada" || cuenta.estado === "cerrada") {
    throw new Error("No se puede marcar como no paga una cuenta ya pagada.");
  }

  await updateDoc(cuentaRef, {
    unpaid: true,
    unpaidReason: reason.trim(),
    estado: "pendiente" as EstadoCuenta,
    updatedAt: serverTimestamp(),
  });

  await createCashierAuditLog({
    restaurantId,
    action: "cashier_marked_unpaid",
    actorUid,
    actorEmail,
    mesa: Number(cuenta.mesa),
    cuentaId,
    reason,
  });
};

export const requestCashierInvoice = async ({
  restaurantId,
  cuentaId,
  invoice,
  actorUid,
  actorEmail,
}: {
  restaurantId: string;
  cuentaId: string;
  invoice: CashierInvoiceData;
  actorUid: string;
  actorEmail?: string | null;
}) => {
  const cuentaRef = doc(db, "restaurants", restaurantId, "cuentas", cuentaId);
  const snapshot = await getDoc(cuentaRef);

  if (!snapshot.exists()) {
    throw new Error("La cuenta no existe.");
  }

  const cuenta = snapshot.data();

  await updateDoc(cuentaRef, {
    invoice: {
      ...invoice,
      status: "requested",
      requestedAt: serverTimestamp(),
    },
    updatedAt: serverTimestamp(),
  });

  await createCashierAuditLog({
    restaurantId,
    action: "cashier_invoice_requested",
    actorUid,
    actorEmail,
    mesa: Number(cuenta.mesa),
    cuentaId,
    metadata: invoice,
  });
};

export const markCashierBillPrinted = async ({
  restaurantId,
  cuentaId,
  mesa,
  actorUid,
  actorEmail,
}: {
  restaurantId: string;
  cuentaId: string;
  mesa: number;
  actorUid: string;
  actorEmail?: string | null;
}) => {
  await createCashierAuditLog({
    restaurantId,
    action: "cashier_bill_printed",
    actorUid,
    actorEmail,
    mesa,
    cuentaId,
  });
};

// FC-005: Reabrir cuenta pagada con motivo obligatorio
export const reopenCashierBill = async ({
  restaurantId,
  cuentaId,
  reason,
  actorUid,
  actorEmail,
}: {
  restaurantId: string;
  cuentaId: string;
  reason: string;
  actorUid: string;
  actorEmail?: string | null;
}) => {
  if (!reason.trim() || reason.trim().length < 4) {
    throw new Error("Ingresá un motivo claro para reabrir la cuenta.");
  }

  const cuentaRef = doc(db, "restaurants", restaurantId, "cuentas", cuentaId);
  const snapshot = await getDoc(cuentaRef);
  if (!snapshot.exists()) throw new Error("La cuenta no existe.");

  const cuenta = snapshot.data();

  await updateDoc(cuentaRef, {
    estado: "pendiente",
    payments: [],
    paidAmount: 0,
    tip: 0,
    metodo: null,
    reopenReason: reason.trim(),
    reopenedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await createCashierAuditLog({
    restaurantId,
    action: "cashier_bill_created",
    actorUid,
    actorEmail,
    mesa: Number(cuenta.mesa),
    cuentaId,
    reason: `Cuenta reabierta · ${reason.trim()}`,
    metadata: { reopenReason: reason.trim() },
  });
};