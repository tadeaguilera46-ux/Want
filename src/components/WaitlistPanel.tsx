import { useEffect, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { getApp } from "firebase/app";
import { getFunctions, httpsCallable } from "firebase/functions";
import { Bell, Check, Clock, Plus, Users, X } from "lucide-react";
import { getDb } from "../lib/firebase";
import { toast } from "sonner";
import { useAuth } from "../lib/auth-context";
import { writeAuditLog } from "../lib/audit-logs";

type WaitlistEntry = {
  id: string;
  name: string;
  partySize: number;
  phone?: string;
  status: "waiting" | "notified" | "seated" | "cancelled";
  notification?: {
    status?: "sending" | "sent" | "failed";
    channel?: "sms" | "whatsapp";
  };
  assignment?: {
    mesa?: number;
    sessionId?: string;
  };
  arrivedAt: { seconds?: number; toMillis?: () => number } | number | null;
};

type WaitlistTable = {
  id: string;
  numero: number;
  estado: "available" | "occupied" | "needs_cleaning";
  active: boolean;
  activeSessionId: string | null;
};

const db = getDb();
const functions = getFunctions(getApp(), "us-central1");

const getFunctionErrorMessage = (
  error: unknown,
  fallback = "No se pudo completar la operacion."
) => {
  if (
    error &&
    typeof error === "object" &&
    "details" in error &&
    typeof error.details === "string"
  ) {
    return error.details;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
};

const fmtTime = (entry: WaitlistEntry) => {
  const raw = entry.arrivedAt;
  if (!raw) return "—";
  const ms =
    typeof raw === "object" && "toMillis" in raw && raw.toMillis
      ? raw.toMillis()
      : typeof raw === "object" && "seconds" in raw && raw.seconds
        ? raw.seconds * 1000
        : Number(raw);
  return new Intl.DateTimeFormat("es-AR", { timeStyle: "short" }).format(new Date(ms));
};

const waitMins = (entry: WaitlistEntry) => {
  const raw = entry.arrivedAt;
  if (!raw) return 0;
  const ms =
    typeof raw === "object" && "toMillis" in raw && raw.toMillis
      ? raw.toMillis()
      : typeof raw === "object" && "seconds" in raw && raw.seconds
        ? raw.seconds * 1000
        : Number(raw);
  return Math.floor((Date.now() - ms) / 60000);
};

export function WaitlistPanel({ restaurantId }: { restaurantId: string }) {
  const { user } = useAuth();
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [name, setName] = useState("");
  const [partySize, setPartySize] = useState("2");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [notifyingId, setNotifyingId] = useState<string | null>(null);
  const [tables, setTables] = useState<WaitlistTable[]>([]);
  const [assignmentEntryId, setAssignmentEntryId] = useState<string | null>(null);
  const [selectedMesa, setSelectedMesa] = useState("");
  const [assigningId, setAssigningId] = useState<string | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, "restaurants", restaurantId, "waitlist"),
      orderBy("arrivedAt", "asc")
    );
    return onSnapshot(q, (snap) => {
      setEntries(
        snap.docs.map((d) => ({ id: d.id, ...d.data() }) as WaitlistEntry)
      );
    });
  }, [restaurantId]);

  useEffect(() => {
    return onSnapshot(
      collection(db, "restaurants", restaurantId, "mesas"),
      (snap) => {
        setTables(
          snap.docs.map((tableDoc) => {
            const data = tableDoc.data();
            return {
              id: tableDoc.id,
              numero:
                typeof data.numero === "number"
                  ? data.numero
                  : Number(tableDoc.id),
              estado:
                data.estado === "occupied" || data.estado === "needs_cleaning"
                  ? data.estado
                  : "available",
              active: data.active !== false,
              activeSessionId:
                typeof data.activeSessionId === "string"
                  ? data.activeSessionId
                  : null,
            };
          })
        );
      }
    );
  }, [restaurantId]);

  const active = entries.filter((e) => e.status === "waiting" || e.status === "notified");
  const done = entries
    .filter((e) => e.status === "seated" || e.status === "cancelled")
    .slice(-5);
  const availableTables = tables
    .filter(
      (table) =>
        table.active &&
        table.estado === "available" &&
        table.activeSessionId === null
    )
    .sort((a, b) => a.numero - b.numero);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !user) return;
    try {
      setSaving(true);
      const entryRef = doc(collection(db, "restaurants", restaurantId, "waitlist"));
      const entryData = {
        name: name.trim(),
        partySize: Number(partySize) || 2,
        phone: phone.trim() || null,
        status: "waiting",
        arrivedAt: serverTimestamp(),
        restaurantId,
      };
      const batch = writeBatch(db);
      batch.set(entryRef, entryData);
      writeAuditLog(batch, {
        restaurantId,
        action: "waitlist_creada",
        actorUid: user.uid,
        actorEmail: user.email,
        actorRole: "admin",
        entityType: "waitlist",
        entityId: entryRef.id,
        description: `Se agrego ${name.trim()} a lista de espera`,
        changes: {
          before: { exists: false },
          after: {
            partySize: Number(partySize) || 2,
            status: "waiting",
          },
        },
      });
      await batch.commit();
      setName("");
      setPhone("");
      setPartySize("2");
    } catch {
      toast.error("No se pudo agregar.");
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (id: string, status: WaitlistEntry["status"]) => {
    if (!user) return;
    const entry = entries.find((current) => current.id === id);
    if (status === "notified") {
      try {
        setNotifyingId(id);
        const notify = httpsCallable<
          { restaurantId: string; entryId: string },
          { ok: boolean; channel: "sms" | "whatsapp" }
        >(functions, "notifyWaitlistEntry");
        const result = await notify({ restaurantId, entryId: id });
        toast.success(
          result.data.channel === "whatsapp"
            ? "Aviso enviado por WhatsApp."
            : "Aviso enviado por SMS."
        );
      } catch (error) {
        toast.error(getFunctionErrorMessage(error, "No se pudo enviar el aviso."));
      } finally {
        setNotifyingId(null);
      }
      return;
    }

    const batch = writeBatch(db);
    batch.update(doc(db, "restaurants", restaurantId, "waitlist", id), { status });
    writeAuditLog(batch, {
      restaurantId,
      action: "waitlist_estado_actualizado",
      actorUid: user.uid,
      actorEmail: user.email,
      actorRole: "admin",
      entityType: "waitlist",
      entityId: id,
      description: `Se actualizo entrada ${id} a ${status}`,
      changes: {
        before: { status: entry?.status ?? null },
        after: { status },
      },
    });
    await batch.commit();
    if (status === "notified") toast.success("Mesa avisada.");
    if (status === "cancelled") toast.success("Entrada cancelada.");
  };

  const openAssignment = (entryId: string) => {
    setAssignmentEntryId(entryId);
    setSelectedMesa(
      availableTables.length > 0 ? String(availableTables[0].numero) : ""
    );
  };

  const assignTable = async (entryId: string) => {
    const mesa = Number(selectedMesa);
    if (!Number.isInteger(mesa)) {
      toast.error("Selecciona una mesa disponible.");
      return;
    }

    try {
      setAssigningId(entryId);
      const assign = httpsCallable<
        { restaurantId: string; entryId: string; mesa: number },
        { ok: boolean; mesa: number; sessionId: string }
      >(functions, "assignWaitlistEntryToTable");
      const result = await assign({ restaurantId, entryId, mesa });
      toast.success(`Mesa ${result.data.mesa} asignada.`);
      setAssignmentEntryId(null);
      setSelectedMesa("");
    } catch (error) {
      toast.error(getFunctionErrorMessage(error, "No se pudo asignar la mesa."));
    } finally {
      setAssigningId(null);
    }
  };

  const statusBadge: Record<WaitlistEntry["status"], string> = {
    waiting: "border-zinc-200 bg-zinc-100 text-zinc-700",
    notified: "border-emerald-200 bg-emerald-100 text-emerald-700",
    seated: "border-blue-200 bg-blue-100 text-blue-700",
    cancelled: "border-red-200 bg-red-100 text-red-600",
  };
  const statusLabel: Record<WaitlistEntry["status"], string> = {
    waiting: "Esperando",
    notified: "Avisado",
    seated: "Sentado",
    cancelled: "Cancelado",
  };

  return (
    <div className="space-y-6">
      {/* Form */}
      <div className="rounded-xl border border-zinc-200 bg-white p-5">
        <div className="mb-4 flex items-center gap-2">
          <Users size={18} className="text-zinc-700" />
          <h2 className="text-lg font-bold text-zinc-950">Lista de espera</h2>
          {active.length > 0 && (
            <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-xs font-bold text-white">
              {active.length}
            </span>
          )}
        </div>
        <form onSubmit={handleAdd} className="grid gap-2 sm:grid-cols-[1fr_80px_160px_auto]">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre del cliente"
            required
            className="h-11 rounded-lg border border-zinc-200 px-3 text-sm outline-none focus:ring-2 focus:ring-black/10"
          />
          <input
            type="number"
            min={1}
            max={30}
            value={partySize}
            onChange={(e) => setPartySize(e.target.value)}
            placeholder="Personas"
            className="h-11 rounded-lg border border-zinc-200 px-3 text-center text-sm font-bold outline-none focus:ring-2 focus:ring-black/10"
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+549... (para avisar)"
            className="h-11 rounded-lg border border-zinc-200 px-3 text-sm outline-none focus:ring-2 focus:ring-black/10"
          />
          <button
            type="submit"
            disabled={saving}
            className="flex h-11 items-center gap-1.5 rounded-lg bg-zinc-950 px-4 font-bold text-white disabled:opacity-50"
          >
            <Plus size={16} /> Agregar
          </button>
        </form>
      </div>

      {/* Active list */}
      {active.length === 0 ? (
        <p className="text-sm text-zinc-500">No hay clientes en espera.</p>
      ) : (
        <div className="space-y-2">
          {active.map((entry, idx) => (
            <div
              key={entry.id}
              className="rounded-xl border border-zinc-200 bg-white p-4"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-sm font-bold text-white">
                  {idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-zinc-950 truncate">{entry.name}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-0.5">
                    <span className="text-xs text-zinc-500">{entry.partySize} personas</span>
                    {entry.phone && <span className="text-xs text-zinc-400">{entry.phone}</span>}
                    {entry.notification?.status === "sent" && (
                      <span className="text-xs font-semibold text-emerald-600">
                        {entry.notification.channel === "whatsapp"
                          ? "WhatsApp enviado"
                          : "SMS enviado"}
                      </span>
                    )}
                    <span className="flex items-center gap-1 text-xs text-zinc-400">
                      <Clock size={11} /> {fmtTime(entry)} · {waitMins(entry)} min
                    </span>
                  </div>
                </div>
                <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-bold ${statusBadge[entry.status]}`}>
                  {statusLabel[entry.status]}
                </span>
                <div className="flex gap-1.5 shrink-0">
                  {entry.status === "waiting" && (
                    <button
                      onClick={() => setStatus(entry.id, "notified")}
                      disabled={notifyingId === entry.id}
                      title={
                        entry.phone
                          ? "Mesa lista — enviar aviso"
                          : "Agregá un teléfono con código de país"
                      }
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                    >
                      <Bell
                        size={14}
                        className={notifyingId === entry.id ? "animate-pulse" : ""}
                      />
                    </button>
                  )}
                  <button
                    onClick={() => openAssignment(entry.id)}
                    title="Asignar mesa"
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-600 hover:bg-zinc-100"
                  >
                    <Check size={14} />
                  </button>
                  <button
                    onClick={() => setStatus(entry.id, "cancelled")}
                    title="Cancelar"
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-500 hover:bg-red-100"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
              {assignmentEntryId === entry.id && (
                <div className="mt-3 flex items-center justify-end gap-2 border-t border-zinc-100 pt-3">
                  <select
                    value={selectedMesa}
                    onChange={(event) => setSelectedMesa(event.target.value)}
                    disabled={assigningId === entry.id || availableTables.length === 0}
                    className="h-9 rounded-lg border border-zinc-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-black/10 disabled:opacity-50"
                  >
                    {availableTables.length === 0 ? (
                      <option value="">No hay mesas disponibles</option>
                    ) : (
                      availableTables.map((table) => (
                        <option key={table.id} value={table.numero}>
                          Mesa {table.numero}
                        </option>
                      ))
                    )}
                  </select>
                  <button
                    type="button"
                    onClick={() => setAssignmentEntryId(null)}
                    disabled={assigningId === entry.id}
                    className="h-9 rounded-lg border border-zinc-200 px-3 text-sm font-semibold text-zinc-600 disabled:opacity-50"
                  >
                    Volver
                  </button>
                  <button
                    type="button"
                    onClick={() => assignTable(entry.id)}
                    disabled={assigningId === entry.id || availableTables.length === 0}
                    className="h-9 rounded-lg bg-zinc-950 px-3 text-sm font-bold text-white disabled:opacity-50"
                  >
                    {assigningId === entry.id ? "Asignando..." : "Asignar mesa"}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Recent cancelled */}
      {done.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-400">Ultimas cerradas</p>
          <div className="space-y-1">
            {done.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between rounded-lg border border-zinc-100 bg-zinc-50 px-4 py-2">
                <p className={`text-sm text-zinc-500 ${entry.status === "cancelled" ? "line-through" : ""}`}>
                  {entry.name} · {entry.partySize}p
                  {entry.assignment?.mesa ? ` · Mesa ${entry.assignment.mesa}` : ""}
                  {entry.status === "seated" ? " · Sentado" : ""}
                </p>
                <p className="text-xs text-zinc-400">{fmtTime(entry)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
