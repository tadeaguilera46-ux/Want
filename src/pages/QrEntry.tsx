import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, AlertTriangle } from "lucide-react";
import { getOrCreateMesaSession } from "../lib/mesas";
import { parseTableNumber, resolveRuntimeContext } from "../lib/runtime-context";
import {
  getStoredTableSessionId,
  saveTableSessionId,
} from "../lib/table-session";
import { useCart } from "@/lib/CartContext";

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

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        setError(null);

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
      </div>
    </div>
  );
};

export default QrEntry;
