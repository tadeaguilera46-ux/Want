import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Mail,
  Receipt,
  XCircle,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { getDb } from "../lib/firebase";
import { useRestaurant } from "../lib/restaurant-context";

const db = getDb();

type InvoiceStatus = "requested" | "issued" | "failed" | "not_requested";

type InvoiceType = "A" | "B" | "C" | "ticket";

type CuentaInvoice = {
  status?: InvoiceStatus;
  type?: InvoiceType;
  customerName?: string;
  documentType?: string;
  documentNumber?: string;
  ivaCondition?: string;
  fiscalRegime?: string;
  fiscalAddress?: string;
  postalCode?: string;
  province?: string;
  city?: string;
  email?: string;
  provider?: "manual" | "arca" | "external";
  invoiceNumber?: string;
  cae?: string;
  invoiceUrl?: string;
  failureReason?: string;
};

type Cuenta = {
  id: string;
  restaurantId: string;
  mesa: number;
  total: number;
  estado: string;
  invoice?: CuentaInvoice;
  createdAt?: {
    seconds?: number;
    toMillis?: () => number;
  };
};

const formatPriceARS = (value: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value || 0);

const getTimestampMs = (value?: Cuenta["createdAt"]) => {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  return 0;
};

const statusLabel: Record<InvoiceStatus, string> = {
  requested: "Solicitada",
  issued: "Emitida",
  failed: "Fallida",
  not_requested: "No solicitada",
};

