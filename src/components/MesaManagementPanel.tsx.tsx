import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDocs, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { Clock, Copy, DoorOpen, Download, History, Plus, QrCode, X } from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import { getDb } from "../lib/firebase";
import { createMesaIfNotExists, setMesaActive, setMesaZona } from "../lib/mesas";
import { toast } from "sonner";
import {
  canCreateTable,
  getPlanLimits,
  getTableLimitLabel,
  normalizePlan,
  PLAN_LABELS,
  type RestaurantPlan,
} from "../lib/plan";

type MesaAdmin = {
  id: string;
  numero?: number;
  estado?: string;
  active?: boolean;
  zona?: string;
};

type RestaurantBillingData = {
  plan?: RestaurantPlan;
};

type Props = {
  restaurantId: string;
  qrBasePath?: string;
};

const db = getDb();

const getMenuUrl = (
  restaurantId: string,
  mesa: number,
  qrBasePath: string
) => {
  const origin = window.location.origin;

  return `${origin}${qrBasePath}?restaurantId=${encodeURIComponent(
    restaurantId
  )}&table=${encodeURIComponent(String(mesa))}`;
};
export function MesaManagementPanel({
  restaurantId,
  qrBasePath = "/menu",
}: Props) {
  const [mesas, setMesas] = useState<MesaAdmin[]>([]);
  const [restaurantPlan, setRestaurantPlan] = useState<RestaurantPlan>("starter");
  const [newMesaNumber, setNewMesaNumber] = useState("");
  const [newMesaZona, setNewMesaZona] = useState("");
  const [filterZona, setFilterZona] = useState("all");
  const [editingZona, setEditingZona] = useState<{ mesaId: string; value: string } | null>(null);
  const [historialMesa, setHistorialMesa] = useState<MesaAdmin | null>(null);
  const [historialItems, setHistorialItems] = useState<{ id: string; mesa: number; total: number; estado: string; paidAt?: number; createdAt?: number; payments?: { method: string }[] }[]>([]);
  const [loadingHistorial, setLoadingHistorial] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [qrMesa, setQrMesa] = useState<MesaAdmin | null>(null);

  useEffect(() => {
    if (!restaurantId) return;

    const unsubscribe = onSnapshot(
      doc(db, "restaurants", restaurantId),
      (snapshot) => {
        const data = snapshot.data() as RestaurantBillingData | undefined;
        setRestaurantPlan(normalizePlan(data?.plan));
      },
      (error) => {
        console.error("Error cargando plan del restaurante:", error);
        setRestaurantPlan("starter");
      }
    );

    return () => unsubscribe();
  }, [restaurantId]);

  useEffect(() => {
    if (!restaurantId) return;

    setLoading(true);

    const q = query(collection(db, "restaurants", restaurantId, "mesas"));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        })) as MesaAdmin[];

        setMesas(data);
        setLoading(false);
      },
      (error) => {
        console.error("Error cargando mesas:", error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [restaurantId]);

  const allZonas = useMemo(() => {
    const set = new Set(mesas.map((m) => m.zona).filter(Boolean) as string[]);
    return Array.from(set).sort();
  }, [mesas]);

  const sortedMesas = useMemo(() => {
    return [...mesas]
      .filter((m) => filterZona === "all" || m.zona === filterZona)
      .sort((a, b) => {
        const aNum = Number(a.numero ?? a.id);
        const bNum = Number(b.numero ?? b.id);
        return aNum - bNum;
      });
  }, [mesas, filterZona]);

  const handleOpenHistorial = async (mesa: MesaAdmin) => {
    const numero = Number(mesa.numero ?? mesa.id);
    setHistorialMesa(mesa);
    setHistorialItems([]);
    setLoadingHistorial(true);
    try {
      const q = query(
        collection(db, "restaurants", restaurantId, "cuentas"),
        where("mesa", "==", numero),
        where("estado", "==", "pagada"),
        orderBy("paidAt", "desc"),
        limit(10)
      );
      const snap = await getDocs(q);
      setHistorialItems(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as { id: string; mesa: number; total: number; estado: string; paidAt?: number; createdAt?: number; payments?: { method: string }[] }));
    } catch {
      toast.error("No se pudo cargar el historial.");
    } finally {
      setLoadingHistorial(false);
    }
  };

  const handleSaveZona = async (mesa: MesaAdmin) => {
    if (!editingZona || editingZona.mesaId !== mesa.id) return;
    const numero = Number(mesa.numero ?? mesa.id);
    try {
      setSaving(true);
      await setMesaZona(restaurantId, numero, editingZona.value);
      setEditingZona(null);
      toast.success("Zona actualizada.");
    } catch {
      toast.error("No se pudo guardar la zona.");
    } finally {
      setSaving(false);
    }
  };

  const activeMesasCount = useMemo(() => {
    return mesas.filter((mesa) => mesa.active !== false).length;
  }, [mesas]);

  const tableLimitLabel = getTableLimitLabel(restaurantPlan);
  const planLimits = getPlanLimits(restaurantPlan);
  const reachedTableLimit = !canCreateTable(restaurantPlan, activeMesasCount);

  const handleCreateMesa = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const numero = Number(newMesaNumber);

    if (!Number.isInteger(numero) || numero <= 0) {
      toast.error("Ingresá un número de mesa válido");
      return;
    }

    if (!canCreateTable(restaurantPlan, activeMesasCount)) {
      toast.warning(
        `Tu plan ${PLAN_LABELS[restaurantPlan]} permite hasta ${tableLimitLabel} mesas activas.`
      );
      return;
    }

    try {
      setSaving(true);
      await createMesaIfNotExists(restaurantId, numero, newMesaZona.trim() || undefined);
      setNewMesaNumber("");
      setNewMesaZona("");
    } catch (error) {
      console.error("Error creando mesa:", error);
      toast.error("No se pudo crear la mesa");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (mesa: MesaAdmin) => {
    const numero = Number(mesa.numero ?? mesa.id);

    if (!Number.isInteger(numero) || numero <= 0) return;

    const nextActive = mesa.active === false;

    if (nextActive && !canCreateTable(restaurantPlan, activeMesasCount)) {
      toast.error(
        `Tu plan ${PLAN_LABELS[restaurantPlan]} permite hasta ${tableLimitLabel} mesas activas.`
      );
      return;
    }

    if (!nextActive && mesa.estado === "occupied") {
      toast.error("No podés desactivar una mesa ocupada.");
      return;
    }

    try {
      setSaving(true);
      await setMesaActive(restaurantId, numero, nextActive);
    } catch (error) {
      console.error("Error actualizando mesa:", error);
      toast.error("No se pudo actualizar la mesa");
    } finally {
      setSaving(false);
    }
  };

  const copyQrLink = async (mesa: MesaAdmin) => {
    const numero = Number(mesa.numero ?? mesa.id);

    if (!Number.isInteger(numero) || numero <= 0) return;

    const url = getMenuUrl(restaurantId, mesa.numero, qrBasePath)

    try {
      await navigator.clipboard.writeText(url);
      alert(`Link QR de mesa ${numero} copiado`);
    } catch {
      window.prompt("Copiá el link QR:", url);
    }
  };

  const downloadQr = () => {
    if (!qrMesa) return;

    const numero = Number(qrMesa.numero ?? qrMesa.id);
    const canvas = document.getElementById(
      "mesa-qr-canvas"
    ) as HTMLCanvasElement | null;

    if (!canvas) return;

    const pngUrl = canvas.toDataURL("image/png");

    const link = document.createElement("a");
    link.href = pngUrl;
    link.download = `qr-mesa-${numero}.png`;
    link.click();
  };

  const qrMesaNumber = qrMesa ? Number(qrMesa.numero ?? qrMesa.id) : null;

  const qrUrl =
    qrMesaNumber && Number.isInteger(qrMesaNumber)
      ? getMenuUrl(restaurantId, qrMesaNumber, qrBasePath)
      : "";

  return (
    <>
      <section className="mb-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-zinc-950 text-white">
              <DoorOpen size={20} />
            </div>

            <div>
              <h2 className="text-xl font-bold text-zinc-950">
                Gestión de mesas
              </h2>
              <p className="mt-1 text-sm text-zinc-500">
                Creá mesas, activalas/desactivalas y generá el QR real.
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-zinc-700">
                  Plan {PLAN_LABELS[restaurantPlan]}
                </span>

                <span
                  className={`rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wide ${
                    reachedTableLimit
                      ? "border-red-200 bg-red-100 text-red-700"
                      : "border-emerald-200 bg-emerald-100 text-emerald-700"
                  }`}
                >
                  Mesas activas: {activeMesasCount} / {tableLimitLabel}
                </span>

                {planLimits.maxTables !== null && (
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">
                    Upgrade a Premium para mesas ilimitadas
                  </span>
                )}
              </div>
            </div>
          </div>

          <form onSubmit={handleCreateMesa} className="flex flex-wrap gap-2">
            <input
              type="number"
              min={1}
              placeholder="N° mesa"
              value={newMesaNumber}
              onChange={(e) => setNewMesaNumber(e.target.value)}
              className="h-11 w-28 rounded-lg border border-zinc-200 px-3 outline-none focus:ring-2 focus:ring-black/10"
            />
            <input
              type="text"
              placeholder="Zona (opcional)"
              value={newMesaZona}
              onChange={(e) => setNewMesaZona(e.target.value)}
              className="h-11 w-36 rounded-lg border border-zinc-200 px-3 text-sm outline-none focus:ring-2 focus:ring-black/10"
            />
            <button
              type="submit"
              disabled={saving || reachedTableLimit}
              className="flex h-11 items-center gap-2 rounded-lg bg-zinc-950 px-4 font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
            >
              <Plus size={16} />
              Crear
            </button>
          </form>
        </div>

        {reachedTableLimit && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            Alcanzaste el límite de mesas activas para el plan{" "}
            {PLAN_LABELS[restaurantPlan]}. Desactivá una mesa o subí de plan.
          </div>
        )}

        {loading ? (
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500">
            Cargando mesas...
          </div>
        ) : sortedMesas.length === 0 ? (
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500">
            Todavía no hay mesas creadas.
          </div>
        ) : (
          <>
          {/* F-013: Filtro por zona */}
          {allZonas.length > 0 && (
            <div className="mb-3 flex items-center gap-2">
              <span className="text-xs font-bold text-zinc-500">Filtrar por zona:</span>
              <select
                value={filterZona}
                onChange={(e) => setFilterZona(e.target.value)}
                className="h-9 rounded-lg border border-zinc-200 px-3 text-sm"
              >
                <option value="all">Todas</option>
                {allZonas.map((z) => (
                  <option key={z} value={z}>{z}</option>
                ))}
              </select>
            </div>
          )}

          <div className="max-h-[430px] overflow-y-auto rounded-lg border border-zinc-200">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="sticky top-0 z-10 bg-zinc-50">
                <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                  <th className="py-3 pl-4 pr-4">Mesa</th>
                  <th className="py-3 pr-4">Zona</th>
                  <th className="py-3 pr-4">Estado operativo</th>
                  <th className="py-3 pr-4">Visible QR</th>
                  <th className="py-3 pr-4 text-right">Acciones</th>
                </tr>
              </thead>

              <tbody>
                {sortedMesas.map((mesa) => {
                  const numero = Number(mesa.numero ?? mesa.id);
                  const active = mesa.active !== false;
                  const isEditingThisZona = editingZona?.mesaId === mesa.id;

                  return (
                    <tr
                      key={mesa.id}
                      className="border-b border-zinc-100 last:border-0"
                    >
                      <td className="py-4 pl-4 pr-4">
                        <p className="text-lg font-bold text-zinc-950">
                          Mesa {numero}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          Documento: {mesa.id}
                        </p>
                      </td>

                      <td className="py-4 pr-4">
                        {isEditingThisZona ? (
                          <div className="flex items-center gap-1">
                            <input
                              value={editingZona.value}
                              onChange={(e) => setEditingZona({ mesaId: mesa.id, value: e.target.value })}
                              placeholder="Ej: Salón, Terraza"
                              className="h-8 w-28 rounded border border-zinc-300 px-2 text-xs"
                              autoFocus
                              onKeyDown={(e) => { if (e.key === "Enter") handleSaveZona(mesa); if (e.key === "Escape") setEditingZona(null); }}
                            />
                            <button onClick={() => handleSaveZona(mesa)} className="rounded bg-zinc-900 px-2 py-1 text-xs font-bold text-white">OK</button>
                            <button onClick={() => setEditingZona(null)} className="rounded border border-zinc-200 px-2 py-1 text-xs text-zinc-500">✕</button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setEditingZona({ mesaId: mesa.id, value: mesa.zona || "" })}
                            className="rounded-full border border-dashed border-zinc-300 px-2.5 py-1 text-xs font-semibold text-zinc-600 hover:border-zinc-500"
                          >
                            {mesa.zona || "Sin zona"}
                          </button>
                        )}
                      </td>

                      <td className="py-4 pr-4">
                        <span className="rounded-full border border-zinc-200 bg-zinc-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-zinc-700">
                          {mesa.estado || "available"}
                        </span>
                      </td>

                      <td className="py-4 pr-4">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${
                            active
                              ? "border border-emerald-200 bg-emerald-100 text-emerald-700"
                              : "border border-red-200 bg-red-100 text-red-700"
                          }`}
                        >
                          {active ? "Activa" : "Inactiva"}
                        </span>
                      </td>

                      <td className="py-4 pr-4">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => setQrMesa(mesa)}
                            className="flex h-10 items-center gap-2 rounded-lg bg-zinc-950 px-4 font-semibold text-white transition hover:opacity-90"
                          >
                            <QrCode size={15} />
                            Ver QR
                          </button>

                          <button
                            onClick={() => copyQrLink(mesa)}
                            className="flex h-10 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 font-semibold text-zinc-900 transition hover:bg-zinc-50"
                          >
                            <Copy size={15} />
                            Copiar link
                          </button>

                          <button
                            onClick={() => handleOpenHistorial(mesa)}
                            className="flex h-10 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 font-semibold text-zinc-700 transition hover:bg-zinc-50"
                          >
                            <History size={14} />
                            Historial
                          </button>

                          <button
                            onClick={() => handleToggleActive(mesa)}
                            disabled={saving}
                            className={`h-10 rounded-lg px-4 font-semibold text-white transition hover:opacity-90 disabled:opacity-60 ${
                              active ? "bg-red-600" : "bg-emerald-600"
                            }`}
                          >
                            {active ? "Desactivar" : "Activar"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </section>

      {qrMesa && qrMesaNumber && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-2xl font-bold text-zinc-950">
                  QR Mesa {qrMesaNumber}
                </h3>
                <p className="mt-1 text-sm text-zinc-500">
                  Este QR abre el menú directo para esta mesa.
                </p>
              </div>

              <button
                onClick={() => setQrMesa(null)}
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-200 text-zinc-700 transition hover:bg-zinc-50"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex justify-center rounded-xl border border-zinc-200 bg-white p-5">
              <QRCodeCanvas
                id="mesa-qr-canvas"
                value={qrUrl}
                size={260}
                level="H"
                includeMargin
              />
            </div>

            <p className="mt-4 break-all rounded-lg bg-zinc-50 p-3 text-xs text-zinc-500">
              {qrUrl}
            </p>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                onClick={() => copyQrLink(qrMesa)}
                className="flex h-11 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white font-semibold text-zinc-900 transition hover:bg-zinc-50"
              >
                <Copy size={16} />
                Copiar link
              </button>

              <button
                onClick={downloadQr}
                className="flex h-11 items-center justify-center gap-2 rounded-lg bg-zinc-950 font-semibold text-white transition hover:opacity-90"
              >
                <Download size={16} />
                Descargar PNG
              </button>
            </div>
          </div>
        </div>
      )}
      {/* F-015: Modal historial de sesiones de mesa */}
      {historialMesa && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
              <div className="flex items-center gap-2">
                <Clock size={16} className="text-zinc-500" />
                <h3 className="font-bold text-zinc-950">
                  Historial · Mesa {Number(historialMesa.numero ?? historialMesa.id)}
                </h3>
              </div>
              <button onClick={() => setHistorialMesa(null)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-50">
                <X size={16} />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-5">
              {loadingHistorial ? (
                <p className="text-sm text-zinc-500">Cargando historial...</p>
              ) : historialItems.length === 0 ? (
                <p className="text-sm text-zinc-500">No hay sesiones cerradas para esta mesa.</p>
              ) : (
                <div className="space-y-2">
                  {historialItems.map((cuenta) => {
                    const raw = cuenta.paidAt ?? cuenta.createdAt;
                    const ts = raw == null ? 0
                      : typeof raw === "object" && "seconds" in (raw as object)
                        ? (raw as { seconds: number }).seconds * 1000
                        : Number(raw);
                    const method = cuenta.payments?.[0]?.method ?? "—";
                    return (
                      <div key={cuenta.id} className="flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3">
                        <div>
                          <p className="text-sm font-bold text-zinc-950">
                            {new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(cuenta.total || 0)}
                          </p>
                          <p className="text-xs text-zinc-500 capitalize">{method}</p>
                        </div>
                        <p className="text-xs text-zinc-400">
                          {ts ? new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(new Date(ts)) : "—"}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}