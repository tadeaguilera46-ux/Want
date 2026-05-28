import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Clock3,
  CreditCard,
  ShieldCheck,
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
  pedidoId?: string | null;
  cuentaId?: string | null;
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

  const diffDays = Math.floor(diffHours / 24);

  return `hace ${diffDays}d`;
};

const getActionVisual = (action?: string) => {
  if (action === "pedido_listo") {
    return {
      icon: CheckCircle2,
      label: "Pedido listo",
      tone: "border-emerald-200 bg-emerald-50 text-emerald-700",
      iconTone: "bg-emerald-500 text-white",
    };
  }

  if (action === "pedido_entregado") {
    return {
      icon: Truck,
      label: "Pedido entregado",
      tone: "border-blue-200 bg-blue-50 text-blue-700",
      iconTone: "bg-blue-500 text-white",
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
      tone: "border-violet-200 bg-violet-50 text-violet-700",
      iconTone: "bg-violet-500 text-white",
    };
  }

  if (action === "mesa_limpiada") {
    return {
      icon: Sparkles,
      label: "Mesa",
      tone: "border-amber-200 bg-amber-50 text-amber-800",
      iconTone: "bg-amber-500 text-white",
    };
  }

  if (action === "empleado_actualizado") {
    return {
      icon: UserCog,
      label: "Equipo",
      tone: "border-zinc-200 bg-zinc-50 text-zinc-700",
      iconTone: "bg-zinc-950 text-white",
    };
  }

  return {
    icon: Activity,
    label: "Actividad",
    tone: "border-zinc-200 bg-zinc-50 text-zinc-700",
    iconTone: "bg-zinc-950 text-white",
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
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 15000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!restaurantId) {
      setLogs([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const q = query(
      collection(db, "restaurants", restaurantId, "auditLogs"),
      orderBy("createdAt", "desc"),
      limit(8)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        })) as AuditLogRecord[];

        setLogs(data);
        setLoading(false);
      },
      (error) => {
        console.error("Error cargando actividad reciente:", error);
        setLogs([]);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [restaurantId]);

  const visibleLogs = useMemo(() => {
    void now;

    return logs
      .filter((log) => Boolean(log.description || log.action))
      .slice(0, 6);
  }, [logs, now]);

  return (
    <section className="rounded-[2rem] border border-white/70 bg-white/85 p-5 shadow-sm backdrop-blur">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
            <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.14)]" />
            Live feed
          </div>

          <h2 className="text-xl font-black tracking-tight text-zinc-950">
            Actividad reciente
          </h2>

          <p className="mt-1 text-sm text-zinc-500">
            Eventos importantes del restaurante en tiempo real.
          </p>
        </div>

        <div className="hidden rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-black text-zinc-600 sm:flex sm:items-center sm:gap-2">
          <ShieldCheck size={14} />
          Audit backed
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((item) => (
            <div
              key={item}
              className="h-16 animate-pulse rounded-2xl border border-zinc-100 bg-zinc-100"
            />
          ))}
        </div>
      ) : visibleLogs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-6 text-center">
          <Clock3 className="mx-auto text-zinc-400" size={22} />
          <p className="mt-2 text-sm font-bold text-zinc-600">
            Sin actividad reciente
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Los eventos críticos van a aparecer automáticamente acá.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleLogs.map((log) => {
            const visual = getActionVisual(log.action);
            const Icon = visual.icon;

            return (
              <div
                key={log.id}
                className="group rounded-2xl border border-zinc-200 bg-white p-3 transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${visual.iconTone}`}
                  >
                    <Icon size={17} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-wide ${visual.tone}`}
                      >
                        {visual.label}
                      </span>

                      {typeof log.mesa === "number" && log.mesa > 0 && (
                        <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-black text-zinc-700">
                          Mesa {log.mesa}
                        </span>
                      )}

                      <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-black text-zinc-500">
                        {getRoleLabel(log.userRole)}
                      </span>
                    </div>

                    <p className="mt-2 line-clamp-2 text-sm font-semibold leading-snug text-zinc-900">
                      {log.description || log.action || "Actividad registrada"}
                    </p>

                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                      <span>{formatRelativeTime(log.createdAt)}</span>

                      {log.userEmail && (
                        <>
                          <span>•</span>
                          <span className="truncate font-medium">
                            {log.userEmail}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}