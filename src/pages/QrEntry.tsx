import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, AlertTriangle } from "lucide-react";
import { collection, doc, getDoc, getDocs, limit, query } from "firebase/firestore";
import { getOrCreateMesaSession } from "../lib/mesas";
import { parseTableNumber, resolveRuntimeContext } from "../lib/runtime-context";
import {
  getStoredTableSessionId,
  saveTableSessionId,
} from "../lib/table-session";
import { useCart } from "@/lib/CartContext";
import { auth, getDb } from "@/lib/firebase";

const db = getDb();

// DIAGNÓSTICO TEMPORAL — remover después de identificar el error
async function diagQrPaths(restaurantId: string, tableNumber: number) {
  const user = auth.currentUser;
  console.log("[DIAG] auth state:", user
    ? `signed-in uid=${user.uid} anonymous=${user.isAnonymous}`
    : "anonymous (not signed in)");

  const paths: Array<{ label: string; fn: () => Promise<string> }> = [
    {
      label: `restaurants/${restaurantId}`,
      fn: async () => {
        const snap = await getDoc(doc(db, "restaurants", restaurantId));
        return snap.exists() ? "exists" : "not found";
      },
    },
    {
      label: `restaurants/${restaurantId}/public/branding`,
      fn: async () => {
        const snap = await getDoc(doc(db, "restaurants", restaurantId, "public", "branding"));
        return snap.exists() ? `exists name="${snap.data()?.name}"` : "not found";
      },
    },
    {
      label: `restaurants/${restaurantId}/mesas/${tableNumber}`,
      fn: async () => {
        const snap = await getDoc(doc(db, "restaurants", restaurantId, "mesas", String(tableNumber)));
        if (!snap.exists()) return "not found";
        const d = snap.data();
        return `exists estado=${d?.estado} activeSessionId=${d?.activeSessionId ?? "null"}`;
      },
    },
    {
      label: `restaurants/${restaurantId}/menu (limit 1)`,
      fn: async () => {
        const snap = await getDocs(query(collection(db, "restaurants", restaurantId, "menu"), limit(1)));
        return `ok (${snap.size} doc(s))`;
      },
    },
  ];

  for (const { label, fn } of paths) {
    try {
      const result = await fn();
      console.log(`[DIAG] ✅ ${label}: ${result}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[DIAG] ❌ ${label}: FAILED — ${msg}`);
    }
  }

  // Si la mesa tiene activeSessionId, probamos leer esa sesión también
  try {
    const mesaSnap = await getDoc(doc(db, "restaurants", restaurantId, "mesas", String(tableNumber)));
    const activeSessionId = mesaSnap.data()?.activeSessionId;
    if (activeSessionId) {
      try {
        const sessionSnap = await getDoc(doc(db, "restaurants", restaurantId, "sessions", activeSessionId));
        console.log(`[DIAG] ✅ sessions/${activeSessionId}: ${sessionSnap.exists() ? "exists" : "not found"}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[DIAG] ❌ sessions/${activeSessionId}: FAILED — ${msg}`);
      }
    }
  } catch {
    // mesa read already logged above
  }
}

const QrEntry = () => {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { clearCart } = useCart();

  const { table, restaurantId } = resolveRuntimeContext({
    searchParams,
    location,
  });

  const tableNumber = parseTableNumber(table);

  const [error, setError] = useState<string | null>(null);
  const [diagLines, setDiagLines] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        setError(null);

        const lines: string[] = [];
        const log = (line: string) => { lines.push(line); setDiagLines([...lines]); };

        const user = auth.currentUser;
        log(`auth: ${user ? `signed-in uid=${user.uid.slice(0,8)}… anon=${user.isAnonymous}` : "anonymous"}`);

        await diagQrPaths(restaurantId, tableNumber);

        // Reproduce los checks clave en pantalla
        const checks: Array<{ label: string; fn: () => Promise<string> }> = [
          { label: `restaurants/${restaurantId}`, fn: async () => { const s = await getDoc(doc(db, "restaurants", restaurantId)); return s.exists() ? "✅ exists" : "⚠️ not found"; } },
          { label: `public/branding`, fn: async () => { const s = await getDoc(doc(db, "restaurants", restaurantId, "public", "branding")); return s.exists() ? `✅ name="${s.data()?.name}"` : "⚠️ not found"; } },
          { label: `mesas/${tableNumber}`, fn: async () => { const s = await getDoc(doc(db, "restaurants", restaurantId, "mesas", String(tableNumber))); if (!s.exists()) return "⚠️ not found"; const d = s.data(); return `✅ estado=${d?.estado} session=${d?.activeSessionId ?? "null"}`; } },
          { label: `menu (limit 1)`, fn: async () => { const s = await getDocs(query(collection(db, "restaurants", restaurantId, "menu"), limit(1))); return `✅ ${s.size} doc(s)`; } },
        ];

        for (const { label, fn } of checks) {
          try { log(`${label}: ${await fn()}`); }
          catch (e) { log(`${label}: ❌ ${e instanceof Error ? e.message : String(e)}`); }
        }

        // Si mesa tiene activeSessionId, probamos leer esa sesión
        try {
          const mesaSnap = await getDoc(doc(db, "restaurants", restaurantId, "mesas", String(tableNumber)));
          const sid = mesaSnap.data()?.activeSessionId;
          if (sid) {
            try { const ss = await getDoc(doc(db, "restaurants", restaurantId, "sessions", sid)); log(`sessions/${sid.slice(0,8)}…: ${ss.exists() ? "✅ exists" : "⚠️ not found"}`); }
            catch (e) { log(`sessions/${sid.slice(0,8)}…: ❌ ${e instanceof Error ? e.message : String(e)}`); }
          } else { log("sessions: no activeSessionId en mesa"); }
        } catch { /* mesa ya logueada arriba */ }

        const existingSessionId = getStoredTableSessionId({
          restaurantId,
          table: tableNumber,
        });

        const sessionId = await getOrCreateMesaSession(
          restaurantId,
          tableNumber
        );

        if (cancelled) return;

        // New session means the old cart belongs to a different table visit.
        if (sessionId !== existingSessionId) {
          clearCart();
        }

        saveTableSessionId({
          restaurantId,
          table: tableNumber,
          sessionId,
        });

        navigate(`/menu?restaurantId=${restaurantId}&table=${table}`, {
          replace: true,
          state: { restaurantId, table },
        });
      } catch (err) {
        console.error("Error abriendo QR:", err);

        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "No se pudo abrir la mesa."
          );
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [restaurantId, table, tableNumber, navigate]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <div className="w-full max-w-sm rounded-3xl border border-red-200 bg-white p-6 text-center shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-red-700">
            <AlertTriangle size={26} />
          </div>

          <h1 className="mt-4 text-xl font-black text-slate-950">
            No se pudo abrir la mesa
          </h1>

          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            {error}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <Loader2 className="mx-auto h-9 w-9 animate-spin text-slate-900" />

        <h1 className="mt-4 text-xl font-black text-slate-950">
          Abriendo mesa {table}
        </h1>

        <p className="mt-2 text-sm text-slate-500">
          Estamos preparando el menú.
        </p>

        {diagLines.length > 0 && (
          <div className="mt-4 rounded-xl bg-slate-100 p-3 text-left">
            {diagLines.map((line, i) => (
              <p key={i} className="font-mono text-[10px] text-slate-700 break-all">{line}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default QrEntry;