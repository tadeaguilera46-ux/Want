import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { getApp } from "firebase/app";
import { getFunctions, httpsCallable } from "firebase/functions";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BarChart3,
  Calendar,
  CalendarClock,
  Clock,
  History,
  Phone,
  Plus,
  Search,
  Users,
  X,
} from "lucide-react";
import { getDb } from "../lib/firebase";
import { toast } from "sonner";
import { useAuth } from "../lib/auth-context";

type ReservationStatus =
  | "pending"
  | "confirmed"
  | "seated"
  | "completed"
  | "cancelled"
  | "no_show";

type Reservation = {
  id: string;
  name: string;
  phone: string;
  email: string;
  date: string;
  time: string;
  slot?: string;
  partySize: number;
  mesa?: number;
  status: ReservationStatus;
  confirmation?: {
    channel: "email";
    status: "pending" | "sent" | "failed";
    sentAt?: unknown;
    error?: string | null;
  };
  reminder?: {
    channel: "email";
    status: "pending" | "sending" | "sent" | "failed";
    sentAt?: unknown;
    error?: string | null;
  };
  notes?: string;
  rescheduleHistory?: {
    from: { date: string; time: string };
    to: { date: string; time: string };
    changedAt?: unknown;
    actorUid?: string;
    actorEmail?: string | null;
  }[];
  createdAt?: unknown;
};

type ReservationSettings = {
  openTime: string;
  closeTime: string;
  slotMinutes: number;
  capacityPerSlot: number;
};

type ReservationTable = {
  id: string;
  numero: number;
  active?: boolean;
};

type ReservationHistoryResult = {
  phoneNormalized: string;
  total: number;
  completed: number;
  cancelled: number;
  noShows: number;
  reservations: {
    id: string;
    name: string;
    phone: string;
    email: string;
    date: string;
    time: string;
    partySize: number;
    mesa?: number | null;
    status: ReservationStatus;
    notes?: string | null;
    rescheduleCount: number;
  }[];
};

type MetricsRange = 7 | 30 | 90;

type ReservationMetrics = {
  days: MetricsRange;
  startDate: string;
  endDate: string;
  total: number;
  completed: number;
  cancelled: number;
  noShows: number;
  active: number;
  cancellationRate: number;
  noShowRate: number;
  attendanceRate: number;
  daily: {
    date: string;
    label: string;
    total: number;
    completed: number;
    cancelled: number;
    noShows: number;
  }[];
};

const db = getDb();
const functions = getFunctions(getApp(), "us-central1");

const today = () => new Date().toISOString().slice(0, 10);
const DEFAULT_SETTINGS: ReservationSettings = {
  openTime: "12:00",
  closeTime: "23:00",
  slotMinutes: 60,
  capacityPerSlot: 40,
};

const STATUS_ORDER: ReservationStatus[] = [
  "pending",
  "confirmed",
  "seated",
  "completed",
  "cancelled",
  "no_show",
];

const STATUS_LABEL: Record<ReservationStatus, string> = {
  pending: "Pendiente",
  confirmed: "Confirmada",
  seated: "En mesa",
  completed: "Finalizada",
  cancelled: "Cancelada",
  no_show: "No se presentó",
};

const STATUS_ACTION_LABEL: Record<ReservationStatus, string> = {
  pending: "Volver a pendiente",
  confirmed: "Confirmar / reactivar",
  seated: "Marcar llegada",
  completed: "Finalizar atención",
  cancelled: "Cancelar",
  no_show: "Marcar ausencia",
};

const STATUS_STYLE: Record<ReservationStatus, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-700",
  confirmed: "border-emerald-200 bg-emerald-100 text-emerald-700",
  seated: "border-blue-200 bg-blue-100 text-blue-700",
  completed: "border-zinc-200 bg-zinc-100 text-zinc-600",
  cancelled: "border-red-200 bg-red-100 text-red-600",
  no_show: "border-orange-200 bg-orange-100 text-orange-700",
};

const STATUS_TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["seated", "cancelled", "no_show"],
  seated: ["completed", "cancelled"],
  completed: [],
  cancelled: ["confirmed"],
  no_show: ["confirmed"],
};

