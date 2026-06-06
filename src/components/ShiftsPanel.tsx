import { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { Clock, LogIn, LogOut, Users } from "lucide-react";
import { getDb } from "../lib/firebase";
import { toast } from "sonner";
import { useAuth } from "../lib/auth-context";

type Shift = {
  id: string;
  staffId: string;
  staffEmail: string;
  role: string;
  startedAt: { seconds?: number; toMillis?: () => number } | number | null;
  endedAt: { seconds?: number; toMillis?: () => number } | number | null;
  restaurantId: string;
};

const db = getDb();

const toMs = (v: Shift["startedAt"]): number => {
  if (!v) return 0;
  if (typeof v === "object" && "toMillis" in v && v.toMillis) return v.toMillis();
  if (typeof v === "object" && "seconds" in v && v.seconds) return v.seconds * 1000;
  return Number(v);
};

const fmt = (v: Shift["startedAt"]) => {
  const ms = toMs(v);
  return ms ? new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(new Date(ms)) : "—";
};

const duration = (s: Shift) => {
  const start = toMs(s.startedAt);
  const end = toMs(s.endedAt) || Date.now();
  if (!start) return "—";
  const mins = Math.floor((end - start) / 60000);
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
};

export function ShiftsPanel({ restaurantId }: { restaurantId: string }) {
  const { user } = useAuth();
  const [activeShifts, setActiveShifts] = useState<Shift[]>([]);
  const [recentShifts, setRecentShifts] = useState<Shift[]>([]);
  const [myOpenShift, setMyOpenShift] = useState<Shift | null>(null);
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    const q = query(
      collection(db, "restaurants", restaurantId, "shifts"),
      where("endedAt", "==", null),
      orderBy("startedAt", "desc")
    );
    return onSnapshot(q, (snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Shift);
      setActiveShifts(all);
      setMyOpenShift(user ? (all.find((s) => s.staffId === user.uid) ?? null) : null);
    });
  }, [restaurantId, user]);

  useEffect(() => {
    const load = async () => {
      const q = query(
        collection(db, "restaurants", restaurantId, "shifts"),
        where("endedAt", "!=", null),
        orderBy("endedAt", "desc"),
        limit(20)
      );
      const snap = await getDocs(q);
      setRecentShifts(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Shift));
    };
    load();
  }, [restaurantId]);

  const handleStart = async () => {
    if (!user) return;
    try {
      setStarting(true);
      await addDoc(collection(db, "restaurants", restaurantId, "shifts"), {
        staffId: user.uid,
        staffEmail: user.email ?? "",
        role: "staff",
        startedAt: serverTimestamp(),
        endedAt: null,
        restaurantId,
      });
      toast.success("Turno iniciado.");
    } catch {
      toast.error("No se pudo iniciar el turno.");
    } finally {
      setStarting(false);
    }
  };

  const handleEnd = async () => {
    if (!myOpenShift) return;
    try {
      setEnding(true);
      await updateDoc(doc(db, "restaurants", restaurantId, "shifts", myOpenShift.id), {
        endedAt: serverTimestamp(),
      });
      toast.success("Turno cerrado.");
    } catch {
      toast.error("No se pudo cerrar el turno.");
    } finally {
      setEnding(false);
    }
  };

  const handleEndOther = async (shift: Shift) => {
    await updateDoc(doc(db, "restaurants", restaurantId, "shifts", shift.id), {
      endedAt: serverTimestamp(),
    });
    toast.success(`Turno de ${shift.staffEmail} cerrado.`);
  };

  return (
    <div className="space-y-6">
      {/* My shift */}
      <div className="rounded-xl border border-zinc-200 bg-white p-5">
        <div className="mb-4 flex items-center gap-2">
          <Clock size={18} className="text-zinc-600" />
          <h2 className="text-lg font-bold text-zinc-950">Mi turno</h2>
        </div>
        {myOpenShift ? (
          <div className="flex items-center justify-between gap-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <div>
              <p className="font-bold text-emerald-800">Turno activo</p>
              <p className="text-sm text-emerald-700">
                Iniciado: {fmt(myOpenShift.startedAt)} · {duration(myOpenShift)}
              </p>
            </div>
            <button
              onClick={handleEnd}
              disabled={ending}
              className="flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              <LogOut size={15} /> Terminar turno
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
            <p className="text-sm text-zinc-600">No tenés un turno activo.</p>
            <button
              onClick={handleStart}
              disabled={starting}
              className="flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              <LogIn size={15} /> Iniciar turno
            </button>
          </div>
        )}
      </div>

      {/* Active shifts */}
      {activeShifts.length > 0 && (
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="mb-3 flex items-center gap-2">
            <Users size={16} className="text-zinc-500" />
            <h3 className="font-bold text-zinc-950">Turnos activos ahora ({activeShifts.length})</h3>
          </div>
          <div className="space-y-2">
            {activeShifts.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3">
                <div>
                  <p className="text-sm font-bold text-zinc-950">{s.staffEmail}</p>
                  <p className="text-xs text-zinc-500">Desde {fmt(s.startedAt)} · {duration(s)}</p>
                </div>
                {s.staffId !== user?.uid && (
                  <button onClick={() => handleEndOther(s)} className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-100">
                    Cerrar turno
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent closed shifts */}
      {recentShifts.length > 0 && (
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <h3 className="mb-3 font-bold text-zinc-950">Últimos turnos cerrados</h3>
          <div className="space-y-2">
            {recentShifts.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg border border-zinc-100 bg-zinc-50 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-800">{s.staffEmail}</p>
                  <p className="text-xs text-zinc-500">{fmt(s.startedAt)} → {fmt(s.endedAt)}</p>
                </div>
                <span className="text-sm font-bold text-zinc-700">{duration(s)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
