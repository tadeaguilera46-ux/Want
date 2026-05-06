import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Plus,
  Minus,
  MessageSquareText,
  ShoppingBag,
  ChevronRight,
} from "lucide-react";
import { useState } from "react";
import { useCart } from "@/lib/CartContext";
import { crearPedido } from "../lib/orders";
import type { PedidoItem } from "../lib/restaurant";
import { resolveRuntimeContext } from "../lib/runtime-context";

type CartItem = {
  id: string;
  name: string;
  nombre?: string;
  price: number;
  precio?: number;
  quantity: number;
  cantidad?: number;
  category: "food" | "drinks";
  displayCategory?: string;
  observacion?: string;
  image?: string;
  description?: string;
};

type MenuOperationalCategory = "food" | "drinks";

const normalizeObservation = (value?: string) => value?.trim() || "";

const formatPriceARS = (value: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value || 0);

const Cart = () => {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  const { table, restaurantId } = resolveRuntimeContext({
    searchParams,
    location,
  });

  const { cart, addToCart, removeFromCart, total, clearCart } = useCart();

  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [isSubmittingOrderAndBill, setIsSubmittingOrderAndBill] =
    useState(false);
  const [error, setError] = useState<string | null>(null);

  const mapMenuCategoryToOrderCategory = (
    category: MenuOperationalCategory
  ): PedidoItem["category"] => {
    return category === "drinks" ? "drinks" : "food";
  };

  const buildPedido = () => {
    const items = (cart as CartItem[]).map((item) => {
      const observacion = normalizeObservation(item.observacion);
      const itemName = item.name || item.nombre || "Producto";
      const itemPrice = Number(item.price ?? item.precio ?? 0);
      const itemQuantity = Number(item.quantity ?? item.cantidad ?? 1);

      const safePrice =
        Number.isFinite(itemPrice) && itemPrice > 0 ? itemPrice : 0;

      const safeQuantity =
        Number.isFinite(itemQuantity) && itemQuantity > 0 ? itemQuantity : 1;

      const baseItem = {
        id: item.id,
        nombre: itemName,
        name: itemName,
        cantidad: safeQuantity,
        quantity: safeQuantity,
        precio: safePrice,
        price: safePrice,
        subtotal: safePrice * safeQuantity,
        category: mapMenuCategoryToOrderCategory(item.category),
        displayCategory: item.displayCategory || "",
      };

      if (observacion) {
        return {
          ...baseItem,
          observacion,
          note: observacion,
        };
      }

      return baseItem;
    }) as unknown as PedidoItem[];

    return {
      restaurantId,
      mesa: Number(table),
      items,
      total,
    };
  };

  const handlePedido = async () => {
    if (isSubmittingOrder || isSubmittingOrderAndBill || cart.length === 0) {
      return;
    }

    try {
      setError(null);
      setIsSubmittingOrder(true);

      const pedido = buildPedido();
      await crearPedido(pedido);

      clearCart();
      navigate(`/order-confirmed?restaurantId=${restaurantId}&table=${table}`, {
        state: { table, restaurantId },
      });
    } catch (err) {
      console.error("Error creando pedido:", err);
      setError("No se pudo enviar el pedido. Reintentá.");
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  const handlePedidoYCuenta = async () => {
    if (isSubmittingOrder || isSubmittingOrderAndBill || cart.length === 0) {
      return;
    }

    try {
      setError(null);
      setIsSubmittingOrderAndBill(true);

      const pedido = buildPedido();
      await crearPedido(pedido);

      clearCart();
      navigate(`/bill?restaurantId=${restaurantId}&table=${table}`, {
        state: { table, restaurantId },
      });
    } catch (err) {
      console.error("Error creando pedido y solicitando cuenta:", err);
      setError("No se pudo enviar el pedido. Reintentá.");
    } finally {
      setIsSubmittingOrderAndBill(false);
    }
  };

  const isBusy = isSubmittingOrder || isSubmittingOrderAndBill;

  return (
    <div className="min-h-screen bg-slate-50 pb-44">
      <div className="mx-auto w-full max-w-lg">
        <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="px-4 pb-4 pt-[max(12px,env(safe-area-inset-top))]">
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate(-1)}
                disabled={isBusy}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm disabled:opacity-50"
              >
                <ArrowLeft size={18} />
              </button>

              <div className="min-w-0">
                <h1 className="text-xl font-black tracking-tight text-slate-950">
                  Tu pedido
                </h1>
                <p className="text-sm text-slate-500">
                  Revisá los productos antes de enviarlos
                </p>
              </div>

              <span className="ml-auto inline-flex items-center rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground shadow-want">
                Mesa {table}
              </span>
            </div>
          </div>
        </header>

        {error && (
          <div className="px-4 pt-4">
            <div className="rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {error}
            </div>
          </div>
        )}

        {cart.length === 0 ? (
          <div className="px-4 py-10">
            <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center shadow-sm">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                <ShoppingBag size={28} />
              </div>

              <h2 className="mt-4 text-xl font-black tracking-tight text-slate-950">
                Tu carrito está vacío
              </h2>

              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                Agregá productos desde el menú para poder enviar tu pedido.
              </p>

              <button
                onClick={() =>
                  navigate(`/menu?restaurantId=${restaurantId}&table=${table}`, {
                    state: { table, restaurantId },
                  })
                }
                className="mt-5 h-11 rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white"
              >
                Volver al menú
              </button>
            </div>
          </div>
        ) : (
          <main className="space-y-4 px-4 py-4">
            {(cart as CartItem[]).map((item) => {
              const observation = normalizeObservation(item.observacion);
              const hasObservation = observation.length > 0;
              const itemName = item.name || item.nombre || "Producto";
              const itemPrice = Number(item.price ?? item.precio ?? 0);
              const itemQuantity = Number(item.quantity ?? item.cantidad ?? 1);

              const safePrice =
                Number.isFinite(itemPrice) && itemPrice > 0 ? itemPrice : 0;

              const safeQuantity =
                Number.isFinite(itemQuantity) && itemQuantity > 0
                  ? itemQuantity
                  : 1;

              return (
                <motion.div
                  key={`${item.id}__${observation}`}
                  layout
                  className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex gap-4">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-3xl bg-slate-100 text-4xl">
                      {item.image ? (
                        <img
                          src={item.image}
                          alt={itemName}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <ShoppingBag size={24} className="text-slate-400" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <h3 className="text-base font-black leading-tight text-slate-950">
                            {itemName}
                          </h3>

                          {item.displayCategory && (
                            <p className="mt-1 text-xs font-semibold text-slate-400">
                              {item.displayCategory}
                            </p>
                          )}

                          <p className="mt-2 text-sm font-bold text-accent">
                            {formatPriceARS(safePrice * safeQuantity)}
                          </p>
                        </div>
                      </div>

                      {hasObservation && (
                        <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                          <div className="flex items-start gap-2 text-amber-900">
                            <MessageSquareText
                              size={14}
                              className="mt-0.5 shrink-0"
                            />
                            <div className="min-w-0">
                              <p className="mb-1 text-[11px] font-extrabold uppercase tracking-wide">
                                Observación
                              </p>
                              <p className="break-words text-sm font-medium">
                                {observation}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="mt-4 flex items-center justify-between gap-3">
                        <div className="text-xs font-medium text-slate-500">
                          Precio unitario: {formatPriceARS(safePrice)}
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() =>
                              removeFromCart(item.id, item.observacion)
                            }
                            disabled={isBusy}
                            className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 disabled:opacity-50"
                          >
                            <Minus size={14} />
                          </button>

                          <span className="min-w-[28px] text-center text-sm font-black text-slate-950">
                            {safeQuantity}
                          </span>

                          <button
                            onClick={() => addToCart(item as any)}
                            disabled={isBusy}
                            className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-want disabled:opacity-50"
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </main>
        )}
      </div>

      {cart.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-4 backdrop-blur">
          <div className="mx-auto max-w-lg">
            <div className="mb-3 rounded-2xl bg-slate-50 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-slate-500">
                  Total
                </span>
                <span className="text-2xl font-black tracking-tight text-slate-950">
                  {formatPriceARS(total)}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <motion.button
                whileTap={{ scale: isBusy ? 1 : 0.985 }}
                onClick={handlePedido}
                disabled={isBusy}
                className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-black text-primary-foreground shadow-want disabled:opacity-50"
              >
                <span>{isSubmittingOrder ? "Enviando..." : "Enviar pedido"}</span>
                {!isSubmittingOrder && <ChevronRight size={18} />}
              </motion.button>

              <button
                onClick={handlePedidoYCuenta}
                disabled={isBusy}
                className="h-12 w-full rounded-2xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 disabled:opacity-50"
              >
                {isSubmittingOrderAndBill
                  ? "Procesando..."
                  : "Finalizar y pedir cuenta"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Cart;