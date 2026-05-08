import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getDb } from "../lib/firebase";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
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
  PieChart,
  RefreshCcw,
} from "lucide-react";

const db = getDb();

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

type VentaPorDia = {
  dateKey: string;
  label: string;
  totalVentas: number;
  cantidadCuentas: number;
};

type MesaRanking = {
  mesa: string;
  total: number;
  cantidadCuentas: number;
};

type ProductoRanking = {
  nombre: string;
  cantidad: number;
  totalPedidos: number;
  category?: "food" | "drinks";
};

type PedidoLento = {
  id: string;
  mesa: string;
  tipo: "Cocina" | "Barra";
  minutos: number;
  items: string;
};

type HoraPico = {
  hora: string;
  pedidos: number;
};

type RotacionMesa = {
  sessionId: string;
  mesa: string;
  minutos: number;
  openedAt: Date;
  cleanedAt: Date;
};

const formatPrice = (value: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value || 0);

const formatMinutes = (minutes: number) => {
  if (!Number.isFinite(minutes) || minutes <= 0) return "-";
  if (minutes < 1) return "< 1 min";
  return `${minutes.toFixed(1)} min`;
};

const toDateSafe = (
  dateValue?: TimestampLike | string | number | null
): Date | null => {
  if (!dateValue) return null;

  try {
    if (
      typeof dateValue === "object" &&
      typeof dateValue.toDate === "function"
    ) {
      return dateValue.toDate();
    }

    if (
      typeof dateValue === "object" &&
      typeof dateValue.toMillis === "function"
    ) {
      return new Date(dateValue.toMillis());
    }

    if (
      typeof dateValue === "object" &&
      typeof dateValue.seconds === "number"
    ) {
      return new Date(dateValue.seconds * 1000);
    }

    const date = new Date(dateValue as string | number);
    if (isNaN(date.getTime())) return null;

    return date;
  } catch {
    return null;
  }
};

const diffMinutes = (
  start?: TimestampLike | null,
  end?: TimestampLike | null
) => {
  const startDate = toDateSafe(start);
  const endDate = toDateSafe(end);

  if (!startDate || !endDate) return null;

  const diff = (endDate.getTime() - startDate.getTime()) / 60000;

  if (!Number.isFinite(diff) || diff < 0) return null;

  return diff;
};

const getDateKey = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const getDateLabel = (date: Date) =>
  date.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
  });

const isWithinDays = (dateValue: TimestampLike | undefined | null, days: number) => {
  const date = toDateSafe(dateValue);
  if (!date) return false;

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  return diffDays <= days;
};

const getMetodoLabel = (metodo?: string) => {
  switch (metodo) {
    case "cash":
      return "Efectivo";
    case "debit":
      return "Débito";
    case "credit":
      return "Crédito";
    case "transfer":
      return "Transferencia";
    default:
      return metodo || "Sin dato";
  }
};

const isCuentaCobrada = (estado?: string) => {
  return estado === "pagada" || estado === "cerrada";
};

const avg = (values: number[]) => {
  if (values.length === 0) return 0;
  return values.reduce((acc, value) => acc + value, 0) / values.length;
};

const chartGridColor = "#e4e4e7";
const chartAxisColor = "#71717a";
const lineColor = "#18181b";
const barColor = "#27272a";

