import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Bell,
  CheckCircle2,
  ChevronDown,
  Clock3,
  CreditCard,
  Sparkles,
  Truck,
  UserCog,
} from "lucide-react";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { getDb } from "../../lib/firebase";
import type { FirestoreTimestampLike } from "../../lib/restaurant";

const db = getDb();

type AuditLogRecord = {
  id: string;
  action?: string;
  description?: string;
  userEmail?: string | null;
  userRole?: string | null;
  mesa?: number | null;
  createdAt?: FirestoreTimestampLike | null;
};

type Props = {
  restaurantId: string;
};

const getCreatedAtMs = (value?: FirestoreTimestampLike | null) => {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  return 0;
};

const formatRelativeTime = (value?: FirestoreTimestampLike | null) => {
  const createdAtMs = getCreatedAtMs(value);
  if (!createdAtMs) return "recién";

  const diffSeconds = Math.max(0, Math.floor((Date.now() - createdAtMs) / 1000));
  if (diffSeconds < 10) return "recién";
  if (diffSeconds < 60) return `hace ${diffSeconds}s`;

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `hace ${diffMinutes}m`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `hace ${diffHours}h`;

  return `hace ${Math.floor(diffHours / 24)}d`;
};

const getActionVisual = (action?: string) => {
  if (action === "pedido_listo") {
    return {
      icon: CheckCircle2,
      label: "Pedido listo",
      dot: "bg-emerald-500",
      iconTone: "bg-emerald-100 text-emerald-700",
    };
  }

  if (action === "pedido_entregado") {
    return {
      icon: Truck,
      label: "Entregado",
      dot: "bg-blue-500",
      iconTone: "bg-blue-100 text-blue-700",
    };
  }

  if (
    action === "cuenta_pagada" ||
    action === "pago_registrado" ||
    action === "factura_solicitada"
  ) {
    return {
      icon: CreditCard,
      label: "Caja",
      dot: "bg-violet-500",
      iconTone: "bg-violet-100 text-violet-700",
    };
  }

  if (action === "mesa_limpiada") {
    return {
      icon: Sparkles,
      label: "Mesa",
      dot: "bg-amber-500",
      iconTone: "bg-amber-100 text-amber-700",
    };
  }

  if (action === "empleado_actualizado") {
    return {
      icon: UserCog,
      label: "Equipo",
      dot: "bg-zinc-500",
      iconTone: "bg-zinc-100 text-zinc-700",
    };
  }

  return {
    icon: Activity,
    label: "Actividad",
    dot: "bg-zinc-500",
    iconTone: "bg-zinc-100 text-zinc-700",
  };
};

const getRoleLabel = (role?: string | null) => {
  if (role === "admin") return "Admin";
  if (role === "kitchen") return "Cocina";
  if (role === "bar") return "Barra";
  if (role === "runner") return "Runner";
  if (role === "cashier") return "Caja";
  return "Sistema";
};

export function AdminLiveActivityFeed({ restaurantId }: Props) {
  const [logs, setLogs] = useState<AuditLogRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [lastReadLogId, setLastReadLogId] = useState<string | null>(() => {
    return window.localStorage.getItem(`want:lastReadAudit:${restaurantId}`);
  });
  const [now, setNow] = useState(Date.now());

  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setLastReadLogId(
      window.localStorage.getItem(`want:lastReadAudit:${restaurantId}`)
    );
  }, [restaurantId]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!restaurantId) {
      setLogs([]);
      return;
    }

    const q = query(
      collection(db, "restaurants", restaurantId, "auditLogs"),
      orderBy("createdAt", "desc"),
      limit(8)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      })) as AuditLogRecord[];

      setLogs(data);
    });

    return () => unsubscribe();
  }, [restaurantId]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!containerRef.current) return;

      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const visibleLogs = useMemo(() => {
    void now;

    return logs
      .filter((log) => Boolean(log.description || log.action))
      .slice(0, 6);
  }, [logs, now]);

  const latestLogId = visibleLogs[0]?.id || null;
  const hasUnread = Boolean(latestLogId && latestLogId !== lastReadLogId);

  const markAsRead = () => {
    if (!latestLogId) return;

    window.localStorage.setItem(
      `want:lastReadAudit:${restaurantId}`,
      latestLogId
    );

    setLastReadLogId(latestLogId);
  };

  const toggleOpen = () => {
    const nextOpen = !open;
    setOpen(nextOpen);

    if (nextOpen) {
      markAsRead();
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={toggleOpen}
        className={`flex items-center gap-2 rounded-lg border px-4 py-2 shadow-sm transition hover:-translate-y-0.5 ${
          hasUnread
            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
            : "border-zinc-200 bg-white text-zinc-700"
        }`}
      >
        <span className="relative">
          <Bell size={16} />
          {hasUnread && (
            <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-emerald-50" />
          )}
        </span>

        <span className="hidden text-sm font-bold lg:inline">
          Actividad
        </span>

        {hasUnread && (
          <span className="hidden rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white xl:inline">
            Nuevo
          </span>
        )}

        <ChevronDown
          size={15}
          className={`transition ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+10px)] z-50 w-[360px] overflow-hidden rounded-[1.75rem] border border-zinc-200 bg-white shadow-2xl">
          <div className="border-b border-zinc-100 bg-zinc-50/80 px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-zinc-950">
                  Actividad reciente
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Últimos eventos importantes.
                </p>
              </div>

              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                Live
              </span>
            </div>
          </div>

          {visibleLogs.length === 0 ? (
            <div className="p-6 text-center">
              <Clock3 className="mx-auto text-zinc-400" size={22} />
              <p className="mt-2 text-sm font-bold text-zinc-600">
                Sin actividad reciente
              </p>
            </div>
          ) : (
            <div className="max-h-[430px] overflow-y-auto p-3">
              {visibleLogs.map((log) => {
                const visual = getActionVisual(log.action);
                const Icon = visual.icon;

                return (
                  <div
                    key={log.id}
                    className="rounded-lg p-3 transition hover:bg-zinc-50"
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${visual.iconTone}`}
                      >
                        <Icon size={17} />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-bold uppercase tracking-wide text-zinc-500">
                            {visual.label}
                          </span>

                          {typeof log.mesa === "number" && log.mesa > 0 && (
                            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-bold text-zinc-600">
                              Mesa {log.mesa}
                            </span>
                          )}

                          <span
                            className={`h-2 w-2 rounded-full ${visual.dot}`}
                          />
                        </div>

                        <p className="mt-1 line-clamp-2 text-sm font-semibold leading-snug text-zinc-900">
                          {log.description || log.action || "Actividad registrada"}
                        </p>

                        <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
                          <span>{formatRelativeTime(log.createdAt)}</span>
                          <span>•</span>
                          <span>{getRoleLabel(log.userRole)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}