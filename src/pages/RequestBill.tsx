import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Banknote,
  CreditCard,
  Landmark,
  Users,
  ChevronRight,
} from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import { getDb } from "../lib/firebase";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { pedirCuenta } from "../lib/bill";
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

const formatPriceARS = (value: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value || 0);

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
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loadingMesa, setLoadingMesa] = useState(true);
  const [loadingPedidos, setLoadingPedidos] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          data?.estado === "occupied" && typeof data?.activeSessionId === "string"
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

    setLoadingPedidos(true);

    const q = query(
      collection(db, "restaurants", restaurantId, "pedidos"),
      where("sessionId", "==", sessionId)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((document) => ({
          id: document.id,
          ...document.data(),
        })) as PedidoRecord[];

        const pedidosFiltrados = data.filter(
          (pedido) => String(pedido.mesa) === String(tableNumber)
        );

        setPedidos(pedidosFiltrados);
        setLoadingPedidos(false);
      },
      (err) => {
        console.error("Error leyendo pedidos:", err);
        setError("No se pudieron cargar los pedidos de la mesa.");
        setLoadingPedidos(false);
      }
    );

    return () => unsubscribe();
  }, [restaurantId, sessionId, tableNumber]);

  const total = useMemo(() => {
    return pedidos.reduce((sum, pedido) => {
      const pedidoTotal = Number(pedido.total || 0);
      return sum + (Number.isFinite(pedidoTotal) ? pedidoTotal : 0);
    }, 0);
  }, [pedidos]);

  const handleRequestBill = async () => {
    if (!selected || !sessionId || isSubmitting) return;

    try {
      setError(null);
      setIsSubmitting(true);

      await pedirCuenta({
        restaurantId,
        mesa: tableNumber,
        metodo: selected,
        total,
        splitBill,
      });

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

  const isLoading = loadingMesa || loadingPedidos;
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
                <h1 className="text-xl font-black tracking-tight text-slate-950">
                  Pedir cuenta
                </h1>
                <p className="text-sm text-slate-500">
                  Elegí cómo querés pagar
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
            <div className="mb-4 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {error}
            </div>
          )}

          <section className="mb-5 rounded-3xl border border-slate-200 bg-white p-5 text-center shadow-sm">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-slate-500">
              Total actual
            </p>

            <p className="mt-2 text-4xl font-black tracking-tight text-slate-950">
              {isLoading ? "..." : formatPriceARS(total)}
            </p>

            <p className="mt-2 text-sm text-slate-500">
              {pedidos.length} pedido(s) cargado(s) · Mesa {table}
            </p>
          </section>

          {sessionId && !isLoading && total <= 0 && (
            <div className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
              Todavía no encontramos consumos cargados para esta sesión.
            </div>
          )}

          <section className="mb-5">
            <div className="mb-3">
              <h2 className="text-base font-black text-slate-950">
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
                    className={`flex min-h-[112px] flex-col items-center justify-center gap-2 rounded-3xl border p-4 text-center transition-all disabled:opacity-50 ${
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
            <label className="flex cursor-pointer items-start gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
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
            <div className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
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
            className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-black text-primary-foreground shadow-want disabled:opacity-40"
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