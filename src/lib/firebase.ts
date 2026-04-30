import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// DEBUG (lo podés borrar después)
console.log("API KEY:", import.meta.env.VITE_FIREBASE_API_KEY);
console.log("AUTH DOMAIN:", import.meta.env.VITE_FIREBASE_AUTH_DOMAIN);
console.log("PROJECT ID:", import.meta.env.VITE_FIREBASE_PROJECT_ID);

// 🔥 Evita reinicialización (importante en Vite + HMR)
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Servicios principales
const db = getFirestore(app);
const auth = getAuth(app);

// 🔥 CLAVE: Auth secundaria para crear usuarios sin desloguear al admin
export function getSecondaryAuth() {
  const secondaryAppName = "secondary";

  const secondaryApp =
    getApps().find((a) => a.name === secondaryAppName) ??
    initializeApp(firebaseConfig, secondaryAppName);

  return getAuth(secondaryApp);
}

export const getDb = () => db;
export { auth };