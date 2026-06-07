import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Banknote,
  CreditCard,
  Landmark,
  Users,
  ChevronRight,
  ReceiptText,
} from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import { getDb } from "../lib/firebase";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import type { MetodoPago, PedidoRecord } from "../lib/restaurant";
import { resolveRuntimeContext } from "../lib/runtime-context";

const db = getDb();

const paymentOptions: {
  id: MetodoPago;
  label: string;
  icon: typeof Banknote;
}[] = [
  { id: "cash", label: "Efectivo", icon: Banknote },
  { id: "debit", label: "Tarjeta débito", icon: CreditCard },
  { id: "credit", label: "Tarjeta crédito", icon: CreditCard },
  { id: "transfer", label: "Transferencia", icon: Landmark },
];

type BillLineItem = {
  key: string;
  name: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  note?: string;
};

type PedidoItemLike = {
  id?: string;
  nombre?: string;
  name?: string;
  cantidad?: number;
  quantity?: number;
  precio?: number;
  price?: number;
  observacion?: string;
  note?: string;
};

type MenuItemPrice = {
  id: string;
  name?: string;
  price?: number;
  active?: boolean;
};

const formatPriceARS = (value: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value || 0);

const normalizeName = (value: string) =>
  value.trim().toLowerCase().replace(/\s+/g, " ");

const getPedidoItems = (pedido: PedidoRecord): PedidoItemLike[] => {
  const rawPedido = pedido as unknown as {
    items?: PedidoItemLike[];
    productos?: PedidoItemLike[];
  };

  if (Array.isArray(rawPedido.items)) return rawPedido.items;
  if (Array.isArray(rawPedido.productos)) return rawPedido.productos;

  return [];
};

