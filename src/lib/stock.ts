import {
  collection,
  doc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { writeAuditLog, type AuditActor } from "./audit-logs";
import type { StockItem, StockUnit } from "../types/stock";

const db = getDb();

export type CreateStockInput = {
  restaurantId: string;
  name: string;
  category: string;
  unit: StockUnit;
  currentQuantity: number;
  minimumQuantity: number;
  costPerUnit?: number;
  supplier?: string;
  notes?: string;
};

export const createStockItem = async (
  input: CreateStockInput,
  actor: AuditActor
) => {
  const stockRef = doc(
    collection(db, "restaurants", input.restaurantId, "stock")
  );
  const stockData = {
    restaurantId: input.restaurantId,
    name: input.name.trim(),
    category: input.category.trim(),
    unit: input.unit,
    currentQuantity: Number(input.currentQuantity || 0),
    minimumQuantity: Number(input.minimumQuantity || 0),
    ...(input.costPerUnit != null && input.costPerUnit > 0 ? { costPerUnit: input.costPerUnit } : {}),
    supplier: input.supplier?.trim() || "",
    notes: input.notes?.trim() || "",
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const batch = writeBatch(db);
  batch.set(stockRef, stockData);
  writeAuditLog(batch, {
    restaurantId: input.restaurantId,
    action: "stock_item_creado",
    ...actor,
    entityType: "stock_item",
    entityId: stockRef.id,
    description: `Se creo insumo ${input.name.trim()}`,
    changes: {
      before: { exists: false },
      after: {
        name: input.name.trim(),
        currentQuantity: Number(input.currentQuantity || 0),
        active: true,
      },
    },
  });
  await batch.commit();
};

export const updateStockQuantity = async (
  restaurantId: string,
  item: StockItem,
  quantity: number,
  actor: AuditActor
) => {
  const stockDoc = doc(
    db,
    "restaurants",
    restaurantId,
    "stock",
    item.id
  );

  const batch = writeBatch(db);
  batch.update(stockDoc, {
    currentQuantity: Number(quantity),
    updatedAt: serverTimestamp(),
  });
  writeAuditLog(batch, {
    restaurantId,
    action: "stock_cantidad_actualizada",
    ...actor,
    entityType: "stock_item",
    entityId: item.id,
    description: `Se actualizo stock de ${item.name}`,
    changes: {
      before: { currentQuantity: Number(item.currentQuantity || 0) },
      after: { currentQuantity: Number(quantity) },
    },
  });
  await batch.commit();
};

export const addStock = async (
  restaurantId: string,
  item: StockItem,
  amount: number,
  actor: AuditActor
) => {
  const next = Number(item.currentQuantity || 0) + Number(amount || 0);

  await updateStockQuantity(
    restaurantId,
    item,
    next,
    actor
  );
};

export const removeStock = async (
  restaurantId: string,
  item: StockItem,
  amount: number,
  actor: AuditActor
) => {
  const next = Math.max(
    0,
    Number(item.currentQuantity || 0) - Number(amount || 0)
  );

  await updateStockQuantity(
    restaurantId,
    item,
    next,
    actor
  );
};

export const toggleStockItem = async (
  restaurantId: string,
  item: StockItem,
  active: boolean,
  actor: AuditActor
) => {
  const stockDoc = doc(
    db,
    "restaurants",
    restaurantId,
    "stock",
    item.id
  );

  const batch = writeBatch(db);
  batch.update(stockDoc, {
    active,
    updatedAt: serverTimestamp(),
  });
  writeAuditLog(batch, {
    restaurantId,
    action: "stock_item_actualizado",
    ...actor,
    entityType: "stock_item",
    entityId: item.id,
    description: `Se ${active ? "activo" : "pauso"} insumo ${item.name}`,
    changes: {
      before: { active: item.active },
      after: { active },
    },
  });
  await batch.commit();
};
