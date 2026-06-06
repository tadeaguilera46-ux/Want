import { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { Bell, Check, Clock, Plus, Users, X } from "lucide-react";
import { getDb } from "../lib/firebase";
import { toast } from "sonner";

type WaitlistEntry = {
  id: string;
  name: string;
  partySize: number;
  phone?: string;
  status: "waiting" | "notified" | "cancelled";
  arrivedAt: { seconds?: number; toMillis?: () => number } | number | null;
};

const db = getDb();

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
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [name, setName] = useState("");
  const [partySize, setPartySize] = useState("2");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

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

  const active = entries.filter((e) => e.status === "waiting" || e.status === "notified");
  const done = entries.filter((e) => e.status === "cancelled").slice(-5);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      setSaving(true);
      await addDoc(collection(db, "restaurants", restaurantId, "waitlist"), {
        name: name.trim(),
        partySize: Number(partySize) || 2,
        phone: phone.trim() || null,
        status: "waiting",
        arrivedAt: serverTimestamp(),
        restaurantId,
      });
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
    await updateDoc(doc(db, "restaurants", restaurantId, "waitlist", id), { status });
    if (status === "notified") toast.success("Mesa avisada.");
    if (status === "cancelled") toast.success("Entrada cancelada.");
  };

  const statusBadge: Record<WaitlistEntry["status"], string> = {
    waiting: "border-zinc-200 bg-zinc-100 text-zinc-700",
    notified: "border-emerald-200 bg-emerald-100 text-emerald-700",
    cancelled: "border-red-200 bg-red-100 text-red-600",
  };
  const statusLabel: Record<WaitlistEntry["status"], string> = {
    waiting: "Esperando",
    notified: "Avisado",
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
            placeholder="Teléfono (opcional)"
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
              className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-4"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-sm font-bold text-white">
                {idx + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-zinc-950 truncate">{entry.name}</p>
                <div className="flex flex-wrap items-center gap-2 mt-0.5">
                  <span className="text-xs text-zinc-500">{entry.partySize} personas</span>
                  {entry.phone && <span className="text-xs text-zinc-400">{entry.phone}</span>}
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
                    title="Mesa lista — avisar"
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                  >
                    <Bell size={14} />
                  </button>
                )}
                {entry.status === "notified" && (
                  <button
                    onClick={() => setStatus(entry.id, "cancelled")}
                    title="Marcar como sentado / cerrar"
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-600 hover:bg-zinc-100"
                  >
                    <Check size={14} />
                  </button>
                )}
                <button
                  onClick={() => setStatus(entry.id, "cancelled")}
                  title="Cancelar"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-500 hover:bg-red-100"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recent cancelled */}
      {done.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-400">Últimas canceladas</p>
          <div className="space-y-1">
            {done.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between rounded-lg border border-zinc-100 bg-zinc-50 px-4 py-2">
                <p className="text-sm text-zinc-500 line-through">{entry.name} · {entry.partySize}p</p>
                <p className="text-xs text-zinc-400">{fmtTime(entry)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
