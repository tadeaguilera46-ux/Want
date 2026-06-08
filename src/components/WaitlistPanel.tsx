import { useEffect, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { getApp } from "firebase/app";
import { getFunctions, httpsCallable } from "firebase/functions";
import { Check, Clock, MessageCircle, Plus, Users } from "lucide-react";
import { getDb } from "../lib/firebase";
import { toast } from "sonner";
import { useAuth } from "../lib/auth-context";
import {
  buildWaitlistWhatsAppUrl,
  DEFAULT_WAITLIST_WHATSAPP_MESSAGE,
  isMobileWhatsAppDevice,
  normalizeWhatsAppPhone,
  renderWaitlistWhatsAppMessage,
} from "../lib/waitlist-whatsapp";

type WaitlistStatus =
  | "waiting"
  | "notified"
  | "seated"
  | "cancelled"
  | "abandoned"
  | "no_response";

type WaitlistClosureStatus = "cancelled" | "abandoned" | "no_response";

type WaitlistTimestamp = {
  seconds?: number;
  toMillis?: () => number;
};

type WaitlistEntry = {
  id: string;
  name: string;
  partySize: number;
  phone?: string;
  status: WaitlistStatus;
  notification?: {
    status?: "manual";
    channel?: "whatsapp";
  };
  assignment?: {
    mesa?: number;
    sessionId?: string;
    assignedAt?: WaitlistTimestamp | number | null;
  };
  arrivedAt: WaitlistTimestamp | number | null;
  closedAt?: WaitlistTimestamp | number | null;
  seatedAt?: WaitlistTimestamp | number | null;
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

const timestampMillis = (
  raw: WaitlistTimestamp | number | null | undefined
) => {
  if (!raw) return 0;
  if (typeof raw === "number") return raw;
  if (typeof raw.toMillis === "function") return raw.toMillis();
  return typeof raw.seconds === "number" ? raw.seconds * 1000 : 0;
};

export function WaitlistPanel({ restaurantId }: { restaurantId: string }) {
  const { user } = useAuth();
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [name, setName] = useState("");
  const [partySize, setPartySize] = useState("2");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [openedWhatsAppIds, setOpenedWhatsAppIds] = useState<string[]>([]);
  const [whatsAppFallbacks, setWhatsAppFallbacks] = useState<
    Record<string, string>
  >({});
  const [markingNotifiedId, setMarkingNotifiedId] = useState<string | null>(null);
  const [restaurantName, setRestaurantName] = useState("el restaurante");
  const [messageTemplate, setMessageTemplate] = useState(
    DEFAULT_WAITLIST_WHATSAPP_MESSAGE
  );
  const [tables, setTables] = useState<WaitlistTable[]>([]);
  const [assignmentEntryId, setAssignmentEntryId] = useState<string | null>(null);
  const [selectedMesa, setSelectedMesa] = useState("");
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    setEntries([]);
    const q = query(
      collection(db, "restaurants", restaurantId, "waitlist"),
      orderBy("arrivedAt", "asc")
    );
    return onSnapshot(
      q,
      (snap) => {
        setEntries(
          snap.docs.map((d) => ({ id: d.id, ...d.data() }) as WaitlistEntry)
        );
      },
      () => {
        setEntries([]);
        toast.error("No se pudo cargar la lista de espera.");
      }
    );
  }, [restaurantId]);

  useEffect(() => {
    return onSnapshot(doc(db, "restaurants", restaurantId), (snapshot) => {
      const data = snapshot.data();
      const waitlistWhatsApp = data?.waitlistWhatsApp;
      setRestaurantName(
        typeof data?.name === "string" && data.name.trim()
          ? data.name.trim()
          : "el restaurante"
      );
      setMessageTemplate(
        typeof waitlistWhatsApp?.messageTemplate === "string" &&
          waitlistWhatsApp.messageTemplate.trim()
          ? waitlistWhatsApp.messageTemplate
          : DEFAULT_WAITLIST_WHATSAPP_MESSAGE
      );
    });
  }, [restaurantId]);

  useEffect(() => {
    setTables([]);
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
      },
      () => {
        setTables([]);
        toast.error("No se pudieron cargar las mesas.");
      }
    );
  }, [restaurantId]);

  const active = entries.filter((e) => e.status === "waiting" || e.status === "notified");
  const done = entries
    .filter((e) =>
      ["seated", "cancelled", "abandoned", "no_response"].includes(e.status)
    )
    .sort(
      (a, b) =>
        timestampMillis(
          b.closedAt ?? b.seatedAt ?? b.assignment?.assignedAt ?? b.arrivedAt
        ) -
        timestampMillis(
          a.closedAt ?? a.seatedAt ?? a.assignment?.assignedAt ?? a.arrivedAt
        )
    )
    .slice(0, 5);
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
    const normalizedPartySize = Number(partySize);
    if (
      !Number.isInteger(normalizedPartySize) ||
      normalizedPartySize < 1 ||
      normalizedPartySize > 30
    ) {
      toast.error("La cantidad de personas debe estar entre 1 y 30.");
      return;
    }
    try {
      setSaving(true);
      const createEntry = httpsCallable<
        {
          restaurantId: string;
          name: string;
          partySize: number;
          phone: string;
        },
        { ok: boolean; entryId: string }
      >(functions, "createWaitlistEntry");
      await createEntry({
        restaurantId,
        name: name.trim(),
        partySize: normalizedPartySize,
        phone: phone.trim(),
      });
      setName("");
      setPhone("");
      setPartySize("2");
    } catch (error) {
      toast.error(getFunctionErrorMessage(error, "No se pudo agregar."));
    } finally {
      setSaving(false);
    }
  };

  const openWhatsApp = (entry: WaitlistEntry) => {
    const normalizedPhone = normalizeWhatsAppPhone(entry.phone);
    if (!normalizedPhone) {
      toast.error(
        "El telefono del cliente no es valido. Usa codigo de pais o un numero argentino completo."
      );
      return;
    }

    const message = renderWaitlistWhatsAppMessage(messageTemplate, {
      customerName: entry.name,
      restaurantName,
      partySize: entry.partySize,
      tableName: entry.assignment?.mesa
        ? `Mesa ${entry.assignment.mesa}`
        : "a confirmar",
      waitMinutes: waitMins(entry),
    });
    const url = buildWaitlistWhatsAppUrl({
      phone: normalizedPhone,
      message,
      isMobile: isMobileWhatsAppDevice(window.navigator.userAgent),
    });
    const openedWindow = window.open(url, "_blank");
    if (!openedWindow) {
      setWhatsAppFallbacks((current) => ({ ...current, [entry.id]: url }));
      toast.error("El navegador bloqueo la nueva pestaña.");
      return;
    }
    openedWindow.opener = null;
    setWhatsAppFallbacks((current) => {
      const next = { ...current };
      delete next[entry.id];
      return next;
    });
    setOpenedWhatsAppIds((current) =>
      current.includes(entry.id) ? current : [...current, entry.id]
    );
    toast.success("WhatsApp abierto. Marca la entrada como avisada al enviarlo.");
  };

  const markNotified = async (id: string) => {
    if (!user) return;

    try {
      setMarkingNotifiedId(id);
      const mark = httpsCallable<
        { restaurantId: string; entryId: string },
        { ok: boolean }
      >(functions, "markWaitlistEntryNotified");
      await mark({ restaurantId, entryId: id });
      setOpenedWhatsAppIds((current) => current.filter((entryId) => entryId !== id));
      setWhatsAppFallbacks((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      toast.success("Entrada marcada como avisada.");
    } catch (error) {
      toast.error(
        getFunctionErrorMessage(error, "No se pudo marcar la entrada como avisada.")
      );
    } finally {
      setMarkingNotifiedId(null);
    }
  };

  const setStatus = async (id: string, status: WaitlistClosureStatus) => {
    if (!user) return;
    try {
      setUpdatingId(id);
      const closeEntry = httpsCallable<
        {
          restaurantId: string;
          entryId: string;
          status: WaitlistClosureStatus;
        },
        { ok: boolean; status: WaitlistClosureStatus }
      >(functions, "closeWaitlistEntry");
      const result = await closeEntry({ restaurantId, entryId: id, status });
      if (assignmentEntryId === id) {
        setAssignmentEntryId(null);
        setSelectedMesa("");
      }
      toast.success(`Estado actualizado: ${statusLabel[result.data.status]}.`);
    } catch (error) {
      toast.error(
        getFunctionErrorMessage(error, "No se pudo actualizar el estado.")
      );
    } finally {
      setUpdatingId(null);
    }
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

  const statusBadge: Record<WaitlistStatus, string> = {
    waiting: "border-zinc-200 bg-zinc-100 text-zinc-700",
    notified: "border-emerald-200 bg-emerald-100 text-emerald-700",
    seated: "border-blue-200 bg-blue-100 text-blue-700",
    cancelled: "border-red-200 bg-red-100 text-red-600",
    abandoned: "border-orange-200 bg-orange-100 text-orange-700",
    no_response: "border-amber-200 bg-amber-100 text-amber-700",
  };
  const statusLabel: Record<WaitlistStatus, string> = {
    waiting: "Esperando",
    notified: "Avisado",
    seated: "Sentado",
    cancelled: "Canceló",
    abandoned: "Abandonó",
    no_response: "No respondió",
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
                    {entry.notification?.status === "manual" && (
                      <span className="text-xs font-semibold text-emerald-600">
                        Avisada por WhatsApp
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
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  {entry.status === "waiting" && (
                    openedWhatsAppIds.includes(entry.id) ? (
                      <button
                        onClick={() => markNotified(entry.id)}
                        disabled={
                          markingNotifiedId === entry.id ||
                          assigningId === entry.id ||
                          updatingId === entry.id
                        }
                        className="flex h-8 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                      >
                        <Check size={14} />
                        {markingNotifiedId === entry.id
                          ? "Marcando..."
                          : "Marcar avisada"}
                      </button>
                    ) : (
                      <button
                        onClick={() => openWhatsApp(entry)}
                        disabled={
                          assigningId === entry.id ||
                          updatingId === entry.id ||
                          markingNotifiedId === entry.id
                        }
                        title="Abrir aviso manual en WhatsApp"
                        className="flex h-8 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                      >
                        <MessageCircle size={14} />
                        Avisar por WhatsApp
                      </button>
                    )
                  )}
                  <button
                    onClick={() => openAssignment(entry.id)}
                    disabled={
                      assigningId === entry.id ||
                      updatingId === entry.id ||
                      markingNotifiedId === entry.id
                    }
                    title="Asignar mesa"
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-600 hover:bg-zinc-100 disabled:opacity-50"
                  >
                    <Check size={14} />
                  </button>
                  <select
                    value=""
                    onChange={(event) => {
                      const status = event.target.value as WaitlistClosureStatus;
                      if (status) void setStatus(entry.id, status);
                    }}
                    disabled={
                      updatingId === entry.id ||
                      assigningId === entry.id ||
                      markingNotifiedId === entry.id
                    }
                    aria-label={`Cerrar registro de ${entry.name}`}
                    className="h-8 rounded-lg border border-zinc-200 bg-zinc-50 px-2 text-xs font-semibold text-zinc-600 outline-none hover:bg-zinc-100 disabled:opacity-50"
                  >
                    <option value="">Cerrar como...</option>
                    <option value="cancelled">Canceló</option>
                    <option value="abandoned">Abandonó</option>
                    {entry.status === "notified" && (
                      <option value="no_response">No respondió</option>
                    )}
                  </select>
                </div>
              </div>
              {assignmentEntryId === entry.id && (
                <div className="mt-3 flex items-center justify-end gap-2 border-t border-zinc-100 pt-3">
                  <select
                    value={selectedMesa}
                    onChange={(event) => setSelectedMesa(event.target.value)}
                    disabled={
                      assigningId === entry.id ||
                      updatingId === entry.id ||
                      markingNotifiedId === entry.id ||
                      availableTables.length === 0
                    }
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
                    disabled={
                      assigningId === entry.id ||
                      updatingId === entry.id ||
                      markingNotifiedId === entry.id ||
                      availableTables.length === 0
                    }
                    className="h-9 rounded-lg bg-zinc-950 px-3 text-sm font-bold text-white disabled:opacity-50"
                  >
                    {assigningId === entry.id ? "Asignando..." : "Asignar mesa"}
                  </button>
                </div>
              )}
              {whatsAppFallbacks[entry.id] && (
                <div className="mt-3 border-t border-zinc-100 pt-3 text-right">
                  <a
                    href={whatsAppFallbacks[entry.id]}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      setOpenedWhatsAppIds((current) =>
                        current.includes(entry.id)
                          ? current
                          : [...current, entry.id]
                      );
                      setWhatsAppFallbacks((current) => {
                        const next = { ...current };
                        delete next[entry.id];
                        return next;
                      });
                    }}
                    className="text-sm font-bold text-emerald-700 underline underline-offset-2"
                  >
                    Abrir WhatsApp Web
                  </a>
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
                <div>
                  <p className="text-sm text-zinc-600">
                    {entry.name} · {entry.partySize}p
                    {entry.assignment?.mesa ? ` · Mesa ${entry.assignment.mesa}` : ""}
                  </p>
                  <p className="text-xs text-zinc-400">{fmtTime(entry)}</p>
                </div>
                <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${statusBadge[entry.status]}`}>
                  {statusLabel[entry.status]}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
