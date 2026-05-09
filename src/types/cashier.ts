import type { FirestoreTimestampLike, MetodoPago } from "../lib/restaurant";

export type CashierPaymentMethod =
  | MetodoPago
  | "mercado_pago"
  | "mixed"
  | "other";

export type CashierPayment = {
  id: string;
  method: CashierPaymentMethod;
  amount: number;
  note?: string;
  createdAt?: FirestoreTimestampLike;
};

export type CashierDiscountType = "none" | "fixed" | "percentage";

export type CashierInvoiceStatus =
  | "not_requested"
  | "requested"
  | "issued"
  | "failed";

export type CashierInvoiceData = {
  status: CashierInvoiceStatus;
  type?: "A" | "B" | "C" | "ticket";
  customerName?: string;
  documentType?: "DNI" | "CUIT" | "CUIL" | "PASSPORT";
  documentNumber?: string;
  ivaCondition?: string;
  email?: string;
  fiscalAddress?: string;
  provider?: "manual" | "arca" | "external";
  invoiceNumber?: string;
  cae?: string;
  caeExpiresAt?: FirestoreTimestampLike;
  invoiceUrl?: string;
  requestedAt?: FirestoreTimestampLike;
  issuedAt?: FirestoreTimestampLike;
};

export type CashierAuditAction =
  | "cashier_bill_created"
  | "cashier_bill_updated"
  | "cashier_discount_applied"
  | "cashier_payment_registered"
  | "cashier_manual_order_created"
  | "cashier_bill_printed"
  | "cashier_invoice_requested"
  | "cashier_marked_unpaid";

export type CashierAuditLog = {
  id: string;
  restaurantId: string;
  action: CashierAuditAction;
  actorUid: string;
  actorEmail?: string | null;
  mesa?: number;
  cuentaId?: string;
  pedidoId?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  createdAt?: FirestoreTimestampLike;
};