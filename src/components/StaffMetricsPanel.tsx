import { useEffect, useState } from "react";
import { collection, getDocs, orderBy, query, Timestamp, where } from "firebase/firestore";
import { BarChart3, RefreshCw } from "lucide-react";
import { getDb } from "../lib/firebase";

type LogEntry = {
  id: string;
  action: string;
  userEmail?: string;
  userRole?: string;
  createdAt?: { seconds?: number };
};

type StaffStat = {
  email: string;
  role: string;
  orders: number;
  payments: number;
  kitchenDone: number;
  total: number;
};

const db = getDb();

const today = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const ACTION_LABELS: Record<string, string> = {
  cashier_payment_registered: "Cobros",
  cashier_bill_created: "Cuentas abiertas",
  order_status_updated: "Platos preparados",
  order_created: "Pedidos tomados",
};

export function StaffMetricsPanel({ restaurantId }: { restaurantId: string }) {
  const [stats, setStats] = useState<StaffStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [dateFrom, setDateFrom] = useState(today().toISOString().slice(0, 10));
  const [rawLogs, setRawLogs] = useState<LogEntry[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const from = new Date(dateFrom);
      from.setHours(0, 0, 0, 0);
      const q = query(
        collection(db, "restaurants", restaurantId, "auditLogs"),
        where("createdAt", ">=", Timestamp.fromDate(from)),
        orderBy("createdAt", "desc")
      );
      const snap = await getDocs(q);
      const logs = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as LogEntry);
      setRawLogs(logs);

      const map = new Map<string, StaffStat>();
      for (const log of logs) {
        const email = log.userEmail || "desconocido";
        if (!map.has(email)) {
          map.set(email, { email, role: log.userRole || "—", orders: 0, payments: 0, kitchenDone: 0, total: 0 });
        }
        const s = map.get(email)!;
        s.total++;
        if (log.action === "cashier_payment_registered") s.payments++;
        if (log.action === "order_created") s.orders++;
        if (log.action === "order_status_updated") s.kitchenDone++;
      }
      setStats(Array.from(map.values()).sort((a, b) => b.total - a.total));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [restaurantId, dateFrom]);

  const actionBreakdown = (email: string) => {
    const counts: Record<string, number> = {};
    for (const log of rawLogs) {
      if (log.userEmail !== email) continue;
      counts[log.action] = (counts[log.action] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BarChart3 size={18} className="text-zinc-600" />
          <h2 className="text-lg font-bold text-zinc-950">Performance por empleado</h2>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-10 rounded-lg border border-zinc-200 px-3 text-sm"
          />
          <button
            onClick={load}
            disabled={loading}
            className="flex h-10 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-bold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            {loading ? "Cargando..." : "Actualizar"}
          </button>
        </div>
      </div>

      {stats.length === 0 && !loading && (
        <p className="text-sm text-zinc-500">Sin actividad registrada para este período.</p>
      )}

      <div className="space-y-3">
        {stats.map((s) => (
          <div key={s.email} className="rounded-xl border border-zinc-200 bg-white p-5">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="font-bold text-zinc-950">{s.email}</p>
                <p className="text-xs text-zinc-500 capitalize">{s.role} · {s.total} acciones</p>
              </div>
              <div className="flex gap-3 text-right">
                {s.payments > 0 && (
                  <div>
                    <p className="text-xs font-bold text-zinc-500">Cobros</p>
                    <p className="text-xl font-bold text-zinc-950">{s.payments}</p>
                  </div>
                )}
                {s.orders > 0 && (
                  <div>
                    <p className="text-xs font-bold text-zinc-500">Pedidos</p>
                    <p className="text-xl font-bold text-zinc-950">{s.orders}</p>
                  </div>
                )}
                {s.kitchenDone > 0 && (
                  <div>
                    <p className="text-xs font-bold text-zinc-500">Cocina</p>
                    <p className="text-xl font-bold text-zinc-950">{s.kitchenDone}</p>
                  </div>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {actionBreakdown(s.email).map(([action, count]) => (
                <span key={action} className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-0.5 text-xs font-semibold text-zinc-600">
                  {ACTION_LABELS[action] || action} · {count}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