const AdminAnalytics = () => {
  const navigate = useNavigate();
  const { restaurantId } = useRestaurant();
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!restaurantId) {
      setCuentas([]);
      setPedidos([]);
      setSessions([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const qCuentas = query(
      collection(db, "restaurants", restaurantId, "cuentas"),
      orderBy("createdAt", "desc")
    );

    const qPedidos = query(
      collection(db, "restaurants", restaurantId, "pedidos"),
      orderBy("createdAt", "desc")
    );

    const qSessions = query(
      collection(db, "restaurants", restaurantId, "sessions"),
      orderBy("createdAt", "desc")
    );

    const unsubCuentas = onSnapshot(qCuentas, (snapshot) => {
      const data = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      })) as Cuenta[];

      setCuentas(data);
    });

    const unsubPedidos = onSnapshot(qPedidos, (snapshot) => {
      const data = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      })) as Pedido[];

      setPedidos(data);
    });

    const unsubSessions = onSnapshot(qSessions, (snapshot) => {
      const data = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      })) as SessionRecord[];

      setSessions(data);
      setLoading(false);
    });

    return () => {
      unsubCuentas();
      unsubPedidos();
      unsubSessions();
    };
  }, [restaurantId]);

  const cuentasCobradas = useMemo(
    () => cuentas.filter((c) => isCuentaCobrada(c.estado)),
    [cuentas]
  );

  const cuentas7Dias = useMemo(
    () => cuentasCobradas.filter((c) => isWithinDays(c.createdAt, 7)),
    [cuentasCobradas]
  );

  const cuentas30Dias = useMemo(
    () => cuentasCobradas.filter((c) => isWithinDays(c.createdAt, 30)),
    [cuentasCobradas]
  );

  const pedidos30Dias = useMemo(
    () => pedidos.filter((p) => isWithinDays(p.createdAt, 30)),
    [pedidos]
  );

  const sessions30Dias = useMemo(
    () => sessions.filter((s) => isWithinDays(s.openedAt || s.createdAt, 30)),
    [sessions]
  );

  const kitchenTimes = useMemo(() => {
    return pedidos30Dias
      .map((p) => diffMinutes(p.cocinaStartedAt, p.cocinaReadyAt))
      .filter((value): value is number => value !== null);
  }, [pedidos30Dias]);

  const barTimes = useMemo(() => {
    return pedidos30Dias
      .map((p) => diffMinutes(p.barraStartedAt, p.barraReadyAt))
      .filter((value): value is number => value !== null);
  }, [pedidos30Dias]);

  const totalReadyTimes = useMemo(() => {
    return pedidos30Dias
      .map((p) => {
        const createdAt = toDateSafe(p.createdAt);
        const cocinaReady = toDateSafe(p.cocinaReadyAt);
        const barraReady = toDateSafe(p.barraReadyAt);

        if (!createdAt) return null;

        const readyDates = [cocinaReady, barraReady].filter(
          (date): date is Date => date !== null
        );

        if (readyDates.length === 0) return null;

        const lastReady = new Date(
          Math.max(...readyDates.map((date) => date.getTime()))
        );

        const diff = (lastReady.getTime() - createdAt.getTime()) / 60000;

        if (!Number.isFinite(diff) || diff < 0) return null;

        return diff;
      })
      .filter((value): value is number => value !== null);
  }, [pedidos30Dias]);

  const rotacionesMesa = useMemo<RotacionMesa[]>(() => {
    return sessions30Dias
      .map((session) => {
        const openedAt = toDateSafe(session.openedAt || session.createdAt);
        const cleanedAt = toDateSafe(session.cleanedAt);

        if (!openedAt || !cleanedAt) return null;

        const minutos = (cleanedAt.getTime() - openedAt.getTime()) / 60000;

        if (!Number.isFinite(minutos) || minutos < 0) return null;

        return {
          sessionId: session.id,
          mesa: String(session.tableNumber),
          minutos,
          openedAt,
          cleanedAt,
        };
      })
      .filter((value): value is RotacionMesa => value !== null)
      .sort((a, b) => b.minutos - a.minutos);
  }, [sessions30Dias]);

  const rotacionStats = useMemo(() => {
    const tiempos = rotacionesMesa.map((r) => r.minutos);
    const promedio = avg(tiempos);

    const masLentas = [...rotacionesMesa].sort((a, b) => b.minutos - a.minutos).slice(0, 5);
    const masRapidas = [...rotacionesMesa].sort((a, b) => a.minutos - b.minutos).slice(0, 5);

    return {
      promedio,
      cantidad: rotacionesMesa.length,
      masLentas,
      masRapidas,
    };
  }, [rotacionesMesa]);

  const operationalStats = useMemo(() => {
    const foodItems = pedidos30Dias.flatMap((p) =>
      (p.items || []).filter((item) => item.category === "food")
    );

    const drinkItems = pedidos30Dias.flatMap((p) =>
      (p.items || []).filter((item) => item.category === "drinks")
    );

    const foodUnits = foodItems.reduce((acc, item) => acc + (item.cantidad || 0), 0);
    const drinkUnits = drinkItems.reduce(
      (acc, item) => acc + (item.cantidad || 0),
      0
    );

    return {
      cocinaPromedio: avg(kitchenTimes),
      barraPromedio: avg(barTimes),
      totalListoPromedio: avg(totalReadyTimes),
      rotacionMesaPromedio: rotacionStats.promedio,
      rotacionesMedidas: rotacionStats.cantidad,
      pedidos30Dias: pedidos30Dias.length,
      foodUnits,
      drinkUnits,
    };
  }, [pedidos30Dias, kitchenTimes, barTimes, totalReadyTimes, rotacionStats]);

  const pedidosMasLentos = useMemo<PedidoLento[]>(() => {
    const rows: PedidoLento[] = [];

    for (const pedido of pedidos30Dias) {
      const cocinaMin = diffMinutes(pedido.cocinaStartedAt, pedido.cocinaReadyAt);
      const barraMin = diffMinutes(pedido.barraStartedAt, pedido.barraReadyAt);

      const foodNames = (pedido.items || [])
        .filter((item) => item.category === "food")
        .map((item) => `${item.nombre} x${item.cantidad}`)
        .join(", ");

      const drinkNames = (pedido.items || [])
        .filter((item) => item.category === "drinks")
        .map((item) => `${item.nombre} x${item.cantidad}`)
        .join(", ");

      if (cocinaMin !== null) {
        rows.push({
          id: pedido.id,
          mesa: String(pedido.mesa),
          tipo: "Cocina",
          minutos: cocinaMin,
          items: foodNames || "Comida",
        });
      }

      if (barraMin !== null) {
        rows.push({
          id: pedido.id,
          mesa: String(pedido.mesa),
          tipo: "Barra",
          minutos: barraMin,
          items: drinkNames || "Bebidas",
        });
      }
    }

    return rows.sort((a, b) => b.minutos - a.minutos).slice(0, 10);
  }, [pedidos30Dias]);

  const horasPico = useMemo<HoraPico[]>(() => {
    const grouped: Record<string, HoraPico> = {};

    for (const pedido of pedidos30Dias) {
      const date = toDateSafe(pedido.createdAt);
      if (!date) continue;

      const hour = String(date.getHours()).padStart(2, "0");
      const key = `${hour}:00`;

      if (!grouped[key]) {
        grouped[key] = {
          hora: key,
          pedidos: 0,
        };
      }

      grouped[key].pedidos += 1;
    }

    return Object.values(grouped)
      .sort((a, b) => b.pedidos - a.pedidos)
      .slice(0, 6);
  }, [pedidos30Dias]);

  const stats = useMemo(() => {
    const ventasHoy = cuentasCobradas
      .filter((c) => {
        const date = toDateSafe(c.createdAt);
        if (!date) return false;

        const now = new Date();
        return (
          date.getDate() === now.getDate() &&
          date.getMonth() === now.getMonth() &&
          date.getFullYear() === now.getFullYear()
        );
      })
      .reduce((acc, c) => acc + (c.total || 0), 0);

    const ventas7Dias = cuentas7Dias.reduce((acc, c) => acc + (c.total || 0), 0);
    const ventas30Dias = cuentas30Dias.reduce((acc, c) => acc + (c.total || 0), 0);

    const ticketPromedio30 =
      cuentas30Dias.length > 0 ? ventas30Dias / cuentas30Dias.length : 0;

    const metodoCount: Record<string, number> = {};
    for (const cuenta of cuentas30Dias) {
      const key = cuenta.metodo || "sin_dato";
      metodoCount[key] = (metodoCount[key] || 0) + 1;
    }

    const metodoTop = Object.entries(metodoCount).sort((a, b) => b[1] - a[1])[0];

    return {
      ventasHoy,
      ventas7Dias,
      ventas30Dias,
      ticketPromedio30,
      cuentas30Dias: cuentas30Dias.length,
      metodoTop: metodoTop ? getMetodoLabel(metodoTop[0]) : "-",
    };
  }, [cuentasCobradas, cuentas7Dias, cuentas30Dias]);

  const ventasPorDia = useMemo<VentaPorDia[]>(() => {
    const grouped: Record<string, VentaPorDia> = {};

    for (const cuenta of cuentas30Dias) {
      const date = toDateSafe(cuenta.createdAt);
      if (!date) continue;

      const key = getDateKey(date);

      if (!grouped[key]) {
        grouped[key] = {
          dateKey: key,
          label: getDateLabel(date),
          totalVentas: 0,
          cantidadCuentas: 0,
        };
      }

      grouped[key].totalVentas += cuenta.total || 0;
      grouped[key].cantidadCuentas += 1;
    }

    return Object.values(grouped).sort((a, b) =>
      a.dateKey.localeCompare(b.dateKey)
    );
  }, [cuentas30Dias]);

  const metodos30Dias = useMemo(() => {
    const grouped: Record<string, { metodo: string; cantidad: number; total: number }> =
      {};

    for (const cuenta of cuentas30Dias) {
      const key = cuenta.metodo || "sin_dato";

      if (!grouped[key]) {
        grouped[key] = {
          metodo: getMetodoLabel(key),
          cantidad: 0,
          total: 0,
        };
      }

      grouped[key].cantidad += 1;
      grouped[key].total += cuenta.total || 0;
    }

    return Object.values(grouped).sort((a, b) => b.total - a.total);
  }, [cuentas30Dias]);

  const mesasTop30Dias = useMemo<MesaRanking[]>(() => {
    const grouped: Record<string, MesaRanking> = {};

    for (const cuenta of cuentas30Dias) {
      const key = String(cuenta.mesa);

      if (!grouped[key]) {
        grouped[key] = {
          mesa: key,
          total: 0,
          cantidadCuentas: 0,
        };
      }

      grouped[key].total += cuenta.total || 0;
      grouped[key].cantidadCuentas += 1;
    }

    return Object.values(grouped)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [cuentas30Dias]);

  const productosTop30Dias = useMemo<ProductoRanking[]>(() => {
    const grouped: Record<string, ProductoRanking> = {};

    for (const pedido of pedidos30Dias) {
      for (const item of pedido.items || []) {
        const key = item.nombre?.trim()?.toLowerCase();
        if (!key) continue;

        if (!grouped[key]) {
          grouped[key] = {
            nombre: item.nombre,
            cantidad: 0,
            totalPedidos: 0,
            category: item.category,
          };
        }

        grouped[key].cantidad += item.cantidad || 0;
        grouped[key].totalPedidos += 1;
      }
    }

    return Object.values(grouped)
      .sort((a, b) => b.cantidad - a.cantidad)
      .slice(0, 10);
  }, [pedidos30Dias]);

  if (!restaurantId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-100 p-6">
        <div className="rounded-3xl border border-zinc-200 bg-white px-6 py-5 shadow-sm text-center">
          <h1 className="text-lg font-black text-zinc-950">
            Falta restaurante activo
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            Seleccioná un restaurante antes de entrar a analytics.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-100 p-6">
        <div className="rounded-3xl border border-zinc-200 bg-white px-6 py-5 shadow-sm">
          Cargando analytics...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-100">
      <div className="mx-auto max-w-[1800px] px-4 py-4 md:px-6 lg:px-8">
        <header className="mb-6 rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-zinc-950 text-white shadow-sm">
                <ChartLine size={22} />
              </div>

              <div>
                <h1 className="text-3xl font-black tracking-tight text-zinc-950">
                  Admin Analytics
                </h1>
                <p className="mt-1 text-sm text-zinc-500">
                  Ventas, tiempos operativos y rotación de mesas
                </p>
              </div>
            </div>

            <button
              onClick={() => navigate("/staff/admin")}
              className="flex h-11 items-center gap-2 rounded-2xl bg-zinc-950 px-4 font-semibold text-white transition hover:opacity-90"
            >
              <ArrowLeft size={16} />
              Volver a Admin
            </button>
          </div>
        </header>

        <section className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          <div className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-zinc-500">
              <CircleDollarSign size={16} />
              <p className="text-sm">Ventas de hoy</p>
            </div>
            <p className="mt-2 text-3xl font-black text-zinc-950">
              {formatPrice(stats.ventasHoy)}
            </p>
          </div>

          <div className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-zinc-500">
              <Wallet size={16} />
              <p className="text-sm">Últimos 7 días</p>
            </div>
            <p className="mt-2 text-3xl font-black text-zinc-950">
              {formatPrice(stats.ventas7Dias)}
            </p>
          </div>

          <div className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-zinc-500">
              <Wallet size={16} />
              <p className="text-sm">Últimos 30 días</p>
            </div>
            <p className="mt-2 text-3xl font-black text-zinc-950">
              {formatPrice(stats.ventas30Dias)}
            </p>
          </div>

          <div className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-zinc-500">
              <Receipt size={16} />
              <p className="text-sm">Ticket promedio 30d</p>
            </div>
            <p className="mt-2 text-3xl font-black text-zinc-950">
              {formatPrice(stats.ticketPromedio30)}
            </p>
          </div>

          <div className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-zinc-500">
              <CreditCard size={16} />
              <p className="text-sm">Método top 30d</p>
            </div>
            <p className="mt-2 text-xl font-black text-zinc-950">
              {stats.metodoTop}
            </p>
          </div>

          <div className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-zinc-500">
              <Receipt size={16} />
              <p className="text-sm">Cuentas cobradas 30d</p>
            </div>
            <p className="mt-2 text-3xl font-black text-zinc-950">
              {stats.cuentas30Dias}
            </p>
          </div>
        </section>

        <section className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
          <div className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-zinc-500">
              <ChefHat size={16} />
              <p className="text-sm">Promedio cocina</p>
            </div>
            <p className="mt-2 text-3xl font-black text-zinc-950">
              {formatMinutes(operationalStats.cocinaPromedio)}
            </p>
          </div>

          <div className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-zinc-500">
              <Wine size={16} />
              <p className="text-sm">Promedio barra</p>
            </div>
            <p className="mt-2 text-3xl font-black text-zinc-950">
              {formatMinutes(operationalStats.barraPromedio)}
            </p>
          </div>

          <div className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-zinc-500">
              <Timer size={16} />
              <p className="text-sm">Pedido hasta listo</p>
            </div>
            <p className="mt-2 text-3xl font-black text-zinc-950">
              {formatMinutes(operationalStats.totalListoPromedio)}
            </p>
          </div>

          <div className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-zinc-500">
              <RefreshCcw size={16} />
              <p className="text-sm">Rotación mesa</p>
            </div>
            <p className="mt-2 text-3xl font-black text-zinc-950">
              {formatMinutes(operationalStats.rotacionMesaPromedio)}
            </p>
          </div>

          <div className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-zinc-500">
              <Clock3 size={16} />
              <p className="text-sm">Rotaciones medidas</p>
            </div>
            <p className="mt-2 text-3xl font-black text-zinc-950">
              {operationalStats.rotacionesMedidas}
            </p>
          </div>

          <div className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-zinc-500">
              <UtensilsCrossed size={16} />
              <p className="text-sm">Unidades comida</p>
            </div>
            <p className="mt-2 text-3xl font-black text-zinc-950">
              {operationalStats.foodUnits}
            </p>
          </div>

          <div className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-zinc-500">
              <PieChart size={16} />
              <p className="text-sm">Unidades bebida</p>
            </div>
            <p className="mt-2 text-3xl font-black text-zinc-950">
              {operationalStats.drinkUnits}
            </p>
          </div>
        </section>

        <section className="grid gap-6 2xl:grid-cols-2">
          <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="mb-4">
              <h2 className="text-xl font-black text-zinc-950">Ventas por día</h2>
              <p className="text-sm text-zinc-500">Últimos 30 días</p>
            </div>

            {ventasPorDia.length === 0 ? (
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-8 text-center text-zinc-500">
                No hay ventas cobradas en los últimos 30 días
              </div>
            ) : (
              <div className="h-[340px] w-full">
                <ResponsiveContainer>
                  <LineChart data={ventasPorDia} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                    <CartesianGrid stroke={chartGridColor} strokeDasharray="3 3" />
                    <XAxis dataKey="label" stroke={chartAxisColor} tickLine={false} axisLine={false} />
                    <YAxis stroke={chartAxisColor} tickLine={false} axisLine={false} />
                    <Tooltip formatter={(value: number) => formatPrice(value)} labelFormatter={(label) => `Día: ${label}`} />
                    <Line type="monotone" dataKey="totalVentas" stroke={lineColor} strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="mb-4">
              <h2 className="text-xl font-black text-zinc-950">
                Cuentas cobradas por día
              </h2>
              <p className="text-sm text-zinc-500">Últimos 30 días</p>
            </div>

            {ventasPorDia.length === 0 ? (
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-8 text-center text-zinc-500">
                No hay cuentas cobradas todavía
              </div>
            ) : (
              <div className="h-[340px] w-full">
                <ResponsiveContainer>
                  <BarChart data={ventasPorDia} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                    <CartesianGrid stroke={chartGridColor} strokeDasharray="3 3" />
                    <XAxis dataKey="label" stroke={chartAxisColor} tickLine={false} axisLine={false} />
                    <YAxis stroke={chartAxisColor} tickLine={false} axisLine={false} />
                    <Tooltip formatter={(value: number) => `${value} cuenta(s)`} labelFormatter={(label) => `Día: ${label}`} />
                    <Bar dataKey="cantidadCuentas" fill={barColor} radius={[10, 10, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </section>

        <section className="mt-6 grid gap-6 2xl:grid-cols-2">
          <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <RefreshCcw size={18} className="text-zinc-500" />
              <div>
                <h2 className="text-xl font-black text-zinc-950">
                  Mesas con rotación más lenta
                </h2>
                <p className="text-sm text-zinc-500">
                  Desde QR abierto hasta mesa limpia · últimos 30 días
                </p>
              </div>
            </div>

            {rotacionStats.masLentas.length === 0 ? (
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-6 text-center text-zinc-500">
                Todavía no hay rotaciones medidas. Se van a generar cuando una mesa pase de QR abierto a mesa limpia.
              </div>
            ) : (
              <div className="dashboard-scroll max-h-[420px] space-y-3 overflow-y-auto pr-1">
                {rotacionStats.masLentas.map((rotacion, index) => (
                  <div
                    key={rotacion.sessionId}
                    className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4"
                  >
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="font-semibold text-zinc-950">
                        #{index + 1} · Mesa {rotacion.mesa}
                      </p>
                      <p className="font-bold text-zinc-950">
                        {formatMinutes(rotacion.minutos)}
                      </p>
                    </div>
                    <p className="text-sm text-zinc-500">
                      Abierta: {rotacion.openedAt.toLocaleString("es-AR")} · Limpia: {rotacion.cleanedAt.toLocaleString("es-AR")}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <RefreshCcw size={18} className="text-zinc-500" />
              <div>
                <h2 className="text-xl font-black text-zinc-950">
                  Mesas con rotación más rápida
                </h2>
                <p className="text-sm text-zinc-500">
                  Top 5 · últimos 30 días
                </p>
              </div>
            </div>

            {rotacionStats.masRapidas.length === 0 ? (
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-6 text-center text-zinc-500">
                Todavía no hay rotaciones medidas.
              </div>
            ) : (
              <div className="dashboard-scroll max-h-[420px] space-y-3 overflow-y-auto pr-1">
                {rotacionStats.masRapidas.map((rotacion, index) => (
                  <div
                    key={rotacion.sessionId}
                    className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4"
                  >
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="font-semibold text-zinc-950">
                        #{index + 1} · Mesa {rotacion.mesa}
                      </p>
                      <p className="font-bold text-zinc-950">
                        {formatMinutes(rotacion.minutos)}
                      </p>
                    </div>
                    <p className="text-sm text-zinc-500">
                      Abierta: {rotacion.openedAt.toLocaleString("es-AR")} · Limpia: {rotacion.cleanedAt.toLocaleString("es-AR")}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="mt-6 grid gap-6 2xl:grid-cols-2">
          <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Flame size={18} className="text-zinc-500" />
              <div>
                <h2 className="text-xl font-black text-zinc-950">
                  Pedidos más lentos
                </h2>
                <p className="text-sm text-zinc-500">
                  Top 10 · cocina y barra · últimos 30 días
                </p>
              </div>
            </div>

            {pedidosMasLentos.length === 0 ? (
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-6 text-center text-zinc-500">
                Todavía no hay tiempos medidos. Los nuevos pedidos van a empezar a generar datos.
              </div>
            ) : (
              <div className="dashboard-scroll max-h-[420px] space-y-3 overflow-y-auto pr-1">
                {pedidosMasLentos.map((pedido, index) => (
                  <div
                    key={`${pedido.id}-${pedido.tipo}`}
                    className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4"
                  >
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="font-semibold text-zinc-950">
                        #{index + 1} · Mesa {pedido.mesa} · {pedido.tipo}
                      </p>
                      <p className="font-bold text-zinc-950">
                        {formatMinutes(pedido.minutos)}
                      </p>
                    </div>
                    <p className="text-sm text-zinc-500">{pedido.items}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Clock3 size={18} className="text-zinc-500" />
              <div>
                <h2 className="text-xl font-black text-zinc-950">Horas pico</h2>
                <p className="text-sm text-zinc-500">
                  Horarios con más pedidos · últimos 30 días
                </p>
              </div>
            </div>

            {horasPico.length === 0 ? (
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-6 text-center text-zinc-500">
                No hay pedidos suficientes
              </div>
            ) : (
              <div className="dashboard-scroll max-h-[420px] space-y-3 overflow-y-auto pr-1">
                {horasPico.map((hora, index) => (
                  <div
                    key={hora.hora}
                    className="flex items-center justify-between rounded-2xl border border-zinc-200 bg-zinc-50 p-4"
                  >
                    <div>
                      <p className="font-semibold text-zinc-950">
                        #{index + 1} · {hora.hora}
                      </p>
                      <p className="text-sm text-zinc-500">Franja horaria</p>
                    </div>

                    <p className="font-bold text-zinc-950">
                      {hora.pedidos} pedido(s)
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="mt-6 grid gap-6 2xl:grid-cols-2">
          <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Trophy size={18} className="text-zinc-500" />
              <div>
                <h2 className="text-xl font-black text-zinc-950">
                  Mesas que más vendieron
                </h2>
                <p className="text-sm text-zinc-500">Top 10 · últimos 30 días</p>
              </div>
            </div>

            {mesasTop30Dias.length === 0 ? (
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-6 text-center text-zinc-500">
                No hay ventas suficientes
              </div>
            ) : (
              <div className="dashboard-scroll max-h-[420px] space-y-3 overflow-y-auto pr-1">
                {mesasTop30Dias.map((mesa, index) => (
                  <div
                    key={mesa.mesa}
                    className="flex items-center justify-between rounded-2xl border border-zinc-200 bg-zinc-50 p-4"
                  >
                    <div>
                      <p className="font-semibold text-zinc-950">
                        #{index + 1} · Mesa {mesa.mesa}
                      </p>
                      <p className="text-sm text-zinc-500">
                        {mesa.cantidadCuentas} cuenta(s) cobrada(s)
                      </p>
                    </div>

                    <p className="font-bold text-zinc-950">
                      {formatPrice(mesa.total)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <UtensilsCrossed size={18} className="text-zinc-500" />
              <div>
                <h2 className="text-xl font-black text-zinc-950">
                  Productos más pedidos
                </h2>
                <p className="text-sm text-zinc-500">Top 10 · últimos 30 días</p>
              </div>
            </div>

            {productosTop30Dias.length === 0 ? (
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-6 text-center text-zinc-500">
                No hay pedidos suficientes
              </div>
            ) : (
              <div className="dashboard-scroll max-h-[420px] space-y-3 overflow-y-auto pr-1">
                {productosTop30Dias.map((producto, index) => (
                  <div
                    key={`${producto.nombre}-${index}`}
                    className="flex items-center justify-between rounded-2xl border border-zinc-200 bg-zinc-50 p-4"
                  >
                    <div>
                      <p className="font-semibold text-zinc-950">
                        #{index + 1} · {producto.nombre}
                      </p>
                      <p className="text-sm text-zinc-500">
                        {producto.category === "drinks" ? "Bebida" : "Comida"} ·{" "}
                        {producto.totalPedidos} pedido(s)
                      </p>
                    </div>

                    <p className="font-bold text-zinc-950">
                      {producto.cantidad} u.
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-3">
          <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm xl:col-span-1">
            <div className="mb-4">
              <h2 className="text-xl font-black text-zinc-950">Métodos de pago</h2>
              <p className="text-sm text-zinc-500">Últimos 30 días</p>
            </div>

            {metodos30Dias.length === 0 ? (
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-6 text-center text-zinc-500">
                Sin datos
              </div>
            ) : (
              <div className="dashboard-scroll max-h-[420px] space-y-3 overflow-y-auto pr-1">
                {metodos30Dias.map((metodo) => (
                  <div
                    key={metodo.metodo}
                    className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <p className="font-semibold text-zinc-950">{metodo.metodo}</p>
                      <p className="font-bold text-zinc-950">
                        {formatPrice(metodo.total)}
                      </p>
                    </div>
                    <p className="text-sm text-zinc-500">
                      {metodo.cantidad} cuenta(s)
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm xl:col-span-2">
            <div className="mb-4">
              <h2 className="text-xl font-black text-zinc-950">
                Últimas cuentas cobradas
              </h2>
              <p className="text-sm text-zinc-500">Historial reciente</p>
            </div>

            {cuentasCobradas.length === 0 ? (
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-6 text-center text-zinc-500">
                Todavía no hay cuentas cobradas
              </div>
            ) : (
              <div className="dashboard-scroll max-h-[460px] space-y-3 overflow-y-auto pr-1">
                {cuentasCobradas.slice(0, 10).map((cuenta) => (
                  <div
                    key={cuenta.id}
                    className="flex flex-col gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 md:flex-row md:items-center md:justify-between"
                  >
                    <div>
                      <p className="font-semibold text-zinc-950">Mesa {cuenta.mesa}</p>
                      <p className="text-sm text-zinc-500">
                        {toDateSafe(cuenta.createdAt)?.toLocaleString("es-AR") || "-"}
                      </p>
                    </div>

                    <div className="text-sm text-zinc-700">
                      <p>
                        <b>Método:</b> {getMetodoLabel(cuenta.metodo)}
                      </p>
                      <p>
                        <b>Total:</b> {formatPrice(cuenta.total)}
                      </p>
                      <p>
                        <b>Estado:</b> {cuenta.estado}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

export default AdminAnalytics;