import { useEffect, useMemo, useState } from "react";
import type { ElementType } from "react";
import { useNavigate } from "react-router-dom";
import { getDb } from "../lib/firebase";
import { collection, doc, onSnapshot, orderBy, query } from "firebase/firestore";
import { useRestaurant } from "../lib/restaurant-context";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
} from "recharts";
import {
  ArrowLeft,
  ChartLine,
  Receipt,
  Wallet,
  CircleDollarSign,
  CreditCard,
  Trophy,
  UtensilsCrossed,
  Clock3,
  ChefHat,
  Wine,
  Timer,
  Flame,
  RefreshCcw,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";

const db = getDb();

// ── Types ─────────────────────────────────────────────────────────────────────

type RestaurantPlan = "starter" | "pro" | "premium";
type AnalyticsSection = "ventas" | "operaciones" | "mesas" | "pagos";
type DayOption = 1 | 7 | 30;

type TimestampLike = {
  seconds?: number;
  toMillis?: () => number;
  toDate?: () => Date;
};

type Cuenta = {
  id: string;
  mesa: number | string;
  total: number;
  metodo: string;
  sessionId: string;
  estado: "pendiente" | "en_camino" | "pagada" | "cerrada";
  createdAt?: TimestampLike;
  splitBill?: boolean;
};

type PedidoItem = {
  nombre: string;
  cantidad: number;
  precio?: number;
  category: "food" | "drinks";
};

type Pedido = {
  id: string;
  mesa: number | string;
  items: PedidoItem[];
  total: number;
  sessionId: string;
  estadoCocina?: "pendiente" | "preparando" | "listo" | "entregado" | null;
  estadoBarra?: "pendiente" | "preparando" | "listo" | "entregado" | null;
  createdAt?: TimestampLike;
  cocinaStartedAt?: TimestampLike;
  cocinaReadyAt?: TimestampLike;
  barraStartedAt?: TimestampLike;
  barraReadyAt?: TimestampLike;
};

type SessionRecord = {
  id: string;
  restaurantId: string;
  tableNumber: number;
  status: "active" | "closed";
  openedAt?: TimestampLike;
  closedAt?: TimestampLike | null;
  cleanedAt?: TimestampLike | null;
  createdAt?: TimestampLike;
  updatedAt?: TimestampLike;
};

type RotacionMesa = {
  sessionId: string;
  mesa: string;
  minutos: number;
  openedAt: Date;
  cleanedAt: Date;
};

type PedidoLento = {
  id: string;
  mesa: string;
  tipo: "Cocina" | "Barra";
  minutos: number;
  items: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const formatPrice = (value: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value || 0);

const formatMinutes = (minutes: number) => {
  if (!Number.isFinite(minutes) || minutes <= 0) return "—";
  if (minutes < 1) return "< 1 min";
  return `${minutes.toFixed(1)} min`;
};

const toDateSafe = (dateValue?: TimestampLike | string | number | null): Date | null => {
  if (!dateValue) return null;
  try {
    if (typeof dateValue === "object" && typeof (dateValue as TimestampLike).toDate === "function")
      return (dateValue as TimestampLike).toDate!();
    if (typeof dateValue === "object" && typeof (dateValue as TimestampLike).toMillis === "function")
      return new Date((dateValue as TimestampLike).toMillis!());
    if (typeof dateValue === "object" && typeof (dateValue as TimestampLike).seconds === "number")
      return new Date((dateValue as TimestampLike).seconds! * 1000);
    const date = new Date(dateValue as string | number);
    return isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
};

const diffMinutes = (start?: TimestampLike | null, end?: TimestampLike | null) => {
  const s = toDateSafe(start);
  const e = toDateSafe(end);
  if (!s || !e) return null;
  const diff = (e.getTime() - s.getTime()) / 60000;
  return Number.isFinite(diff) && diff >= 0 ? diff : null;
};

const getDateKey = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const getDateLabel = (date: Date) =>
  date.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });

const isWithinDays = (dateValue: TimestampLike | undefined | null, days: number) => {
  const date = toDateSafe(dateValue);
  if (!date) return false;
  return (new Date().getTime() - date.getTime()) / (1000 * 60 * 60 * 24) <= days;
};

const getMetodoLabel = (metodo?: string) => {
  switch (metodo) {
    case "cash": return "Efectivo";
    case "debit": return "Débito";
    case "credit": return "Crédito";
    case "transfer": return "Transferencia";
    default: return metodo || "Sin dato";
  }
};

const isCuentaCobrada = (estado?: string) => estado === "pagada" || estado === "cerrada";

const avg = (values: number[]) =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

// ── Chart constants ───────────────────────────────────────────────────────────

const chartGridColor = "#e4e4e7";
const chartAxisColor = "#a1a1aa";
const lineColor = "#18181b";
const barColor = "#27272a";

// ── Nav config ────────────────────────────────────────────────────────────────

const navItems: { id: AnalyticsSection; label: string; description: string; icon: ElementType }[] = [
  { id: "ventas", label: "Ventas", description: "Ingresos y cobros", icon: TrendingUp },
  { id: "operaciones", label: "Operaciones", description: "Cocina, barra y productos", icon: ChefHat },
  { id: "mesas", label: "Mesas", description: "Rotación y horas pico", icon: UtensilsCrossed },
  { id: "pagos", label: "Pagos", description: "Métodos y cuentas", icon: CreditCard },
];

// ── Shared UI components ──────────────────────────────────────────────────────

function DayFilter({ value, onChange }: { value: DayOption; onChange: (v: DayOption) => void }) {
  return (
    <div className="flex gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1">
      {([1, 7, 30] as DayOption[]).map((d) => (
        <button
          key={d}
          onClick={() => onChange(d)}
          className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
            value === d ? "bg-zinc-950 text-white shadow-sm" : "text-zinc-500 hover:text-zinc-700"
          }`}
        >
          {d === 1 ? "Hoy" : `${d}d`}
        </button>
      ))}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub }: {
  icon: ElementType;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-zinc-100">
        <Icon size={16} className="text-zinc-500" />
      </div>
      <p className="mt-3 text-[10px] font-bold uppercase tracking-widest text-zinc-400">{label}</p>
      <p className="mt-0.5 text-2xl font-bold tracking-tight text-zinc-950">{value}</p>
      {sub && <p className="mt-1 text-xs text-zinc-400">{sub}</p>}
    </div>
  );
}

function AccentCard({ icon: Icon, label, value }: {
  icon: ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-5 shadow-sm">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10">
        <Icon size={16} className="text-white" />
      </div>
      <p className="mt-3 text-[10px] font-bold uppercase tracking-widest text-white/50">{label}</p>
      <p className="mt-0.5 text-2xl font-bold tracking-tight text-white">{value}</p>
    </div>
  );
}

function ChartCard({ title, subtitle, children }: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h3 className="font-bold text-zinc-950">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-zinc-400">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center rounded-xl border border-dashed border-zinc-200 py-10 text-sm text-zinc-400">
      {text}
    </div>
  );
}

function RankingItem({ rank, label, sub, value }: {
  rank: number;
  label: string;
  sub?: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-zinc-100 bg-zinc-50 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-zinc-200 text-xs font-bold text-zinc-600">
          {rank}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-zinc-950">{label}</p>
          {sub && <p className="text-xs text-zinc-400">{sub}</p>}
        </div>
      </div>
      <p className="shrink-0 text-sm font-bold text-zinc-950">{value}</p>
    </div>
  );
}

function SectionHeader({ title, description, filter, onFilterChange }: {
  title: string;
  description: string;
  filter: DayOption;
  onFilterChange: (v: DayOption) => void;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-zinc-950">{title}</h2>
        <p className="mt-0.5 text-sm text-zinc-500">{description}</p>
      </div>
      <DayFilter value={filter} onChange={onFilterChange} />
    </div>
  );
}

// ── VentasSection ─────────────────────────────────────────────────────────────

function VentasSection({ cuentasCobradas, days, onDaysChange }: {
  cuentasCobradas: Cuenta[];
  days: DayOption;
  onDaysChange: (v: DayOption) => void;
}) {
  const filtered = useMemo(
    () => cuentasCobradas.filter((c) => isWithinDays(c.createdAt, days)),
    [cuentasCobradas, days]
  );

  const hoy = useMemo(() => {
    const now = new Date();
    return cuentasCobradas
      .filter((c) => {
        const d = toDateSafe(c.createdAt);
        return d?.getDate() === now.getDate() && d?.getMonth() === now.getMonth() && d?.getFullYear() === now.getFullYear();
      })
      .reduce((acc, c) => acc + (c.total || 0), 0);
  }, [cuentasCobradas]);

  const total = useMemo(() => filtered.reduce((acc, c) => acc + (c.total || 0), 0), [filtered]);
  const ticket = useMemo(() => (filtered.length > 0 ? total / filtered.length : 0), [filtered, total]);

  const metodoTop = useMemo(() => {
    const counts: Record<string, number> = {};
    filtered.forEach((c) => { const k = c.metodo || "sin_dato"; counts[k] = (counts[k] || 0) + 1; });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return top ? getMetodoLabel(top[0]) : "—";
  }, [filtered]);

  const chartData = useMemo(() => {
    const grouped: Record<string, { dateKey: string; label: string; totalVentas: number; cantidadCuentas: number }> = {};
    filtered.forEach((c) => {
      const d = toDateSafe(c.createdAt);
      if (!d) return;
      const key = getDateKey(d);
      if (!grouped[key]) grouped[key] = { dateKey: key, label: getDateLabel(d), totalVentas: 0, cantidadCuentas: 0 };
      grouped[key].totalVentas += c.total || 0;
      grouped[key].cantidadCuentas += 1;
    });
    return Object.values(grouped).sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  }, [filtered]);

  const periodLabel = days === 1 ? "hoy" : `últimos ${days}d`;

  return (
    <div className="space-y-6">
      <SectionHeader title="Ventas" description="Ingresos y cuentas cobradas" filter={days} onFilterChange={onDaysChange} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <AccentCard icon={CircleDollarSign} label="Ventas de hoy" value={formatPrice(hoy)} />
        <StatCard icon={Wallet} label={`Total ${periodLabel}`} value={formatPrice(total)} />
        <StatCard icon={Receipt} label="Ticket promedio" value={formatPrice(ticket)} />
        <StatCard icon={CreditCard} label="Método más usado" value={metodoTop} />
        <StatCard icon={Receipt} label="Cuentas cobradas" value={String(filtered.length)} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <ChartCard title="Ventas por día" subtitle={`Ingresos · ${periodLabel}`}>
          {chartData.length === 0 ? (
            <EmptyState text="Sin ventas en este período" />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={chartGridColor} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" stroke={chartAxisColor} tickLine={false} axisLine={false} fontSize={11} />
                  <YAxis stroke={chartAxisColor} tickLine={false} axisLine={false} fontSize={11} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    formatter={(v: number) => [formatPrice(v), "Ventas"]}
                    contentStyle={{ borderRadius: 12, border: "1px solid #e4e4e7", fontSize: 12, boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}
                  />
                  <Line type="monotone" dataKey="totalVentas" stroke={lineColor} strokeWidth={2.5} dot={{ r: 3, fill: lineColor, strokeWidth: 0 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>

        <ChartCard title="Cuentas por día" subtitle={`Cantidad · ${periodLabel}`}>
          {chartData.length === 0 ? (
            <EmptyState text="Sin cuentas en este período" />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={chartGridColor} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" stroke={chartAxisColor} tickLine={false} axisLine={false} fontSize={11} />
                  <YAxis stroke={chartAxisColor} tickLine={false} axisLine={false} fontSize={11} />
                  <Tooltip
                    formatter={(v: number) => [`${v}`, "Cuentas"]}
                    contentStyle={{ borderRadius: 12, border: "1px solid #e4e4e7", fontSize: 12, boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}
                  />
                  <Bar dataKey="cantidadCuentas" fill={barColor} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>
      </div>
    </div>
  );
}

// ── OperacionesSection ────────────────────────────────────────────────────────

function OperacionesSection({ pedidos, days, onDaysChange }: {
  pedidos: Pedido[];
  days: DayOption;
  onDaysChange: (v: DayOption) => void;
}) {
  const filtered = useMemo(
    () => pedidos.filter((p) => isWithinDays(p.createdAt, days)),
    [pedidos, days]
  );

  const kitchenTimes = useMemo(
    () => filtered.map((p) => diffMinutes(p.cocinaStartedAt, p.cocinaReadyAt)).filter((v): v is number => v !== null),
    [filtered]
  );

  const barTimes = useMemo(
    () => filtered.map((p) => diffMinutes(p.barraStartedAt, p.barraReadyAt)).filter((v): v is number => v !== null),
    [filtered]
  );

  const totalReadyTimes = useMemo(() =>
    filtered.map((p) => {
      const createdAt = toDateSafe(p.createdAt);
      const cocinaReady = toDateSafe(p.cocinaReadyAt);
      const barraReady = toDateSafe(p.barraReadyAt);
      if (!createdAt) return null;
      const readyDates = [cocinaReady, barraReady].filter((d): d is Date => d !== null);
      if (readyDates.length === 0) return null;
      const lastReady = new Date(Math.max(...readyDates.map((d) => d.getTime())));
      const diff = (lastReady.getTime() - createdAt.getTime()) / 60000;
      return Number.isFinite(diff) && diff >= 0 ? diff : null;
    }).filter((v): v is number => v !== null),
    [filtered]
  );

  const foodUnits = useMemo(
    () => filtered.flatMap((p) => p.items || []).filter((i) => i.category === "food").reduce((acc, i) => acc + (i.cantidad || 0), 0),
    [filtered]
  );

  const drinkUnits = useMemo(
    () => filtered.flatMap((p) => p.items || []).filter((i) => i.category === "drinks").reduce((acc, i) => acc + (i.cantidad || 0), 0),
    [filtered]
  );

  const productosTop = useMemo(() => {
    const grouped: Record<string, { nombre: string; cantidad: number; totalPedidos: number; category?: "food" | "drinks" }> = {};
    filtered.forEach((p) => {
      (p.items || []).forEach((item) => {
        const key = item.nombre?.trim()?.toLowerCase();
        if (!key) return;
        if (!grouped[key]) grouped[key] = { nombre: item.nombre, cantidad: 0, totalPedidos: 0, category: item.category };
        grouped[key].cantidad += item.cantidad || 0;
        grouped[key].totalPedidos += 1;
      });
    });
    return Object.values(grouped).sort((a, b) => b.cantidad - a.cantidad).slice(0, 10);
  }, [filtered]);

  const pedidosMasLentos = useMemo(() => {
    const rows: PedidoLento[] = [];
    filtered.forEach((p) => {
      const cocinaMin = diffMinutes(p.cocinaStartedAt, p.cocinaReadyAt);
      const barraMin = diffMinutes(p.barraStartedAt, p.barraReadyAt);
      const foodNames = (p.items || []).filter((i) => i.category === "food").map((i) => `${i.nombre} x${i.cantidad}`).join(", ");
      const drinkNames = (p.items || []).filter((i) => i.category === "drinks").map((i) => `${i.nombre} x${i.cantidad}`).join(", ");
      if (cocinaMin !== null) rows.push({ id: p.id, mesa: String(p.mesa), tipo: "Cocina", minutos: cocinaMin, items: foodNames || "Comida" });
      if (barraMin !== null) rows.push({ id: p.id, mesa: String(p.mesa), tipo: "Barra", minutos: barraMin, items: drinkNames || "Bebidas" });
    });
    return rows.sort((a, b) => b.minutos - a.minutos).slice(0, 8);
  }, [filtered]);

  const foodTop = productosTop.filter((p) => p.category === "food").slice(0, 5);
  const drinkTop = productosTop.filter((p) => p.category === "drinks").slice(0, 5);
  const periodLabel = days === 1 ? "hoy" : `últimos ${days}d`;

  return (
    <div className="space-y-6">
      <SectionHeader title="Operaciones" description="Cocina, barra y productos más pedidos" filter={days} onFilterChange={onDaysChange} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <AccentCard icon={ChefHat} label="Promedio cocina" value={formatMinutes(avg(kitchenTimes))} />
        <StatCard icon={Wine} label="Promedio barra" value={formatMinutes(avg(barTimes))} />
        <StatCard icon={Timer} label="Pedido hasta listo" value={formatMinutes(avg(totalReadyTimes))} />
        <StatCard icon={UtensilsCrossed} label="Unidades comida" value={String(foodUnits)} />
        <StatCard icon={Wine} label="Unidades bebida" value={String(drinkUnits)} />
        <StatCard icon={Flame} label="Total pedidos" value={String(filtered.length)} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <ChartCard title="Comida más pedida" subtitle={`Top 5 · ${periodLabel}`}>
          {foodTop.length === 0 ? (
            <EmptyState text="Sin pedidos de comida en este período" />
          ) : (
            <div className="space-y-2">
              {foodTop.map((p, i) => (
                <RankingItem key={p.nombre} rank={i + 1} label={p.nombre} sub={`${p.totalPedidos} pedido(s)`} value={`${p.cantidad} u.`} />
              ))}
            </div>
          )}
        </ChartCard>

        <ChartCard title="Bebidas más pedidas" subtitle={`Top 5 · ${periodLabel}`}>
          {drinkTop.length === 0 ? (
            <EmptyState text="Sin pedidos de bebidas en este período" />
          ) : (
            <div className="space-y-2">
              {drinkTop.map((p, i) => (
                <RankingItem key={p.nombre} rank={i + 1} label={p.nombre} sub={`${p.totalPedidos} pedido(s)`} value={`${p.cantidad} u.`} />
              ))}
            </div>
          )}
        </ChartCard>
      </div>

      <ChartCard title="Pedidos más lentos" subtitle={`Top 8 · cocina y barra · ${periodLabel}`}>
        {pedidosMasLentos.length === 0 ? (
          <EmptyState text="Sin tiempos medidos en este período" />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {pedidosMasLentos.map((p) => (
              <div
                key={`${p.id}-${p.tipo}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-zinc-100 bg-zinc-50 px-4 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                    p.tipo === "Cocina" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"
                  }`}>
                    {p.tipo === "Cocina" ? "C" : "B"}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-zinc-950">Mesa {p.mesa}</p>
                    <p className="truncate text-xs text-zinc-400">{p.items}</p>
                  </div>
                </div>
                <p className="shrink-0 text-sm font-bold text-zinc-950">{formatMinutes(p.minutos)}</p>
              </div>
            ))}
          </div>
        )}
      </ChartCard>
    </div>
  );
}

// ── MesasSection ──────────────────────────────────────────────────────────────

function MesasSection({ cuentasCobradas, pedidos, sessions, days, onDaysChange }: {
  cuentasCobradas: Cuenta[];
  pedidos: Pedido[];
  sessions: SessionRecord[];
  days: DayOption;
  onDaysChange: (v: DayOption) => void;
}) {
  const filteredSessions = useMemo(
    () => sessions.filter((s) => isWithinDays(s.openedAt ?? s.createdAt, days)),
    [sessions, days]
  );
  const filteredCuentas = useMemo(
    () => cuentasCobradas.filter((c) => isWithinDays(c.createdAt, days)),
    [cuentasCobradas, days]
  );
  const filteredPedidos = useMemo(
    () => pedidos.filter((p) => isWithinDays(p.createdAt, days)),
    [pedidos, days]
  );

  const rotaciones = useMemo<RotacionMesa[]>(() =>
    filteredSessions
      .map((s) => {
        const openedAt = toDateSafe(s.openedAt ?? s.createdAt);
        const cleanedAt = toDateSafe(s.cleanedAt);
        if (!openedAt || !cleanedAt) return null;
        const minutos = (cleanedAt.getTime() - openedAt.getTime()) / 60000;
        return Number.isFinite(minutos) && minutos >= 0
          ? { sessionId: s.id, mesa: String(s.tableNumber), minutos, openedAt, cleanedAt }
          : null;
      })
      .filter((v): v is RotacionMesa => v !== null),
    [filteredSessions]
  );

  const masLentas = useMemo(() => [...rotaciones].sort((a, b) => b.minutos - a.minutos).slice(0, 5), [rotaciones]);
  const masRapidas = useMemo(() => [...rotaciones].sort((a, b) => a.minutos - b.minutos).slice(0, 5), [rotaciones]);

  const mesasTop = useMemo(() => {
    const grouped: Record<string, { mesa: string; total: number; cantidad: number }> = {};
    filteredCuentas.forEach((c) => {
      const key = String(c.mesa);
      if (!grouped[key]) grouped[key] = { mesa: key, total: 0, cantidad: 0 };
      grouped[key].total += c.total || 0;
      grouped[key].cantidad += 1;
    });
    return Object.values(grouped).sort((a, b) => b.total - a.total).slice(0, 8);
  }, [filteredCuentas]);

  const horasPicoChart = useMemo(() => {
    const grouped: Record<string, number> = {};
    filteredPedidos.forEach((p) => {
      const d = toDateSafe(p.createdAt);
      if (!d) return;
      const key = `${String(d.getHours()).padStart(2, "0")}:00`;
      grouped[key] = (grouped[key] || 0) + 1;
    });
    return Object.entries(grouped)
      .map(([hora, pedidos]) => ({ hora, pedidos }))
      .sort((a, b) => a.hora.localeCompare(b.hora));
  }, [filteredPedidos]);

  const periodLabel = days === 1 ? "hoy" : `últimos ${days}d`;

  return (
    <div className="space-y-6">
      <SectionHeader title="Mesas" description="Rotación, horas pico y rendimiento por mesa" filter={days} onFilterChange={onDaysChange} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <AccentCard icon={RefreshCcw} label="Promedio rotación" value={formatMinutes(avg(rotaciones.map((r) => r.minutos)))} />
        <StatCard icon={Clock3} label="Rotaciones medidas" value={String(rotaciones.length)} />
        <StatCard icon={Trophy} label="Mesas en ranking" value={String(mesasTop.length)} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <ChartCard title="Rotación más lenta" subtitle={`Top 5 · ${periodLabel}`}>
          {masLentas.length === 0 ? (
            <EmptyState text="Sin rotaciones medidas en este período" />
          ) : (
            <div className="space-y-2">
              {masLentas.map((r, i) => (
                <RankingItem
                  key={r.sessionId}
                  rank={i + 1}
                  label={`Mesa ${r.mesa}`}
                  sub={r.openedAt.toLocaleDateString("es-AR")}
                  value={formatMinutes(r.minutos)}
                />
              ))}
            </div>
          )}
        </ChartCard>

        <ChartCard title="Rotación más rápida" subtitle={`Top 5 · ${periodLabel}`}>
          {masRapidas.length === 0 ? (
            <EmptyState text="Sin rotaciones medidas en este período" />
          ) : (
            <div className="space-y-2">
              {masRapidas.map((r, i) => (
                <RankingItem
                  key={r.sessionId}
                  rank={i + 1}
                  label={`Mesa ${r.mesa}`}
                  sub={r.openedAt.toLocaleDateString("es-AR")}
                  value={formatMinutes(r.minutos)}
                />
              ))}
            </div>
          )}
        </ChartCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <ChartCard title="Horas pico" subtitle="Pedidos por franja horaria">
          {horasPicoChart.length === 0 ? (
            <EmptyState text="Sin pedidos en este período" />
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={horasPicoChart} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={chartGridColor} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="hora" stroke={chartAxisColor} tickLine={false} axisLine={false} fontSize={11} />
                  <YAxis stroke={chartAxisColor} tickLine={false} axisLine={false} fontSize={11} />
                  <Tooltip
                    formatter={(v: number) => [`${v}`, "Pedidos"]}
                    contentStyle={{ borderRadius: 12, border: "1px solid #e4e4e7", fontSize: 12, boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}
                  />
                  <Bar dataKey="pedidos" fill={barColor} radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>

        <ChartCard title="Mesas que más vendieron" subtitle={`Top 8 · ${periodLabel}`}>
          {mesasTop.length === 0 ? (
            <EmptyState text="Sin ventas en este período" />
          ) : (
            <div className="space-y-2">
              {mesasTop.map((m, i) => (
                <RankingItem
                  key={m.mesa}
                  rank={i + 1}
                  label={`Mesa ${m.mesa}`}
                  sub={`${m.cantidad} cuenta(s)`}
                  value={formatPrice(m.total)}
                />
              ))}
            </div>
          )}
        </ChartCard>
      </div>
    </div>
  );
}

// ── PagosSection ──────────────────────────────────────────────────────────────

function PagosSection({ cuentasCobradas, days, onDaysChange }: {
  cuentasCobradas: Cuenta[];
  days: DayOption;
  onDaysChange: (v: DayOption) => void;
}) {
  const filtered = useMemo(
    () => cuentasCobradas.filter((c) => isWithinDays(c.createdAt, days)),
    [cuentasCobradas, days]
  );

  const metodos = useMemo(() => {
    const grouped: Record<string, { metodo: string; cantidad: number; total: number }> = {};
    filtered.forEach((c) => {
      const key = c.metodo || "sin_dato";
      if (!grouped[key]) grouped[key] = { metodo: getMetodoLabel(key), cantidad: 0, total: 0 };
      grouped[key].cantidad += 1;
      grouped[key].total += c.total || 0;
    });
    return Object.values(grouped).sort((a, b) => b.total - a.total);
  }, [filtered]);

  const ultimasCuentas = useMemo(() => cuentasCobradas.slice(0, 15), [cuentasCobradas]);
  const periodLabel = days === 1 ? "hoy" : `últimos ${days}d`;

  return (
    <div className="space-y-6">
      <SectionHeader title="Pagos" description="Métodos de pago y últimas cuentas cobradas" filter={days} onFilterChange={onDaysChange} />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-1">
          <ChartCard title="Métodos de pago" subtitle={periodLabel}>
            {metodos.length === 0 ? (
              <EmptyState text="Sin pagos en este período" />
            ) : (
              <div className="space-y-4">
                {metodos.map((m) => {
                  const pct = filtered.length > 0 ? Math.round((m.cantidad / filtered.length) * 100) : 0;
                  return (
                    <div key={m.metodo}>
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-sm font-bold text-zinc-950">{m.metodo}</span>
                        <span className="text-sm font-bold text-zinc-500">{formatPrice(m.total)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-zinc-100">
                        <div className="h-1.5 rounded-full bg-zinc-950 transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="mt-1 text-xs text-zinc-400">{m.cantidad} cuenta(s) · {pct}%</p>
                    </div>
                  );
                })}
              </div>
            )}
          </ChartCard>
        </div>

        <div className="xl:col-span-2">
          <ChartCard title="Últimas cuentas cobradas" subtitle="Historial reciente">
            {ultimasCuentas.length === 0 ? (
              <EmptyState text="Sin cuentas cobradas todavía" />
            ) : (
              <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1 [scrollbar-width:thin]">
                {ultimasCuentas.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-4 rounded-xl border border-zinc-100 bg-zinc-50 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-zinc-950">Mesa {c.mesa}</p>
                      <p className="text-xs text-zinc-400">
                        {toDateSafe(c.createdAt)?.toLocaleString("es-AR") || "—"} · {getMetodoLabel(c.metodo)}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-bold text-zinc-950">{formatPrice(c.total)}</p>
                  </div>
                ))}
              </div>
            )}
          </ChartCard>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const AdminAnalytics = () => {
  const navigate = useNavigate();
  const { restaurantId } = useRestaurant();

  const [activeSection, setActiveSection] = useState<AnalyticsSection>("ventas");
  const [ventasDays, setVentasDays] = useState<DayOption>(30);
  const [operacionesDays, setOperacionesDays] = useState<DayOption>(30);
  const [mesasDays, setMesasDays] = useState<DayOption>(30);
  const [pagosDays, setPagosDays] = useState<DayOption>(30);

  const [currentPlan, setCurrentPlan] = useState<RestaurantPlan>("starter");
  const [planLoading, setPlanLoading] = useState(true);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const analyticsEnabled = currentPlan === "pro" || currentPlan === "premium";

  useEffect(() => {
    if (!restaurantId) { setCurrentPlan("starter"); setPlanLoading(false); return; }
    setPlanLoading(true);
    const unsub = onSnapshot(doc(db, "restaurants", restaurantId), (snap) => {
      const plan = snap.data()?.plan;
      setCurrentPlan(plan === "pro" || plan === "premium" ? plan : "starter");
      setPlanLoading(false);
    }, () => { setCurrentPlan("starter"); setPlanLoading(false); });
    return () => unsub();
  }, [restaurantId]);

  useEffect(() => {
    if (!restaurantId || !analyticsEnabled) {
      setCuentas([]); setPedidos([]); setSessions([]); setLoading(false); return;
    }
    setLoading(true);
    const unsubC = onSnapshot(query(collection(db, "restaurants", restaurantId, "cuentas"), orderBy("createdAt", "desc")),
      (snap) => setCuentas(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Cuenta[])
    );
    const unsubP = onSnapshot(query(collection(db, "restaurants", restaurantId, "pedidos"), orderBy("createdAt", "desc")),
      (snap) => setPedidos(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Pedido[])
    );
    const unsubS = onSnapshot(query(collection(db, "restaurants", restaurantId, "sessions"), orderBy("createdAt", "desc")),
      (snap) => { setSessions(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as SessionRecord[]); setLoading(false); }
    );
    return () => { unsubC(); unsubP(); unsubS(); };
  }, [restaurantId, analyticsEnabled]);

  const cuentasCobradas = useMemo(() => cuentas.filter((c) => isCuentaCobrada(c.estado)), [cuentas]);

  if (!restaurantId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-100 p-6">
        <div className="rounded-xl border border-zinc-200 bg-white px-6 py-5 text-center shadow-sm">
          <h1 className="text-lg font-bold text-zinc-950">Falta restaurante activo</h1>
          <p className="mt-2 text-sm text-zinc-500">Seleccioná un restaurante antes de entrar a analytics.</p>
        </div>
      </div>
    );
  }

  if (planLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-100">
        <div className="rounded-xl border border-zinc-200 bg-white px-6 py-5 shadow-sm text-sm text-zinc-500">
          Verificando plan...
        </div>
      </div>
    );
  }

  if (!analyticsEnabled) {
    return (
      <div className="min-h-screen bg-zinc-100 p-6">
        <div className="mx-auto max-w-2xl rounded-xl border border-zinc-200 bg-white p-8 shadow-sm">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-zinc-950 text-white">
            <ShieldCheck size={24} />
          </div>
          <h1 className="mt-5 text-3xl font-bold text-zinc-950">Analytics no disponible</h1>
          <p className="mt-3 text-sm leading-relaxed text-zinc-500">
            Tu plan actual no incluye analytics avanzados. Pasate a Pro o Premium para desbloquear métricas, productos más vendidos, facturación y reportes operativos.
          </p>
          <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
            Plan actual: {currentPlan.toUpperCase()}
          </div>
          <button
            onClick={() => navigate("/staff/admin")}
            className="mt-6 flex h-11 items-center gap-2 rounded-lg bg-zinc-950 px-4 font-semibold text-white transition hover:opacity-90"
          >
            <ArrowLeft size={16} />
            Volver a Admin
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-100">
        <div className="rounded-xl border border-zinc-200 bg-white px-6 py-5 shadow-sm text-sm text-zinc-500">
          Cargando analytics...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-100 lg:flex">
      {/* Sidebar — desktop */}
      <aside className="sticky top-0 hidden h-screen w-[280px] shrink-0 overflow-hidden border-r border-white/60 bg-zinc-950 p-4 text-white shadow-2xl lg:flex lg:flex-col">
        <div className="rounded-xl border border-white/10 bg-white/[0.06] p-4 shadow-inner">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-white text-zinc-950 shadow-sm">
            <ChartLine size={22} />
          </div>
          <h2 className="mt-4 text-2xl font-bold tracking-tight">Analytics</h2>
          <p className="mt-1 text-xs font-medium leading-relaxed text-white/50">
            Métricas y reportes de tu restaurante.
          </p>
        </div>

        <nav className="mt-5 space-y-1.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={`group flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-all duration-200 ${
                  active ? "bg-white text-zinc-950 shadow-lg shadow-black/20" : "text-white/70 hover:bg-white/[0.08] hover:text-white"
                }`}
              >
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition ${
                  active ? "bg-zinc-950 text-white" : "bg-white/10 text-white"
                }`}>
                  <Icon size={18} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold">{item.label}</p>
                  <p className={`text-xs ${active ? "text-zinc-500" : "text-white/40"}`}>{item.description}</p>
                </div>
              </button>
            );
          })}
        </nav>

        <div className="mt-auto border-t border-white/10 pt-4">
          <button
            onClick={() => navigate("/staff/admin")}
            className="flex w-full items-center gap-3 rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-3 text-left text-red-200 transition hover:bg-red-500/20"
          >
            <ArrowLeft size={18} />
            <span className="text-sm font-bold">Volver a Admin</span>
          </button>
        </div>
      </aside>

      {/* Content */}
      <div className="min-w-0 flex-1">
        {/* Tabs — mobile */}
        <div className="sticky top-0 z-10 border-b border-zinc-200 bg-white px-4 lg:hidden">
          <div className="flex gap-1 overflow-x-auto py-3 [scrollbar-width:none]">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveSection(item.id)}
                  className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold transition ${
                    active ? "bg-zinc-950 text-white" : "text-zinc-500 hover:bg-zinc-100"
                  }`}
                >
                  <Icon size={15} />
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Section content */}
        <div className="p-4 md:p-6 lg:p-8">
          {activeSection === "ventas" && (
            <VentasSection cuentasCobradas={cuentasCobradas} days={ventasDays} onDaysChange={setVentasDays} />
          )}
          {activeSection === "operaciones" && (
            <OperacionesSection pedidos={pedidos} days={operacionesDays} onDaysChange={setOperacionesDays} />
          )}
          {activeSection === "mesas" && (
            <MesasSection cuentasCobradas={cuentasCobradas} pedidos={pedidos} sessions={sessions} days={mesasDays} onDaysChange={setMesasDays} />
          )}
          {activeSection === "pagos" && (
            <PagosSection cuentasCobradas={cuentasCobradas} days={pagosDays} onDaysChange={setPagosDays} />
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminAnalytics;
