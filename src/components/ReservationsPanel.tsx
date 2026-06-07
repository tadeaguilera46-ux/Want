import { useEffect, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
  where,
} from "firebase/firestore";
import { Calendar, Check, Clock, Plus, Users, X } from "lucide-react";
import { getDb } from "../lib/firebase";
import { toast } from "sonner";
import { useAuth } from "../lib/auth-context";
import { writeAuditLog } from "../lib/audit-logs";

type Reservation = {
  id: string;
  name: string;
  phone: string;
  email: string;
  date: string;
  time: string;
  partySize: number;
  mesa?: number;
  status: "pending" | "confirmed" | "cancelled";
  confirmation?: {
    channel: "email";
    status: "pending" | "sent" | "failed";
    sentAt?: unknown;
    error?: string | null;
  };
  notes?: string;
  createdAt?: unknown;
};

const db = getDb();

const today = () => new Date().toISOString().slice(0, 10);

export function ReservationsPanel({ restaurantId }: { restaurantId: string }) {
  const { user } = useAuth();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [viewDate, setViewDate] = useState(today());
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [date, setDate] = useState(today());
  const [time, setTime] = useState("20:00");
  const [partySize, setPartySize] = useState("2");
  const [mesa, setMesa] = useState("");
  const [notes, setNotes] = useState("");

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
      const reservationRef = doc(
        collection(db, "restaurants", restaurantId, "reservations")
      );
      const reservationData = {
        name: name.trim(),
        phone: phone.trim(),
        email: normalizedEmail,
        date,
        time,
        partySize: Number(partySize) || 2,
        mesa: mesa ? Number(mesa) : null,
        notes: notes.trim() || null,
        status: "confirmed",
        confirmation: {
          channel: "email",
          status: "pending",
          sentAt: null,
          error: null,
        },
        restaurantId,
        createdAt: serverTimestamp(),
      };
      const batch = writeBatch(db);
      batch.set(reservationRef, reservationData);
      writeAuditLog(batch, {
        restaurantId,
        action: "reserva_creada",
        actorUid: user.uid,
        actorEmail: user.email,
        actorRole: "admin",
        entityType: "reservation",
        entityId: reservationRef.id,
        mesa: mesa ? Number(mesa) : undefined,
        description: `Se creo reserva para ${name.trim()}`,
        changes: {
          before: { exists: false },
          after: {
            date,
            time,
            partySize: Number(partySize) || 2,
            status: "confirmed",
            confirmationStatus: "pending",
          },
        },
      });
      await batch.commit();
      setName(""); setPhone(""); setEmail(""); setDate(today()); setTime("20:00");
      setPartySize("2"); setMesa(""); setNotes("");
      setShowForm(false);
      toast.success("Reserva confirmada. Enviaremos el email automáticamente.");
    } catch {
      toast.error("No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (id: string, status: Reservation["status"]) => {
    if (!user) return;
    const reservation = reservations.find((current) => current.id === id);
    const batch = writeBatch(db);
    batch.update(doc(db, "restaurants", restaurantId, "reservations", id), {
      status,
    });
    writeAuditLog(batch, {
      restaurantId,
      action: "reserva_estado_actualizado",
      actorUid: user.uid,
      actorEmail: user.email,
      actorRole: "admin",
      entityType: "reservation",
      entityId: id,
      mesa: reservation?.mesa,
      description: `Se actualizo reserva ${id} a ${status}`,
      changes: {
        before: { status: reservation?.status ?? null },
        after: { status },
      },
    });
    await batch.commit();
  };

  const statusStyle: Record<Reservation["status"], string> = {
    pending: "border-amber-200 bg-amber-50 text-amber-700",
    confirmed: "border-emerald-200 bg-emerald-100 text-emerald-700",
    cancelled: "border-red-200 bg-red-100 text-red-600",
  };
  const statusLabel: Record<Reservation["status"], string> = {
    pending: "Pendiente",
    confirmed: "Confirmada",
    cancelled: "Cancelada",
  };

  const active = reservations.filter((r) => r.status !== "cancelled");
  const cancelled = reservations.filter((r) => r.status === "cancelled");

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
            onClick={() => setShowForm((v) => !v)}
            className="flex h-10 items-center gap-1.5 rounded-lg bg-zinc-950 px-4 text-sm font-bold text-white"
          >
            <Plus size={15} /> Nueva
          </button>
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
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-10 rounded-lg border border-zinc-200 px-3 text-sm" />
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-10 rounded-lg border border-zinc-200 px-3 text-sm" />
            <input type="number" min={1} max={30} value={partySize} onChange={(e) => setPartySize(e.target.value)} placeholder="Personas" className="h-10 rounded-lg border border-zinc-200 px-3 text-sm" />
            <input type="number" min={1} value={mesa} onChange={(e) => setMesa(e.target.value)} placeholder="Mesa (opcional)" className="h-10 rounded-lg border border-zinc-200 px-3 text-sm" />
          </div>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notas (opcional)" className="h-10 w-full rounded-lg border border-zinc-200 px-3 text-sm" />
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="rounded-lg bg-zinc-950 px-5 py-2 text-sm font-bold text-white disabled:opacity-50">Guardar</button>
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
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${statusStyle[r.status]}`}>{statusLabel[r.status]}</span>
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
                  {r.notes && <span className="italic">{r.notes}</span>}
                </div>
              </div>
              <div className="flex gap-1.5 shrink-0">
                {r.status === "pending" && (
                  <button onClick={() => setStatus(r.id, "confirmed")} className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" title="Confirmar">
                    <Check size={14} />
                  </button>
                )}
                <button onClick={() => setStatus(r.id, "cancelled")} className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-500 hover:bg-red-100" title="Cancelar">
                  <X size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {cancelled.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-400">Canceladas ({cancelled.length})</p>
          <div className="space-y-1">
            {cancelled.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-lg border border-zinc-100 bg-zinc-50 px-4 py-2">
                <p className="text-sm text-zinc-400 line-through">{r.name} · {r.time} · {r.partySize}p</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
