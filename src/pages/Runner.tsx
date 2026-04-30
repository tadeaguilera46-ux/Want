import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Truck,
  Clock,
  CreditCard,
  Utensils,
  Wine,
  MessageSquareText,
  ChevronRight,
  LogOut,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth-context";
import { getDb } from "../lib/firebase";
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  updateDoc,
  doc,
} from "firebase/firestore";
import { actualizarEstadoCuenta } from "../lib/bill";
import { markMesaAvailable } from "../lib/mesas";
import { useRestaurant } from "../lib/restaurant-context";
import type {
  CuentaRecord,
  PedidoItem,
  PedidoRecord,
  EstadoCuenta,
  MetodoPago,
} from "../lib/restaurant";

const db = getDb();

const NEW_BADGE_MS = 15000;
const WARNING_MINUTES = 10;
const DANGER_MINUTES = 15;

const normalizeObservation = (value?: string) => value?.trim() || "";

const Runner = () => {
  const { restaurantId } = useRestaurant();
  const navigate = useNavigate();
  const { logout, user } = useAuth();

  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    try {
      setLoggingOut(true);
      await logout();

      const nextPath = restaurantId
        ? `/staff/login?restaurantId=${encodeURIComponent(restaurantId)}`
        : "/staff/login";

      navigate(nextPath, { replace: true });
    } catch (error) {
      console.error("Error cerrando sesión:", error);
      alert("No se pudo cerrar la sesión");
    } finally {
      setLoggingOut(false);
    }
  };

  const [tab, setTab] = useState<"orders" | "bills">("orders");
  const [orders, setOrders] = useState<PedidoRecord[]>([]);
  const [bills, setBills] = useState<CuentaRecord[]>([]);
  const [loadingOrdersById, setLoadingOrdersById] = useState<Record<string, boolean>>({});
  const [loadingBillsById, setLoadingBillsById] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [soundEnabled, setSoundEnabled] = useState(false);

  const notifiedBillIdsRef = useRef<Set<string>>(new Set());
  const notifiedReadyOrderIdsRef = useRef<Set<string>>(new Set());
  const firstBillsLoadRef = useRef(true);
  const firstOrdersLoadRef = useRef(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = new Audio("/ding.mp3");
    audio.preload = "auto";
    audio.volume = 1;
    audioRef.current = audio;

    return () => {
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    const unlockAudio = async () => {
      if (!audioRef.current || soundEnabled) return;

      try {
        audioRef.current.muted = true;
        audioRef.current.currentTime = 0;
        await audioRef.current.play();
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        audioRef.current.muted = false;
        setSoundEnabled(true);
      } catch (error) {
        console.error("No se pudo habilitar el sonido del runner:", error);
      }
    };

    window.addEventListener("click", unlockAudio, { once: true });
    window.addEventListener("touchstart", unlockAudio, { once: true });

    return () => {
      window.removeEventListener("click", unlockAudio);
      window.removeEventListener("touchstart", unlockAudio);
    };
  }, [soundEnabled]);

  const playSound = async () => {
    try {
      if (!audioRef.current) return;

      const audio = audioRef.current.cloneNode(true) as HTMLAudioElement;
      audio.volume = 1;
      audio.currentTime = 0;
      await audio.play();
    } catch (error) {
      console.error("Error sonido runner:", error);
    }
  };

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const tieneComida = (order: PedidoRecord) =>
    order.estadoCocina !== null && order.estadoCocina !== undefined;

  const tieneBebidas = (order: PedidoRecord) =>
    order.estadoBarra !== null && order.estadoBarra !== undefined;

  const pedidoListoParaRunner = (order: PedidoRecord) => {
    const hayComida = tieneComida(order);
    const hayBebidas = tieneBebidas(order);

    if (hayComida && hayBebidas) {
      return order.estadoCocina === "listo" && order.estadoBarra === "listo";
    }

    if (hayComida) {
      return order.estadoCocina === "listo";
    }

    if (hayBebidas) {
      return order.estadoBarra === "listo";
    }

    return false;
  };

  const getCreatedAtMs = (
    value: PedidoRecord["createdAt"] | CuentaRecord["createdAt"]
  ) => {
    if (!value) return 0;

    if ("toMillis" in value && typeof value.toMillis === "function") {
      return value.toMillis();
    }

    if ("seconds" in value && typeof value.seconds === "number") {
      return value.seconds * 1000;
    }

    return 0;
  };

  const getElapsedSeconds = (
    value: PedidoRecord["createdAt"] | CuentaRecord["createdAt"]
  ) => {
    const createdAtMs = getCreatedAtMs(value);

    if (!createdAtMs) return 0;

    return Math.max(0, Math.floor((now - createdAtMs) / 1000));
  };

  const getElapsedMinutes = (
    value: PedidoRecord["createdAt"] | CuentaRecord["createdAt"]
  ) => {
    return Math.floor(getElapsedSeconds(value) / 60);
  };

  const formatElapsedTime = (
    value: PedidoRecord["createdAt"] | CuentaRecord["createdAt"]
  ) => {
    const diffSeconds = getElapsedSeconds(value);
    const minutes = Math.floor(diffSeconds / 60);
    const seconds = diffSeconds % 60;

    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  };

  const getTimeStyles = (
    value: PedidoRecord["createdAt"] | CuentaRecord["createdAt"]
  ) => {
    const minutes = getElapsedMinutes(value);

    if (minutes >= DANGER_MINUTES) {
      return "bg-red-50 text-red-700 border border-red-200";
    }

    if (minutes >= WARNING_MINUTES) {
      return "bg-amber-50 text-amber-800 border border-amber-200";
    }

    return "bg-slate-100 text-slate-700 border border-slate-200";
  };

  const getOrderCardStyles = (order: PedidoRecord) => {
    const completo =
      (!tieneComida(order) || order.estadoCocina === "listo") &&
      (!tieneBebidas(order) || order.estadoBarra === "listo");

    const minutes = getElapsedMinutes(order.createdAt);

    if (!completo) {
      return "border-l-4 border-l-amber-500";
    }

    if (minutes >= DANGER_MINUTES) {
      return "border-l-4 border-l-red-500";
    }

    if (minutes >= WARNING_MINUTES) {
      return "border-l-4 border-l-amber-500";
    }

    return "border-l-4 border-l-emerald-500";
  };

  const getBillCardStyles = (bill: CuentaRecord) => {
    if (bill.estado === "pendiente") return "border-l-4 border-l-red-500";
    if (bill.estado === "en_camino") return "border-l-4 border-l-blue-500";
    if (bill.estado === "pagada") return "border-l-4 border-l-amber-500";
    return "border-l-4 border-l-emerald-500";
  };

  useEffect(() => {
    if (!restaurantId) {
      setOrders([]);
      setError("Falta restaurante activo.");
      return;
    }

    const q = query(
      collection(db, "restaurants", restaurantId, "pedidos"),
      orderBy("createdAt", "asc")
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setError(null);

        const data = snapshot.docs.map((document) => ({
          id: document.id,
          ...document.data(),
        })) as PedidoRecord[];

        const pedidosListos = data.filter((order) => pedidoListoParaRunner(order));

        if (firstOrdersLoadRef.current) {
          pedidosListos.forEach((order) => {
            notifiedReadyOrderIdsRef.current.add(order.id);
          });
          firstOrdersLoadRef.current = false;
        } else {
          const nuevosPedidosListos = pedidosListos.filter(
            (order) => !notifiedReadyOrderIdsRef.current.has(order.id)
          );

          if (nuevosPedidosListos.length > 0) {
            void playSound();
            nuevosPedidosListos.forEach((order) => {
              notifiedReadyOrderIdsRef.current.add(order.id);
            });
          }
        }

        setOrders(pedidosListos);
      },
      (err) => {
        console.error("Error escuchando pedidos listos:", err);
        setError("No se pudieron cargar los pedidos listos.");
      }
    );

    return () => unsubscribe();
  }, [restaurantId]);

  useEffect(() => {
    if (!restaurantId) {
      setBills([]);
      setError("Falta restaurante activo.");
      return;
    }

    const q = query(
      collection(db, "restaurants", restaurantId, "cuentas"),
      orderBy("createdAt", "asc")
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setError(null);

        const data = snapshot.docs.map((document) => ({
          id: document.id,
          ...document.data(),
        })) as CuentaRecord[];

        const cuentasPendientes = data.filter((bill) => bill.estado === "pendiente");

        if (firstBillsLoadRef.current) {
          cuentasPendientes.forEach((bill) => {
            notifiedBillIdsRef.current.add(bill.id);
          });
          firstBillsLoadRef.current = false;
        } else {
          const nuevas = cuentasPendientes.filter(
            (bill) => !notifiedBillIdsRef.current.has(bill.id)
          );

          if (nuevas.length > 0) {
            void playSound();
            nuevas.forEach((bill) => {
              notifiedBillIdsRef.current.add(bill.id);
            });
          }
        }

        setBills(data);
      },
      (err) => {
        console.error("Error escuchando cuentas:", err);
        setError("No se pudieron cargar las cuentas.");
      }
    );

    return () => unsubscribe();
  }, [restaurantId]);

  const markDelivered = async (id: string) => {
    if (loadingOrdersById[id] || !restaurantId) return;

    try {
      setLoadingOrdersById((prev) => ({ ...prev, [id]: true }));
      setError(null);

      const ref = doc(db, "restaurants", restaurantId, "pedidos", id);

      await updateDoc(ref, {
        estadoCocina: "entregado",
        estadoBarra: "entregado",
      });
    } catch (err) {
      console.error("Error marcando pedido como entregado:", err);
      setError("No se pudo marcar el pedido como entregado.");
    } finally {
      setLoadingOrdersById((prev) => ({ ...prev, [id]: false }));
    }
  };

  const updateBill = async (id: string, estado: EstadoCuenta) => {
    if (loadingBillsById[id] || !restaurantId) return;

    try {
      setLoadingBillsById((prev) => ({ ...prev, [id]: true }));
      setError(null);

      const bill = bills.find((currentBill) => currentBill.id === id);

      if (!bill) {
        throw new Error("Cuenta no encontrada");
      }

      await actualizarEstadoCuenta(
        restaurantId,
        id,
        estado,
        Number(bill.mesa)
      );
    } catch (err) {
      console.error("Error actualizando cuenta:", err);
      setError("No se pudo actualizar la cuenta.");
    } finally {
      setLoadingBillsById((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleMesaLimpia = async (bill: CuentaRecord) => {
    if (loadingBillsById[bill.id] || !restaurantId) return;

    const ok = window.confirm(
      `¿Confirmás que la mesa ${bill.mesa} ya está limpia y lista para nuevos clientes?`
    );
    if (!ok) return;

    try {
      setLoadingBillsById((prev) => ({ ...prev, [bill.id]: true }));
      setError(null);

      await markMesaAvailable(restaurantId, Number(bill.mesa));
      await actualizarEstadoCuenta(
        restaurantId,
        bill.id,
        "cerrada",
        Number(bill.mesa)
      );
    } catch (err) {
      console.error("Error marcando mesa limpia:", err);
      setError("No se pudo marcar la mesa como limpia.");
    } finally {
      setLoadingBillsById((prev) => ({ ...prev, [bill.id]: false }));
    }
  };

  const pendingBills = bills.filter((bill) => bill.estado === "pendiente").length;
  const visibleBills = bills.filter((bill) => bill.estado !== "cerrada");

  const getPaymentMethodLabel = (metodo: MetodoPago | null) => {
    if (metodo === "cash") return "Efectivo";
    if (metodo === "debit") return "Débito";
    if (metodo === "credit") return "Crédito";
    if (metodo === "transfer") return "Transferencia";
    return "Sin definir";
  };

  const getPaymentMethodClass = (metodo: MetodoPago | null) => {
    if (metodo === "cash") {
      return "bg-green-100 text-green-700 border border-green-300";
    }

    if (metodo === "debit" || metodo === "credit") {
      return "bg-blue-100 text-blue-700 border border-blue-300";
    }

    if (metodo === "transfer") {
      return "bg-purple-100 text-purple-700 border border-purple-300";
    }

    return "bg-gray-100 text-gray-700 border border-gray-300";
  };

  const readyOrders = useMemo(() => {
    return [...orders].sort(
      (a, b) => getCreatedAtMs(a.createdAt) - getCreatedAtMs(b.createdAt)
    );
  }, [orders]);

  const renderItemsSection = (
    title: string,
    items: PedidoItem[],
    icon?: "food" | "drinks"
  ) => {
    if (items.length === 0) return null;
    
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wide text-slate-500">
          {icon === "food" && <Utensils size={13} />}
          {icon === "drinks" && <Wine size={13} />}
          <span>{title}</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700">
            {items.length}
          </span>
        </div>

        <div className="space-y-2">
          {items.map((item, i) => {
            const observation = normalizeObservation(item.observacion);
            const hasObservation = observation.length > 0;

            return (
              <div
                key={`${item.nombre}-${observation || "sin-observacion"}-${i}`}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold leading-snug text-slate-900 break-words">
                      {item.nombre}
                    </p>
                  </div>

                  <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-extrabold text-slate-700 border border-slate-200">
                    x{item.cantidad}
                  </span>
                </div>

                {hasObservation && (
                  <div className="mt-3 rounded-xl border border-amber-300 bg-amber-100 px-3 py-2.5">
                    <div className="flex items-start gap-2">
                      <MessageSquareText
                        size={14}
                        className="mt-0.5 shrink-0 text-amber-900"
                      />
                      <div className="min-w-0">
                        <p className="mb-1 text-[11px] font-extrabold uppercase tracking-wide text-amber-900">
                          OBS
                        </p>
                        <p className="text-sm font-semibold leading-snug text-amber-950 break-words">
                          {observation}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderOrderCard = (order: PedidoRecord) => {
    const comida =
      order.items?.filter((item: PedidoItem) => item.category !== "drinks") || [];
    const bebidas =
      order.items?.filter((item: PedidoItem) => item.category === "drinks") || [];
    const isLoading = !!loadingOrdersById[order.id];
    const isNew = now - getCreatedAtMs(order.createdAt) < NEW_BADGE_MS;
    const completo =
      (!tieneComida(order) || order.estadoCocina === "listo") &&
      (!tieneBebidas(order) || order.estadoBarra === "listo");

    return (
      <motion.div
        key={order.id}
        layout
        className={`rounded-3xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-200 ${getOrderCardStyles(
          order
        )} ${isNew ? "ring-2 ring-orange-300" : ""}`}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-black tracking-tight text-slate-900">
                Mesa {order.mesa}
              </h2>

              {isNew && (
                <span className="rounded-full bg-orange-500 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-white">
                  Nuevo
                </span>
              )}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <div
                className={`inline-flex items-center rounded-full px-3 py-1.5 text-sm font-bold ${getTimeStyles(
                  order.createdAt
                )}`}
              >
                ⏱ {formatElapsedTime(order.createdAt)}
              </div>

              <span
                className={`inline-flex items-center rounded-full px-3 py-1.5 text-xs font-extrabold uppercase tracking-wide ${
                  completo
                    ? "bg-emerald-100 text-emerald-700 border border-emerald-200"
                    : "bg-amber-100 text-amber-800 border border-amber-200"
                }`}
              >
                {completo ? "Completo" : "Parcial"}
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {renderItemsSection("Cocina", comida, "food")}
          {renderItemsSection("Bar", bebidas, "drinks")}
        </div>

        <button
          onClick={() => markDelivered(order.id)}
          disabled={isLoading}
          className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 text-sm font-extrabold text-white transition-all duration-200 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span>{isLoading ? "Actualizando..." : "Marcar como entregado"}</span>
          {!isLoading && <ChevronRight size={16} />}
        </button>
      </motion.div>
    );
  };

  const renderBillCard = (bill: CuentaRecord) => {
    const isLoading = !!loadingBillsById[bill.id];
    const isNew = now - getCreatedAtMs(bill.createdAt) < NEW_BADGE_MS;

    return (
      <motion.div
        key={bill.id}
        layout
        className={`rounded-3xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-200 ${getBillCardStyles(
          bill
        )} ${bill.estado === "pendiente" ? "ring-1 ring-red-200" : ""} ${
          isNew ? "ring-2 ring-orange-300" : ""
        }`}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-black tracking-tight text-slate-900">
                Mesa {bill.mesa}
              </h2>

              {isNew && (
                <span className="rounded-full bg-orange-500 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-white">
                  Nuevo
                </span>
              )}
            </div>

            <div className="mt-2">
              <div
                className={`inline-flex items-center rounded-full px-3 py-1.5 text-sm font-bold ${getTimeStyles(
                  bill.createdAt
                )}`}
              >
                ⏱ {formatElapsedTime(bill.createdAt)}
              </div>
            </div>
          </div>

          <span
            className={`inline-flex rounded-full px-3 py-1.5 text-xs font-extrabold uppercase tracking-wide ${
              bill.estado === "pendiente"
                ? "bg-red-100 text-red-700 border border-red-200"
                : bill.estado === "en_camino"
                  ? "bg-blue-100 text-blue-700 border border-blue-200"
                  : bill.estado === "pagada"
                    ? "bg-amber-100 text-amber-700 border border-amber-200"
                    : "bg-emerald-100 text-emerald-700 border border-emerald-200"
            }`}
          >
            {bill.estado === "pendiente"
              ? "Pendiente"
              : bill.estado === "en_camino"
                ? "En camino"
                : bill.estado === "pagada"
                  ? "Pagada"
                  : "Cerrada"}
          </span>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold ${getPaymentMethodClass(
              bill.metodo
            )}`}
          >
            <CreditCard size={14} />
            {getPaymentMethodLabel(bill.metodo)}
          </span>
        </div>

        <div className="rounded-2xl bg-slate-50 p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Total
          </p>
          <p className="mt-1 text-3xl font-black tracking-tight text-slate-900">
            ${Number(bill.total || 0).toFixed(2)}
          </p>
        </div>

        {bill.estado === "pendiente" && (
          <p className="mt-3 text-sm font-semibold text-red-600">
            Nueva solicitud de cuenta
          </p>
        )}

        {bill.estado === "en_camino" && (
          <p className="mt-3 text-sm font-semibold text-blue-600">
            Llevar cuenta a la mesa
          </p>
        )}

        {bill.estado === "pagada" && (
          <p className="mt-3 text-sm font-semibold text-amber-600">
            Pago registrado. Falta marcar mesa limpia.
          </p>
        )}

        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {bill.estado === "pendiente" && (
            <button
              onClick={() => updateBill(bill.id, "en_camino")}
              disabled={isLoading}
              className="flex h-12 items-center justify-center rounded-2xl bg-slate-900 px-4 text-sm font-extrabold text-white transition-all duration-200 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? "Actualizando..." : "Llevar cuenta"}
            </button>
          )}

          {bill.estado === "en_camino" && (
            <button
              onClick={() => updateBill(bill.id, "pagada")}
              disabled={isLoading}
              className="flex h-12 items-center justify-center rounded-2xl bg-emerald-600 px-4 text-sm font-extrabold text-white transition-all duration-200 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? "Actualizando..." : "Marcar pagada"}
            </button>
          )}

          {bill.estado === "pagada" && (
            <button
              onClick={() => handleMesaLimpia(bill)}
              disabled={isLoading}
              className="flex h-12 items-center justify-center rounded-2xl bg-slate-900 px-4 text-sm font-extrabold text-white transition-all duration-200 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-2"
            >
              {isLoading ? "Actualizando..." : "Mesa limpia"}
            </button>
          )}
        </div>
      </motion.div>
    );
  };

  if (!restaurantId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
        <div className="rounded-3xl border border-red-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-black text-slate-950">
            Falta restaurante activo
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Seleccioná un restaurante antes de entrar a runner.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto w-full max-w-md md:max-w-2xl lg:max-w-3xl xl:max-w-4xl">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="px-4 pb-4 pt-[max(12px,env(safe-area-inset-top))] sm:px-5">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-sm">
                <Truck size={20} />
              </div>

              <div className="min-w-0">
                <h1 className="text-xl font-black tracking-tight text-slate-900">
                  Runner
                </h1>
                <p className="mt-0.5 text-sm text-slate-500">
                  {readyOrders.length} pedidos listos · {visibleBills.length} cuentas activas
                </p>
                {user?.email && (
                    <p className="mt-1 text-xs text-slate-400">
                      Sesión activa: {user.email}
                    </p>
                )}
              </div>

              <div className="ml-auto flex flex-col items-end gap-2">
              <div className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 border border-emerald-200">
                <Clock size={12} />
                Live
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
              </div>

              <button
                onClick={handleLogout}
                disabled={loggingOut}
                className="flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
              >
                <LogOut size={14} />
                {loggingOut ? "Cerrando..." : "Cerrar sesiósn"}
              </button>
            </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                onClick={() => setTab("orders")}
                className={`relative flex h-12 items-center justify-center rounded-2xl px-3 text-sm font-extrabold transition-all ${
                  tab === "orders"
                    ? "bg-slate-900 text-white shadow-sm"
                    : "border border-slate-200 bg-white text-slate-700"
                }`}
              >
                Pedidos
                <span
                  className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
                    tab === "orders"
                      ? "bg-white/15 text-white"
                      : "bg-slate-100 text-slate-700"
                  }`}
                >
                  {readyOrders.length}
                </span>
              </button>

              <button
                onClick={() => setTab("bills")}
                className={`relative flex h-12 items-center justify-center rounded-2xl px-3 text-sm font-extrabold transition-all ${
                  tab === "bills"
                    ? "bg-slate-900 text-white shadow-sm"
                    : "border border-slate-200 bg-white text-slate-700"
                }`}
              >
                Cuentas
                <span
                  className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
                    tab === "bills"
                      ? "bg-white/15 text-white"
                      : "bg-slate-100 text-slate-700"
                  }`}
                >
                  {visibleBills.length}
                </span>

                {pendingBills > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-extrabold text-white shadow-sm">
                    {pendingBills}
                  </span>
                )}
              </button>
            </div>
          </div>
        </header>

        <main className="px-4 py-4 pb-24 sm:px-5 sm:py-5">
          {!soundEnabled && (
            <div className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
              Tocá una vez la pantalla para habilitar el sonido.
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {error}
            </div>
          )}

          {tab === "orders" && (
            <>
              {readyOrders.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center shadow-sm">
                  <p className="text-base font-semibold text-slate-700">
                    No hay pedidos listos
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    Cuando cocina o barra terminen un pedido, va a aparecer acá.
                  </p>
                </div>
              ) : (
                <div className="space-y-3 md:grid md:grid-cols-2 md:gap-4 md:space-y-0">
                  {readyOrders.map(renderOrderCard)}
                </div>
              )}
            </>
          )}

          {tab === "bills" && (
            <>
              {visibleBills.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center shadow-sm">
                  <p className="text-base font-semibold text-slate-700">
                    No hay cuentas activas
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    Las solicitudes de cuenta van a aparecer acá.
                  </p>
                </div>
              ) : (
                <div className="space-y-3 md:grid md:grid-cols-2 md:gap-4 md:space-y-0">
                  {visibleBills.map(renderBillCard)}
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
};

export default Runner;