const RequestBill = () => {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  const { table, restaurantId } = resolveRuntimeContext({
    searchParams,
    location,
  });

  const tableNumber = Number(table);

  const [selected, setSelected] = useState<MetodoPago | null>(null);
  const [splitBill, setSplitBill] = useState(false);
  const [pedidos, setPedidos] = useState<PedidoRecord[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItemPrice[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loadingMesa, setLoadingMesa] = useState(true);
  const [loadingPedidos, setLoadingPedidos] = useState(false);
  const [loadingMenu, setLoadingMenu] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!restaurantId) return;

    setLoadingMenu(true);

    const menuUnsubscribe = onSnapshot(
      query(collection(db, "restaurants", restaurantId, "menu"), where("active", "==", true)),
      (snapshot) => {
        const data = snapshot.docs.map((document) => ({
          id: document.id,
          ...document.data(),
        })) as MenuItemPrice[];

        setMenuItems(data);
        setLoadingMenu(false);
      },
      (err) => {
        console.error("Error leyendo menú para cuenta:", err);
        setLoadingMenu(false);
      }
    );

    return () => menuUnsubscribe();
  }, [restaurantId]);

  useEffect(() => {
    if (!restaurantId || !Number.isInteger(tableNumber) || tableNumber <= 0) {
      setSessionId(null);
      setPedidos([]);
      setLoadingMesa(false);
      setError("Mesa o restaurante inválido.");
      return;
    }

    setLoadingMesa(true);

    const mesaUnsubscribe = onSnapshot(
      doc(db, "restaurants", restaurantId, "mesas", String(tableNumber)),
      (snapshot) => {
        const data = snapshot.data();

        const activeSessionId =
          data?.estado === "occupied" &&
          typeof data?.activeSessionId === "string"
            ? data.activeSessionId
            : null;

        setSessionId(activeSessionId);
        setLoadingMesa(false);

        if (!activeSessionId) {
          setPedidos([]);
        }
      },
      (err) => {
        console.error("Error leyendo mesa:", err);
        setError("No se pudo leer la mesa.");
        setLoadingMesa(false);
      }
    );

    return () => mesaUnsubscribe();
  }, [restaurantId, tableNumber]);

  useEffect(() => {
    if (!sessionId) {
      setPedidos([]);
      setLoadingPedidos(false);
      return;
    }

    let cancelled = false;
    setLoadingPedidos(true);

    const loadBill = async () => {
      try {
        const url = `/api/get-session-bill?restaurantId=${encodeURIComponent(restaurantId)}&sessionId=${encodeURIComponent(sessionId)}&mesa=${encodeURIComponent(String(tableNumber))}`;
        const response = await fetch(url);
        const data = await response.json() as {
          ok: boolean;
          pedidos?: PedidoRecord[];
          error?: string;
        };

        if (!cancelled) {
          if (data.ok && Array.isArray(data.pedidos)) {
            setPedidos(data.pedidos);
          } else {
            setError(data.error ?? "No se pudieron cargar los pedidos de la mesa.");
            setPedidos([]);
          }
          setLoadingPedidos(false);
        }
      } catch (err) {
        console.error("Error cargando cuenta:", err);
        if (!cancelled) {
          setError("No se pudieron cargar los pedidos de la mesa.");
          setLoadingPedidos(false);
        }
      }
    };

    void loadBill();

    return () => {
      cancelled = true;
    };
  }, [restaurantId, sessionId, tableNumber]);

  const menuPriceByName = useMemo(() => {
    const map = new Map<string, number>();

    menuItems.forEach((item) => {
      const name = String(item.name || "").trim();
      const price = Number(item.price || 0);

      if (!name || !Number.isFinite(price) || price <= 0) return;

      map.set(normalizeName(name), price);
    });

    return map;
  }, [menuItems]);

  const billItems = useMemo(() => {
    const grouped = new Map<string, BillLineItem>();

    pedidos.forEach((pedido) => {
      const items = getPedidoItems(pedido);
      const pedidoTotal = Number(pedido.total || 0);
      const safePedidoTotal =
        Number.isFinite(pedidoTotal) && pedidoTotal > 0 ? pedidoTotal : 0;

      items.forEach((item, index) => {
        const name = String(item.nombre || item.name || "Producto");
        const quantity = Number(item.cantidad || item.quantity || 1);
        const note = String(item.observacion || item.note || "").trim();

        const safeQuantity =
          Number.isFinite(quantity) && quantity > 0 ? quantity : 1;

        const rawUnitPrice = Number(item.precio || item.price || 0);
        const menuUnitPrice = menuPriceByName.get(normalizeName(name)) || 0;

        const resolvedUnitPrice =
          Number.isFinite(rawUnitPrice) && rawUnitPrice > 0
            ? rawUnitPrice
            : menuUnitPrice > 0
              ? menuUnitPrice
              : items.length === 1 && safePedidoTotal > 0
                ? safePedidoTotal / safeQuantity
                : 0;

        const safeUnitPrice =
          Number.isFinite(resolvedUnitPrice) && resolvedUnitPrice > 0
            ? resolvedUnitPrice
            : 0;

        const key = `${name}-${safeUnitPrice}-${note || "sin-nota"}`;
        const existing = grouped.get(key);

        if (existing) {
          existing.quantity += safeQuantity;
          existing.subtotal += safeUnitPrice * safeQuantity;
          return;
        }

        grouped.set(key, {
          key: `${pedido.id || "pedido"}-${index}-${key}`,
          name,
          quantity: safeQuantity,
          unitPrice: safeUnitPrice,
          subtotal: safeUnitPrice * safeQuantity,
          note,
        });
      });
    });

    return Array.from(grouped.values());
  }, [menuPriceByName, pedidos]);

  const total = useMemo(() => {
    const itemsTotal = billItems.reduce((sum, item) => sum + item.subtotal, 0);

    if (itemsTotal > 0) return itemsTotal;

    return pedidos.reduce((sum, pedido) => {
      const pedidoTotal = Number(pedido.total || 0);
      return sum + (Number.isFinite(pedidoTotal) ? pedidoTotal : 0);
    }, 0);
  }, [billItems, pedidos]);

  const handleRequestBill = async () => {
    if (!selected || !sessionId || isSubmitting) return;

    try {
      setError(null);
      setIsSubmitting(true);

      const response = await fetch("/api/request-bill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurantId,
          sessionId,
          mesa: tableNumber,
          metodo: selected,
          splitBill,
        }),
      });
      const data = await response.json() as { ok: boolean; error?: string };
      if (!data.ok) {
        throw new Error(data.error ?? "Error desconocido");
      }

      navigate(`/bill-confirmed?restaurantId=${restaurantId}&table=${table}`, {
        state: { table, restaurantId },
      });
    } catch (err) {
      console.error("Error solicitando cuenta:", err);
      setError("No se pudo solicitar la cuenta. Reintentá.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const isLoading = loadingMesa || loadingPedidos || loadingMenu;
  const canSubmit = !!selected && !!sessionId && !isSubmitting && !isLoading;

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <div className="mx-auto w-full max-w-lg">
        <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="px-4 pb-4 pt-[max(12px,env(safe-area-inset-top))]">
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate(-1)}
                disabled={isSubmitting}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm disabled:opacity-50"
              >
                <ArrowLeft size={18} />
              </button>

              <div className="min-w-0">
                <h1 className="text-xl font-bold tracking-tight text-slate-950">
                  Pedir cuenta
                </h1>
                <p className="text-sm text-slate-500">
                  Revisá tu consumo y elegí cómo pagar
                </p>
              </div>

              <span className="ml-auto inline-flex items-center rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground shadow-want">
                Mesa {table}
              </span>
            </div>
          </div>
        </header>

        <main className="px-4 py-4">
          {error && (
            <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {error}
            </div>
          )}

          <section className="mb-5 rounded-xl border border-slate-200 bg-white p-5 text-center shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Total actual
            </p>

            <p className="mt-2 text-4xl font-bold tracking-tight text-slate-950">
              {isLoading ? "..." : formatPriceARS(total)}
            </p>

            <p className="mt-2 text-sm text-slate-500">
              {pedidos.length} pedido(s) cargado(s) · Mesa {table}
            </p>
          </section>

          {sessionId && !isLoading && total <= 0 && (
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
              Todavía no encontramos consumos cargados para esta sesión.
            </div>
          )}

          <section className="mb-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
                <ReceiptText size={18} />
              </div>

              <div>
                <h2 className="text-base font-bold text-slate-950">
                  Detalle de la cuenta
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Estos son los productos cargados en tu mesa.
                </p>
              </div>
            </div>

            {isLoading ? (
              <div className="rounded-lg bg-slate-50 p-4 text-sm font-semibold text-slate-500">
                Cargando detalle...
              </div>
            ) : billItems.length === 0 ? (
              <div className="rounded-lg bg-slate-50 p-4 text-sm font-semibold text-slate-500">
                No hay productos para mostrar todavía.
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-slate-100">
                <div className="divide-y divide-slate-100">
                  {billItems.map((item) => (
                    <div key={item.key} className="bg-white px-3 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-950">
                            {item.quantity}× {item.name}
                          </p>

                          <p className="mt-0.5 text-xs text-slate-500">
                            {formatPriceARS(item.unitPrice)} c/u
                          </p>

                          {item.note && (
                            <p className="mt-1 rounded-xl bg-slate-50 px-2 py-1 text-xs font-medium text-slate-500">
                              Nota: {item.note}
                            </p>
                          )}
                        </div>

                        <p className="shrink-0 text-sm font-bold text-slate-950">
                          {formatPriceARS(item.subtotal)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-3 py-3">
                  <span className="text-sm font-bold text-slate-950">
                    Total
                  </span>
                  <span className="text-lg font-bold text-slate-950">
                    {formatPriceARS(total)}
                  </span>
                </div>
              </div>
            )}
          </section>

          <section className="mb-5">
            <div className="mb-3">
              <h2 className="text-base font-bold text-slate-950">
                ¿Cómo querés pagar?
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Elegí el método de pago para solicitar la cuenta.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {paymentOptions.map((option) => {
                const Icon = option.icon;
                const isSelected = selected === option.id;

                return (
                  <motion.button
                    key={option.id}
                    whileTap={{ scale: isSubmitting ? 1 : 0.97 }}
                    onClick={() => setSelected(option.id)}
                    disabled={isSubmitting}
                    className={`flex min-h-[112px] flex-col items-center justify-center gap-2 rounded-xl border p-4 text-center transition-all disabled:opacity-50 ${
                      isSelected
                        ? "border-primary bg-primary/10 shadow-want"
                        : "border-slate-200 bg-white shadow-sm"
                    }`}
                  >
                    <div
                      className={`flex h-11 w-11 items-center justify-center rounded-full ${
                        isSelected
                          ? "bg-primary text-primary-foreground"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      <Icon size={20} />
                    </div>

                    <span className="text-sm font-semibold text-slate-900">
                      {option.label}
                    </span>
                  </motion.button>
                );
              })}
            </div>
          </section>

          <section className="mb-6">
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <input
                type="checkbox"
                checked={splitBill}
                onChange={(e) => setSplitBill(e.target.checked)}
                disabled={isSubmitting}
                className="mt-1 h-5 w-5 rounded accent-primary"
              />

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Users size={18} className="text-slate-500" />
                  <span className="text-sm font-semibold text-slate-900">
                    Dividir cuenta
                  </span>
                </div>

                <p className="mt-1 text-sm leading-relaxed text-slate-500">
                  Marcá esta opción si van a pagar entre varias personas.
                </p>
              </div>
            </label>
          </section>

          {!sessionId && !loadingMesa && (
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
              No encontramos una sesión activa para esta mesa.
            </div>
          )}
        </main>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-4 backdrop-blur">
        <div className="mx-auto max-w-lg">
          <motion.button
            whileTap={{ scale: isSubmitting ? 1 : 0.985 }}
            disabled={!canSubmit}
            onClick={handleRequestBill}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-lg bg-primary text-base font-bold text-primary-foreground shadow-want disabled:opacity-40"
          >
            <span>{isSubmitting ? "Solicitando..." : "Solicitar cuenta"}</span>
            {!isSubmitting && <ChevronRight size={18} />}
          </motion.button>
        </div>
      </div>
    </div>
  );
};

export default RequestBill;