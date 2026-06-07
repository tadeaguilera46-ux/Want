import {
  collection,
  doc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { writeAuditLog, type AuditActor } from "./audit-logs";
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
  station?: string;
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
  data: Omit<MenuItem, "id">,
  actor: AuditActor
) => {
  const ref = doc(collection(db, "restaurants", restaurantId, "menu"));
  const menuData = {
    ...data,
    ingredients: data.ingredients || [],
    variants: data.variants || [],
    comboItems: data.comboItems || [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const batch = writeBatch(db);
  batch.set(ref, menuData);
  writeAuditLog(batch, {
    restaurantId,
    action: "menu_item_creado",
    ...actor,
    entityType: "menu_item",
    entityId: ref.id,
    description: `Se creo producto ${data.name}`,
    changes: {
      before: { exists: false },
      after: data,
    },
  });
  await batch.commit();
};

export const updateMenuItem = async (
  restaurantId: string,
  itemId: string,
  data: Partial<Omit<MenuItem, "id">>,
  actor: AuditActor
) => {
  const batch = writeBatch(db);
  batch.update(doc(db, "restaurants", restaurantId, "menu", itemId), {
    ...data,
    updatedAt: serverTimestamp(),
  });
  writeAuditLog(batch, {
    restaurantId,
    action: "menu_item_actualizado",
    ...actor,
    entityType: "menu_item",
    entityId: itemId,
    description: `Se actualizo producto ${data.name || itemId}`,
    changes: {
      before: {},
      after: data,
    },
  });
  await batch.commit();
};

export const deleteMenuItem = async (
  restaurantId: string,
  item: MenuItem,
  actor: AuditActor
) => {
  const batch = writeBatch(db);
  batch.delete(doc(db, "restaurants", restaurantId, "menu", item.id));
  writeAuditLog(batch, {
    restaurantId,
    action: "menu_item_eliminado",
    ...actor,
    entityType: "menu_item",
    entityId: item.id,
    description: `Se elimino producto ${item.name}`,
    changes: {
      before: item,
      after: { exists: false },
    },
  });
  await batch.commit();
};
