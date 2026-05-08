import type { PedidoInput } from "./restaurant";

export const crearPedido = async (pedido: PedidoInput) => {
  const response = await fetch("/api/create-order", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(pedido),
  });

  const text = await response.text();

  let data: {
    ok?: boolean;
    pedidoId?: string;
    error?: string;
  } = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Error del servidor (${response.status}). Revisá logs de Vercel.`);
  }

  if (!response.ok || !data.ok || !data.pedidoId) {
    throw new Error(data.error || "No se pudo crear el pedido");
  }

  return data.pedidoId;
};