import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { getDb } from "./firebase";
import type { StockItem, StockUnit } from "../types/stock";

const db = getDb();

export type CreateStockInput = {
  restaurantId: string;
  name: string;
  category: string;
  unit: StockUnit;
  currentQuantity: number;
  minimumQuantity: number;
  supplier?: string;
  notes?: string;
};

export const createStockItem = async (
  input: CreateStockInput
) => {
  const stockRef = collection(
    db,
    "restaurants",
    input.restaurantId,
    "stock"
  );

  await addDoc(stockRef, {
    restaurantId: input.restaurantId,
    name: input.name.trim(),
    category: input.category.trim(),
    unit: input.unit,
    currentQuantity: Number(input.currentQuantity || 0),
    minimumQuantity: Number(input.minimumQuantity || 0),
    supplier: input.supplier?.trim() || "",
    notes: input.notes?.trim() || "",
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

export const updateStockQuantity = async (
  restaurantId: string,
  stockItemId: string,
  quantity: number
) => {
  const stockDoc = doc(
    db,
    "restaurants",
    restaurantId,
    "stock",
    stockItemId
  );

  await updateDoc(stockDoc, {
    currentQuantity: Number(quantity),
    updatedAt: serverTimestamp(),
  });
};

export const addStock = async (
  restaurantId: string,
  item: StockItem,
  amount: number
) => {
  const next = Number(item.currentQuantity || 0) + Number(amount || 0);

  await updateStockQuantity(
    restaurantId,
    item.id,
    next
  );
};

export const removeStock = async (
  restaurantId: string,
  item: StockItem,
  amount: number
) => {
  const next = Math.max(
    0,
    Number(item.currentQuantity || 0) - Number(amount || 0)
  );

  await updateStockQuantity(
    restaurantId,
    item.id,
    next
  );
};

export const toggleStockItem = async (
  restaurantId: string,
  stockItemId: string,
  active: boolean
) => {
  const stockDoc = doc(
    db,
    "restaurants",
    restaurantId,
    "stock",
    stockItemId
  );

  await updateDoc(stockDoc, {
    active,
    updatedAt: serverTimestamp(),
  });
};