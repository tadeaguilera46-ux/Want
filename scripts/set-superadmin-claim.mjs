/**
 * Asigna el custom claim { superAdmin: true } al usuario superAdmin.
 * Ejecutar UNA sola vez: node scripts/set-superadmin-claim.mjs
 *
 * Requiere serviceAccountKey.json en la raíz del proyecto (ya en .gitignore).
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

let serviceAccount;
try {
  serviceAccount = require('../serviceAccountKey.json');
} catch {
  console.error('❌ No se encontró serviceAccountKey.json en la raíz del proyecto.');
  console.error('   Descargalo desde Firebase Console → Configuración del proyecto → Cuentas de servicio.');
  process.exit(1);
}

initializeApp({ credential: cert(serviceAccount) });

const auth = getAuth();
const UID = 'avMRl4526tYfAZkOmSebwxvLCAb2';

console.log(`Seteando custom claim para UID: ${UID} …`);

await auth.setCustomUserClaims(UID, { superAdmin: true });

const user = await auth.getUser(UID);
console.log('✓ Custom claims actuales:', JSON.stringify(user.customClaims));
console.log('');
console.log('Próximos pasos:');
console.log('  1. firebase deploy --only firestore:rules');
console.log('  2. Cerrar sesión y volver a entrar como superAdmin.');
console.log('  3. Verificar acceso al panel SuperAdmin.');
