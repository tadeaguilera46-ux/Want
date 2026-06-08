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
  AlertTriangle,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { getDb } from "../lib/firebase";
import { writeAuditLog } from "../lib/audit-logs";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { useWakeLock } from "../hooks/useWakeLock";
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  doc,
  serverTimestamp,
  writeBatch,
  updateDoc,
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

const CRITICAL_KEYWORDS = [
  "alergi", "celiac", "celiaquí", "gluten", "lactosa",
  "maní", "mani", "nuez", "nueces", "cacahuete",
  "diabétic", "diabetic", "intoleranc", "fruto seco",
  "sin azúcar", "sin azucar", "anafilax",
];

const isCriticalObservation = (text: string) =>
  CRITICAL_KEYWORDS.some((kw) => text.toLowerCase().includes(kw));

const isDrinkItem = (item: { category?: string }) => {
  return item.category === "drinks";
};

const Bar = () => {
  const navigate = useNavigate();
  const { restaurantId } = useRestaurant();
  const { logout, user } = useAuth();
  const isOnline = useOnlineStatus();
  const { isWakeLockActive, isWakeLockSupported } = useWakeLock(true);
  const [orders, setOrders] = useState<Pedido[]>([]);
  const [loadingById, setLoadingById] = useState<Record<string, boolean>>({});
  const [loadingByItemKey, setLoadingByItemKey] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [showDisponibilidad, setShowDisponibilidad] = useState(false);
  const [barMenuItems, setBarMenuItems] = useState<{ id: string; nombre: string; category: string; active: boolean }[]>([]);
  const [togglingByBarItemId, setTogglingByBarItemId] = useState<Record<string, boolean>>({});
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

  useEffect(() => {
    if (!restaurantId || !showDisponibilidad) return;
    const q = query(collection(db, "restaurants", restaurantId, "menu"), orderBy("name", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      setBarMenuItems(
        snap.docs
          .filter((d) => d.data().type === "drinks")
          .map((d) => ({
            id: d.id,
            nombre: String(d.data().name ?? ""),
            category: String(d.data().category ?? ""),
            active: d.data().active !== false,
          }))
      );
    });
    return unsub;
  }, [restaurantId, showDisponibilidad]);

  const toggleDisponibilidadBar = async (itemId: string, currentActive: boolean) => {
    if (togglingByBarItemId[itemId] || !restaurantId || !user) return;
    if (!isOnline) { toast.error("Sin conexión."); return; }
    setTogglingByBarItemId((prev) => ({ ...prev, [itemId]: true }));
    try {
      await updateDoc(doc(db, "restaurants", restaurantId, "menu", itemId), {
        active: !currentActive,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error("Error cambiando disponibilidad:", err);
      toast.error("No se pudo cambiar la disponibilidad.");
    } finally {
      setTogglingByBarItemId((prev) => ({ ...prev, [itemId]: false }));
    }
  };

  const updateStatus = async (id: string, newStatus: EstadoBarra) => {
    if (loadingById[id] || !restaurantId || !user) return;

    if (!isOnline) {
      toast.error("Sin conexión. No se pueden actualizar pedidos ahora.");
      return;
    }

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

      const batch = writeBatch(db);
      batch.update(ref, updateData);
      if (newStatus === "listo") {
        const order = orders.find((currentOrder) => currentOrder.id === id);

        writeAuditLog(batch, {
          restaurantId,
          action: "pedido_listo",
          actorUid: user.uid,
          actorEmail: user.email,
          actorRole: "bar",
          mesa: Number(order?.mesa || 0),
          pedidoId: id,
          description: `Barra marcó bebidas listas en mesa ${order?.mesa || "-"}`,
          changes: {
            before: { estadoBarra: order?.estadoBarra ?? "pendiente" },
            after: { estadoBarra: newStatus },
          },
        });
      }
      await batch.commit();
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

  const nextStatusForDrink = (status: EstadoBarra | null | undefined, isSimple: boolean): EstadoBarra | null => {
    if (isSimple) return status === "pendiente" ? "listo" : null;
    return nextStatus(status);
  };

  const cambiarEstadoBarraItem = async (pedidoId: string, itemIndex: number, nuevoEstado: EstadoBarra) => {
    const loadKey = `${pedidoId}:${itemIndex}`;
    if (loadingByItemKey[loadKey] || !restaurantId || !user) return;
    if (!isOnline) { toast.error("Sin conexión. No se pueden actualizar pedidos ahora."); return; }

    const order = orders.find((o) => o.id === pedidoId);
    if (!order) return;

    try {
      setLoadingByItemKey((prev) => ({ ...prev, [loadKey]: true }));
      setError(null);

      const currentItemEstadosBarra = (order.itemEstadosBarra ?? {}) as Record<string, EstadoBarra>;
      const newItemEstadosBarra = { ...currentItemEstadosBarra, [String(itemIndex)]: nuevoEstado };

      const drinkIndices = (order.items || [])
        .map((item, idx) => ({ item, idx }))
        .filter(({ item, idx }) => isDrinkItem(item) && !order.cancelledItems?.some((c) => c.itemIndex === idx))
        .map(({ idx }) => idx);

      const allStates = drinkIndices.map((idx) =>
        (newItemEstadosBarra[String(idx)] as EstadoBarra | undefined) ?? ("pendiente" as EstadoBarra)
      );

      let derivedEstado: EstadoBarra = "pendiente";
      if (allStates.every((s) => s === "listo" || s === "entregado")) {
        derivedEstado = "listo";
      } else if (allStates.some((s) => s === "preparando" || s === "listo")) {
        derivedEstado = "preparando";
      }

      const updateData: Record<string, unknown> = {
        [`itemEstadosBarra.${itemIndex}`]: nuevoEstado,
        estadoBarra: derivedEstado,
        updatedAt: serverTimestamp(),
      };

      if (nuevoEstado === "preparando") updateData.barraStartedAt = serverTimestamp();
      if (derivedEstado === "listo") updateData.barraReadyAt = serverTimestamp();

      const ref = doc(db, "restaurants", restaurantId, "pedidos", pedidoId);
      const batch = writeBatch(db);
      batch.update(ref, updateData);
      if (derivedEstado === "listo") {
        writeAuditLog(batch, {
          restaurantId,
          action: "pedido_listo",
          actorUid: user.uid,
          actorEmail: user.email,
          actorRole: "bar",
          mesa: Number(order.mesa || 0),
          pedidoId,
          description: `Barra marcó bebidas listas en mesa ${order.mesa || "-"}`,
          changes: {
            before: { estadoBarra: order.estadoBarra ?? "pendiente" },
            after: { estadoBarra: derivedEstado },
          },
        });
      }
      await batch.commit();
    } catch (err) {
      console.error("Error actualizando estado de ítem de barra:", err);
      setError("No se pudo actualizar el estado. Reintentá.");
    } finally {
      setLoadingByItemKey((prev) => ({ ...prev, [loadKey]: false }));
    }
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
        <div className="rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-bold text-slate-950">
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
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white shadow-sm">
                <Wine size={22} />
              </div>

              <div>
                <h1 className="text-2xl font-bold tracking-tight text-slate-950 md:text-3xl">
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
            <div
              className={`flex items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-bold shadow-sm ${
                isWakeLockActive
                  ? "border-blue-200 bg-blue-50 text-blue-700"
                  : "border-zinc-200 bg-white text-zinc-500"
              }`}
            >
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  isWakeLockActive ? "bg-blue-500" : "bg-zinc-300"
                }`}
              />

              {isWakeLockSupported
                ? isWakeLockActive
                  ? "Pantalla activa"
                  : "Pantalla puede dormirse"
                : "Wake Lock no soportado"}
            </div>
            <button
              onClick={() => setShowDisponibilidad((v) => !v)}
              className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-bold shadow-sm transition ${
                showDisponibilidad
                  ? "border-violet-400 bg-violet-600 text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {showDisponibilidad ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
              Disponibilidad
            </button>
            <div className="flex flex-col gap-3 xl:items-end">
              <div
                className={`flex items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-bold shadow-sm ${
                  isOnline
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-red-200 bg-red-50 text-red-700"
                }`}
              >
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    isOnline
                      ? "bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.14)]"
                      : "bg-red-500 shadow-[0_0_0_4px_rgba(239,68,68,0.14)]"
                  }`}
                />
                {isOnline ? "Online" : "Sin conexión"}
              </div>
              <button
                onClick={handleLogout}
                disabled={loggingOut}
                className="flex h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 font-semibold text-slate-900 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <LogOut size={16} />
                {loggingOut ? "Cerrando..." : "Cerrar sesión"}
              </button>

              <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
                <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Activos
                  </p>
                  <p className="mt-1 text-2xl font-bold text-slate-950">
                    {stats.activos}
                  </p>
                </div>

                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 shadow-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-red-600">
                    Pendientes
                  </p>
                  <p className="mt-1 text-2xl font-bold text-red-700">
                    {stats.pendientes}
                  </p>
                </div>

                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 shadow-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                    Preparando
                  </p>
                  <p className="mt-1 text-2xl font-bold text-amber-800">
                    {stats.preparando}
                  </p>
                </div>

                <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 shadow-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-orange-700">
                    Urgentes
                  </p>
                  <p className="mt-1 text-2xl font-bold text-orange-800">
                    {stats.urgentes}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
        
      <main className="mx-auto max-w-[1800px] px-4 py-4 md:px-6 md:py-6 lg:px-8">
        {showDisponibilidad && (
          <div className="mb-6 rounded-xl border border-violet-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-violet-100 px-5 py-4">
              <div>
                <p className="text-base font-bold text-slate-900">Disponibilidad de bebidas</p>
                <p className="text-xs text-slate-500">Pausá una bebida para que no aparezca en el menú del cliente.</p>
              </div>
              <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-semibold text-violet-800">
                {barMenuItems.filter((i) => !i.active).length} pausados
              </span>
            </div>
            {barMenuItems.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-500">Cargando bebidas...</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {barMenuItems.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className={`text-sm font-semibold ${item.active ? "text-slate-900" : "text-slate-400 line-through"}`}>
                        {item.nombre}
                      </p>
                      {item.category && (
                        <p className="text-xs text-slate-400">{item.category}</p>
                      )}
                    </div>
                    <button
                      onClick={() => toggleDisponibilidadBar(item.id, item.active)}
                      disabled={!!togglingByBarItemId[item.id] || !isOnline}
                      className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition disabled:opacity-50 ${
                        item.active
                          ? "bg-emerald-100 text-emerald-800 hover:bg-red-100 hover:text-red-700"
                          : "bg-red-100 text-red-700 hover:bg-emerald-100 hover:text-emerald-800"
                      }`}
                    >
                      {togglingByBarItemId[item.id] ? "..." : item.active ? "Disponible" : "Pausado"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {!isOnline && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
            Sin conexión. Estás viendo datos guardados localmente. Las acciones quedan deshabilitadas hasta reconectar.
          </div>
        )}
        {!soundEnabled && (
          <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
            Tocá la pantalla una vez para habilitar el sonido.
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        {visibleOrders.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white px-8 py-14 text-center shadow-sm">
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
              const bebidasConIdx = (order.items || [])
                .map((item, idx) => ({ item, idx }))
                .filter(({ item, idx }) => isDrinkItem(item) && !order.cancelledItems?.some((c) => c.itemIndex === idx));
              const bebidasSimples = bebidasConIdx.filter(({ item }) => item.drinkType === "simple");
              const tragos = bebidasConIdx.filter(({ item }) => item.drinkType !== "simple");
              const hasPerItemEstados = !!(order.itemEstadosBarra && Object.keys(order.itemEstadosBarra).length > 0);
              const status = (order.estadoBarra || "pendiente") as EstadoBarra;
              const isNew = now - getCreatedAtMs(order.createdAt) < NEW_BADGE_MS;

              return (
                <motion.div
                  key={order.id}
                  layout
                  className={`rounded-xl border border-slate-200 border-l-4 bg-white p-5 shadow-sm transition-all duration-200 ${getCardAccent(
                    status
                  )} ${isNew ? "ring-2 ring-orange-300" : ""}`}
                >
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-2xl font-bold tracking-tight text-slate-950">
                          Mesa {order.mesa}
                        </p>

                        {isNew && (
                          <span className="rounded-full bg-orange-500 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">
                            Nuevo
                          </span>
                        )}
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-wide ${getBadgeStyles(
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

                  <div className="space-y-4">
                    {([
                      { items: bebidasSimples, isSimple: true, label: "Bebidas simples" },
                      { items: tragos, isSimple: false, label: "Tragos" },
                    ] as const).map(({ items, isSimple, label }) =>
                      items.length > 0 && (
                        <div key={label}>
                          {bebidasSimples.length > 0 && tragos.length > 0 && (
                            <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                              {label}
                            </p>
                          )}
                          <div className="space-y-3">
                            {items.map(({ item, idx }) => {
                              const rawEstado = order.itemEstadosBarra?.[String(idx)] as EstadoBarra | undefined;
                              const itemEstado: EstadoBarra = rawEstado !== undefined
                                ? rawEstado
                                : hasPerItemEstados
                                  ? "pendiente"
                                  : (order.estadoBarra || "pendiente") as EstadoBarra;
                              const siguienteEstado = nextStatusForDrink(itemEstado, isSimple);
                              const loadKey = `${order.id}:${idx}`;
                              const isItemLoading = !!loadingByItemKey[loadKey];
                              const observation = normalizeObservation(item.observacion);
                              const hasObservation = observation.length > 0;

                              return (
                                <div
                                  key={`${item.nombre}-${observation || "sin-observacion"}-${idx}`}
                                  className={`rounded-lg border px-4 py-3 transition-colors ${itemEstado === "listo" ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-start gap-2">
                                        <Martini size={16} className="mt-0.5 shrink-0 text-slate-500" />
                                        <p className={`text-base font-semibold leading-tight break-words ${itemEstado === "listo" ? "text-emerald-800 line-through opacity-70" : "text-slate-950"}`}>
                                          {item.nombre}
                                        </p>
                                      </div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-2">
                                      <span className="rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-sm font-bold text-slate-900">
                                        x{item.cantidad}
                                      </span>
                                      {itemEstado === "listo" ? (
                                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100">
                                          <CheckCircle2 size={16} className="text-emerald-600" />
                                        </span>
                                      ) : siguienteEstado && (
                                        <button
                                          onClick={() => cambiarEstadoBarraItem(order.id, idx, siguienteEstado)}
                                          disabled={isItemLoading || !isOnline}
                                          className={`flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${
                                            siguienteEstado === "preparando" ? "bg-slate-800 hover:bg-slate-700" : "bg-emerald-600 hover:bg-emerald-500"
                                          }`}
                                        >
                                          {isItemLoading ? "..." : siguienteEstado === "preparando"
                                            ? <><Flame size={12} /> Iniciar</>
                                            : <><CheckCircle2 size={12} /> Listo</>}
                                        </button>
                                      )}
                                    </div>
                                  </div>

                                  {hasObservation && (() => {
                                    const critical = isCriticalObservation(observation);
                                    return (
                                      <div className={`mt-3 rounded-xl border px-3 py-2.5 ${critical ? "border-red-400 bg-red-100" : "border-amber-300 bg-amber-100"}`}>
                                        <div className="flex items-start gap-2">
                                          {critical
                                            ? <AlertTriangle size={14} className="mt-0.5 shrink-0 text-red-700" />
                                            : <MessageSquareText size={14} className="mt-0.5 shrink-0 text-amber-900" />
                                          }
                                          <div className="min-w-0">
                                            <p className={`mb-1 text-[11px] font-semibold uppercase tracking-wide ${critical ? "text-red-700" : "text-amber-900"}`}>
                                              {critical ? "¡ALERGIA / ALERTA!" : "OBS"}
                                            </p>
                                            <p className={`text-sm font-semibold leading-snug break-words ${critical ? "text-red-900" : "text-amber-950"}`}>
                                              {observation}
                                            </p>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })()}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )
                    )}
                  </div>
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
