import * as forge from "node-forge";
import * as crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

// ─── Cifrado simétrico de la clave privada ────────────────────────────────────
// masterKey debe ser 32 bytes hex (64 chars), guardado en Firebase Secrets

export function encryptPrivateKey(
  privateKeyPem: string,
  masterKeyHex: string
): { encrypted: string; iv: string } {
  const key = Buffer.from(masterKeyHex, "hex").slice(0, KEY_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv) as crypto.CipherGCM;
  const encrypted = Buffer.concat([
    cipher.update(privateKeyPem, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return {
    encrypted: encrypted.toString("hex"),
    iv: iv.toString("hex"),
  };
}

export function decryptPrivateKey(
  encryptedHex: string,
  ivHex: string,
  masterKeyHex: string
): string {
  const key = Buffer.from(masterKeyHex, "hex").slice(0, KEY_LENGTH);
  const iv = Buffer.from(ivHex, "hex");
  const encBuf = Buffer.from(encryptedHex, "hex");
  const authTag = encBuf.slice(encBuf.length - AUTH_TAG_LENGTH);
  const encrypted = encBuf.slice(0, encBuf.length - AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv) as crypto.DecipherGCM;
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted).toString("utf8") + decipher.final("utf8");
}

// ─── Generación de par de claves RSA + CSR ────────────────────────────────────

export function generateKeyPairAndCsr(
  restaurantName: string,
  cuit: string
): { privateKeyPem: string; csrPem: string } {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = keys.publicKey;
  csr.setSubject([
    { name: "commonName", value: `WANT-${cuit}` },
    { name: "organizationName", value: restaurantName.slice(0, 64) },
    { name: "organizationalUnitName", value: "Facturacion Electronica" },
    { name: "countryName", value: "AR" },
  ]);
  csr.sign(keys.privateKey, forge.md.sha256.create());
  return {
    privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
    csrPem: forge.pki.certificationRequestToPem(csr),
  };
}

// ─── Firma del TRA para WSAA (PKCS#7 / CMS SignedData) ───────────────────────

export function signTRA(
  traXml: string,
  privateKeyPem: string,
  certificatePem: string
): string {
  const cert = forge.pki.certificateFromPem(certificatePem);
  const key = forge.pki.privateKeyFromPem(privateKeyPem);

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(traXml, "utf8");
  p7.addCertificate(cert);
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [],
  });
  p7.sign();

  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return Buffer.from(der, "binary").toString("base64");
}
