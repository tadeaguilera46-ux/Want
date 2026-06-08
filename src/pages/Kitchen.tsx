import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getDb } from "../lib/firebase";
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  doc,
  updateDoc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { ChefHat, Clock3, Flame, CheckCircle2, LogOut, ToggleLeft, ToggleRight, AlertTriangle, Filter } from "lucide-react";
import { toast } from "sonner";
import { writeAuditLog } from "../lib/audit-logs";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { useWakeLock } from "../hooks/useWakeLock";
import type {
  PedidoRecord,
  EstadoCocinaBarra,
  FirestoreTimestampLike,
} from "../lib/restaurant";
import { useRestaurant } from "../lib/restaurant-context";
import { useAuth } from "../lib/auth-context";
import { KITCHEN_STATIONS } from "../lib/store";

const db = getDb();

type EstadoCocina = Extract<
  EstadoCocinaBarra,
  "pendiente" | "preparando" | "listo" | "entregado"
>;

type Pedido = PedidoRecord;

const NEW_BADGE_MS = 15000;
const WARNING_MINUTES = 10;
const DANGER_MINUTES = 15;
const NOW_REFRESH_MS = 5000;

const normalizeObservation = (value?: string) => value?.trim() || "";

const CRITICAL_KEYWORDS = [
  "alergi", "celiac", "celiaquí", "gluten", "lactosa",
  "maní", "mani", "nuez", "nueces", "cacahuete",
  "diabétic", "diabetic", "intoleranc", "fruto seco",
  "sin azúcar", "sin azucar", "anafilax",
];

const isCriticalObservation = (text: string) =>
  CRITICAL_KEYWORDS.some((kw) => text.toLowerCase().includes(kw));

const isFoodItem = (item: { category?: string }) => {
  return item.category === "food";
};

