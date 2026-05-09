import { useEffect, useMemo, useState } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import {
  Receipt,
  Wallet,
  CreditCard,
  BadgeDollarSign,
  Printer,
  AlertTriangle,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { getDb } from "../lib/firebase";
import { useAuth } from "../lib/auth-context";
import {
  markCashierBillPrinted,
  registerCashierPayment,
} from "../lib/cashier";

const db = getDb();

type Cuenta = {
  id: string;
  mesa: number;
  total: number;
  estado: string;
  metodo?: string | null;
  createdAt?: {
    seconds?: number;
  };
  payments?: {
    id: string;
    method: string;
    amount: number;
  }[];
};

const formatPriceARS = (value: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value || 0);

const Cashier = () => {
  const [searchParams] = useSearchParams();

  const restaurantId = searchParams.get("restaurantId") || "";

  const { user } = useAuth();

  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [selectedCuenta, setSelectedCuenta] = useState<Cuenta | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (!restaurantId) return;

    const q = query(
      collection(db, "restaurants", restaurantId, "cuentas"),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        })) as Cuenta[];

        setCuentas(data);
        setLoading(false);
      },
      (error) => {
        console.error("Error cargando cuentas:", error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [restaurantId]);

  const pendingBills = useMemo(() => {
    return cuentas.filter(
      (cuenta) =>
        cuenta.estado !== "pagada" &&
        cuenta.estado !== "cerrada"
    );
  }, [cuentas]);

  const handleMarkPaid = async (
    cuenta: Cuenta,
    method: "cash" | "debit" | "credit" | "transfer"
  ) => {
    if (!user) return;

    try {
      setProcessing(true);

      await registerCashierPayment({
        restaurantId,
        cuentaId: cuenta.id,
        mesa: cuenta.mesa,
        metodo: method,
        actorUid: user.uid,
        actorEmail: user.email,
        payments: [
          {
            id: crypto.randomUUID(),
            method,
            amount: cuenta.total,
          },
        ],
      });

      setSelectedCuenta(null);
    } catch (error) {
      console.error(error);
      alert(
        error instanceof Error
          ? error.message
          : "No se pudo registrar el pago"
      );
    } finally {
      setProcessing(false);
    }
  };

  const handlePrint = async (cuenta: Cuenta) => {
    if (!user) return;

    try {
      await markCashierBillPrinted({
        restaurantId,
        cuentaId: cuenta.id,
        mesa: cuenta.mesa,
        actorUid: user.uid,
        actorEmail: user.email,
      });

      window.print();
    } catch (error) {
      console.error(error);
      alert("No se pudo registrar la impresión");
    }
  };

  return (
    <div className="min-h-screen bg-zinc-100">
      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.25em] text-zinc-500">
              WANT POS
            </p>

            <h1 className="mt-1 text-4xl font-black tracking-tight text-zinc-950">
              Caja
            </h1>

            <p className="mt-2 text-sm text-zinc-500">
              Gestión de cuentas, pagos y cierre de mesas.
            </p>
          </div>

          <div className="rounded-3xl border border-zinc-200 bg-white px-5 py-4 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">
              Cuentas pendientes
            </p>

            <p className="mt-1 text-3xl font-black text-zinc-950">
              {pendingBills.length}
            </p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
          <section className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Receipt size={20} />

              <h2 className="text-lg font-black text-zinc-950">
                Cuentas activas
              </h2>
            </div>

            {loading ? (
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500">
                Cargando cuentas...
              </div>
            ) : pendingBills.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-6 text-center">
                <AlertTriangle className="mx-auto mb-3 text-zinc-400" />

                <p className="font-semibold text-zinc-700">
                  No hay cuentas pendientes
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {pendingBills.map((cuenta) => {
                  const selected = selectedCuenta?.id === cuenta.id;

                  return (
                    <button
                      key={cuenta.id}
                      onClick={() => setSelectedCuenta(cuenta)}
                      className={`w-full rounded-3xl border p-4 text-left transition ${
                        selected
                          ? "border-zinc-950 bg-zinc-950 text-white"
                          : "border-zinc-200 bg-white hover:border-zinc-300"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p
                            className={`text-xs font-bold uppercase tracking-wide ${
                              selected
                                ? "text-white/70"
                                : "text-zinc-500"
                            }`}
                          >
                            Mesa
                          </p>

                          <h3 className="text-3xl font-black">
                            {cuenta.mesa}
                          </h3>
                        </div>

                        <div className="text-right">
                          <p
                            className={`text-xs font-bold uppercase tracking-wide ${
                              selected
                                ? "text-white/70"
                                : "text-zinc-500"
                            }`}
                          >
                            Total
                          </p>

                          <p className="text-xl font-black">
                            {formatPriceARS(cuenta.total)}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
            {!selectedCuenta ? (
              <div className="flex h-full min-h-[420px] flex-col items-center justify-center text-center">
                <Receipt size={52} className="mb-4 text-zinc-300" />

                <h2 className="text-2xl font-black text-zinc-950">
                  Seleccioná una cuenta
                </h2>

                <p className="mt-2 max-w-sm text-sm text-zinc-500">
                  Elegí una mesa pendiente para gestionar pagos,
                  imprimir tickets o cerrar la cuenta.
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-zinc-500">
                      Cuenta activa
                    </p>

                    <h2 className="mt-1 text-5xl font-black tracking-tight text-zinc-950">
                      Mesa {selectedCuenta.mesa}
                    </h2>

                    <p className="mt-3 text-sm text-zinc-500">
                      Estado actual:{" "}
                      <span className="font-bold capitalize">
                        {selectedCuenta.estado}
                      </span>
                    </p>
                  </div>

                  <button
                    onClick={() => handlePrint(selectedCuenta)}
                    className="flex h-12 items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 font-semibold text-zinc-700 transition hover:bg-zinc-50"
                  >
                    <Printer size={18} />
                    Imprimir
                  </button>
                </div>

                <div className="mt-8 rounded-3xl border border-zinc-200 bg-zinc-50 p-6">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-zinc-500">
                    Total a cobrar
                  </p>

                  <h3 className="mt-2 text-6xl font-black tracking-tight text-zinc-950">
                    {formatPriceARS(selectedCuenta.total)}
                  </h3>
                </div>

                <div className="mt-8">
                  <h3 className="mb-4 text-lg font-black text-zinc-950">
                    Registrar pago
                  </h3>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <button
                      disabled={processing}
                      onClick={() =>
                        handleMarkPaid(selectedCuenta, "cash")
                      }
                      className="flex h-14 items-center justify-center gap-3 rounded-2xl bg-emerald-600 font-black text-white transition hover:opacity-90 disabled:opacity-50"
                    >
                      <Wallet size={20} />
                      Efectivo
                    </button>

                    <button
                      disabled={processing}
                      onClick={() =>
                        handleMarkPaid(selectedCuenta, "debit")
                      }
                      className="flex h-14 items-center justify-center gap-3 rounded-2xl bg-blue-600 font-black text-white transition hover:opacity-90 disabled:opacity-50"
                    >
                      <CreditCard size={20} />
                      Débito
                    </button>

                    <button
                      disabled={processing}
                      onClick={() =>
                        handleMarkPaid(selectedCuenta, "credit")
                      }
                      className="flex h-14 items-center justify-center gap-3 rounded-2xl bg-violet-600 font-black text-white transition hover:opacity-90 disabled:opacity-50"
                    >
                      <CreditCard size={20} />
                      Crédito
                    </button>

                    <button
                      disabled={processing}
                      onClick={() =>
                        handleMarkPaid(selectedCuenta, "transfer")
                      }
                      className="flex h-14 items-center justify-center gap-3 rounded-2xl bg-zinc-950 font-black text-white transition hover:opacity-90 disabled:opacity-50"
                    >
                      <BadgeDollarSign size={20} />
                      Transferencia
                    </button>
                  </div>
                </div>

                {selectedCuenta.payments &&
                  selectedCuenta.payments.length > 0 && (
                    <div className="mt-8">
                      <h3 className="mb-4 text-lg font-black text-zinc-950">
                        Pagos registrados
                      </h3>

                      <div className="space-y-2">
                        {selectedCuenta.payments.map((payment) => (
                          <div
                            key={payment.id}
                            className="flex items-center justify-between rounded-2xl border border-zinc-200 bg-white px-4 py-3"
                          >
                            <div>
                              <p className="font-semibold capitalize text-zinc-950">
                                {payment.method}
                              </p>
                            </div>

                            <p className="font-black text-zinc-950">
                              {formatPriceARS(payment.amount)}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default Cashier;