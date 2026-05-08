import {
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { getDb } from "./firebase";
import type { MenuIngredient, MenuVariant } from "./store";

const db = getDb();

export type MenuType = "food" | "drinks";

export type MenuItem = {
  id: string;
  name: string;
  price: number;
  type?: MenuType;
  category: string;
  description?: string;
  image?: string;
  active: boolean;
  ingredients?: MenuIngredient[];
  variants?: MenuVariant[];
  comboItems?: string[];
};

export const createMenuItem = async (
  restaurantId: string,
  data: Omit<MenuItem, "id">
) => {
  const ref = doc(collection(db, "restaurants", restaurantId, "menu"));

  await setDoc(ref, {
    ...data,
    ingredients: data.ingredients || [],
    variants: data.variants || [],
    comboItems: data.comboItems || [],
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