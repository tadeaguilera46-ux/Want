import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChefHat,
  Clock3,
  CookingPot,
  PackageCheck,
  XCircle,
} from "lucide-react";
import { doc, onSnapshot } from "firebase/firestore";
import { getDb } from "../../lib/firebase";
import { getStoredCustomerOrderIds } from "../../lib/customer-orders";
import {
  pedidoTieneBebidas,
  pedidoTieneComida,
} from "../../lib/restaurant-helpers";
import type {
  EstadoCocinaBarra,
  FirestoreTimestampLike,
  PedidoRecord,
} from "../../lib/restaurant";
import { getStoredTableSessionId } from "../../lib/table-session";

type VisibleOrderStatus =
  | "cancelado"
  | "pendiente"
  | "preparando"
  | "listo"
  | "entregado";

type CustomerOrderStatusProps = {
  restaurantId: string;
  table: number;
  primaryColor?: string;
};

const getTimestampMs = (value?: FirestoreTimestampLike) => {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  return typeof value.seconds === "number" ? value.seconds * 1000 : 0;
};

const getVisibleStatus = (order: PedidoRecord): VisibleOrderStatus => {
  if (order.cancelado) return "cancelado";

  const stationStatuses = [
    pedidoTieneComida(order) ? order.estadoCocina : null,
    pedidoTieneBebidas(order) ? order.estadoBarra : null,
  ].filter((status): status is EstadoCocinaBarra => Boolean(status));

  if (
    stationStatuses.length > 0 &&
    stationStatuses.every((status) => status === "entregado")
  ) {
    return "entregado";
  }

  if (
    stationStatuses.length > 0 &&
    stationStatuses.every(
      (status) => status === "listo" || status === "entregado"
    )
  ) {
    return "listo";
  }

  if (
    stationStatuses.some(
      (status) =>
        status === "preparando" ||
        status === "listo" ||
        status === "entregado"
    )
  ) {
    return "preparando";
  }

  return "pendiente";
};

const statusDetails: Record<
  VisibleOrderStatus,
  {
    label: string;
    description: string;
    icon: typeof Clock3;
    className: string;
  }
> = {
  pendiente: {
    label: "Pedido recibido",
    description: "El restaurante ya recibió tu pedido.",
    icon: Clock3,
    className: "bg-amber-50 text-amber-700 ring-amber-200",
  },
  preparando: {
    label: "En preparación",
    description: "Cocina o barra está preparando tu pedido.",
    icon: CookingPot,
    className: "bg-blue-50 text-blue-700 ring-blue-200",
  },
  listo: {
    label: "Listo",
    description: "Tu pedido está listo para ser llevado a la mesa.",
    icon: CheckCircle2,
    className: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  },
  entregado: {
    label: "Entregado",
    description: "Tu pedido fue entregado.",
    icon: PackageCheck,
    className: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  },
  cancelado: {
    label: "Cancelado",
    description: "Este pedido fue cancelado.",
    icon: XCircle,
    className: "bg-red-50 text-red-700 ring-red-200",
  },
};

const stationLabel: Record<EstadoCocinaBarra, string> = {
  pendiente: "Recibido",
  preparando: "Preparando",
  listo: "Listo",
  entregado: "Entregado",
};

const CustomerOrderStatus = ({
  restaurantId,
  table,
  primaryColor = "#111827",
}: CustomerOrderStatusProps) => {
  const sessionId = getStoredTableSessionId({ restaurantId, table });
  const orderIds = useMemo(
    () =>
      sessionId
        ? getStoredCustomerOrderIds({ restaurantId, table, sessionId })
        : [],
    [restaurantId, sessionId, table]
  );
  const [ordersById, setOrdersById] = useState<Record<string, PedidoRecord>>({});

  useEffect(() => {
    setOrdersById({});

    if (!sessionId || orderIds.length === 0) return;

    const unsubscribe = orderIds.map((orderId) =>
      onSnapshot(
        doc(getDb(), "restaurants", restaurantId, "pedidos", orderId),
        (snapshot) => {
          if (!snapshot.exists()) return;

          const order = {
            id: snapshot.id,
            ...snapshot.data(),
          } as PedidoRecord;

          if (order.sessionId !== sessionId || order.mesa !== table) return;

          setOrdersById((currentOrders) => ({
            ...currentOrders,
            [orderId]: order,
          }));
        },
        () => {
          setOrdersById((currentOrders) => {
            const nextOrders = { ...currentOrders };
            delete nextOrders[orderId];
            return nextOrders;
          });
        }
      )
    );

    return () => unsubscribe.forEach((stopListening) => stopListening());
  }, [orderIds, restaurantId, sessionId, table]);

  const orders = useMemo(
    () =>
      Object.values(ordersById).sort(
        (a, b) => getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt)
      ),
    [ordersById]
  );

  if (!sessionId || orderIds.length === 0) return null;

  return (
    <section className="rounded-[24px] border border-black/5 bg-white p-4 text-left shadow-[0_8px_24px_-14px_rgba(0,0,0,0.18)]">
      <div className="mb-3 flex items-center gap-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-full text-white"
          style={{ backgroundColor: primaryColor }}
        >
          <ChefHat size={19} />
        </div>
        <div>
          <h2 className="font-bold text-zinc-950">Estado de tus pedidos</h2>
          <p className="text-xs text-zinc-500">Se actualiza en tiempo real</p>
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="rounded-xl bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-500">
          Consultando el estado de tu pedido...
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((order, index) => {
            const visibleStatus = getVisibleStatus(order);
            const details = statusDetails[visibleStatus];
            const StatusIcon = details.icon;
            const hasFood = pedidoTieneComida(order);
            const hasDrinks = pedidoTieneBebidas(order);
            const itemSummary = order.items
              .slice(0, 3)
              .map((item) => `${item.cantidad}x ${item.nombre}`)
              .join(", ");

            return (
              <article
                key={order.id}
                className="rounded-2xl border border-black/5 bg-zinc-50 p-3.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-wide text-zinc-400">
                      Pedido {orders.length - index}
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm font-semibold text-zinc-800">
                      {itemSummary}
                      {order.items.length > 3
                        ? ` y ${order.items.length - 3} más`
                        : ""}
                    </p>
                  </div>
                  <div
                    className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-bold ring-1 ${details.className}`}
                  >
                    <StatusIcon size={14} />
                    {details.label}
                  </div>
                </div>

                <p className="mt-2 text-xs text-zinc-500">
                  {details.description}
                </p>

                {(hasFood || hasDrinks) && !order.cancelado && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {hasFood && order.estadoCocina && (
                      <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-zinc-600 ring-1 ring-black/10">
                        Cocina: {stationLabel[order.estadoCocina]}
                      </span>
                    )}
                    {hasDrinks && order.estadoBarra && (
                      <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-zinc-600 ring-1 ring-black/10">
                        Barra: {stationLabel[order.estadoBarra]}
                      </span>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default CustomerOrderStatus;
