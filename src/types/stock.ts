export type StockUnit = "kg" | "g" | "l" | "ml" | "unit";

export type KardexMovementType = "entrada" | "salida" | "ajuste" | "creacion";

export type KardexEntry = {
  id: string;
  restaurantId: string;
  stockItemId: string;
  stockItemName: string;
  unit: StockUnit;
  movementType: KardexMovementType;
  quantityBefore: number;
  quantityMoved: number;
  quantityAfter: number;
  actorEmail?: string | null;
  actorUid?: string;
  reason?: string | null;
  createdAt?: unknown;
};

export type StockItem = {
  id: string;
  restaurantId: string;
  name: string;
  category: string;
  unit: StockUnit;
  currentQuantity: number;
  minimumQuantity: number;
  costPerUnit?: number;
  supplier?: string;
  notes?: string;
  active: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
};