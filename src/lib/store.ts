export type MenuOperationalType = "food" | "drinks";

export type MenuCategory = "starters" | "mains" | "desserts" | "drinks";

export type RecipeUnit = "kg" | "g" | "l" | "ml" | "unit";

export type MenuIngredient = {
  stockItemId: string;
  stockItemName: string;
  quantity: number;
  unit: RecipeUnit;
  essential: boolean;
};

export type MenuVariant = {
  id: string;
  name: string;
  priceDelta?: number;
  ingredients?: MenuIngredient[];
  active: boolean;
};

export type MenuItem = {
  id: string;
  name: string;
  price: number;
  image: string;
  category: MenuCategory | string;
  displayCategory?: string;
  description: string;
  observacion?: string;
  tags?: string[];
  type?: MenuOperationalType;
  active?: boolean;
  ingredients?: MenuIngredient[];
  variants?: MenuVariant[];
  comboItems?: string[];
};

export interface CartItem extends MenuItem {
  quantity: number;
}

export interface Order {
  id: string;
  table: number;
  items: CartItem[];
  status: "pending" | "preparing" | "ready" | "delivered";
  type: "food" | "drink" | "mixed";
  time: string;
  total: number;
}

export interface BillRequest {
  id: string;
  table: number;
  total: number;
  paymentMethod: string;
  time: string;
  status: "pending" | "going" | "paid";
}

export const menuItems: MenuItem[] = [];
export const sampleOrders: Order[] = [];
export const sampleBillRequests: BillRequest[] = [];