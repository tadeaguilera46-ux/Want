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

export type PedidoItem = {
  nombre: string;
  cantidad: number;
  category: PedidoCategory;
  observacion?: string;
};

export interface PedidoInput extends RestaurantScoped {
  mesa: number;
  items: PedidoItem[];
  total: number;
}

export interface PedidoRecord extends PedidoInput {
  id: string;
  sessionId: string;
  estadoCocina?: EstadoCocinaBarra | null;
  estadoBarra?: EstadoCocinaBarra | null;
  cancelado?: boolean;
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