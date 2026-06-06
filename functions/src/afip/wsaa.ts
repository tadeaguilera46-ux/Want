import * as admin from "firebase-admin";
import { signTRA } from "./crypto.js";

const WSAA_URLS = {
  homologacion: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
  produccion: "https://wsaa.afip.gov.ar/ws/services/LoginCms",
};

function buildTRA(): string {
  const now = new Date();
  const from = new Date(now.getTime() - 10 * 60 * 1000); // -10 min
  const to = new Date(now.getTime() + 60 * 60 * 1000);   // +1 hora

  const isoFrom = from.toISOString().replace("Z", "-03:00");
  const isoTo = to.toISOString().replace("Z", "-03:00");
  const uniqueId = Math.floor(now.getTime() / 1000);

  return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${uniqueId}</uniqueId>
    <generationTime>${isoFrom}</generationTime>
    <expirationTime>${isoTo}</expirationTime>
  </header>
  <service>wsfe</service>
</loginTicketRequest>`;
}

function parseSoapResponse(xml: string): { token: string; sign: string; expiry: string } {
  const extract = (tag: string): string => {
    const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
    return m ? m[1].trim() : "";
  };
  const token = extract("token");
  const sign = extract("sign");
  const expiry = extract("expirationTime");
  if (!token || !sign) throw new Error(`WSAA no devolvió token/sign. Respuesta: ${xml.slice(0, 500)}`);
  return { token, sign, expiry };
}

export async function getAfipToken(
  restaurantId: string,
  privateKeyPem: string,
  certificatePem: string,
  env: "homologacion" | "produccion" = "produccion"
): Promise<{ token: string; sign: string }> {
  const db = admin.firestore();
  const tokenRef = db
    .collection("restaurants")
    .doc(restaurantId)
    .collection("afipTokens")
    .doc(env);

  // Intentar usar token cacheado (válido por 10h con margen de 2h)
  const cached = await tokenRef.get();
  if (cached.exists) {
    const data = cached.data() as { token: string; sign: string; expiresAt: FirebaseFirestore.Timestamp };
    const expiresAt = data.expiresAt?.toDate?.() ?? new Date(0);
    const twoHoursFromNow = new Date(Date.now() + 2 * 60 * 60 * 1000);
    if (expiresAt > twoHoursFromNow) {
      return { token: data.token, sign: data.sign };
    }
  }

  // Generar nuevo token
  const tra = buildTRA();
  const cms = signTRA(tra, privateKeyPem, certificatePem);

  const soapBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <loginCms xmlns="https://wsaa.afip.gov.ar/ws/services/LoginCms">
      <in0><![CDATA[${cms}]]></in0>
    </loginCms>
  </soapenv:Body>
</soapenv:Envelope>`;

  const res = await fetch(WSAA_URLS[env], {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: "",
    },
    body: soapBody,
  });

  if (!res.ok) throw new Error(`WSAA HTTP ${res.status}: ${await res.text()}`);
  const xml = await res.text();

  const { token, sign, expiry } = parseSoapResponse(xml);

  // Parsear expiración y cachear
  const expiresAt = expiry
    ? admin.firestore.Timestamp.fromDate(new Date(expiry))
    : admin.firestore.Timestamp.fromDate(new Date(Date.now() + 10 * 60 * 60 * 1000));

  await tokenRef.set({ token, sign, expiresAt, updatedAt: admin.firestore.FieldValue.serverTimestamp() });

  return { token, sign };
}