const Kitchen = () => {
  const navigate = useNavigate();
  const { restaurantId } = useRestaurant();
  const { logout, user } = useAuth();
  const isOnline = useOnlineStatus();
  const { isWakeLockActive, isWakeLockSupported } = useWakeLock(true);
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [loadingById, setLoadingById] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [showDisponibilidad, setShowDisponibilidad] = useState(false);
  const [menuItems, setMenuItems] = useState<{ id: string; nombre: string; category: string; active: boolean; type: string }[]>([]);
  const [togglingById, setTogglingById] = useState<Record<string, boolean>>({});
  const [selectedStation, setSelectedStation] = useState<string | null>(null);

  const notifiedOrderIdsRef = useRef<Set<string>>(new Set());
  const notifiedModifiedRef = useRef<Set<string>>(new Set());
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
        console.error("No se pudo habilitar el sonido:", error);
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
      console.error("Error reproduciendo sonido:", error);
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
      setPedidos([]);
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

        const pedidosConComida = data.filter((pedido) => {
          const tieneComida = pedido.items?.some(isFoodItem);

          const estadoValido =
            pedido.estadoCocina !== null && pedido.estadoCocina !== undefined;

          return estadoValido && tieneComida;
        });

        let shouldPlaySound = false;

        if (firstLoadRef.current) {
          pedidosConComida.forEach((pedido) => {
            notifiedOrderIdsRef.current.add(pedido.id);
            const cancelledCount = pedido.cancelledItems?.length ?? 0;
            if (cancelledCount > 0) {
              notifiedModifiedRef.current.add(`${pedido.id}:${cancelledCount}`);
            }
          });
          firstLoadRef.current = false;
        } else {
          const nuevosPedidos = pedidosConComida.filter(
            (pedido) => !notifiedOrderIdsRef.current.has(pedido.id)
          );

          if (nuevosPedidos.length > 0) {
            shouldPlaySound = true;
            nuevosPedidos.forEach((pedido) => {
              notifiedOrderIdsRef.current.add(pedido.id);
            });
          }

          pedidosConComida.forEach((pedido) => {
            const cancelledCount = pedido.cancelledItems?.length ?? 0;
            if (cancelledCount === 0) return;
            const modKey = `${pedido.id}:${cancelledCount}`;
            if (!notifiedModifiedRef.current.has(modKey)) {
              shouldPlaySound = true;
              notifiedModifiedRef.current.add(modKey);
            }
          });
        }

        if (shouldPlaySound) void playSound();

        setPedidos(pedidosConComida);
      },
      (err) => {
        console.error("Error escuchando pedidos de cocina:", err);
        setError("No se pudieron cargar los pedidos en tiempo real.");
      }
    );

    return () => unsubscribe();
  }, [restaurantId]);

  // Load menu items for the disponibilidad panel
  useEffect(() => {
    if (!restaurantId || !showDisponibilidad) return;
    const q = query(collection(db, "restaurants", restaurantId, "menu"), orderBy("name", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      setMenuItems(
        snap.docs.map((d) => ({
          id: d.id,
          nombre: String(d.data().nombre ?? d.data().name ?? ""),
          category: String(d.data().category ?? d.data().displayCategory ?? ""),
          active: d.data().active !== false,
          type: String(d.data().type ?? "food"),
        }))
      );
    });
    return unsub;
  }, [restaurantId, showDisponibilidad]);

  const toggleDisponibilidad = async (itemId: string, currentActive: boolean) => {
    if (togglingById[itemId] || !restaurantId || !user) return;
    if (!isOnline) { toast.error("Sin conexión."); return; }
    setTogglingById((prev) => ({ ...prev, [itemId]: true }));
    try {
      await updateDoc(doc(db, "restaurants", restaurantId, "menu", itemId), {
        active: !currentActive,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error("Error cambiando disponibilidad:", err);
      toast.error("No se pudo cambiar la disponibilidad.");
    } finally {
      setTogglingById((prev) => ({ ...prev, [itemId]: false }));
    }
  };

  const getItemEstado = (pedido: Pedido, itemIndex: number): EstadoCocina => {
    const explicit = pedido.itemEstados?.[String(itemIndex)] as EstadoCocina | undefined;
    if (explicit !== undefined) return explicit;
    // Si ya hay al menos un ítem trackeado, los no tocados son "pendiente"
    if (pedido.itemEstados && Object.keys(pedido.itemEstados).length > 0) return "pendiente";
    // Compat. pedidos viejos sin per-item tracking
    return (pedido.estadoCocina || "pendiente") as EstadoCocina;
  };

  const siguienteEstadoItem = (estado: EstadoCocina): EstadoCocina | null => {
    if (estado === "pendiente") return "preparando";
    if (estado === "preparando") return "listo";
    return null;
  };

  const cambiarEstadoItem = async (pedidoId: string, itemIndex: number, nuevoEstado: EstadoCocina) => {
    const loadKey = `${pedidoId}:${itemIndex}`;
    if (loadingById[loadKey] || !restaurantId || !user) return;
    if (!isOnline) { toast.error("Sin conexión. No se pueden actualizar pedidos ahora."); return; }

    const pedido = pedidos.find((p) => p.id === pedidoId);
    if (!pedido) return;

    try {
      setLoadingById((prev) => ({ ...prev, [loadKey]: true }));
      setError(null);

      const currentItemEstados = (pedido.itemEstados ?? {}) as Record<string, EstadoCocina>;
      const newItemEstados = { ...currentItemEstados, [String(itemIndex)]: nuevoEstado };

      const foodIndices = (pedido.items || [])
        .map((item, idx) => ({ item, idx }))
        .filter(({ item, idx }) => isFoodItem(item) && !pedido.cancelledItems?.some((c) => c.itemIndex === idx))
        .map(({ idx }) => idx);

      const allStates = foodIndices.map((idx) => (newItemEstados[String(idx)] as EstadoCocina | undefined) ?? ("pendiente" as EstadoCocina));

      let derivedEstado: EstadoCocina = "pendiente";
      if (allStates.every((s) => s === "listo")) {
        derivedEstado = "listo";
      } else if (allStates.some((s) => s === "preparando" || s === "listo")) {
        derivedEstado = "preparando";
      }

      const updateData: Record<string, unknown> = {
        [`itemEstados.${itemIndex}`]: nuevoEstado,
        estadoCocina: derivedEstado,
        updatedAt: serverTimestamp(),
      };

      const oldDerived = (pedido.estadoCocina || "pendiente") as EstadoCocina;
      if (oldDerived === "pendiente" && derivedEstado !== "pendiente") {
        updateData.cocinaStartedAt = serverTimestamp();
      }
      if (derivedEstado === "listo") {
        updateData.cocinaReadyAt = serverTimestamp();
      }

      const ref = doc(db, "restaurants", restaurantId, "pedidos", pedidoId);
      const batch = writeBatch(db);
      batch.update(ref, updateData);
      if (derivedEstado === "listo") {
        writeAuditLog(batch, {
          restaurantId,
          action: "pedido_listo",
          actorUid: user.uid,
          actorEmail: user.email,
          actorRole: "kitchen",
          mesa: Number(pedido.mesa || 0),
          pedidoId,
          description: `Cocina marcó pedido listo en mesa ${pedido.mesa || "-"}`,
          changes: {
            before: { estadoCocina: pedido.estadoCocina ?? "pendiente" },
            after: { estadoCocina: derivedEstado },
          },
        });
      }
      await batch.commit();
    } catch (err) {
      console.error("Error actualizando estado de ítem:", err);
      setError("No se pudo actualizar el estado. Reintentá.");
    } finally {
      setLoadingById((prev) => ({ ...prev, [`${pedidoId}:${itemIndex}`]: false }));
    }
  };

  const getCreatedAtMs = (value?: FirestoreTimestampLike | null) => {
    if (!value) return 0;
    if (typeof value.toMillis === "function") return value.toMillis();
    if (typeof value.seconds === "number") return value.seconds * 1000;
    return 0;
  };

  const getElapsedSeconds = (pedido: Pedido) => {
    const createdAtMs = getCreatedAtMs(pedido.createdAt);
    if (!createdAtMs) return 0;
    return Math.max(0, Math.floor((now - createdAtMs) / 1000));
  };

  const getElapsedMinutes = (pedido: Pedido) => {
    return Math.floor(getElapsedSeconds(pedido) / 60);
  };

  const formatElapsedTime = (pedido: Pedido) => {
    const diffSeconds = getElapsedSeconds(pedido);
    const minutes = Math.floor(diffSeconds / 60);
    const seconds = diffSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(
      2,
      "0"
    )}`;
  };

  const getTimeStyles = (pedido: Pedido) => {
    const minutes = getElapsedMinutes(pedido);

    if (minutes >= DANGER_MINUTES) {
      return "bg-red-50 text-red-700 border border-red-200";
    }

    if (minutes >= WARNING_MINUTES) {
      return "bg-amber-50 text-amber-800 border border-amber-200";
    }

    return "bg-slate-100 text-slate-700 border border-slate-200";
  };

  const getCardStylesByEstado = (estado: EstadoCocina) => {
    if (estado === "pendiente") return "border-l-red-500";
    if (estado === "preparando") return "border-l-amber-500";
    if (estado === "listo") return "border-l-emerald-500";
    return "border-l-slate-300";
  };

  const getBadgeStylesByEstado = (estado: EstadoCocina) => {
    if (estado === "pendiente") {
      return "bg-red-100 text-red-700 border border-red-200";
    }

    if (estado === "preparando") {
      return "bg-amber-100 text-amber-800 border border-amber-200";
    }

    if (estado === "listo") {
      return "bg-emerald-100 text-emerald-700 border border-emerald-200";
    }

    return "bg-slate-100 text-slate-700 border border-slate-200";
  };

  const getEstadoLabel = (estado: EstadoCocina) => {
    if (estado === "pendiente") return "Pendiente";
    if (estado === "preparando") return "Preparando";
    if (estado === "listo") return "Listo";
    return "Entregado";
  };

  const getEstadoPriority = (estado: EstadoCocina) => {
    if (estado === "pendiente") return 0;
    if (estado === "preparando") return 1;
    if (estado === "listo") return 2;
    return 3;
  };

  const pedidosVisibles = useMemo(() => {
    return pedidos
      .filter((p) => {
        const estado = (p.estadoCocina || "pendiente") as EstadoCocina;
        return estado !== "listo" && estado !== "entregado";
      })
      .sort((a, b) => {
        const estadoA = (a.estadoCocina || "pendiente") as EstadoCocina;
        const estadoB = (b.estadoCocina || "pendiente") as EstadoCocina;

        const priorityDiff =
          getEstadoPriority(estadoA) - getEstadoPriority(estadoB);
        if (priorityDiff !== 0) return priorityDiff;

        return getCreatedAtMs(a.createdAt) - getCreatedAtMs(b.createdAt);
      });
  }, [pedidos]);

  const pedidosPorMesa = useMemo(() => {
    const groups = new Map<number, Pedido[]>();
    for (const p of pedidosVisibles) {
      const mesa = Number(p.mesa);
      if (!groups.has(mesa)) groups.set(mesa, []);
      groups.get(mesa)!.push(p);
    }
    return Array.from(groups.entries())
      .sort(([, aList], [, bList]) => {
        const minA = Math.min(...aList.map((p) => getEstadoPriority((p.estadoCocina || "pendiente") as EstadoCocina)));
        const minB = Math.min(...bList.map((p) => getEstadoPriority((p.estadoCocina || "pendiente") as EstadoCocina)));
        if (minA !== minB) return minA - minB;
        const earliestA = Math.min(...aList.map((p) => getCreatedAtMs(p.createdAt)));
        const earliestB = Math.min(...bList.map((p) => getCreatedAtMs(p.createdAt)));
        return earliestA - earliestB;
      })
      .map(([mesa, mesaPedidos]) => ({ mesa, mesaPedidos }));
  }, [pedidosVisibles]);

  const stats = useMemo(() => {
    const pendientes = pedidosVisibles.filter(
      (p) => (p.estadoCocina || "pendiente") === "pendiente"
    ).length;

    const preparando = pedidosVisibles.filter(
      (p) => (p.estadoCocina || "pendiente") === "preparando"
    ).length;

    const urgentes = pedidosVisibles.filter(
      (p) => getElapsedMinutes(p) >= WARNING_MINUTES
    ).length;

    return {
      activos: pedidosVisibles.length,
      pendientes,
      preparando,
      urgentes,
    };
  }, [pedidosVisibles, now]);

  const availableStations = useMemo(() => {
    const stationIds = new Set<string>();
    for (const p of pedidosVisibles) {
      for (const item of p.items || []) {
        if (isFoodItem(item) && item.station) stationIds.add(item.station);
      }
    }
    return KITCHEN_STATIONS.filter((s) => stationIds.has(s.id));
  }, [pedidosVisibles]);

  useEffect(() => {
    if (selectedStation !== null && !availableStations.some((s) => s.id === selectedStation)) {
      setSelectedStation(null);
    }
  }, [availableStations, selectedStation]);

  if (!restaurantId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 px-6">
        <div className="rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-bold text-slate-950">
            Falta restaurante activo
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Seleccioná un restaurante antes de entrar a cocina.
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
                <ChefHat size={22} />
              </div>

              <div>
                <h1 className="text-2xl font-bold tracking-tight text-slate-950 md:text-3xl">
                  Cocina
                </h1>
                <p className="text-sm text-slate-500 md:text-base">
                  Estación fija · pedidos de comida en tiempo real
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
                <p className="text-base font-bold text-slate-900">Disponibilidad de productos</p>
                <p className="text-xs text-slate-500">Pausá un ítem para que no aparezca en el menú del cliente.</p>
              </div>
              <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-semibold text-violet-800">
                {menuItems.filter((i) => i.type !== "drinks" && !i.active).length} pausados
              </span>
            </div>
            {menuItems.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-500">Cargando productos...</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {menuItems.filter((i) => i.type !== "drinks").map((item) => (
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
                      onClick={() => toggleDisponibilidad(item.id, item.active)}
                      disabled={!!togglingById[item.id] || !isOnline}
                      className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition disabled:opacity-50 ${
                        item.active
                          ? "bg-emerald-100 text-emerald-800 hover:bg-red-100 hover:text-red-700"
                          : "bg-red-100 text-red-700 hover:bg-emerald-100 hover:text-emerald-800"
                      }`}
                    >
                      {togglingById[item.id] ? "..." : item.active ? "Disponible" : "Pausado"}
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
            Tocá la pantalla una vez para habilitar las notificaciones sonoras.
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        {availableStations.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Filter size={14} className="text-slate-500" />
            <button
              onClick={() => setSelectedStation(null)}
              className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${
                selectedStation === null
                  ? "bg-slate-900 text-white"
                  : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              Todas
            </button>
            {availableStations.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedStation(selectedStation === s.id ? null : s.id)}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${
                  selectedStation === s.id
                    ? "bg-slate-900 text-white"
                    : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        {pedidosPorMesa.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white px-8 py-14 text-center shadow-sm">
            <p className="text-lg font-semibold text-slate-700">
              No hay pedidos de cocina activos
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Los nuevos pedidos van a aparecer automáticamente acá.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {pedidosPorMesa.map(({ mesa, mesaPedidos }) => {
              const filteredMesaPedidos = selectedStation
                ? mesaPedidos.filter((p) =>
                    (p.items || []).some(
                      (item, idx) =>
                        isFoodItem(item) &&
                        !p.cancelledItems?.some((c) => c.itemIndex === idx) &&
                        item.station === selectedStation
                    )
                  )
                : mesaPedidos;
              if (filteredMesaPedidos.length === 0) return null;
              const mesaUrgente = filteredMesaPedidos.some((p) => getElapsedMinutes(p) >= WARNING_MINUTES);
              return (
                <div key={mesa}>
                  <div className={`mb-3 flex items-center gap-3 rounded-lg px-4 py-2.5 ${mesaUrgente ? "bg-orange-50 border border-orange-200" : "bg-slate-100 border border-slate-200"}`}>
                    <span className={`text-xl font-bold tracking-tight ${mesaUrgente ? "text-orange-800" : "text-slate-800"}`}>
                      Mesa {mesa}
                    </span>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${mesaUrgente ? "bg-orange-200 text-orange-900" : "bg-slate-200 text-slate-700"}`}>
                      {filteredMesaPedidos.length} {filteredMesaPedidos.length === 1 ? "pedido" : "pedidos"}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {filteredMesaPedidos.map((p) => {
                      const estadoActual = (p.estadoCocina || "pendiente") as EstadoCocina;
                      const comidaConIdx = (p.items || [])
                        .map((item, idx) => ({ item, idx }))
                        .filter(({ item, idx }) =>
                          isFoodItem(item) &&
                          !p.cancelledItems?.some((c) => c.itemIndex === idx) &&
                          (selectedStation === null || item.station === selectedStation)
                        );
                      const isNew = now - getCreatedAtMs(p.createdAt) < NEW_BADGE_MS;
                      const urgente = getElapsedMinutes(p) >= WARNING_MINUTES;

                      return (
                        <div
                          key={p.id}
                          className={[
                            "rounded-xl border border-slate-200 border-l-4 bg-white p-5 shadow-sm transition-all duration-200",
                            getCardStylesByEstado(estadoActual),
                            isNew ? "ring-2 ring-orange-300" : "",
                            urgente ? "shadow-md" : "",
                          ].join(" ")}
                        >
                          <div className="mb-4 flex flex-wrap items-center gap-2">
                            {isNew && (
                              <span className="rounded-full bg-orange-500 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">
                                Nuevo
                              </span>
                            )}
                            {(p.cancelledItems?.length ?? 0) > 0 && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-amber-400 bg-amber-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                                <AlertTriangle size={11} />
                                Modificado
                              </span>
                            )}
                            <span className={`inline-flex rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-wide ${getBadgeStylesByEstado(estadoActual)}`}>
                              {estadoActual === "pendiente" && <Clock3 size={13} className="mr-1.5" />}
                              {estadoActual === "preparando" && <Flame size={13} className="mr-1.5" />}
                              {estadoActual === "listo" && <CheckCircle2 size={13} className="mr-1.5" />}
                              {getEstadoLabel(estadoActual)}
                            </span>
                            <span className={`inline-flex rounded-full px-3 py-1.5 text-sm font-bold ${getTimeStyles(p)}`}>
                              ⏱ {formatElapsedTime(p)}
                            </span>
                          </div>

                          {(p.cancelledItems?.length ?? 0) > 0 && (
                            <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5">
                              <div className="mb-1.5 flex items-center gap-1.5">
                                <AlertTriangle size={12} className="shrink-0 text-amber-700" />
                                <p className="text-[10px] font-bold uppercase tracking-wide text-amber-800">
                                  Ítems cancelados por caja
                                </p>
                              </div>
                              <ul className="space-y-0.5">
                                {p.cancelledItems!.map((ci, i) => (
                                  <li key={i} className="flex items-baseline gap-1 text-xs">
                                    <span className="shrink-0 font-bold text-amber-700">×</span>
                                    <span className="font-semibold text-amber-900">{ci.name}</span>
                                    {ci.reason && (
                                      <span className="text-amber-700">— {ci.reason}</span>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          <div className="space-y-3">
                            {comidaConIdx.map(({ item, idx }) => {
                              const itemEstado = getItemEstado(p, idx);
                              const nextItem = siguienteEstadoItem(itemEstado);
                              const loadKey = `${p.id}:${idx}`;
                              const isItemLoading = !!loadingById[loadKey];
                              const observation = normalizeObservation(item.observacion);
                              const hasObservation = observation.length > 0;

                              return (
                                <div
                                  key={`${item.nombre}-${observation || "sin-observacion"}-${idx}`}
                                  className={`rounded-lg border px-4 py-3 transition-colors ${itemEstado === "listo" ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                      <p className={`text-base font-semibold leading-tight break-words ${itemEstado === "listo" ? "text-emerald-800 line-through opacity-70" : "text-slate-950"}`}>
                                        {item.nombre}
                                      </p>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-2">
                                      <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-sm font-bold text-slate-900">
                                        x{item.cantidad}
                                      </span>
                                      {itemEstado === "listo" ? (
                                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100">
                                          <CheckCircle2 size={16} className="text-emerald-600" />
                                        </span>
                                      ) : (
                                        <button
                                          onClick={() => cambiarEstadoItem(p.id, idx, nextItem!)}
                                          disabled={isItemLoading || !isOnline || !nextItem}
                                          className={`flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${
                                            nextItem === "preparando" ? "bg-slate-800 hover:bg-slate-700" : "bg-emerald-600 hover:bg-emerald-500"
                                          }`}
                                        >
                                          {isItemLoading ? "..." : nextItem === "preparando" ? <><Flame size={12} /> Iniciar</> : <><CheckCircle2 size={12} /> Listo</>}
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                  {hasObservation && (() => {
                                    const critical = isCriticalObservation(observation);
                                    return (
                                      <div className={`mt-2 rounded-lg border px-3 py-2 ${critical ? "border-red-400 bg-red-100" : "border-amber-300 bg-amber-100"}`}>
                                        <div className="mb-0.5 flex items-center gap-1">
                                          {critical && <AlertTriangle size={11} className="shrink-0 text-red-700" />}
                                          <p className={`text-[10px] font-bold uppercase tracking-wide ${critical ? "text-red-700" : "text-amber-900"}`}>
                                            {critical ? "¡ALERGIA / ALERTA!" : "OBS"}
                                          </p>
                                        </div>
                                        <p className={`text-sm font-semibold leading-snug break-words ${critical ? "text-red-900" : "text-amber-950"}`}>
                                          {observation}
                                        </p>
                                      </div>
                                    );
                                  })()}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
};

export default Kitchen;
