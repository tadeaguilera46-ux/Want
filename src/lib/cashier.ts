import { doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { getDb } from "./firebase";
import { pedirCuenta } from "./bill";
import {
  createAuditLog,
  writeAuditLog,
  type AuditActor,
  type CreateAuditLogInput,
} from "./audit-logs";
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
    throw new Error("Tenes que ingresar un motivo claro.");
  }
};

const cashierActor = (
  actorUid: string,
  actorEmail?: string | null
): AuditActor => ({
  actorUid,
  actorEmail,
  actorRole: "cashier",
});

export const createCashierAuditLog = async (
  input: Omit<CreateAuditLogInput, "actorRole" | "description"> & {
    action: CashierAuditAction | string;
    description?: string;
  }
) =>
  createAuditLog({
    ...input,
    actorRole: "cashier",
    description: input.description || input.reason?.trim() || input.action,
  });

export const createOrRefreshCashierBill = async ({
  data,
  actorUid,
  actorEmail,
}: {
  data: CuentaInput;
  actorUid: string;
  actorEmail?: string | null;
}) =>
  pedirCuenta(data, {
    ...cashierActor(actorUid, actorEmail),
    action: "cashier_bill_created",
    description: `Caja creo o actualizo la cuenta de mesa ${data.mesa}`,
  });

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

  await runTransaction(db, async (transaction) => {
    const cuentaRef = doc(db, "restaurants", restaurantId, "cuentas", cuentaId);
    const snapshot = await transaction.get(cuentaRef);

    if (!snapshot.exists()) throw new Error("La cuenta no existe.");

    const cuenta = snapshot.data();
    if (cuenta.estado === "pagada" || cuenta.estado === "cerrada") {
      throw new Error("No se puede editar una cuenta pagada o cerrada.");
    }

    const after = {
      discountType,
      discountValue: Number(discountValue || 0),
      discountReason: hasDiscount ? discountReason.trim() : "",
      manualExtraAmount: Number(manualExtraAmount || 0),
      manualExtraReason: hasExtra ? manualExtraReason.trim() : "",
    };

    transaction.update(cuentaRef, { ...after, updatedAt: serverTimestamp() });
    writeAuditLog(transaction, {
      restaurantId,
      action: hasDiscount
        ? "cashier_discount_applied"
        : "cashier_bill_updated",
      ...cashierActor(actorUid, actorEmail),
      mesa: Number(cuenta.mesa),
      cuentaId,
      reason: hasDiscount ? discountReason : manualExtraReason,
      description: `Caja actualizo ajustes de la cuenta ${cuentaId}`,
      changes: {
        before: {
          discountType: cuenta.discountType ?? "none",
          discountValue: cuenta.discountValue ?? 0,
          manualExtraAmount: cuenta.manualExtraAmount ?? 0,
        },
        after,
      },
    });
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
  if (!payments.length) throw new Error("Agrega al menos un pago.");

  const totalPaid = payments.reduce(
    (sum, payment) => sum + Number(payment.amount || 0),
    0
  );
  if (!Number.isFinite(totalPaid) || totalPaid <= 0) {
    throw new Error("El monto pagado no es valido.");
  }

  await runTransaction(db, async (transaction) => {
    const cuentaRef = doc(db, "restaurants", restaurantId, "cuentas", cuentaId);
    const snapshot = await transaction.get(cuentaRef);
    if (!snapshot.exists()) throw new Error("La cuenta no existe.");

    const cuenta = snapshot.data();
    if (cuenta.estado === "pagada" || cuenta.estado === "cerrada") {
      throw new Error("La cuenta ya esta pagada o cerrada.");
    }

    const after = {
      metodo,
      payments,
      paidAmount: totalPaid,
      tip: tip && tip > 0 ? tip : 0,
      estado: "pagada",
    };
    transaction.update(cuentaRef, {
      ...after,
      paidAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    writeAuditLog(transaction, {
      restaurantId,
      action: "cashier_payment_registered",
      ...cashierActor(actorUid, actorEmail),
      mesa,
      cuentaId,
      description: `Caja registro el pago de la cuenta ${cuentaId}`,
      changes: {
        before: {
          estado: cuenta.estado,
          paidAmount: cuenta.paidAmount ?? 0,
          metodo: cuenta.metodo ?? null,
        },
        after,
      },
    });
  });
};

export const addPartialPayment = async ({
  restaurantId,
  cuentaId,
  mesa,
  payment,
  finalTotal,
  actorUid,
  actorEmail,
  tip,
}: {
  restaurantId: string;
  cuentaId: string;
  mesa: number;
  payment: CashierPayment;
  finalTotal: number;
  actorUid: string;
  actorEmail?: string | null;
  tip?: number;
}) => {
  const amount = Number(payment.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("El monto del pago no es válido.");
  }

  await runTransaction(db, async (transaction) => {
    const cuentaRef = doc(db, "restaurants", restaurantId, "cuentas", cuentaId);
    const snapshot = await transaction.get(cuentaRef);
    if (!snapshot.exists()) throw new Error("La cuenta no existe.");

    const cuenta = snapshot.data();
    if (cuenta.estado === "pagada" || cuenta.estado === "cerrada") {
      throw new Error("La cuenta ya está pagada o cerrada.");
    }

    const existingPayments: CashierPayment[] = Array.isArray(cuenta.payments)
      ? cuenta.payments
      : [];
    const newPayments = [...existingPayments, { ...payment, createdAt: undefined }];
    const newPaidAmount = newPayments.reduce(
      (s, p) => s + Number(p.amount || 0),
      0
    );
    const isFullyPaid = newPaidAmount >= finalTotal;

    const toMetodoPago = (method: string): MetodoPago | null => {
      if (
        method === "cash" ||
        method === "debit" ||
        method === "credit" ||
        method === "transfer"
      )
        return method as MetodoPago;
      return null;
    };
    const uniqueMethods = [...new Set(newPayments.map((p) => toMetodoPago(p.method)))];
    const resolvedMetodo = uniqueMethods.length === 1 ? uniqueMethods[0] : null;

    const update: Record<string, unknown> = {
      payments: newPayments,
      paidAmount: newPaidAmount,
      updatedAt: serverTimestamp(),
    };
    if (tip && tip > 0) update.tip = tip;
    if (isFullyPaid) {
      update.estado = "pagada";
      update.metodo = resolvedMetodo;
      update.paidAt = serverTimestamp();
    } else {
      update.splitBill = true;
    }

    transaction.update(cuentaRef, update);
    writeAuditLog(transaction, {
      restaurantId,
      action: isFullyPaid ? "cashier_payment_registered" : "cashier_partial_payment",
      ...cashierActor(actorUid, actorEmail),
      mesa,
      cuentaId,
      description: isFullyPaid
        ? `Caja registró pago final (${payment.method}) de $${amount} para cuenta ${cuentaId}`
        : `Caja registró pago parcial (${payment.method}) de $${amount} — acumulado $${newPaidAmount} de $${finalTotal}`,
      changes: {
        before: { paidAmount: cuenta.paidAmount ?? 0, estado: cuenta.estado },
        after: {
          paidAmount: newPaidAmount,
          estado: isFullyPaid ? "pagada" : "pendiente",
        },
      },
      metadata: { amount, method: payment.method, newPaidAmount, finalTotal, isFullyPaid },
    });
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

  await runTransaction(db, async (transaction) => {
    const cuentaRef = doc(db, "restaurants", restaurantId, "cuentas", cuentaId);
    const snapshot = await transaction.get(cuentaRef);
    if (!snapshot.exists()) throw new Error("La cuenta no existe.");

    const cuenta = snapshot.data();
    if (cuenta.estado === "pagada" || cuenta.estado === "cerrada") {
      throw new Error("No se puede marcar como no paga una cuenta ya pagada.");
    }

    transaction.update(cuentaRef, {
      unpaid: true,
      unpaidReason: reason.trim(),
      estado: "pendiente" as EstadoCuenta,
      updatedAt: serverTimestamp(),
    });
    writeAuditLog(transaction, {
      restaurantId,
      action: "cashier_marked_unpaid",
      ...cashierActor(actorUid, actorEmail),
      mesa: Number(cuenta.mesa),
      cuentaId,
      reason,
      description: `Caja marco como impaga la cuenta ${cuentaId}`,
      changes: {
        before: { unpaid: cuenta.unpaid ?? false, estado: cuenta.estado },
        after: { unpaid: true, estado: "pendiente" },
      },
    });
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
  await runTransaction(db, async (transaction) => {
    const cuentaRef = doc(db, "restaurants", restaurantId, "cuentas", cuentaId);
    const snapshot = await transaction.get(cuentaRef);
    if (!snapshot.exists()) throw new Error("La cuenta no existe.");

    const cuenta = snapshot.data();
    transaction.update(cuentaRef, {
      invoice: { ...invoice, status: "requested", requestedAt: serverTimestamp() },
      updatedAt: serverTimestamp(),
    });
    writeAuditLog(transaction, {
      restaurantId,
      action: "cashier_invoice_requested",
      ...cashierActor(actorUid, actorEmail),
      mesa: Number(cuenta.mesa),
      cuentaId,
      description: `Caja solicito factura para la cuenta ${cuentaId}`,
      changes: {
        before: { invoiceStatus: cuenta.invoice?.status ?? "not_requested" },
        after: { invoiceStatus: "requested" },
      },
      metadata: invoice as Record<string, unknown>,
    });
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
    description: `Caja imprimio la precuenta ${cuentaId}`,
    changes: { before: {}, after: { printed: true } },
  });
};

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
  assertReason(reason);

  await runTransaction(db, async (transaction) => {
    const cuentaRef = doc(db, "restaurants", restaurantId, "cuentas", cuentaId);
    const snapshot = await transaction.get(cuentaRef);
    if (!snapshot.exists()) throw new Error("La cuenta no existe.");

    const cuenta = snapshot.data();
    const after = {
      estado: "pendiente",
      payments: [],
      paidAmount: 0,
      tip: 0,
      metodo: null,
      reopenReason: reason.trim(),
    };
    transaction.update(cuentaRef, {
      ...after,
      reopenedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    writeAuditLog(transaction, {
      restaurantId,
      action: "cashier_bill_reopened",
      ...cashierActor(actorUid, actorEmail),
      mesa: Number(cuenta.mesa),
      cuentaId,
      reason,
      description: `Caja reabrio la cuenta ${cuentaId}`,
      changes: {
        before: { estado: cuenta.estado, paidAmount: cuenta.paidAmount ?? 0 },
        after,
      },
    });
  });
};
