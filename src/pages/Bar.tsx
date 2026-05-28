import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Wine,
  Clock3,
  CheckCircle2,
  MessageSquareText,
  Martini,
  Flame,
  LogOut,
} from "lucide-react";
import { getDb } from "../lib/firebase";
import { createAuditLog } from "../lib/audit-logs";
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  updateDoc,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import { toast } from "sonner";
import type {
  PedidoRecord,
  EstadoCocinaBarra,
  FirestoreTimestampLike,
} from "../lib/restaurant";
import { useRestaurant } from "../lib/restaurant-context";
import { useAuth } from "../lib/auth-context";

const db = getDb();

type EstadoBarra = Extract<
  EstadoCocinaBarra,
  "pendiente" | "preparando" | "listo" | "entregado"
>;

type Pedido = PedidoRecord;

const NEW_BADGE_MS = 15000;
const WARNING_MINUTES = 8;
const DANGER_MINUTES = 12;
const NOW_REFRESH_MS = 5000;

const statusLabels: Record<EstadoBarra, string> = {
  pendiente: "Pendiente",
  preparando: "Preparando",
  listo: "Listo",
  entregado: "Entregado",
};

const normalizeObservation = (value?: string) => value?.trim() || "";

const isDrinkItem = (item: { category?: string }) => {
  return item.category === "drinks";
};

