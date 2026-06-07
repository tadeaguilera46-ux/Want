import { INVOICE_TYPE_CODES, IVA_CODE_21, IVA_CODES, type InvoiceRequest, type AfipInvoiceResult } from "./types.js";

const WSFE_URLS = {
  homologacion: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
  produccion: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
};

const NS = "http://ar.gov.afip.dif.FEV1/";

// ─── helpers ──────────────────────────────────────────────────────────────────

function soapEnvelope(action: string, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="${NS}">
  <soapenv:Header/>
  <soapenv:Body>
    ${body}
  </soapenv:Body>
</soapenv:Envelope>`;
}

async function callWsfe(
  url: string,
  action: string,
  body: string
): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: `${NS}${action}`,
    },
    body: soapEnvelope(action, body),
  });
  if (!res.ok) throw new Error(`WSFE HTTP ${res.status}: ${await res.text()}`);
  const xml = await res.text();

  // Extraer error AFIP si existe
  const errMatch = xml.match(/<ErrMsg[^>]*>([\s\S]*?)<\/ErrMsg>/);
  const obsMatch = xml.match(/<Obs[^>]*>[\s\S]*?<Msg[^>]*>([\s\S]*?)<\/Msg>/);
  if (errMatch && errMatch[1]?.trim()) {
    throw new Error(`AFIP WSFE: ${errMatch[1].trim()}`);
  }
  if (obsMatch && obsMatch[1]?.trim()) {
    console.warn(`AFIP WSFE obs: ${obsMatch[1].trim()}`);
  }
  return xml;
}

function extract(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<(?:ar:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:ar:)?${tag}>`));
  return m ? m[1].trim() : "";
}

// ─── Obtener último número autorizado ─────────────────────────────────────────

export async function getLastInvoiceNumber(
  token: string,
  sign: string,
  cuit: string,
  puntoVenta: number,
  invoiceTypeCode: number,
  env: "homologacion" | "produccion"
): Promise<number> {
  const url = WSFE_URLS[env];
  const body = `
    <ar:FECompUltimoAutorizado>
      <ar:Auth>
        <ar:Token><![CDATA[${token}]]></ar:Token>
        <ar:Sign><![CDATA[${sign}]]></ar:Sign>
        <ar:Cuit>${cuit.replace(/-/g, "")}</ar:Cuit>
      </ar:Auth>
      <ar:PtoVta>${puntoVenta}</ar:PtoVta>
      <ar:CbteTipo>${invoiceTypeCode}</ar:CbteTipo>
    </ar:FECompUltimoAutorizado>`;

  const xml = await callWsfe(url, "FECompUltimoAutorizado", body);
  const cbteNro = extract(xml, "CbteNro");
  return cbteNro ? parseInt(cbteNro, 10) : 0;
}

// ─── Emitir comprobante ────────────────────────────────────────────────────────

