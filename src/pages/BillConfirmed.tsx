import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  Receipt,
  Clock3,
  ArrowRight,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { getDb } from "../lib/firebase";
import type { CuentaRecord, FirestoreTimestampLike } from "../lib/restaurant";
import { resolveRuntimeContext, parseTableNumber } from "../lib/runtime-context";
import { getMesa } from "../lib/mesas";
import { getSessionById } from "../lib/sessions";
import {
  getStoredTableSessionId,
  clearStoredTableSessionId,
} from "../lib/table-session";

const db = getDb();

const CLOSED_TABLE_MESSAGE =
  "Esta mesa ya fue cerrada. Para volver a pedir, escaneá nuevamente el QR.";

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

  const tableNumber = parseTableNumber(table);

  const [cuenta, setCuenta] = useState<CuentaRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkingSession, setCheckingSession] = useState(true);
  const [sessionClosed, setSessionClosed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const storedSessionId = useMemo(() => {
    return getStoredTableSessionId({
      restaurantId,
      table: tableNumber,
    });
  }, [restaurantId, tableNumber]);

  useEffect(() => {
    let cancelled = false;

    const validateCurrentSession = async () => {
      try {
        setCheckingSession(true);

        if (!storedSessionId) {
          if (!cancelled) {
            setSessionClosed(true);
          }
          return;
        }

        const mesa = await getMesa(restaurantId, tableNumber);
        const session = await getSessionById(restaurantId, storedSessionId);

        const isStillValid =
          mesa.estado === "occupied" &&
          mesa.activeSessionId === storedSessionId &&
          session?.status === "active";

        if (!isStillValid) {
          clearStoredTableSessionId({
            restaurantId,
            table: tableNumber,
          });

          if (!cancelled) {
            setSessionClosed(true);
          }

          return;
        }

        if (!cancelled) {
          setSessionClosed(false);
        }
      } catch (err) {
        console.error("Error validando sesión en BillConfirmed:", err);

        if (!cancelled) {
          setSessionClosed(true);
        }
      } finally {
        if (!cancelled) {
          setCheckingSession(false);
        }
      }
    };

    void validateCurrentSession();

    return () => {
      cancelled = true;
    };
  }, [restaurantId, tableNumber, storedSessionId]);

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
          .filter((c) => {
            const sameMesa = Number(c.mesa) === Number(table);

            if (!sameMesa) return false;

            if (storedSessionId && c.sessionId) {
              return c.sessionId === storedSessionId;
            }

            return sameMesa;
          })
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
  }, [restaurantId, table, storedSessionId]);

  const cuentaBloqueada =
    loading ||
    checkingSession ||
    sessionClosed ||
    !cuenta ||
    cuenta.estado === "pendiente" ||
    cuenta.estado === "en_camino";

  const cuentaPagada = !loading && cuenta?.estado === "pagada";
  const cuentaCerrada = !loading && cuenta?.estado === "cerrada";
  const cuentaFinalizada = cuentaPagada || cuentaCerrada;

  const handleBackToMenu = async () => {
    if (!cuentaPagada || !storedSessionId) return;

    try {
      const mesa = await getMesa(restaurantId, tableNumber);
      const session = await getSessionById(restaurantId, storedSessionId);

      const isStillValid =
        mesa.estado === "occupied" &&
        mesa.activeSessionId === storedSessionId &&
        session?.status === "active";

      if (!isStillValid) {
        clearStoredTableSessionId({
          restaurantId,
          table: tableNumber,
        });

        setSessionClosed(true);
        return;
      }

      navigate(`/menu?restaurantId=${restaurantId}&table=${table}`, {
        replace: true,
        state: { table, restaurantId },
      });
    } catch (err) {
      console.error("Error volviendo al menú:", err);
      setSessionClosed(true);
    }
  };

  const handleFinish = () => {
    if (!cuentaFinalizada) return;

    if (sessionClosed) {
      alert(CLOSED_TABLE_MESSAGE);
      return;
    }

    alert("Para volver a pedir, escaneá nuevamente el QR de la mesa.");
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center px-4 py-8">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <div
            className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${
              sessionClosed
                ? "bg-red-100 text-red-700"
                : "bg-emerald-100 text-emerald-700"
            }`}
          >
            {sessionClosed ? <AlertTriangle size={30} /> : <Receipt size={30} />}
          </div>

          <h1 className="mt-5 text-center text-2xl font-black tracking-tight text-slate-950">
            {sessionClosed ? "Mesa cerrada" : "Cuenta solicitada"}
          </h1>

          <p className="mt-2 text-center text-sm leading-relaxed text-slate-500">
            {sessionClosed
              ? CLOSED_TABLE_MESSAGE
              : `Ya avisamos al staff. Te vamos a mostrar acá el estado de la cuenta de la mesa ${table}.`}
          </p>

          <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-slate-500">Mesa</span>
              <span className="text-sm font-bold text-slate-950">{table}</span>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-slate-500">Estado</span>

              {loading || checkingSession ? (
                <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">
                  Cargando...
                </span>
              ) : sessionClosed ? (
                <span className="rounded-full border border-red-200 bg-red-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-red-700">
                  Mesa cerrada
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

          {sessionClosed ? (
            <div className="mt-5 rounded-2xl border border-red-300 bg-red-50 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle
                  className="mt-0.5 shrink-0 text-red-700"
                  size={18}
                />
                <div>
                  <p className="text-sm font-bold text-red-900">
                    Sesión finalizada
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-red-800">
                    El restaurante ya limpió o cerró esta mesa. Para volver a pedir, necesitás escanear nuevamente el QR desde la mesa.
                  </p>
                </div>
              </div>
            </div>
          ) : cuentaBloqueada ? (
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
                    El pago ya fue confirmado. Podés volver al menú mientras la
                    mesa siga ocupada.
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
            {cuentaPagada && !sessionClosed && (
              <button
                onClick={handleBackToMenu}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-sm font-extrabold text-white transition hover:opacity-90"
              >
                <span>Volver al menú</span>
                <ArrowRight size={16} />
              </button>
            )}

            <button
              disabled={!cuentaFinalizada && !sessionClosed}
              onClick={handleFinish}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 text-sm font-extrabold text-white transition disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span>{sessionClosed ? "Mesa cerrada" : "Finalizar"}</span>
              <ArrowRight size={16} />
            </button>

            <div className="flex items-start gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <ShieldCheck
                size={16}
                className="mt-0.5 shrink-0 text-slate-500"
              />
              <p className="text-xs leading-relaxed text-slate-500">
                Esta pantalla valida que la sesión de la mesa siga activa antes
                de permitir volver al menú.
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default BillConfirmed;