const Bar = () => {
  const navigate = useNavigate();
  const { restaurantId } = useRestaurant();
  const { logout, user } = useAuth();

  const [orders, setOrders] = useState<Pedido[]>([]);
  const [loadingById, setLoadingById] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const notifiedOrderIdsRef = useRef<Set<string>>(new Set());
  const firstLoadRef = useRef(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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
      toast.error("No se pudo cerrar la sesión");
    } finally {
      setLoggingOut(false);
    }
  };

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
        console.error("No se pudo habilitar el sonido del bar:", error);
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
      console.error("Error sonido bar:", error);
    }
  };

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, NOW_REFRESH_MS);

    return () => clearInterval(interval);
  }, []);

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
        })) as Pedido[];

        const drinkOrders = data.filter((order) => {
          const tieneBebidas = order.items?.some(isDrinkItem);

          const estadoValido =
            order.estadoBarra !== null && order.estadoBarra !== undefined;

          return tieneBebidas && estadoValido;
        });

        if (firstLoadRef.current) {
          drinkOrders.forEach((order) => {
            notifiedOrderIdsRef.current.add(order.id);
          });
          firstLoadRef.current = false;
        } else {
          const nuevosPedidos = drinkOrders.filter(
            (order) => !notifiedOrderIdsRef.current.has(order.id)
          );

          if (nuevosPedidos.length > 0) {
            void playSound();
            nuevosPedidos.forEach((order) => {
              notifiedOrderIdsRef.current.add(order.id);
            });
          }
        }

        setOrders(drinkOrders);
      },
      (err) => {
        console.error("Error escuchando pedidos de barra:", err);
        setError("No se pudieron cargar los pedidos de barra.");
      }
    );

    return () => unsubscribe();
  }, [restaurantId]);

  const updateStatus = async (id: string, newStatus: EstadoBarra) => {
    if (loadingById[id] || !restaurantId) return;

    try {
      setLoadingById((prev) => ({ ...prev, [id]: true }));
      setError(null);

      const ref = doc(db, "restaurants", restaurantId, "pedidos", id);

      const updateData: Record<string, unknown> = {
        estadoBarra: newStatus,
        updatedAt: serverTimestamp(),
      };

      if (newStatus === "preparando") {
        updateData.barraStartedAt = serverTimestamp();
      }

      if (newStatus === "listo") {
        updateData.barraReadyAt = serverTimestamp();
      }

      await updateDoc(ref, updateData);
      if (newStatus === "listo") {
        const order = orders.find((currentOrder) => currentOrder.id === id);

        await createAuditLog({
          restaurantId,
          action: "pedido_listo",
          userUid: user?.uid,
          userEmail: user?.email || "",
          userRole: "bar",
          mesa: Number(order?.mesa || 0),
          pedidoId: id,
          description: `Barra marcó bebidas listas en mesa ${order?.mesa || "-"}`,
        });
      }
    } catch (err) {
      console.error("Error actualizando estado de barra:", err);
      setError("No se pudo actualizar el estado. Reintentá.");
    } finally {
      setLoadingById((prev) => ({ ...prev, [id]: false }));
    }
  };

  const nextStatus = (status: EstadoBarra | null | undefined) => {
    if (status === "pendiente") return "preparando";
    if (status === "preparando") return "listo";
    return null;
  };

  const getCreatedAtMs = (value?: FirestoreTimestampLike | null) => {
    if (!value) return 0;
    if (typeof value.toMillis === "function") return value.toMillis();
    if (typeof value.seconds === "number") return value.seconds * 1000;
    return 0;
  };

  const getElapsedSeconds = (order: Pedido) => {
    const createdAtMs = getCreatedAtMs(order.createdAt);
    if (!createdAtMs) return 0;
    return Math.max(0, Math.floor((now - createdAtMs) / 1000));
  };

  const getElapsedMinutes = (order: Pedido) => {
    return Math.floor(getElapsedSeconds(order) / 60);
  };

  const formatElapsedTime = (order: Pedido) => {
    const diffSeconds = getElapsedSeconds(order);
    const minutes = Math.floor(diffSeconds / 60);
    const seconds = diffSeconds % 60;

    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  };

  const getTimeStyles = (order: Pedido) => {
    const minutes = getElapsedMinutes(order);

    if (minutes >= DANGER_MINUTES) {
      return "bg-red-50 text-red-700 border border-red-200";
    }

    if (minutes >= WARNING_MINUTES) {
      return "bg-amber-50 text-amber-800 border border-amber-200";
    }

    return "bg-slate-100 text-slate-700 border border-slate-200";
  };

  const getCardAccent = (status: EstadoBarra) => {
    if (status === "pendiente") return "border-l-red-500";
    if (status === "preparando") return "border-l-amber-500";
    if (status === "listo") return "border-l-emerald-500";
    return "border-l-slate-300";
  };

  const getBadgeStyles = (status: EstadoBarra) => {
    if (status === "pendiente") {
      return "bg-red-100 text-red-700 border border-red-200";
    }

    if (status === "preparando") {
      return "bg-amber-100 text-amber-800 border border-amber-200";
    }

    if (status === "listo") {
      return "bg-emerald-100 text-emerald-700 border border-emerald-200";
    }

    return "bg-slate-100 text-slate-700 border border-slate-200";
  };

  const getEstadoPriority = (status: EstadoBarra) => {
    if (status === "pendiente") return 0;
    if (status === "preparando") return 1;
    if (status === "listo") return 2;
    return 3;
  };

  const visibleOrders = useMemo(() => {
    return orders
      .filter((order) => {
        const status = (order.estadoBarra || "pendiente") as EstadoBarra;
        return status !== "listo" && status !== "entregado";
      })
      .sort((a, b) => {
        const statusA = (a.estadoBarra || "pendiente") as EstadoBarra;
        const statusB = (b.estadoBarra || "pendiente") as EstadoBarra;

        const priorityDiff =
          getEstadoPriority(statusA) - getEstadoPriority(statusB);

        if (priorityDiff !== 0) return priorityDiff;

        return getCreatedAtMs(a.createdAt) - getCreatedAtMs(b.createdAt);
      });
  }, [orders]);

  const stats = useMemo(() => {
    const pendientes = visibleOrders.filter(
      (o) => (o.estadoBarra || "pendiente") === "pendiente"
    ).length;

    const preparando = visibleOrders.filter(
      (o) => (o.estadoBarra || "pendiente") === "preparando"
    ).length;

    const urgentes = visibleOrders.filter(
      (o) => getElapsedMinutes(o) >= WARNING_MINUTES
    ).length;

    return {
      activos: visibleOrders.length,
      pendientes,
      preparando,
      urgentes,
    };
  }, [visibleOrders, now]);

  if (!restaurantId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 px-6">
        <div className="rounded-3xl border border-red-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-black text-slate-950">
            Falta restaurante activo
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Seleccioná un restaurante antes de entrar a bar.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto max-w-[1800px] px-4 py-4 md:px-6 lg:px-8">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-sm">
                <Wine size={22} />
              </div>

              <div>
                <h1 className="text-2xl font-black tracking-tight text-slate-950 md:text-3xl">
                  Bar
                </h1>
                <p className="text-sm text-slate-500 md:text-base">
                  Estación fija · pedidos de bebidas en tiempo real
                </p>
                {user?.email && (
                  <p className="mt-1 text-xs text-slate-400">
                    Sesión activa: {user.email}
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-3 xl:items-end">
              <button
                onClick={handleLogout}
                disabled={loggingOut}
                className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 font-semibold text-slate-900 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <LogOut size={16} />
                {loggingOut ? "Cerrando..." : "Cerrar sesión"}
              </button>

              <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
                    Activos
                  </p>
                  <p className="mt-1 text-2xl font-black text-slate-950">
                    {stats.activos}
                  </p>
                </div>

                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 shadow-sm">
                  <p className="text-[11px] font-extrabold uppercase tracking-wide text-red-600">
                    Pendientes
                  </p>
                  <p className="mt-1 text-2xl font-black text-red-700">
                    {stats.pendientes}
                  </p>
                </div>

                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 shadow-sm">
                  <p className="text-[11px] font-extrabold uppercase tracking-wide text-amber-700">
                    Preparando
                  </p>
                  <p className="mt-1 text-2xl font-black text-amber-800">
                    {stats.preparando}
                  </p>
                </div>

                <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 shadow-sm">
                  <p className="text-[11px] font-extrabold uppercase tracking-wide text-orange-700">
                    Urgentes
                  </p>
                  <p className="mt-1 text-2xl font-black text-orange-800">
                    {stats.urgentes}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-[1800px] px-4 py-4 md:px-6 md:py-6 lg:px-8">
        {!soundEnabled && (
          <div className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
            Tocá la pantalla una vez para habilitar el sonido.
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        {visibleOrders.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-8 py-14 text-center shadow-sm">
            <p className="text-lg font-semibold text-slate-700">
              No hay pedidos de barra activos
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Los nuevos pedidos de bebidas van a aparecer automáticamente acá.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {visibleOrders.map((order) => {
              const bebidas = order.items?.filter(isDrinkItem) || [];
              const status = (order.estadoBarra || "pendiente") as EstadoBarra;
              const next = nextStatus(status);
              const isLoading = !!loadingById[order.id];
              const isNew = now - getCreatedAtMs(order.createdAt) < NEW_BADGE_MS;

              return (
                <motion.div
                  key={order.id}
                  layout
                  className={`rounded-3xl border border-slate-200 border-l-4 bg-white p-5 shadow-sm transition-all duration-200 ${getCardAccent(
                    status
                  )} ${isNew ? "ring-2 ring-orange-300" : ""}`}
                >
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-2xl font-black tracking-tight text-slate-950">
                          Mesa {order.mesa}
                        </p>

                        {isNew && (
                          <span className="rounded-full bg-orange-500 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-white">
                            Nuevo
                          </span>
                        )}
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center rounded-full px-3 py-1.5 text-xs font-extrabold uppercase tracking-wide ${getBadgeStyles(
                            status
                          )}`}
                        >
                          {status === "pendiente" && (
                            <Clock3 size={13} className="mr-1.5" />
                          )}
                          {status === "preparando" && (
                            <Flame size={13} className="mr-1.5" />
                          )}
                          {status === "listo" && (
                            <CheckCircle2 size={13} className="mr-1.5" />
                          )}
                          {statusLabels[status]}
                        </span>

                        <span
                          className={`inline-flex rounded-full px-3 py-1.5 text-sm font-bold ${getTimeStyles(
                            order
                          )}`}
                        >
                          ⏱ {formatElapsedTime(order)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {bebidas.map((item, index) => {
                      const observation = normalizeObservation(item.observacion);
                      const hasObservation = observation.length > 0;

                      return (
                        <div
                          key={`${item.nombre}-${observation || "sin-observacion"}-${index}`}
                          className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start gap-2">
                                <Martini
                                  size={16}
                                  className="mt-0.5 shrink-0 text-slate-500"
                                />
                                <p className="text-base font-extrabold leading-tight text-slate-950 break-words">
                                  {item.nombre}
                                </p>
                              </div>
                            </div>

                            <div className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-black text-slate-900">
                              x{item.cantidad}
                            </div>
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

                  {next && (
                    <motion.button
                      whileTap={{ scale: 0.99 }}
                      onClick={() => updateStatus(order.id, next)}
                      disabled={isLoading}
                      className={`mt-5 flex h-12 w-full items-center justify-center rounded-2xl px-4 text-sm font-extrabold text-white transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${
                        next === "preparando"
                          ? "bg-slate-950 hover:opacity-90"
                          : "bg-emerald-600 hover:opacity-90"
                      }`}
                    >
                      {isLoading
                        ? "Actualizando..."
                        : next === "preparando"
                          ? "Empezar preparación"
                          : "Marcar como listo"}
                    </motion.button>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
};

export default Bar;