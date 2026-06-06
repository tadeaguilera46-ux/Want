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

export type MenuType = "food" | "drinks" | "combo";

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
  availableFrom?: string;
  availableTo?: string;
  availableDays?: number[];
  allergens?: string[];
  modifierGroups?: ModifierGroup[];
};

export type ModifierOption = {
  name: string;
  priceAdd: number;
};

export type ModifierGroup = {
  name: string;
  required: boolean;
  options: ModifierOption[];
};

export const isMenuItemAvailableNow = (item: MenuItem): boolean => {
  const now = new Date();
  const day = now.getDay();
  if (item.availableDays && item.availableDays.length > 0) {
    if (!item.availableDays.includes(day)) return false;
  }
  if (item.availableFrom && item.availableTo) {
    const [fh, fm] = item.availableFrom.split(":").map(Number);
    const [th, tm] = item.availableTo.split(":").map(Number);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const fromMin = fh * 60 + fm;
    const toMin = th * 60 + tm;
    if (fromMin <= toMin) return nowMin >= fromMin && nowMin <= toMin;
    return nowMin >= fromMin || nowMin <= toMin;
  }
  return true;
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