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
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Mail,
  Receipt,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getDb } from "../lib/firebase";
import { useRestaurant } from "../lib/restaurant-context";

const db = getDb();

type InvoiceStatus = "requested" | "issued" | "failed" | "not_requested";
type InvoiceType = "A" | "B" | "C" | "ticket";
type TabKey = "requested" | "issued" | "failed";

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
  issuedAt?: { seconds?: number; toMillis?: () => number };
  failedAt?: { seconds?: number; toMillis?: () => number };
};

type Cuenta = {
  id: string;
  restaurantId: string;
  mesa: number;
  total: number;
  estado: string;
  invoice?: CuentaInvoice;
  createdAt?: { seconds?: number; toMillis?: () => number };
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

const formatTs = (value?: CuentaInvoice["issuedAt"]) => {
  if (!value) return null;
  const ms =
    typeof value.toMillis === "function"
      ? value.toMillis()
      : typeof value.seconds === "number"
        ? value.seconds * 1000
        : null;
  if (!ms) return null;
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
};

const TABS: { key: TabKey; label: string; color: string; activeClass: string }[] = [
  {
    key: "requested",
    label: "Pendientes",
    color: "text-amber-400",
    activeClass: "bg-amber-600 text-white border-amber-600",
  },
  {
    key: "issued",
    label: "Emitidas",
    color: "text-emerald-400",
    activeClass: "bg-emerald-600 text-white border-emerald-600",
  },
  {
    key: "failed",
    label: "Fallidas",
    color: "text-red-400",
    activeClass: "bg-red-600 text-white border-red-600",
  },
];

const CashierInvoices = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { restaurantId: contextRestaurantId } = useRestaurant();

  const restaurantId =
    contextRestaurantId || searchParams.get("restaurantId") || "";

  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("requested");

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

  const invoiceRequests = useMemo(
    () =>
      cuentas
        .filter((c) => c.invoice?.status === "requested")
        .sort((a, b) => getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt)),
    [cuentas]
  );

  const issuedInvoices = useMemo(
    () =>
      cuentas
        .filter((c) => c.invoice?.status === "issued")
        .sort((a, b) => getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt)),
    [cuentas]
  );

  const failedInvoices = useMemo(
    () =>
      cuentas
        .filter((c) => c.invoice?.status === "failed")
        .sort((a, b) => getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt)),
    [cuentas]
  );

  const activeList =
    activeTab === "requested"
      ? invoiceRequests
      : activeTab === "issued"
        ? issuedInvoices
        : failedInvoices;

  const selectedCuenta = useMemo(
    () => (selectedId ? cuentas.find((c) => c.id === selectedId) || null : null),
    [cuentas, selectedId]
  );

  useEffect(() => {
    if (!selectedCuenta) return;
    setInvoiceNumber(selectedCuenta.invoice?.invoiceNumber || "");
    setCae(selectedCuenta.invoice?.cae || "");
    setInvoiceUrl(selectedCuenta.invoice?.invoiceUrl || "");
    setFailureReason(selectedCuenta.invoice?.failureReason || "");
  }, [selectedCuenta?.id]);

  const handleTabChange = (tab: TabKey) => {
    setActiveTab(tab);
    setSelectedId(null);
  };

  const markIssued = async () => {
    if (!restaurantId || !selectedCuenta) return;
    if (!invoiceNumber.trim()) {
      toast.error("Ingresá el número de factura o comprobante.");
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
      toast.success("Factura marcada como emitida.");
      setSelectedId(null);
    } catch (error) {
      console.error(error);
      toast.error("No se pudo marcar como emitida.");
    } finally {
      setSaving(false);
    }
  };

  const markFailed = async () => {
    if (!restaurantId || !selectedCuenta) return;
    if (!failureReason.trim()) {
      toast.error("Ingresá el motivo del fallo.");
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
      toast.success("Factura marcada como fallida.");
      setSelectedId(null);
    } catch (error) {
      console.error(error);
      toast.error("No se pudo marcar como fallida.");
    } finally {
      setSaving(false);
    }
  };

  const reopenRequest = async (cuenta: Cuenta) => {
    if (!restaurantId) return;
    try {
      await updateDoc(
        doc(db, "restaurants", restaurantId, "cuentas", cuenta.id),
        {
          "invoice.status": "requested",
          updatedAt: serverTimestamp(),
        }
      );
      toast.success("Solicitud reabierta como pendiente.");
      setSelectedId(null);
      setActiveTab("requested");
    } catch (error) {
      console.error(error);
      toast.error("No se pudo reabrir la solicitud.");
    }
  };

  if (!restaurantId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="rounded-xl border border-red-800/50 bg-card p-6 text-center shadow-sm">
          <h1 className="text-lg font-bold text-foreground">Falta restaurante activo</h1>
          <p className="mt-2 text-sm text-muted-foreground">Entrá con una URL que tenga restaurantId.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-4 py-6">
        {/* Header */}
        <header className="mb-6">
          <button
            onClick={() => navigate(-1)}
            className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-bold text-foreground shadow-sm transition hover:bg-secondary"
          >
            <ArrowLeft size={15} />
            Volver al admin
          </button>
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-muted-foreground">
            WANT Fiscal
          </p>
          <h1 className="mt-1 text-4xl font-bold tracking-tight text-foreground">
            Solicitudes de factura
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Bandeja manual para emitir facturas en sistema fiscal externo y registrar el resultado.
          </p>
        </header>

        {/* Summary cards */}
        <div className="mb-6 grid grid-cols-3 gap-3">
          <button
            onClick={() => handleTabChange("requested")}
            className={`rounded-xl border px-5 py-4 shadow-sm text-left transition ${
              activeTab === "requested"
                ? "border-amber-300 bg-amber-950/30 ring-2 ring-amber-200"
                : "border-border bg-card hover:border-zinc-300"
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <Clock size={15} className="text-amber-400" />
              <p className="text-xs font-bold uppercase tracking-wide text-amber-400">Pendientes</p>
            </div>
            <p className="text-3xl font-bold text-foreground">{invoiceRequests.length}</p>
          </button>

          <button
            onClick={() => handleTabChange("issued")}
            className={`rounded-xl border px-5 py-4 shadow-sm text-left transition ${
              activeTab === "issued"
                ? "border-emerald-300 bg-emerald-950/30 ring-2 ring-emerald-200"
                : "border-border bg-card hover:border-zinc-300"
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 size={15} className="text-emerald-600" />
              <p className="text-xs font-bold uppercase tracking-wide text-emerald-400">Emitidas</p>
            </div>
            <p className="text-3xl font-bold text-foreground">{issuedInvoices.length}</p>
          </button>

          <button
            onClick={() => handleTabChange("failed")}
            className={`rounded-xl border px-5 py-4 shadow-sm text-left transition ${
              activeTab === "failed"
                ? "border-red-300 bg-red-950/30 ring-2 ring-red-200"
                : "border-border bg-card hover:border-zinc-300"
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <XCircle size={15} className="text-red-500" />
              <p className="text-xs font-bold uppercase tracking-wide text-red-400">Fallidas</p>
            </div>
            <p className="text-3xl font-bold text-foreground">{failedInvoices.length}</p>
          </button>
        </div>

        {/* Tabs */}
        <div className="mb-4 flex gap-2">
          {TABS.map((tab) => {
            const count =
              tab.key === "requested"
                ? invoiceRequests.length
                : tab.key === "issued"
                  ? issuedInvoices.length
                  : failedInvoices.length;
            return (
              <button
                key={tab.key}
                onClick={() => handleTabChange(tab.key)}
                className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold transition ${
                  activeTab === tab.key
                    ? tab.activeClass
                    : "border-border bg-card text-muted-foreground hover:bg-secondary"
                }`}
              >
                {tab.label}
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                    activeTab === tab.key ? "bg-white/25" : "bg-background text-muted-foreground"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="grid gap-6 lg:grid-cols-[430px_1fr]">
          {/* Left: list */}
          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <FileText size={18} className="text-muted-foreground" />
              <h2 className="text-base font-bold text-foreground">
                {activeTab === "requested"
                  ? "Solicitudes pendientes"
                  : activeTab === "issued"
                    ? "Facturas emitidas"
                    : "Facturas fallidas"}
              </h2>
            </div>

            {loading ? (
              <p className="rounded-lg border border-border bg-secondary p-4 text-sm text-muted-foreground">
                Cargando...
              </p>
            ) : activeList.length === 0 ? (
              <div className="rounded-lg border border-dashed border-zinc-300 bg-secondary p-6 text-center">
                <AlertTriangle className="mx-auto mb-3 text-muted-foreground" />
                <p className="font-semibold text-foreground">
                  {activeTab === "requested"
                    ? "No hay solicitudes pendientes"
                    : activeTab === "issued"
                      ? "No hay facturas emitidas"
                      : "No hay facturas fallidas"}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {activeList.map((cuenta) => {
                  const selected = selectedCuenta?.id === cuenta.id;
                  const ts =
                    activeTab === "issued"
                      ? formatTs(cuenta.invoice?.issuedAt)
                      : activeTab === "failed"
                        ? formatTs(cuenta.invoice?.failedAt)
                        : null;

                  return (
                    <button
                      key={cuenta.id}
                      onClick={() => setSelectedId(cuenta.id)}
                      className={`w-full rounded-lg border p-4 text-left transition ${
                        selected
                          ? "border-zinc-950 bg-zinc-950 text-white"
                          : "border-border bg-secondary hover:border-zinc-300 hover:bg-card"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p
                            className={`text-[11px] font-bold uppercase tracking-wide ${
                              selected ? "text-white/60" : "text-muted-foreground"
                            }`}
                          >
                            Mesa {cuenta.mesa}
                            {cuenta.invoice?.type && ` · Tipo ${cuenta.invoice.type}`}
                          </p>
                          <p className="mt-1 truncate font-bold">
                            {cuenta.invoice?.customerName || "Cliente"}
                          </p>
                          <p
                            className={`mt-0.5 text-xs ${selected ? "text-white/60" : "text-muted-foreground"}`}
                          >
                            {cuenta.invoice?.documentType} {cuenta.invoice?.documentNumber}
                          </p>
                          {activeTab === "issued" && cuenta.invoice?.invoiceNumber && (
                            <p
                              className={`mt-0.5 text-xs font-bold ${selected ? "text-white/80" : "text-emerald-400"}`}
                            >
                              Nro. {cuenta.invoice.invoiceNumber}
                            </p>
                          )}
                          {activeTab === "failed" && cuenta.invoice?.failureReason && (
                            <p
                              className={`mt-0.5 text-xs ${selected ? "text-red-300" : "text-red-400"}`}
                            >
                              {cuenta.invoice.failureReason}
                            </p>
                          )}
                          {ts && (
                            <p
                              className={`mt-0.5 text-[11px] ${selected ? "text-white/50" : "text-muted-foreground"}`}
                            >
                              {ts}
                            </p>
                          )}
                        </div>

                        <div className="shrink-0 text-right">
                          <p className="text-lg font-bold">{formatPriceARS(cuenta.total)}</p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* Right: detail */}
          <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
            {!selectedCuenta ? (
              <div className="flex h-full min-h-[480px] flex-col items-center justify-center text-center">
                <Receipt size={52} className="mb-4 text-zinc-300" />
                <h2 className="text-2xl font-bold text-foreground">
                  Seleccioná una factura
                </h2>
                <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                  {activeTab === "requested"
                    ? "Elegí una solicitud pendiente para ver los datos fiscales y marcarla como emitida o fallida."
                    : "Elegí un registro para ver todos los datos fiscales asociados."}
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                {/* Title */}
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">
                    {activeTab === "requested"
                      ? "Solicitud pendiente"
                      : activeTab === "issued"
                        ? "Factura emitida"
                        : "Factura fallida"}
                  </p>
                  <h2 className="mt-1 text-5xl font-bold tracking-tight text-foreground">
                    Mesa {selectedCuenta.mesa}
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Total:{" "}
                    <span className="font-bold text-foreground">
                      {formatPriceARS(selectedCuenta.total)}
                    </span>
                    {selectedCuenta.invoice?.type && (
                      <span className="ml-3 rounded-full border border-border bg-background px-2 py-0.5 text-xs font-bold text-foreground">
                        Tipo {selectedCuenta.invoice.type}
                      </span>
                    )}
                  </p>
                </div>

                {/* Fiscal data */}
                <div className="grid gap-3 md:grid-cols-2">
                  <InfoCard
                    label="Fecha del comprobante"
                    value={new Intl.DateTimeFormat("es-AR", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                    }).format(
                      getTimestampMs(selectedCuenta.createdAt)
                        ? new Date(getTimestampMs(selectedCuenta.createdAt))
                        : new Date()
                    )}
                  />
                  <InfoCard
                    label="Nombre / Razón social"
                    value={selectedCuenta.invoice?.customerName}
                  />
                  <InfoCard
                    label="Documento"
                    value={`${selectedCuenta.invoice?.documentType || ""} ${selectedCuenta.invoice?.documentNumber || ""}`}
                  />
                  <InfoCard
                    label="Condición IVA"
                    value={selectedCuenta.invoice?.ivaCondition}
                  />
                  <InfoCard
                    label="Régimen fiscal"
                    value={selectedCuenta.invoice?.fiscalRegime}
                  />
                  <InfoCard
                    label="Dirección fiscal"
                    value={selectedCuenta.invoice?.fiscalAddress}
                  />
                  <InfoCard
                    label="CP / Provincia / Localidad"
                    value={[
                      selectedCuenta.invoice?.postalCode,
                      selectedCuenta.invoice?.province,
                      selectedCuenta.invoice?.city,
                    ]
                      .filter(Boolean)
                      .join(" · ") || undefined}
                  />
                  <InfoCard
                    label="Email"
                    value={selectedCuenta.invoice?.email}
                    icon={<Mail size={13} />}
                  />
                  <InfoCard
                    label="Proveedor fiscal"
                    value={selectedCuenta.invoice?.provider}
                  />
                </div>

                {/* Issued details */}
                {activeTab === "issued" && (
                  <div className="rounded-lg border border-emerald-800/50 bg-emerald-950/30 p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <CheckCircle2 size={16} className="text-emerald-600" />
                      <h3 className="font-bold text-emerald-300">Datos de emisión</h3>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <InfoCard
                        label="Número de factura"
                        value={selectedCuenta.invoice?.invoiceNumber}
                      />
                      <InfoCard
                        label="CAE"
                        value={selectedCuenta.invoice?.cae}
                      />
                      <InfoCard
                        label="Emitida el"
                        value={formatTs(selectedCuenta.invoice?.issuedAt)}
                      />
                      {selectedCuenta.invoice?.invoiceUrl ? (
                        <div className="rounded-lg border border-border bg-secondary p-4">
                          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                            PDF / URL
                          </p>
                          <a
                            href={selectedCuenta.invoice.invoiceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 flex items-center gap-1.5 text-sm font-bold text-emerald-400 underline underline-offset-2"
                          >
                            <ExternalLink size={13} />
                            Ver factura
                          </a>
                        </div>
                      ) : (
                        <InfoCard label="PDF / URL" value={null} />
                      )}
                    </div>
                    <button
                      onClick={() => reopenRequest(selectedCuenta)}
                      className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-emerald-300 bg-card text-sm font-bold text-emerald-400 transition hover:bg-emerald-100"
                    >
                      <RotateCcw size={14} />
                      Reabrir como pendiente
                    </button>
                  </div>
                )}

                {/* Failed details */}
                {activeTab === "failed" && (
                  <div className="rounded-lg border border-red-800/50 bg-red-950/30 p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <XCircle size={16} className="text-red-500" />
                      <h3 className="font-bold text-red-900">Motivo del fallo</h3>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <InfoCard
                        label="Motivo"
                        value={selectedCuenta.invoice?.failureReason}
                      />
                      <InfoCard
                        label="Fallida el"
                        value={formatTs(selectedCuenta.invoice?.failedAt)}
                      />
                    </div>
                    <button
                      onClick={() => reopenRequest(selectedCuenta)}
                      className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-red-300 bg-card text-sm font-bold text-red-800 transition hover:bg-red-100"
                    >
                      <RotateCcw size={14} />
                      Reabrir como pendiente
                    </button>
                  </div>
                )}

                {/* Pending actions */}
                {activeTab === "requested" && (
                  <>
                    <div className="rounded-lg border border-border bg-secondary p-4">
                      <h3 className="mb-3 font-bold text-foreground">Registrar emisión manual</h3>
                      <div className="grid gap-3 md:grid-cols-2">
                        <input
                          value={invoiceNumber}
                          onChange={(e) => setInvoiceNumber(e.target.value)}
                          placeholder="Número de factura / comprobante"
                          className="h-12 rounded-lg border border-border bg-card px-4 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                        />
                        <input
                          value={cae}
                          onChange={(e) => setCae(e.target.value)}
                          placeholder="CAE (opcional)"
                          className="h-12 rounded-lg border border-border bg-card px-4 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                        />
                        <input
                          value={invoiceUrl}
                          onChange={(e) => setInvoiceUrl(e.target.value)}
                          placeholder="URL PDF (opcional)"
                          className="h-12 rounded-lg border border-border bg-card px-4 text-sm outline-none focus:ring-2 focus:ring-ring/40 md:col-span-2"
                        />
                      </div>
                      <button
                        onClick={markIssued}
                        disabled={saving}
                        className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                      >
                        <CheckCircle2 size={17} />
                        Marcar como emitida
                      </button>
                    </div>

                    <div className="rounded-lg border border-red-800/50 bg-red-950/30 p-4">
                      <h3 className="mb-3 font-bold text-red-900">Marcar como fallida</h3>
                      <input
                        value={failureReason}
                        onChange={(e) => setFailureReason(e.target.value)}
                        placeholder="Motivo del fallo"
                        className="h-12 w-full rounded-lg border border-red-800/50 bg-card px-4 text-sm outline-none focus:ring-2 focus:ring-red-200"
                      />
                      <button
                        onClick={markFailed}
                        disabled={saving}
                        className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-red-600 font-bold text-white transition hover:bg-red-700 disabled:opacity-50"
                      >
                        <XCircle size={17} />
                        Marcar como fallida
                      </button>
                    </div>
                  </>
                )}
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
}) => (
  <div className="rounded-lg border border-border bg-secondary p-3.5">
    <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
      {icon}
      <span>{label}</span>
    </div>
    <p className="mt-1.5 break-words text-sm font-bold text-foreground">
      {value || "—"}
    </p>
  </div>
);

export default CashierInvoices;
