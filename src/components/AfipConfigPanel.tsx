import { useEffect, useRef, useState } from "react";
import { collection, doc, onSnapshot } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getDb } from "../lib/firebase";
import { toast } from "sonner";
import { CheckCircle, ChevronRight, Copy, FileText, ShieldCheck, Upload } from "lucide-react";

type AfipStatus = "unconfigured" | "pending_certificate" | "active";

type AfipConfig = {
  cuit?: string;
  puntoVenta?: number;
  fiscalCondition?: string;
  status: AfipStatus;
  activatedAt?: { toDate?: () => Date };
};

const db = getDb();
const functions = getFunctions(undefined, "us-central1");

const STEPS = ["Datos fiscales", "Certificado ARCA", "Activado"];

const ARCA_INSTRUCTIONS = [
  "Ingresá a **arca.gob.ar** con tu CUIT y clave fiscal.",
  'En el menú, buscá **"Administración de Certificados Digitales"** (o WSASS).',
  "Creá un nuevo certificado para el servicio **wsfe**.",
  'Pegá el texto del CSR en el campo correspondiente y hacé clic en **"Crear"**.',
  "Descargá el archivo **.crt** que genera ARCA.",
  "Subilo acá abajo para activar la facturación.",
];

export function AfipConfigPanel({ restaurantId }: { restaurantId: string }) {
  const [config, setConfig] = useState<AfipConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Step 1 state
  const [cuit, setCuit] = useState("");
  const [puntoVenta, setPuntoVenta] = useState("1");
  const [fiscalCondition, setFiscalCondition] = useState<"monotributista" | "responsable_inscripto">("responsable_inscripto");

  // Step 2 state
  const [csrPem, setCsrPem] = useState("");
  const [certFile, setCertFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const ref = doc(
      collection(db, "restaurants", restaurantId, "afipConfig"),
      "main"
    );
    return onSnapshot(ref, (snap) => {
      setConfig(snap.exists() ? (snap.data() as AfipConfig) : { status: "unconfigured" });
      setLoading(false);
    });
  }, [restaurantId]);

  const currentStep =
    !config || config.status === "unconfigured" ? 0
    : config.status === "pending_certificate" ? 1
    : 2;

  // ─── Paso 1: Generar CSR ───────────────────────────────────────────────────

  const handleGenerateCsr = async () => {
    const rawCuit = cuit.replace(/\D/g, "");
    if (rawCuit.length !== 11) {
      toast.error("El CUIT debe tener 11 dígitos.");
      return;
    }
    const pv = Number(puntoVenta);
    if (!pv || pv < 1) {
      toast.error("El punto de venta debe ser un número positivo.");
      return;
    }
    try {
      setSaving(true);
      const fn = httpsCallable<unknown, { csrPem: string }>(functions, "afipGenerateCsr");
      const res = await fn({ restaurantId, cuit: rawCuit, puntoVenta: pv, fiscalCondition });
      setCsrPem(res.data.csrPem);
      toast.success("CSR generado. Ahora pegalo en ARCA.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo generar el CSR.");
    } finally {
      setSaving(false);
    }
  };

  // ─── Paso 2: Subir certificado ─────────────────────────────────────────────

  const handleSaveCertificate = async () => {
    if (!certFile) {
      toast.error("Seleccioná el archivo .crt que descargaste de ARCA.");
      return;
    }
    const text = await certFile.text();
    if (!text.includes("BEGIN CERTIFICATE")) {
      toast.error("El archivo no parece un certificado PEM válido.");
      return;
    }
    try {
      setSaving(true);
      const fn = httpsCallable(functions, "afipSaveCertificate");
      await fn({ restaurantId, certificatePem: text });
      toast.success("¡Facturación ARCA activada!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo activar el certificado.");
    } finally {
      setSaving(false);
    }
  };

  const copyCsr = () => {
    navigator.clipboard.writeText(csrPem).then(() => toast.success("CSR copiado al portapapeles."));
  };

  if (loading) {
    return <p className="text-sm text-zinc-500">Cargando configuración ARCA...</p>;
  }

  return (
    <div className="space-y-6">
      {/* Progress steps */}
      <div className="flex items-center gap-2">
        {STEPS.map((label, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition ${
              idx < currentStep ? "bg-emerald-600 text-white"
              : idx === currentStep ? "bg-zinc-900 text-white"
              : "border border-zinc-200 bg-white text-zinc-400"
            }`}>
              {idx < currentStep ? "✓" : idx + 1}
            </div>
            <span className={`text-sm font-semibold ${idx === currentStep ? "text-zinc-900" : "text-zinc-400"}`}>
              {label}
            </span>
            {idx < STEPS.length - 1 && <ChevronRight size={14} className="text-zinc-300" />}
          </div>
        ))}
      </div>

      {/* ── PASO 1: Datos fiscales ────────────────────────────────────────── */}
      {currentStep === 0 && (
        <div className="rounded-xl border border-zinc-200 bg-white p-6 space-y-4">
          <div>
            <h3 className="font-bold text-zinc-950">Datos fiscales del restaurante</h3>
            <p className="mt-1 text-sm text-zinc-500">
              Estos datos se usan para generar el certificado digital que ARCA necesita.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-bold text-zinc-600">CUIT (sin guiones)</label>
              <input
                value={cuit}
                onChange={(e) => setCuit(e.target.value.replace(/\D/g, "").slice(0, 11))}
                placeholder="20123456789"
                maxLength={11}
                className="h-11 w-full rounded-lg border border-zinc-200 px-3 text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-black/10"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-zinc-600">Punto de venta en ARCA</label>
              <input
                type="number"
                min={1}
                max={9999}
                value={puntoVenta}
                onChange={(e) => setPuntoVenta(e.target.value)}
                placeholder="1"
                className="h-11 w-full rounded-lg border border-zinc-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
              />
              <p className="mt-1 text-xs text-zinc-400">El número que creaste en arca.gob.ar → Puntos de venta</p>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-bold text-zinc-600">Condición fiscal</label>
              <div className="flex gap-3">
                {(["responsable_inscripto", "monotributista"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setFiscalCondition(v)}
                    className={`flex-1 rounded-lg border py-2.5 text-sm font-semibold transition ${
                      fiscalCondition === v
                        ? "border-zinc-900 bg-zinc-900 text-white"
                        : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400"
                    }`}
                  >
                    {v === "responsable_inscripto" ? "Responsable Inscripto" : "Monotributista"}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-zinc-400">
                {fiscalCondition === "responsable_inscripto"
                  ? "Emitirá Factura A (para empresas con CUIT) y Factura B (para consumidores finales)."
                  : "Emitirá Factura C para todos los clientes."}
              </p>
            </div>
          </div>

          <button
            onClick={handleGenerateCsr}
            disabled={saving || cuit.length < 11}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-zinc-950 font-bold text-white disabled:opacity-50"
          >
            {saving ? "Generando certificado..." : "Generar certificado →"}
          </button>
        </div>
      )}

      {/* ── PASO 2: Subir certificado ─────────────────────────────────────── */}
      {currentStep === 1 && (
        <div className="space-y-4">
          {/* CSR */}
          {csrPem && (
            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText size={16} className="text-zinc-600" />
                  <h3 className="font-bold text-zinc-950">Tu CSR generado</h3>
                </div>
                <button
                  onClick={copyCsr}
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-bold text-zinc-700 hover:bg-zinc-100"
                >
                  <Copy size={13} /> Copiar
                </button>
              </div>
              <pre className="max-h-36 overflow-auto rounded-lg bg-zinc-950 p-3 text-xs text-emerald-400 font-mono leading-relaxed">
                {csrPem}
              </pre>
            </div>
          )}

          {/* Instrucciones */}
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
            <h3 className="mb-3 font-bold text-amber-900">
              {csrPem ? "Ahora pegalo en ARCA:" : "Pasos para configurar en ARCA:"}
            </h3>
            <ol className="space-y-2">
              {ARCA_INSTRUCTIONS.map((step, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-amber-800">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-600 text-xs font-bold text-white">
                    {i + 1}
                  </span>
                  <span dangerouslySetInnerHTML={{
                    __html: step.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
                  }} />
                </li>
              ))}
            </ol>
            <a
              href="https://www.arca.gob.ar"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-amber-600 text-sm font-bold text-white hover:bg-amber-700"
            >
              Ir a ARCA →
            </a>
          </div>

          {/* Upload .crt */}
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <h3 className="mb-3 font-bold text-zinc-950">Subir el certificado (.crt)</h3>
            <div
              onClick={() => fileRef.current?.click()}
              className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-zinc-300 p-6 hover:border-zinc-400 hover:bg-zinc-50 transition"
            >
              <Upload size={24} className="text-zinc-400" />
              <p className="text-sm font-semibold text-zinc-600">
                {certFile ? certFile.name : "Hacé clic para seleccionar el .crt de ARCA"}
              </p>
              <p className="text-xs text-zinc-400">Archivo en formato PEM (.crt)</p>
              <input
                ref={fileRef}
                type="file"
                accept=".crt,.pem,.cer"
                className="hidden"
                onChange={(e) => setCertFile(e.target.files?.[0] ?? null)}
              />
            </div>
            {certFile && (
              <button
                onClick={handleSaveCertificate}
                disabled={saving}
                className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-zinc-950 font-bold text-white disabled:opacity-50"
              >
                {saving ? "Activando..." : "Activar facturación electrónica →"}
              </button>
            )}
          </div>

          {!csrPem && (
            <p className="text-center text-xs text-zinc-400">
              Si ya generaste el CSR antes, cerrá y volvé a abrir esta pantalla para verlo.
            </p>
          )}
        </div>
      )}

      {/* ── PASO 3: Activo ────────────────────────────────────────────────── */}
      {currentStep === 2 && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
          <div className="flex items-center gap-3 mb-4">
            <ShieldCheck size={32} className="text-emerald-600 shrink-0" />
            <div>
              <h3 className="font-bold text-emerald-900 text-lg">Facturación electrónica activa</h3>
              <p className="text-sm text-emerald-700 mt-0.5">
                Want está conectado a ARCA con el certificado del restaurante.
              </p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-lg border border-emerald-200 bg-white p-3">
              <p className="text-xs font-bold text-zinc-500">CUIT</p>
              <p className="mt-1 font-mono font-bold text-zinc-950">{config?.cuit ?? "—"}</p>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-white p-3">
              <p className="text-xs font-bold text-zinc-500">Punto de venta</p>
              <p className="mt-1 font-bold text-zinc-950">{config?.puntoVenta ?? "—"}</p>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-white p-3">
              <p className="text-xs font-bold text-zinc-500">Condición fiscal</p>
              <p className="mt-1 font-bold text-zinc-950 capitalize">
                {config?.fiscalCondition === "responsable_inscripto" ? "Resp. Inscripto" : "Monotributista"}
              </p>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-white p-3">
            <CheckCircle size={15} className="text-emerald-600 shrink-0" />
            <p className="text-xs text-zinc-600">
              Los certificados de ARCA duran 2 años. Cuando venzan, repetí el proceso desde el Paso 1.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
