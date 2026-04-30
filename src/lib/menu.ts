import {
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { getDb } from "./firebase";

const db = getDb();

// 🔥 SOLO PARA LÓGICA INTERNA
export type MenuType = "food" | "drinks";

// 🔥 CATEGORY AHORA ES LIBRE
export type MenuItem = {
  id: string;
  name: string;
  price: number;

  type: MenuType;        // 👈 cocina/barra
  category: string;      // 👈 pizzas, postres, etc

  description?: string;
  image?: string;
  active: boolean;
};

export const createMenuItem = async (
  restaurantId: string,
  data: Omit<MenuItem, "id">
) => {
  const ref = doc(collection(db, "restaurants", restaurantId, "menu"));

  await setDoc(ref, {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

export const updateMenuItem = async (
  restaurantId: string,
  itemId: string,
  data: Partial<Omit<MenuItem, "id">>
) => {
  await updateDoc(doc(db, "restaurants", restaurantId, "menu", itemId), {
    ...data,
    updatedAt: serverTimestamp(),
  });
};

export const deleteMenuItem = async (restaurantId: string, itemId: string) => {
  await deleteDoc(doc(db, "restaurants", restaurantId, "menu", itemId));
};