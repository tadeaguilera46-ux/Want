export type AfipFiscalCondition = "monotributista" | "responsable_inscripto";

export type AfipConfig = {
  cuit: string;
  puntoVenta: number;
  fiscalCondition: AfipFiscalCondition;
  ivaRate: number; // alícuota IVA en % — 21, 10.5 o 0 (exento)
  privateKeyEncrypted: string;
  privateKeyIv: string;
  certificate: string;
  status: "unconfigured" | "pending_certificate" | "active";
};

export type AfipTokens = {
  token: string;
  sign: string;
  expiresAt: FirebaseFirestore.Timestamp;
};

// cbte type codes
export const INVOICE_TYPE_CODES: Record<string, number> = {
  A: 1,   // Factura A  (RI → RI con CUIT)
  B: 6,   // Factura B  (RI → consumidor final / DNI)
  C: 11,  // Factura C  (Monotributista)
};

// IVA alicuota codes (AFIP)
export const IVA_CODE_21 = 5;   // 21%
export const IVA_CODE_105 = 4;  // 10.5%
export const IVA_CODE_EXENTO = 2; // Exento 0%

// Mapa rate (%) → código AFIP
export const IVA_CODES: Record<number, number> = {
  21:   IVA_CODE_21,
  10.5: IVA_CODE_105,
  0:    IVA_CODE_EXENTO,
};

export type InvoiceRequest = {
  restaurantId: string;
  cuentaId: string;
  customerName: string;
  customerDocType: "DNI" | "CUIT" | "consumidor_final";
  customerDocNumber?: string;
  invoiceType: "A" | "B" | "C";
  total: number; // total en pesos (ya con IVA para B/C)
  items?: { description: string; quantity: number; unitPrice: number }[];
};

export type AfipInvoiceResult = {
  cae: string;
  caeExpiry: string;
  invoiceNumber: number;
  invoiceType: string;
  puntoVenta: number;
  cuit: string;
};
