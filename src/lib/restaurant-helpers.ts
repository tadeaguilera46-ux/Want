import type {
  EstadoCuenta,
  PedidoRecord,
} from "./restaurant";

/* =========================
   CUENTAS
========================= */

export const isCuentaActiva = (estado?: EstadoCuenta) =>
  estado === "pendiente" || estado === "en_camino";

export const isCuentaPagada = (estado?: EstadoCuenta) =>
  estado === "pagada";

export const isCuentaCerrada = (estado?: EstadoCuenta) =>
  estado === "cerrada";

export const isCuentaFinalizada = (estado?: EstadoCuenta) =>
  estado === "pagada" || estado === "cerrada";

/* =========================
   PEDIDOS (TIPO)
========================= */

export const pedidoTieneComida = (pedido: PedidoRecord) =>
  pedido.items?.some((item) => item.category === "food") ?? false;

export const pedidoTieneBebidas = (pedido: PedidoRecord) =>
  pedido.items?.some((item) => item.category === "drinks") ?? false;

/* =========================
   PEDIDOS (ESTADO)
========================= */

export const isPedidoEntregado = (pedido: PedidoRecord) => {
  const hasFood = pedidoTieneComida(pedido);
  const hasDrinks = pedidoTieneBebidas(pedido);

  if (hasFood && !hasDrinks) {
    return pedido.estadoCocina === "entregado";
  }

  if (!hasFood && hasDrinks) {
    return pedido.estadoBarra === "entregado";
  }

  if (hasFood && hasDrinks) {
    return (
      pedido.estadoCocina === "entregado" &&
      pedido.estadoBarra === "entregado"
    );
  }

  return false;
};

export const isPedidoListo = (pedido: PedidoRecord) => {
  const hasFood = pedidoTieneComida(pedido);
  const hasDrinks = pedidoTieneBebidas(pedido);

  if (hasFood && !hasDrinks) {
    return pedido.estadoCocina === "listo";
  }

  if (!hasFood && hasDrinks) {
    return pedido.estadoBarra === "listo";
  }

  if (hasFood && hasDrinks) {
    return (
      pedido.estadoCocina === "listo" &&
      pedido.estadoBarra === "listo"
    );
  }

  return false;
};

export const isPedidoActivo = (pedido: PedidoRecord) => {
  return !isPedidoEntregado(pedido);
};

/* =========================
   CANCELACIÓN
========================= */

export const canCancelPedido = (pedido: PedidoRecord) => {
  if (pedido.cancelado) return false;

  const estadosBloqueantes = ["preparando", "listo"];

  const cocinaBloqueada = estadosBloqueantes.includes(
    pedido.estadoCocina || ""
  );

  const barraBloqueada = estadosBloqueantes.includes(
    pedido.estadoBarra || ""
  );

  return !cocinaBloqueada && !barraBloqueada;
};

/* =========================
   UTILS
========================= */

export const sumPedidosTotal = (pedidos: PedidoRecord[]) =>
  pedidos.reduce((acc, p) => acc + (p.total || 0), 0);

export const getPedidosActivos = (pedidos: PedidoRecord[]) =>
  pedidos.filter((p) => isPedidoActivo(p));

export const getPedidosEntregados = (pedidos: PedidoRecord[]) =>
  pedidos.filter((p) => isPedidoEntregado(p));

export const getPedidosListos = (pedidos: PedidoRecord[]) =>
  pedidos.filter((p) => isPedidoListo(p));