const OCCUPYING_STATUSES: ReservationStatus[] = ["confirmed", "seated"];

const timeToMinutes = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

const minutesToTime = (minutes: number) => {
  const normalized = minutes % (24 * 60);
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(
    normalized % 60
  ).padStart(2, "0")}`;
};

const buildSlots = (settings: ReservationSettings) => {
  const open = timeToMinutes(settings.openTime);
  const rawClose = timeToMinutes(settings.closeTime);
  const close = rawClose <= open ? rawClose + 24 * 60 : rawClose;
  const slots: string[] = [];

  for (
    let minutes = open;
    minutes < close && slots.length < 96;
    minutes += settings.slotMinutes
  ) {
    slots.push(minutesToTime(minutes));
  }

  return slots;
};

const getFunctionErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message) return error.message;
  return "No se pudo completar la operación.";
};

export function ReservationsPanel({ restaurantId }: { restaurantId: string }) {
  const { user } = useAuth();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [viewDate, setViewDate] = useState(today());
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState(false);
  const [rescheduleDraft, setRescheduleDraft] = useState<{
    reservationId: string;
    date: string;
    time: string;
  } | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settings, setSettings] =
    useState<ReservationSettings>(DEFAULT_SETTINGS);
  const [settingsDraft, setSettingsDraft] =
    useState<ReservationSettings>(DEFAULT_SETTINGS);
  const [tables, setTables] = useState<ReservationTable[]>([]);
  const [historyPhone, setHistoryPhone] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyResult, setHistoryResult] =
    useState<ReservationHistoryResult | null>(null);
  const [metricsRange, setMetricsRange] = useState<MetricsRange>(30);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [metrics, setMetrics] = useState<ReservationMetrics | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [date, setDate] = useState(today());
  const [time, setTime] = useState("20:00");
  const [partySize, setPartySize] = useState("2");
  const [mesa, setMesa] = useState("");
  const [notes, setNotes] = useState("");

  const slots = useMemo(() => buildSlots(settings), [settings]);
  const occupancyBySlot = useMemo(() => {
    const occupancy = new Map<string, number>();
    reservations
      .filter((reservation) => OCCUPYING_STATUSES.includes(reservation.status))
      .forEach((reservation) => {
        const slot = reservation.slot || reservation.time;
        occupancy.set(
          slot,
          (occupancy.get(slot) || 0) + Number(reservation.partySize || 0)
        );
      });
    return occupancy;
  }, [reservations]);
  const selectedSlotOccupancy = occupancyBySlot.get(time) || 0;
  const selectedSlotRemaining = Math.max(
    0,
    settings.capacityPerSlot - selectedSlotOccupancy
  );
  const reservedTablesForSelectedSlot = useMemo(
    () =>
      new Set(
        reservations
          .filter(
            (reservation) =>
              OCCUPYING_STATUSES.includes(reservation.status) &&
              (reservation.slot || reservation.time) === time &&
              Number.isInteger(reservation.mesa)
          )
          .map((reservation) => Number(reservation.mesa))
      ),
    [reservations, time]
  );
  const activeTables = useMemo(
    () =>
      tables
        .filter((table) => table.active !== false)
        .sort((left, right) => left.numero - right.numero),
    [tables]
  );

  useEffect(() => {
    return onSnapshot(
      doc(db, "restaurants", restaurantId, "reservationSettings", "main"),
      (snapshot) => {
        const nextSettings = snapshot.exists()
          ? (snapshot.data() as ReservationSettings)
          : DEFAULT_SETTINGS;
        setSettings(nextSettings);
        setSettingsDraft(nextSettings);
      }
    );
  }, [restaurantId]);

  useEffect(() => {
    return onSnapshot(
      collection(db, "restaurants", restaurantId, "mesas"),
      (snapshot) => {
        setTables(
          snapshot.docs
            .map((tableDoc) => {
              const data = tableDoc.data();
              return {
                id: tableDoc.id,
                numero: Number(data.numero ?? tableDoc.id),
                active: data.active,
              };
            })
            .filter((table) => Number.isInteger(table.numero) && table.numero > 0)
        );
      }
    );
  }, [restaurantId]);

  useEffect(() => {
    if (slots.length > 0 && !slots.includes(time)) {
      setTime(slots[0]);
    }
  }, [slots, time]);

  useEffect(() => {
    const selectedMesa = Number(mesa);
    if (
      mesa &&
      (!activeTables.some((table) => table.numero === selectedMesa) ||
        reservedTablesForSelectedSlot.has(selectedMesa))
    ) {
      setMesa("");
    }
  }, [activeTables, mesa, reservedTablesForSelectedSlot]);

  useEffect(() => {
    const q = query(
      collection(db, "restaurants", restaurantId, "reservations"),
      where("date", "==", viewDate),
      orderBy("time", "asc")
    );
    return onSnapshot(q, (snap) => {
      setReservations(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Reservation));
    });
  }, [restaurantId, viewDate]);

  useEffect(() => {
    let active = true;
    setMetricsLoading(true);
    const getMetrics = httpsCallable<
      { restaurantId: string; days: MetricsRange },
      ReservationMetrics
    >(functions, "getReservationMetrics");

    getMetrics({ restaurantId, days: metricsRange })
      .then((result) => {
        if (active) setMetrics(result.data);
      })
      .catch((error) => {
        if (active) toast.error(getFunctionErrorMessage(error));
      })
      .finally(() => {
        if (active) setMetricsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [restaurantId, metricsRange]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!name.trim() || !phone.trim() || !normalizedEmail || !user) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      toast.error("Ingresá un email válido.");
      return;
    }
    try {
      setSaving(true);
      const createReservation = httpsCallable(functions, "createReservation");
      await createReservation({
        restaurantId,
        name: name.trim(),
        phone: phone.trim(),
        email: normalizedEmail,
        date,
        time,
        partySize: Number(partySize) || 2,
        mesa: mesa ? Number(mesa) : null,
        notes: notes.trim() || null,
      });
      setName(""); setPhone(""); setEmail(""); setDate(today()); setTime("20:00");
      setPartySize("2"); setMesa(""); setNotes("");
      setShowForm(false);
      toast.success("Reserva confirmada. Enviaremos el email automáticamente.");
    } catch (error) {
      toast.error(getFunctionErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (id: string, status: ReservationStatus) => {
    if (!user) return;
    try {
      setUpdatingId(id);
      const updateStatus = httpsCallable(functions, "updateReservationStatus");
      await updateStatus({ restaurantId, reservationId: id, status });
      toast.success(`Reserva actualizada a: ${STATUS_LABEL[status]}.`);
    } catch (error) {
      toast.error(getFunctionErrorMessage(error));
    } finally {
      setUpdatingId(null);
    }
  };

  const startReschedule = (reservation: Reservation) => {
    setRescheduleDraft({
      reservationId: reservation.id,
      date: reservation.date,
      time: reservation.slot || reservation.time,
    });
  };

  const saveReschedule = async () => {
    if (!rescheduleDraft || !user) return;
    try {
      setRescheduling(true);
      const reschedule = httpsCallable(functions, "rescheduleReservation");
      await reschedule({
        restaurantId,
        reservationId: rescheduleDraft.reservationId,
        date: rescheduleDraft.date,
        time: rescheduleDraft.time,
      });
      setViewDate(rescheduleDraft.date);
      setRescheduleDraft(null);
      toast.success("Reserva reprogramada y registrada en el historial.");
    } catch (error) {
      toast.error(getFunctionErrorMessage(error));
    } finally {
      setRescheduling(false);
    }
  };

  const saveSettings = async () => {
    try {
      setSettingsSaving(true);
      const save = httpsCallable(functions, "saveReservationSettings");
      await save({ restaurantId, settings: settingsDraft });
      toast.success("Capacidad por franja guardada.");
    } catch (error) {
      toast.error(getFunctionErrorMessage(error));
    } finally {
      setSettingsSaving(false);
    }
  };

  const searchPhoneHistory = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!historyPhone.trim()) return;
    try {
      setHistoryLoading(true);
      const getHistory = httpsCallable<
        { restaurantId: string; phone: string },
        ReservationHistoryResult
      >(functions, "getReservationHistoryByPhone");
      const result = await getHistory({
        restaurantId,
        phone: historyPhone.trim(),
      });
      setHistoryResult(result.data);
    } catch (error) {
      toast.error(getFunctionErrorMessage(error));
    } finally {
      setHistoryLoading(false);
    }
  };

  const active = reservations.filter((reservation) =>
    ["pending", "confirmed", "seated"].includes(reservation.status)
  );
  const completed = reservations.filter(
    (reservation) => reservation.status === "completed"
  );
  const closed = reservations.filter((reservation) =>
    ["cancelled", "no_show"].includes(reservation.status)
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Calendar size={18} className="text-zinc-600" />
          <h2 className="text-lg font-bold text-zinc-950">Reservas</h2>
          {active.length > 0 && (
            <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-xs font-bold text-white">{active.length}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={viewDate}
            onChange={(e) => setViewDate(e.target.value)}
            className="h-10 rounded-lg border border-zinc-200 px-3 text-sm"
          />
          <button
            onClick={() => {
              setDate(viewDate);
              setShowForm((v) => !v);
            }}
            className="flex h-10 items-center gap-1.5 rounded-lg bg-zinc-950 px-4 text-sm font-bold text-white"
          >
            <Plus size={15} /> Nueva
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {STATUS_ORDER.map((status) => {
          const count = reservations.filter(
            (reservation) => reservation.status === status
          ).length;
          return (
            <div
              key={status}
              className={`rounded-xl border px-3 py-2 ${STATUS_STYLE[status]}`}
            >
              <p className="text-xs font-semibold">{STATUS_LABEL[status]}</p>
              <p className="text-xl font-black">{count}</p>
            </div>
          );
        })}
      </div>

      <section className="rounded-xl border border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BarChart3 size={17} className="text-zinc-600" />
            <div>
              <h3 className="text-sm font-bold text-zinc-900">
                Métricas de reservas
              </h3>
              <p className="text-xs text-zinc-500">
                Reservas, cancelaciones y ausencias hasta hoy.
              </p>
            </div>
          </div>
          <div className="flex rounded-lg border border-zinc-200 bg-zinc-50 p-1">
            {([7, 30, 90] as MetricsRange[]).map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => setMetricsRange(days)}
                className={`rounded-md px-3 py-1.5 text-xs font-bold ${
                  metricsRange === days
                    ? "bg-zinc-950 text-white"
                    : "text-zinc-500 hover:text-zinc-900"
                }`}
              >
                {days} días
              </button>
            ))}
          </div>
        </div>

        {metricsLoading && !metrics ? (
          <p className="mt-4 text-sm text-zinc-500">Calculando métricas...</p>
        ) : metrics ? (
          <>
            <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
              {[
                {
                  label: "Reservas",
                  value: metrics.total,
                  detail: `${metrics.active} activas`,
                  style: "border-zinc-200 bg-zinc-50 text-zinc-950",
                },
                {
                  label: "Cancelaciones",
                  value: metrics.cancelled,
                  detail: `${metrics.cancellationRate}% del total`,
                  style: "border-red-200 bg-red-50 text-red-700",
                },
                {
                  label: "No-shows",
                  value: metrics.noShows,
                  detail: `${metrics.noShowRate}% del total`,
                  style: "border-orange-200 bg-orange-50 text-orange-700",
                },
                {
                  label: "Asistencia",
                  value: `${metrics.attendanceRate}%`,
                  detail: `${metrics.completed} finalizadas`,
                  style: "border-emerald-200 bg-emerald-50 text-emerald-700",
                },
              ].map((metric) => (
                <div
                  key={metric.label}
                  className={`rounded-xl border px-3 py-3 ${metric.style}`}
                >
                  <p className="text-xs font-semibold">{metric.label}</p>
                  <p className="text-2xl font-black">{metric.value}</p>
                  <p className="text-xs opacity-75">{metric.detail}</p>
                </div>
              ))}
            </div>

            <div className="mt-5 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={metrics.daily}
                  margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
                >
                  <CartesianGrid
                    stroke="#e4e4e7"
                    strokeDasharray="3 3"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="label"
                    stroke="#a1a1aa"
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                    minTickGap={18}
                  />
                  <YAxis
                    allowDecimals={false}
                    stroke="#a1a1aa"
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                  />
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      value,
                      name === "total"
                        ? "Reservas"
                        : name === "cancelled"
                          ? "Canceladas"
                          : "No-shows",
                    ]}
                    contentStyle={{
                      borderRadius: 12,
                      border: "1px solid #e4e4e7",
                      fontSize: 12,
                    }}
                  />
                  <Bar
                    dataKey="total"
                    fill="#27272a"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="cancelled"
                    fill="#ef4444"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="noShows"
                    fill="#f97316"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        ) : (
          <p className="mt-4 text-sm text-zinc-500">
            No se pudieron cargar las métricas.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-4">
        <div className="flex items-center gap-2">
          <History size={17} className="text-zinc-600" />
          <div>
            <h3 className="text-sm font-bold text-zinc-900">
              Historial por teléfono
            </h3>
            <p className="text-xs text-zinc-500">
              Encontrá visitas, cancelaciones y ausencias del cliente.
            </p>
          </div>
        </div>
        <form onSubmit={searchPhoneHistory} className="mt-3 flex gap-2">
          <div className="relative flex-1">
            <Phone
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
            />
            <input
              value={historyPhone}
              onChange={(event) => setHistoryPhone(event.target.value)}
              placeholder="Número telefónico"
              className="h-10 w-full rounded-lg border border-zinc-200 pl-9 pr-3 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={historyLoading || !historyPhone.trim()}
            className="flex h-10 items-center gap-1.5 rounded-lg bg-zinc-950 px-4 text-xs font-bold text-white disabled:opacity-50"
          >
            <Search size={14} />
            {historyLoading ? "Buscando..." : "Buscar"}
          </button>
          {historyResult && (
            <button
              type="button"
              onClick={() => {
                setHistoryResult(null);
                setHistoryPhone("");
              }}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500"
              aria-label="Cerrar historial"
            >
              <X size={15} />
            </button>
          )}
        </form>

        {historyResult && (
          <div className="mt-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["Reservas", historyResult.total],
                ["Finalizadas", historyResult.completed],
                ["Canceladas", historyResult.cancelled],
                ["Ausencias", historyResult.noShows],
              ].map(([label, value]) => (
                <div
                  key={String(label)}
                  className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2"
                >
                  <p className="text-xs font-semibold text-zinc-500">{label}</p>
                  <p className="text-lg font-black text-zinc-950">{value}</p>
                </div>
              ))}
            </div>

            {historyResult.reservations.length === 0 ? (
              <p className="mt-3 text-sm text-zinc-500">
                No hay reservas registradas para ese teléfono.
              </p>
            ) : (
              <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                {historyResult.reservations.map((reservation) => (
                  <div
                    key={reservation.id}
                    className="flex items-start justify-between gap-3 rounded-lg border border-zinc-200 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-zinc-900">
                        {reservation.name}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {reservation.date} · {reservation.time} ·{" "}
                        {reservation.partySize} personas
                        {reservation.mesa ? ` · Mesa ${reservation.mesa}` : ""}
                      </p>
                      {reservation.rescheduleCount > 0 && (
                        <p className="mt-1 text-xs font-semibold text-blue-600">
                          Reprogramada {reservation.rescheduleCount}{" "}
                          {reservation.rescheduleCount === 1 ? "vez" : "veces"}
                        </p>
                      )}
                    </div>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-bold ${
                        STATUS_STYLE[reservation.status] ||
                        "border-zinc-200 bg-zinc-100 text-zinc-600"
                      }`}
                    >
                      {STATUS_LABEL[reservation.status] || reservation.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <div className="rounded-xl border border-zinc-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-bold text-zinc-900">Capacidad por franja</h3>
            <p className="text-xs text-zinc-500">
              Las reservas se aceptan solo dentro de este horario y cupo.
            </p>
          </div>
          <button
            type="button"
            onClick={saveSettings}
            disabled={settingsSaving}
            className="rounded-lg bg-zinc-950 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
          >
            {settingsSaving ? "Guardando..." : "Guardar capacidad"}
          </button>
        </div>
        <div className="grid gap-2 sm:grid-cols-4">
          <label className="text-xs font-semibold text-zinc-600">
            Apertura
            <input
              type="time"
              value={settingsDraft.openTime}
              onChange={(event) =>
                setSettingsDraft((current) => ({
                  ...current,
                  openTime: event.target.value,
                }))
              }
              className="mt-1 h-10 w-full rounded-lg border border-zinc-200 px-3 text-sm"
            />
          </label>
          <label className="text-xs font-semibold text-zinc-600">
            Cierre
            <input
              type="time"
              value={settingsDraft.closeTime}
              onChange={(event) =>
                setSettingsDraft((current) => ({
                  ...current,
                  closeTime: event.target.value,
                }))
              }
              className="mt-1 h-10 w-full rounded-lg border border-zinc-200 px-3 text-sm"
            />
          </label>
          <label className="text-xs font-semibold text-zinc-600">
            Minutos por franja
            <select
              value={settingsDraft.slotMinutes}
              onChange={(event) =>
                setSettingsDraft((current) => ({
                  ...current,
                  slotMinutes: Number(event.target.value),
                }))
              }
              className="mt-1 h-10 w-full rounded-lg border border-zinc-200 px-3 text-sm"
            >
              {[15, 30, 45, 60, 90, 120].map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes} min
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-zinc-600">
            Personas por franja
            <input
              type="number"
              min={1}
              max={1000}
              value={settingsDraft.capacityPerSlot}
              onChange={(event) =>
                setSettingsDraft((current) => ({
                  ...current,
                  capacityPerSlot: Number(event.target.value),
                }))
              }
              className="mt-1 h-10 w-full rounded-lg border border-zinc-200 px-3 text-sm"
            />
          </label>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4">
        <p className="mb-3 text-xs font-bold uppercase tracking-wide text-zinc-500">
          Ocupación del {viewDate}
        </p>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {slots.map((slot) => {
            const used = occupancyBySlot.get(slot) || 0;
            const full = used >= settings.capacityPerSlot;
            return (
              <div
                key={slot}
                className={`min-w-[110px] rounded-lg border px-3 py-2 ${
                  full
                    ? "border-red-200 bg-red-50 text-red-700"
                    : "border-zinc-200 bg-zinc-50 text-zinc-700"
                }`}
              >
                <p className="text-sm font-bold">{slot}</p>
                <p className="text-xs">
                  {used}/{settings.capacityPerSlot} personas
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleAdd} className="rounded-xl border border-zinc-200 bg-white p-5 space-y-3">
          <h3 className="font-bold text-zinc-900">Nueva reserva</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre *" required className="h-10 rounded-lg border border-zinc-200 px-3 text-sm" />
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Teléfono *" required className="h-10 rounded-lg border border-zinc-200 px-3 text-sm" />
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email *" required className="h-10 rounded-lg border border-zinc-200 px-3 text-sm" />
            <input type="date" value={date} onChange={(e) => { setDate(e.target.value); setViewDate(e.target.value); }} className="h-10 rounded-lg border border-zinc-200 px-3 text-sm" />
            <select value={time} onChange={(e) => setTime(e.target.value)} className="h-10 rounded-lg border border-zinc-200 px-3 text-sm">
              {slots.map((slot) => {
                const remaining = Math.max(
                  0,
                  settings.capacityPerSlot - (occupancyBySlot.get(slot) || 0)
                );
                return (
                  <option key={slot} value={slot} disabled={remaining === 0}>
                    {slot} · {remaining} lugares
                  </option>
                );
              })}
            </select>
            <input type="number" min={1} max={100} value={partySize} onChange={(e) => setPartySize(e.target.value)} placeholder="Personas" className="h-10 rounded-lg border border-zinc-200 px-3 text-sm" />
            <select value={mesa} onChange={(e) => setMesa(e.target.value)} className="h-10 rounded-lg border border-zinc-200 px-3 text-sm">
              <option value="">Sin mesa asignada</option>
              {activeTables.map((table) => {
                const unavailable = reservedTablesForSelectedSlot.has(
                  table.numero
                );
                return (
                  <option
                    key={table.id}
                    value={table.numero}
                    disabled={unavailable}
                  >
                    Mesa {table.numero}
                    {unavailable ? " · ya reservada" : ""}
                  </option>
                );
              })}
            </select>
          </div>
          <p
            className={`text-xs font-semibold ${
              Number(partySize) > selectedSlotRemaining
                ? "text-red-600"
                : "text-emerald-600"
            }`}
          >
            Franja {time}: {selectedSlotRemaining} lugares disponibles.
          </p>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notas (opcional)" className="h-10 w-full rounded-lg border border-zinc-200 px-3 text-sm" />
          <div className="flex gap-2">
            <button type="submit" disabled={saving || Number(partySize) > selectedSlotRemaining || slots.length === 0} className="rounded-lg bg-zinc-950 px-5 py-2 text-sm font-bold text-white disabled:opacity-50">Guardar</button>
            <button type="button" onClick={() => setShowForm(false)} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-600">Cancelar</button>
          </div>
        </form>
      )}

      {/* Reservations list */}
      {active.length === 0 && !showForm ? (
        <p className="text-sm text-zinc-500">No hay reservas para este día.</p>
      ) : (
        <div className="space-y-2">
          {active.map((r) => (
            <div key={r.id} className="flex items-start gap-3 rounded-xl border border-zinc-200 bg-white p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100">
                <Clock size={16} className="text-zinc-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-bold text-zinc-950">{r.name}</p>
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${STATUS_STYLE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-3 text-xs text-zinc-500">
                  <span className="flex items-center gap-1"><Clock size={11} />{r.time}</span>
                  <span className="flex items-center gap-1"><Users size={11} />{r.partySize} personas</span>
                  {r.mesa && <span>Mesa {r.mesa}</span>}
                  {r.phone && <span>{r.phone}</span>}
                  {r.email && <span>{r.email}</span>}
                  {r.confirmation?.status === "pending" && (
                    <span className="font-semibold text-amber-600">Enviando confirmación...</span>
                  )}
                  {r.confirmation?.status === "sent" && (
                    <span className="font-semibold text-emerald-600">Confirmación enviada</span>
                  )}
                  {r.confirmation?.status === "failed" && (
                    <span className="font-semibold text-red-600">Error al enviar confirmación</span>
                  )}
                  {r.status === "confirmed" &&
                    (!r.reminder || r.reminder.status === "pending") && (
                    <span className="font-semibold text-blue-600">Recordatorio programado 2 h antes</span>
                  )}
                  {r.reminder?.status === "sending" && (
                    <span className="font-semibold text-blue-600">Enviando recordatorio...</span>
                  )}
                  {r.reminder?.status === "sent" && (
                    <span className="font-semibold text-emerald-600">Recordatorio enviado</span>
                  )}
                  {r.reminder?.status === "failed" && (
                    <span className="font-semibold text-red-600">Error al enviar recordatorio</span>
                  )}
                  {r.notes && <span className="italic">{r.notes}</span>}
                </div>
                {r.rescheduleHistory && r.rescheduleHistory.length > 0 && (
                  <details className="mt-2 text-xs text-zinc-500">
                    <summary className="cursor-pointer font-semibold text-zinc-600">
                      Historial de reprogramaciones ({r.rescheduleHistory.length})
                    </summary>
                    <div className="mt-2 space-y-1 border-l-2 border-zinc-200 pl-3">
                      {[...r.rescheduleHistory].reverse().map((entry, index) => (
                        <p key={`${entry.from.date}-${entry.from.time}-${index}`}>
                          {entry.from.date} {entry.from.time} → {entry.to.date}{" "}
                          {entry.to.time}
                        </p>
                      ))}
                    </div>
                  </details>
                )}
                {rescheduleDraft?.reservationId === r.id && (
                  <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
                    <p className="mb-2 text-xs font-bold text-blue-800">
                      Nueva fecha y horario
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <input
                        type="date"
                        min={today()}
                        value={rescheduleDraft.date}
                        onChange={(event) =>
                          setRescheduleDraft((current) =>
                            current
                              ? { ...current, date: event.target.value }
                              : current
                          )
                        }
                        className="h-9 rounded-lg border border-blue-200 bg-white px-3 text-sm"
                      />
                      <select
                        value={rescheduleDraft.time}
                        onChange={(event) =>
                          setRescheduleDraft((current) =>
                            current
                              ? { ...current, time: event.target.value }
                              : current
                          )
                        }
                        className="h-9 rounded-lg border border-blue-200 bg-white px-3 text-sm"
                      >
                        {slots.map((slot) => (
                          <option key={slot} value={slot}>
                            {slot}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={saveReschedule}
                        disabled={rescheduling}
                        className="h-9 rounded-lg bg-blue-700 px-3 text-xs font-bold text-white disabled:opacity-50"
                      >
                        {rescheduling ? "Guardando..." : "Confirmar"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setRescheduleDraft(null)}
                        disabled={rescheduling}
                        className="h-9 rounded-lg border border-blue-200 bg-white px-3 text-xs font-bold text-blue-700 disabled:opacity-50"
                      >
                        Cerrar
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-blue-700">
                      El cupo de la nueva franja se valida al confirmar.
                    </p>
                  </div>
                )}
              </div>
              <div className="flex shrink-0 flex-col gap-2">
                {(r.status === "pending" || r.status === "confirmed") && (
                  <button
                    type="button"
                    onClick={() => startReschedule(r)}
                    disabled={rescheduling}
                    className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-blue-700 disabled:opacity-50"
                  >
                    <CalendarClock size={14} /> Reprogramar
                  </button>
                )}
                <select
                  value=""
                  onChange={(event) =>
                    setStatus(r.id, event.target.value as ReservationStatus)
                  }
                  disabled={updatingId === r.id}
                  className="h-9 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-bold text-zinc-700 disabled:opacity-50"
                  aria-label={`Cambiar estado de la reserva de ${r.name}`}
                >
                  <option value="" disabled>
                    {updatingId === r.id ? "Actualizando..." : "Cambiar estado"}
                  </option>
                  {STATUS_TRANSITIONS[r.status].map((status) => (
                    <option key={status} value={status}>
                      {STATUS_ACTION_LABEL[status]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}

      {completed.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-400">Finalizadas ({completed.length})</p>
          <div className="space-y-1">
            {completed.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-lg border border-zinc-100 bg-zinc-50 px-4 py-2">
                <p className="text-sm text-zinc-500">{r.name} · {r.time} · {r.partySize}p</p>
                <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${STATUS_STYLE[r.status]}`}>
                  {STATUS_LABEL[r.status]}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {closed.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-400">Canceladas y ausentes ({closed.length})</p>
          <div className="space-y-1">
            {closed.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg border border-zinc-100 bg-zinc-50 px-4 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <p className="truncate text-sm text-zinc-400 line-through">{r.name} · {r.time} · {r.partySize}p</p>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-bold ${STATUS_STYLE[r.status]}`}>
                    {STATUS_LABEL[r.status]}
                  </span>
                </div>
                <select
                  value=""
                  onChange={(event) =>
                    setStatus(r.id, event.target.value as ReservationStatus)
                  }
                  disabled={updatingId === r.id}
                  className="h-8 shrink-0 rounded-lg border border-zinc-200 bg-white px-2 text-xs font-bold text-zinc-700 disabled:opacity-50"
                  aria-label={`Reactivar reserva de ${r.name}`}
                >
                  <option value="" disabled>
                    {updatingId === r.id ? "Actualizando..." : "Acciones"}
                  </option>
                  {STATUS_TRANSITIONS[r.status].map((status) => (
                    <option key={status} value={status}>
                      {STATUS_ACTION_LABEL[status]}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
