import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  Receipt,
  Clock3,
  ShieldCheck,
  AlertTriangle,
  QrCode,
} from "lucide-react";
import { doc, onSnapshot } from "firebase/firestore";
import { getDb } from "../lib/firebase";
import type { CuentaRecord } from "../lib/restaurant";
import { resolveRuntimeContext, parseTableNumber } from "../lib/runtime-context";
import { getMesa } from "../lib/mesas";
import { getSessionById } from "../lib/sessions";
import {
  getStoredTableSessionId,
  clearStoredTableSessionId,
} from "../lib/table-session";

const db = getDb();

const RESCAN_QR_MESSAGE =
  "Para volver a pedir, escaneá nuevamente el QR físico de la mesa.";

const CLOSED_TABLE_MESSAGE =
  "Esta mesa ya fue cerrada. Para volver a pedir, escaneá nuevamente el QR físico de la mesa.";

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
      return "bg-amber-100 text-amber-400 border border-amber-800/50";
    case "en_camino":
      return "bg-blue-100 text-blue-400 border border-blue-800/50";
    case "pagada":
      return "bg-emerald-100 text-emerald-400 border border-emerald-800/50";
    case "cerrada":
      return "bg-slate-200 text-slate-800 border border-slate-300";
    default:
      return "bg-slate-100 text-slate-700 border border-slate-200";
  }
};


const BillConfirmed = () => {
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
          if (!cancelled) setSessionClosed(true);
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

          if (!cancelled) setSessionClosed(true);
          return;
        }

        if (!cancelled) setSessionClosed(false);
      } catch (err) {
        console.error("Error validando sesión en BillConfirmed:", err);
        if (!cancelled) setSessionClosed(true);
      } finally {
        if (!cancelled) setCheckingSession(false);
      }
    };

    void validateCurrentSession();

    return () => {
      cancelled = true;
    };
  }, [restaurantId, tableNumber, storedSessionId]);

  useEffect(() => {
    if (!storedSessionId) {
      setCuenta(null);
      setLoading(false);
      return;
    }

    const cuentaRef = doc(db, "restaurants", restaurantId, "cuentas", storedSessionId);

    const unsubscribe = onSnapshot(
      cuentaRef,
      (snapshot) => {
        setError(null);
        setCuenta(
          snapshot.exists()
            ? ({ id: snapshot.id, ...snapshot.data() } as CuentaRecord)
            : null
        );
        setLoading(false);
      },
      (err) => {
        console.error("Error escuchando estado de la cuenta:", err);
        setError("No pudimos verificar el estado de la cuenta en tiempo real.");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [restaurantId, storedSessionId]);

  const waitingForStaff =
    loading ||
    checkingSession ||
    !cuenta ||
    cuenta.estado === "pendiente" ||
    cuenta.estado === "en_camino";

  const cuentaPagada = !loading && cuenta?.estado === "pagada";
  const cuentaCerrada = !loading && cuenta?.estado === "cerrada";
  const shouldShowRescanMessage = sessionClosed || cuentaPagada || cuentaCerrada;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center px-4 py-8">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-slate-200 bg-card p-6 shadow-sm"
        >
          <div
            className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${
              sessionClosed
                ? "bg-red-100 text-red-400"
                : "bg-emerald-100 text-emerald-400"
            }`}
          >
            {sessionClosed ? <AlertTriangle size={30} /> : <Receipt size={30} />}
          </div>

          <h1 className="mt-5 text-center text-2xl font-bold tracking-tight text-slate-950">
            {sessionClosed ? "Mesa cerrada" : "Cuenta solicitada"}
          </h1>

          <p className="mt-2 text-center text-sm leading-relaxed text-slate-500">
            {sessionClosed
              ? CLOSED_TABLE_MESSAGE
              : `Ya avisamos al staff. Te mostramos acá el estado de la cuenta de la mesa ${table}.`}
          </p>

          <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
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
                <span className="rounded-full border border-red-800/50 bg-red-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-red-400">
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
            <div className="mt-4 rounded-lg border border-red-300 bg-red-950/30 px-4 py-3 text-sm font-medium text-red-400">
              {error}
            </div>
          )}

          {sessionClosed ? (
            <div className="mt-5 rounded-lg border border-red-300 bg-red-950/30 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 shrink-0 text-red-400" size={18} />
                <div>
                  <p className="text-sm font-bold text-red-900">
                    Sesión finalizada
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-red-800">
                    El restaurante ya cerró o limpió esta mesa. Para volver a
                    pedir, necesitás escanear nuevamente el QR físico desde la
                    mesa.
                  </p>
                </div>
              </div>
            </div>
          ) : waitingForStaff ? (
            <div className="mt-5 rounded-lg border border-amber-300 bg-amber-950/30 p-4">
              <div className="flex items-start gap-3">
                <Clock3 className="mt-0.5 shrink-0 text-amber-400" size={18} />
                <div>
                  <p className="text-sm font-bold text-amber-300">
                    Esperando confirmación del staff
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-amber-400">
                    Mientras la cuenta esté pendiente o en camino, no se pueden
                    cargar nuevos pedidos desde esta sesión.
                  </p>
                </div>
              </div>
            </div>
          ) : cuentaPagada ? (
            <div className="mt-5 rounded-lg border border-emerald-300 bg-emerald-950/30 p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2
                  className="mt-0.5 shrink-0 text-emerald-400"
                  size={18}
                />
                <div>
                  <p className="text-sm font-bold text-emerald-300">
                    Cuenta pagada
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-emerald-400">
                    El pago ya fue confirmado. Si querés volver a pedir,
                    escaneá nuevamente el QR físico de la mesa.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-5 rounded-lg border border-slate-300 bg-slate-50 p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2
                  className="mt-0.5 shrink-0 text-slate-700"
                  size={18}
                />
                <div>
                  <p className="text-sm font-bold text-slate-900">
                    Cuenta cerrada
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-slate-700">
                    La cuenta ya fue cerrada por el restaurante. Muchas gracias!
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="mt-6 space-y-3">
            {shouldShowRescanMessage && (
              <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-4">
                <QrCode size={20} className="mt-0.5 shrink-0 text-slate-700" />
                <div>
                  <p className="text-sm font-bold text-slate-950">
                    Escaneá el QR para volver a pedir
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-slate-600">
                    {RESCAN_QR_MESSAGE}
                  </p>
                </div>
              </div>
            )}

            <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <ShieldCheck
                size={16}
                className="mt-0.5 shrink-0 text-slate-500"
              />
              <p className="text-xs leading-relaxed text-slate-500">
                Por seguridad, esta pantalla no permite volver al menú desde un
                link anterior. El acceso al menú debe iniciarse desde el QR de la
                mesa.
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default BillConfirmed;