const CashierInvoices = () => {
  const [searchParams] = useSearchParams();
  const { restaurantId: contextRestaurantId } = useRestaurant();

  const restaurantId =
    contextRestaurantId || searchParams.get("restaurantId") || "";

  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [cae, setCae] = useState("");
  const [invoiceUrl, setInvoiceUrl] = useState("");
  const [failureReason, setFailureReason] = useState("");

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
        console.error("Error cargando solicitudes de factura:", error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [restaurantId]);

  const invoiceRequests = useMemo(() => {
    return cuentas
      .filter((cuenta) => cuenta.invoice?.status === "requested")
      .sort((a, b) => getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt));
  }, [cuentas]);

  const issuedInvoices = useMemo(() => {
    return cuentas.filter((cuenta) => cuenta.invoice?.status === "issued");
  }, [cuentas]);

  const failedInvoices = useMemo(() => {
    return cuentas.filter((cuenta) => cuenta.invoice?.status === "failed");
  }, [cuentas]);

  const selectedCuenta = useMemo(() => {
    if (!selectedId) return null;
    return cuentas.find((cuenta) => cuenta.id === selectedId) || null;
  }, [cuentas, selectedId]);

  useEffect(() => {
    if (!selectedCuenta) return;

    setInvoiceNumber(selectedCuenta.invoice?.invoiceNumber || "");
    setCae(selectedCuenta.invoice?.cae || "");
    setInvoiceUrl(selectedCuenta.invoice?.invoiceUrl || "");
    setFailureReason(selectedCuenta.invoice?.failureReason || "");
  }, [selectedCuenta?.id]);

  const markIssued = async () => {
    if (!restaurantId || !selectedCuenta) return;

    if (!invoiceNumber.trim()) {
      alert("Ingresá el número de factura o comprobante.");
      return;
    }

    try {
      setSaving(true);

      await updateDoc(
        doc(db, "restaurants", restaurantId, "cuentas", selectedCuenta.id),
        {
          "invoice.status": "issued",
          "invoice.invoiceNumber": invoiceNumber.trim(),
          "invoice.cae": cae.trim(),
          "invoice.invoiceUrl": invoiceUrl.trim(),
          "invoice.issuedAt": serverTimestamp(),
          "invoice.failureReason": "",
          updatedAt: serverTimestamp(),
        }
      );
    } catch (error) {
      console.error("Error marcando factura emitida:", error);
      alert("No se pudo marcar como emitida.");
    } finally {
      setSaving(false);
    }
  };

  const markFailed = async () => {
    if (!restaurantId || !selectedCuenta) return;

    if (!failureReason.trim()) {
      alert("Ingresá el motivo del fallo.");
      return;
    }

    try {
      setSaving(true);

      await updateDoc(
        doc(db, "restaurants", restaurantId, "cuentas", selectedCuenta.id),
        {
          "invoice.status": "failed",
          "invoice.failureReason": failureReason.trim(),
          "invoice.failedAt": serverTimestamp(),
          updatedAt: serverTimestamp(),
        }
      );
    } catch (error) {
      console.error("Error marcando factura fallida:", error);
      alert("No se pudo marcar como fallida.");
    } finally {
      setSaving(false);
    }
  };

  if (!restaurantId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-100 p-6">
        <div className="rounded-3xl border border-red-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-black text-zinc-950">
            Falta restaurante activo
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            Entrá con una URL que tenga restaurantId.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-100">
      <div className="mx-auto max-w-7xl px-4 py-6">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.25em] text-zinc-500">
              WANT Fiscal
            </p>
            <h1 className="mt-1 text-4xl font-black tracking-tight text-zinc-950">
              Solicitudes de factura
            </h1>
            <p className="mt-2 text-sm text-zinc-500">
              Fase 1: bandeja manual para emitir facturas en sistema fiscal
              externo y registrar el resultado.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-3xl border border-zinc-200 bg-white px-5 py-4 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">
                Pendientes
              </p>
              <p className="mt-1 text-3xl font-black text-zinc-950">
                {invoiceRequests.length}
              </p>
            </div>

            <div className="rounded-3xl border border-emerald-200 bg-emerald-50 px-5 py-4 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">
                Emitidas
              </p>
              <p className="mt-1 text-3xl font-black text-emerald-700">
                {issuedInvoices.length}
              </p>
            </div>

            <div className="rounded-3xl border border-red-200 bg-red-50 px-5 py-4 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wide text-red-700">
                Fallidas
              </p>
              <p className="mt-1 text-3xl font-black text-red-700">
                {failedInvoices.length}
              </p>
            </div>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[430px_1fr]">
          <section className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <FileText size={20} />
              <h2 className="text-lg font-black text-zinc-950">
                Pendientes
              </h2>
            </div>

            {loading ? (
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500">
                Cargando solicitudes...
              </div>
            ) : invoiceRequests.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-6 text-center">
                <AlertTriangle className="mx-auto mb-3 text-zinc-400" />
                <p className="font-semibold text-zinc-700">
                  No hay solicitudes pendientes
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {invoiceRequests.map((cuenta) => {
                  const selected = selectedCuenta?.id === cuenta.id;

                  return (
                    <button
                      key={cuenta.id}
                      onClick={() => setSelectedId(cuenta.id)}
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
                              selected ? "text-white/70" : "text-zinc-500"
                            }`}
                          >
                            Mesa {cuenta.mesa}
                          </p>
                          <h3 className="mt-1 text-lg font-black">
                            {cuenta.invoice?.customerName || "Cliente"}
                          </h3>
                          <p
                            className={`mt-1 text-xs ${
                              selected ? "text-white/70" : "text-zinc-500"
                            }`}
                          >
                            {cuenta.invoice?.documentType}{" "}
                            {cuenta.invoice?.documentNumber}
                          </p>
                        </div>

                        <div className="text-right">
                          <p
                            className={`text-xs font-bold uppercase tracking-wide ${
                              selected ? "text-white/70" : "text-zinc-500"
                            }`}
                          >
                            Total
                          </p>
                          <p className="text-lg font-black">
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
              <div className="flex h-full min-h-[520px] flex-col items-center justify-center text-center">
                <Receipt size={52} className="mb-4 text-zinc-300" />
                <h2 className="text-2xl font-black text-zinc-950">
                  Seleccioná una solicitud
                </h2>
                <p className="mt-2 max-w-sm text-sm text-zinc-500">
                  Elegí una solicitud pendiente para ver los datos fiscales y
                  marcarla como emitida o fallida.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-zinc-500">
                    Solicitud
                  </p>
                  <h2 className="mt-1 text-5xl font-black tracking-tight text-zinc-950">
                    Mesa {selectedCuenta.mesa}
                  </h2>
                  <p className="mt-3 text-sm text-zinc-500">
                    Estado:{" "}
                    <span className="font-bold text-zinc-950">
                      {
                        statusLabel[
                          selectedCuenta.invoice?.status || "not_requested"
                        ]
                      }
                    </span>
                  </p>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <InfoCard label="Tipo" value={selectedCuenta.invoice?.type} />
                  <InfoCard
                    label="Total"
                    value={formatPriceARS(selectedCuenta.total)}
                  />
                  <InfoCard
                    label="Nombre / Razón social"
                    value={selectedCuenta.invoice?.customerName}
                  />
                  <InfoCard
                    label="Documento"
                    value={`${selectedCuenta.invoice?.documentType || ""} ${
                      selectedCuenta.invoice?.documentNumber || ""
                    }`}
                  />
                  <InfoCard
                    label="Condición IVA"
                    value={selectedCuenta.invoice?.ivaCondition}
                  />
                  <InfoCard
                    label="Régimen"
                    value={selectedCuenta.invoice?.fiscalRegime}
                  />
                  <InfoCard
                    label="Dirección fiscal"
                    value={selectedCuenta.invoice?.fiscalAddress}
                  />
                  <InfoCard
                    label="Código postal"
                    value={selectedCuenta.invoice?.postalCode}
                  />
                  <InfoCard
                    label="Provincia"
                    value={selectedCuenta.invoice?.province}
                  />
                  <InfoCard label="Localidad" value={selectedCuenta.invoice?.city} />
                  <InfoCard
                    label="Email"
                    value={selectedCuenta.invoice?.email}
                    icon={<Mail size={14} />}
                  />
                </div>

                <div className="rounded-3xl border border-zinc-200 bg-zinc-50 p-4">
                  <h3 className="mb-3 text-lg font-black text-zinc-950">
                    Registrar emisión manual
                  </h3>

                  <div className="grid gap-3 md:grid-cols-2">
                    <input
                      value={invoiceNumber}
                      onChange={(e) => setInvoiceNumber(e.target.value)}
                      placeholder="Número de factura / comprobante"
                      className="h-12 rounded-2xl border border-zinc-200 px-4 outline-none focus:ring-2 focus:ring-black/10"
                    />

                    <input
                      value={cae}
                      onChange={(e) => setCae(e.target.value)}
                      placeholder="CAE opcional"
                      className="h-12 rounded-2xl border border-zinc-200 px-4 outline-none focus:ring-2 focus:ring-black/10"
                    />

                    <input
                      value={invoiceUrl}
                      onChange={(e) => setInvoiceUrl(e.target.value)}
                      placeholder="URL PDF opcional"
                      className="h-12 rounded-2xl border border-zinc-200 px-4 outline-none focus:ring-2 focus:ring-black/10 md:col-span-2"
                    />
                  </div>

                  <button
                    onClick={markIssued}
                    disabled={saving}
                    className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 font-black text-white disabled:opacity-50"
                  >
                    <CheckCircle2 size={18} />
                    Marcar como emitida
                  </button>
                </div>

                <div className="rounded-3xl border border-red-200 bg-red-50 p-4">
                  <h3 className="mb-3 text-lg font-black text-red-800">
                    Marcar como fallida
                  </h3>

                  <input
                    value={failureReason}
                    onChange={(e) => setFailureReason(e.target.value)}
                    placeholder="Motivo del fallo"
                    className="h-12 w-full rounded-2xl border border-red-200 px-4 outline-none focus:ring-2 focus:ring-red-200"
                  />

                  <button
                    onClick={markFailed}
                    disabled={saving}
                    className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-red-600 font-black text-white disabled:opacity-50"
                  >
                    <XCircle size={18} />
                    Marcar como fallida
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

const InfoCard = ({
  label,
  value,
  icon,
}: {
  label: string;
  value?: string | number | null;
  icon?: React.ReactNode;
}) => {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
      <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-zinc-500">
        {icon}
        <span>{label}</span>
      </div>
      <p className="mt-2 break-words text-sm font-bold text-zinc-950">
        {value || "—"}
      </p>
    </div>
  );
};

export default CashierInvoices;