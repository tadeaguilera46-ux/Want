export type StockUnit = "kg" | "g" | "l" | "ml" | "unit";

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