export async function issueFECAE(
  token: string,
  sign: string,
  cuit: string,
  puntoVenta: number,
  nextNumber: number,
  req: InvoiceRequest,
  env: "homologacion" | "produccion",
  ivaRate: number = 21
): Promise<AfipInvoiceResult> {
  const url = WSFE_URLS[env];
  const cbteType = INVOICE_TYPE_CODES[req.invoiceType];
  if (!cbteType) throw new Error(`Tipo de comprobante desconocido: ${req.invoiceType}`);

  const rawCuit = cuit.replace(/-/g, "");
  const today = new Date()
    .toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })
    .split("/")
    .reverse()
    .map((p) => p.padStart(2, "0"))
    .join("");

  // Calcular importes según tipo de comprobante y alícuota configurada
  let impTotal: number;
  let impNeto: number;
  let impIVA: number;
  let impOpEx = 0;
  let ivaBlock = "";

  if (req.invoiceType === "C") {
    // Monotributista: sin IVA discriminado — impTotal = impNeto
    impNeto = Math.round(req.total * 100) / 100;
    impIVA = 0;
    impTotal = impNeto;
  } else if (ivaRate === 0) {
    // Exento: no hay IVA — el total va en ImpOpEx
    impNeto = 0;
    impIVA = 0;
    impOpEx = Math.round(req.total * 100) / 100;
    impTotal = impOpEx;
    ivaBlock = `
      <ar:Iva>
        <ar:AlicIva>
          <ar:Id>${IVA_CODES[0]}</ar:Id>
          <ar:BaseImp>${impOpEx.toFixed(2)}</ar:BaseImp>
          <ar:Importe>0.00</ar:Importe>
        </ar:AlicIva>
      </ar:Iva>`;
  } else {
    // Factura A o B con IVA: el total incluye IVA, extraemos neto e IVA
    const rate = ivaRate / 100;
    const ivaCode = IVA_CODES[ivaRate] ?? IVA_CODE_21;
    impNeto = Math.round((req.total / (1 + rate)) * 100) / 100;
    impIVA = Math.round((req.total - impNeto) * 100) / 100;
    impTotal = impNeto + impIVA;
    ivaBlock = `
      <ar:Iva>
        <ar:AlicIva>
          <ar:Id>${ivaCode}</ar:Id>
          <ar:BaseImp>${impNeto.toFixed(2)}</ar:BaseImp>
          <ar:Importe>${impIVA.toFixed(2)}</ar:Importe>
        </ar:AlicIva>
      </ar:Iva>`;
  }

  // Factura A exige CUIT del receptor — no se puede emitir a consumidor final
  if (req.invoiceType === "A") {
    if (req.customerDocType !== "CUIT") {
      throw new Error("Factura A requiere el CUIT del cliente. Usá Factura B para consumidores finales o clientes con DNI.");
    }
    const rawDocNro = (req.customerDocNumber ?? "").replace(/-/g, "");
    if (!rawDocNro || rawDocNro.length < 10) {
      throw new Error("Factura A requiere un CUIT válido del cliente (11 dígitos).");
    }
  }

  // Datos del receptor
  const docTipoCodes: Record<string, number> = {
    DNI: 96,
    CUIT: 80,
    consumidor_final: 99,
  };
  const docTipo = docTipoCodes[req.customerDocType] ?? 99;
  const docNro =
    req.customerDocType === "consumidor_final"
      ? 0
      : parseInt((req.customerDocNumber ?? "0").replace(/-/g, ""), 10) || 0;

  const body = `
    <ar:FECAESolicitar>
      <ar:Auth>
        <ar:Token><![CDATA[${token}]]></ar:Token>
        <ar:Sign><![CDATA[${sign}]]></ar:Sign>
        <ar:Cuit>${rawCuit}</ar:Cuit>
      </ar:Auth>
      <ar:FeCAEReq>
        <ar:FeCabReq>
          <ar:CantReg>1</ar:CantReg>
          <ar:PtoVta>${puntoVenta}</ar:PtoVta>
          <ar:CbteTipo>${cbteType}</ar:CbteTipo>
        </ar:FeCabReq>
        <ar:FeDetReq>
          <ar:FECAEDetRequest>
            <ar:Concepto>1</ar:Concepto>
            <ar:DocTipo>${docTipo}</ar:DocTipo>
            <ar:DocNro>${docNro}</ar:DocNro>
            <ar:CbteDesde>${nextNumber}</ar:CbteDesde>
            <ar:CbteHasta>${nextNumber}</ar:CbteHasta>
            <ar:CbteFch>${today}</ar:CbteFch>
            <ar:ImpTotal>${impTotal.toFixed(2)}</ar:ImpTotal>
            <ar:ImpTotConc>0.00</ar:ImpTotConc>
            <ar:ImpNeto>${impNeto.toFixed(2)}</ar:ImpNeto>
            <ar:ImpOpEx>${impOpEx.toFixed(2)}</ar:ImpOpEx>
            <ar:ImpIVA>${impIVA.toFixed(2)}</ar:ImpIVA>
            <ar:ImpTrib>0.00</ar:ImpTrib>
            <ar:MonId>PES</ar:MonId>
            <ar:MonCotiz>1</ar:MonCotiz>
            ${ivaBlock}
          </ar:FECAEDetRequest>
        </ar:FeDetReq>
      </ar:FeCAEReq>
    </ar:FECAESolicitar>`;

  const xml = await callWsfe(url, "FECAESolicitar", body);

  const cae = extract(xml, "CAE");
  const caeExpiry = extract(xml, "CAEFchVto");
  const resultado = extract(xml, "Resultado");

  if (!cae || resultado !== "A") {
    const obs = xml.match(/<Msg[^>]*>([\s\S]*?)<\/Msg>/g)?.join(" ") ?? xml.slice(0, 400);
    throw new Error(`AFIP rechazó el comprobante: ${obs}`);
  }

  // Formatear fecha de vencimiento: YYYYMMDD → DD/MM/YYYY
  const expFmt = caeExpiry.length === 8
    ? `${caeExpiry.slice(6)}/${caeExpiry.slice(4, 6)}/${caeExpiry.slice(0, 4)}`
    : caeExpiry;

  return {
    cae,
    caeExpiry: expFmt,
    invoiceNumber: nextNumber,
    invoiceType: req.invoiceType,
    puntoVenta,
    cuit: rawCuit,
  };
}
