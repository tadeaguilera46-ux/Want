/**
 * Crea restaurants/{id}/public/branding para cada restaurante existente.
 * Idempotente — se puede ejecutar múltiples veces sin daño.
 *
 * Ejecutar con: node scripts/migrate-public-branding.mjs
 * Requiere serviceAccountKey.json en la raíz.
 */
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

let serviceAccount;
try {
  serviceAccount = require("../serviceAccountKey.json");
} catch {
  console.error("❌ No se encontró serviceAccountKey.json en la raíz del proyecto.");
  process.exit(1);
}

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const BRANDING_FIELDS = [
  "name",
  "logoUrl",
  "coverUrl",
  "primaryColor",
  "secondaryColor",
  "welcomeMessage",
  "active",
];

const snap = await db.collection("restaurants").get();
console.log(`Migrando ${snap.docs.length} restaurante(s)...`);

let ok = 0;
let skipped = 0;

for (const restaurantDoc of snap.docs) {
  const data = restaurantDoc.data();
  const branding = {};

  for (const field of BRANDING_FIELDS) {
    if (data[field] !== undefined) {
      branding[field] = data[field];
    }
  }

  // Defaults para campos que no existan en el doc raíz
  if (branding.name === undefined) branding.name = restaurantDoc.id;
  if (branding.active === undefined) branding.active = true;
  if (!branding.primaryColor) branding.primaryColor = "#000000";
  if (!branding.secondaryColor) branding.secondaryColor = "#FFFFFF";
  if (branding.logoUrl === undefined) branding.logoUrl = "";
  if (branding.coverUrl === undefined) branding.coverUrl = "";
  if (branding.welcomeMessage === undefined) branding.welcomeMessage = "";

  await db
    .doc(`restaurants/${restaurantDoc.id}/public/branding`)
    .set(branding, { merge: true });

  console.log(`  ✓ ${restaurantDoc.id} → ${JSON.stringify({ name: branding.name })}`);
  ok++;
}

if (skipped > 0) console.log(`  — ${skipped} omitidos (ya tenían public/branding)`);
console.log(`\n✅ Migración completa. ${ok} restaurante(s) procesado(s).`);
