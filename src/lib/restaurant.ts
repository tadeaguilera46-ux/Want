export interface FirestoreTimestampLike {
  seconds?: number;
  toMillis?: () => number;
}

export type RestaurantScoped = {
  restaurantId: string;
};

export type PedidoCategory = "food" | "drinks";

export type EstadoCocinaBarra =
  | "pendiente"
  | "preparando"
  | "listo"
  | "entregado";

export type MetodoPago = "cash" | "debit" | "credit" | "transfer";

export type EstadoCuenta = "pendiente" | "en_camino" | "pagada" | "cerrada";

export type PedidoStockMovement = {
  stockItemId: string;
  stockItemName: string;
  quantity: number;
  unit: "kg" | "g" | "l" | "ml" | "unit";
  quantityInBaseUnit: number;
};

export type PedidoItem = {
  id?: string;
  nombre: string;
  name?: string;
  cantidad: number;
  quantity?: number;
  precio?: number;
  price?: number;
  subtotal?: number;
  category: PedidoCategory;
  displayCategory?: string;
  station?: string | null;
  observacion?: string;
  note?: string;
  stockMovements?: PedidoStockMovement[];
};

export interface PedidoInput extends RestaurantScoped {
  mesa: number;
  sessionId: string;
  clientRequestId?: string;
  items: PedidoItem[];
  total: number;
}

export type CancelledItem = {
  itemIndex: number;
  name: string;
  reason: string;
  cancelledAt: number;
  actorUid?: string;
  actorEmail?: string;
};

export interface PedidoRecord extends PedidoInput {
  id: string;
  sessionId: string;
  estadoCocina?: EstadoCocinaBarra | null;
  estadoBarra?: EstadoCocinaBarra | null;
  cancelado?: boolean;
  stockReturned?: boolean;
  cancelledItems?: CancelledItem[];
  itemEstados?: Record<string, EstadoCocinaBarra>;
  itemEstadosBarra?: Record<string, EstadoCocinaBarra>;
  createdAt?: FirestoreTimestampLike;
  updatedAt?: FirestoreTimestampLike;
}

export interface CuentaInput extends RestaurantScoped {
  mesa: number;
  metodo: MetodoPago | null;
  total: number;
  splitBill: boolean;
}

export interface CuentaRecord extends CuentaInput {
  id: string;
  sessionId: string;
  estado: EstadoCuenta;
  createdAt?: FirestoreTimestampLike;
  updatedAt?: FirestoreTimestampLike;
}
