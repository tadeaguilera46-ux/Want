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
import { Calendar, Clock, Plus, Users } from "lucide-react";
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
  createdAt?: unknown;
};

type ReservationSettings = {
  openTime: string;
  closeTime: string;
  slotMinutes: number;
  capacityPerSlot: number;
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
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settings, setSettings] =
    useState<ReservationSettings>(DEFAULT_SETTINGS);
  const [settingsDraft, setSettingsDraft] =
    useState<ReservationSettings>(DEFAULT_SETTINGS);

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
    if (slots.length > 0 && !slots.includes(time)) {
      setTime(slots[0]);
    }
  }, [slots, time]);

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
            <input type="number" min={1} value={mesa} onChange={(e) => setMesa(e.target.value)} placeholder="Mesa (opcional)" className="h-10 rounded-lg border border-zinc-200 px-3 text-sm" />
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
              </div>
              <select
                value=""
                onChange={(event) =>
                  setStatus(r.id, event.target.value as ReservationStatus)
                }
                disabled={updatingId === r.id}
                className="h-9 shrink-0 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-bold text-zinc-700 disabled:opacity-50"
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
