import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  Receipt,
  Clock3,
  ArrowRight,
  ShieldCheck,
} from "lucide-react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { getDb } from "../lib/firebase";
import type { CuentaRecord, FirestoreTimestampLike } from "../lib/restaurant";
import { resolveRuntimeContext } from "../lib/runtime-context";

const db = getDb();

const statusLabel = (estado?: string) => {
  switch (estado) {
    case "pendiente":
      return "Pendiente";
    case "en_camino":
      return "En camino";
    case "pagada":
      return "Pagada";
    case "cerrada":
      return "Cerrada";
    default:
      return "Procesando";
  }
};

const statusStyles = (estado?: string) => {
  switch (estado) {
    case "pendiente":
      return "bg-amber-100 text-amber-800 border border-amber-200";
    case "en_camino":
      return "bg-blue-100 text-blue-800 border border-blue-200";
    case "pagada":
      return "bg-emerald-100 text-emerald-800 border border-emerald-200";
    case "cerrada":
      return "bg-emerald-100 text-emerald-800 border border-emerald-200";
    default:
      return "bg-slate-100 text-slate-700 border border-slate-200";
  }
};

const getTimestampMs = (value?: FirestoreTimestampLike) => {
  if (!value) return 0;

  if (typeof value.toMillis === "function") {
    return value.toMillis();
  }

  if (typeof value.seconds === "number") {
    return value.seconds * 1000;
  }

  return 0;
};

const BillConfirmed = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const { table, restaurantId } = resolveRuntimeContext({
    searchParams,
    location,
  });

  const [cuenta, setCuenta] = useState<CuentaRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, "restaurants", restaurantId, "cuentas"),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setError(null);

        const cuentas = snapshot.docs.map((cuentaDoc) => {
          return {
            id: cuentaDoc.id,
            ...cuentaDoc.data(),
          };
        }) as CuentaRecord[];

        const cuentasMesa = cuentas
          .filter((c) => Number(c.mesa) === Number(table))
          .sort(
            (a, b) => getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt)
          );

        setCuenta(cuentasMesa[0] || null);
        setLoading(false);
      },
      (err) => {
        console.error("Error escuchando estado de la cuenta:", err);
        setError("No pudimos verificar el estado de la cuenta en tiempo real.");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [restaurantId, table]);

  const cuentaBloqueada =
    loading ||
    !cuenta ||
    cuenta.estado === "pendiente" ||
    cuenta.estado === "en_camino";

  const cuentaPagada = !loading && cuenta?.estado === "pagada";
  const cuentaCerrada = !loading && cuenta?.estado === "cerrada";
  const cuentaFinalizada = cuentaPagada || cuentaCerrada;

  const handleFinish = () => {
    if (!cuentaFinalizada) return;

    navigate(`/menu?restaurantId=${restaurantId}&table=${table}`, {
      replace: true,
      state: { table, restaurantId },
    });
  };

  const handleBackToMenu = () => {
    if (!cuentaPagada) return;

    navigate(`/menu?restaurantId=${restaurantId}&table=${table}`, {
      replace: true,
      state: { table, restaurantId },
    });
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center px-4 py-8">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <Receipt size={30} />
          </div>

          <h1 className="mt-5 text-center text-2xl font-black tracking-tight text-slate-950">
            Cuenta solicitada
          </h1>

          <p className="mt-2 text-center text-sm leading-relaxed text-slate-500">
            Ya avisamos al staff. Te vamos a mostrar acá el estado de la cuenta
            de la mesa {table}.
          </p>

          <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-slate-500">Mesa</span>
              <span className="text-sm font-bold text-slate-950">{table}</span>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-slate-500">Estado</span>

              {loading ? (
                <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">
                  Cargando...
                </span>
              ) : (
                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${statusStyles(
                    cuenta?.estado
                  )}`}
                >
                  {statusLabel(cuenta?.estado)}
                </span>
              )}
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {error}
            </div>
          )}

          {cuentaBloqueada ? (
            <div className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-4">
              <div className="flex items-start gap-3">
                <Clock3 className="mt-0.5 shrink-0 text-amber-800" size={18} />
                <div>
                  <p className="text-sm font-bold text-amber-900">
                    Esperando confirmación del staff
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-amber-800">
                    Mientras la cuenta esté pendiente o en camino, no vas a poder
                    volver al menú para seguir pidiendo.
                  </p>
                </div>
              </div>
            </div>
          ) : cuentaPagada ? (
            <div className="mt-5 rounded-2xl border border-emerald-300 bg-emerald-50 p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2
                  className="mt-0.5 shrink-0 text-emerald-700"
                  size={18}
                />
                <div>
                  <p className="text-sm font-bold text-emerald-900">
                    Cuenta pagada
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-emerald-800">
                    El pago ya fue confirmado. Podés volver al menú y empezar un
                    nuevo consumo si querés seguir pidiendo.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-emerald-300 bg-emerald-50 p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2
                  className="mt-0.5 shrink-0 text-emerald-700"
                  size={18}
                />
                <div>
                  <p className="text-sm font-bold text-emerald-900">
                    Cuenta cerrada
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-emerald-800">
                    La cuenta ya fue cerrada por el restaurante.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="mt-6 space-y-3">
            {cuentaPagada && (
              <button
                onClick={handleBackToMenu}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-sm font-extrabold text-white transition hover:opacity-90"
              >
                <span>Volver al menú</span>
                <ArrowRight size={16} />
              </button>
            )}

            <button
              disabled={!cuentaFinalizada}
              onClick={handleFinish}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 text-sm font-extrabold text-white transition disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span>Finalizar</span>
              <ArrowRight size={16} />
            </button>

            <div className="flex items-start gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <ShieldCheck
                size={16}
                className="mt-0.5 shrink-0 text-slate-500"
              />
              <p className="text-xs leading-relaxed text-slate-500">
                Esta pantalla queda bloqueada hasta que el restaurante confirme
                el pago, para evitar que se sigan cargando pedidos sobre una
                cuenta ya solicitada.
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default BillConfirmed;
