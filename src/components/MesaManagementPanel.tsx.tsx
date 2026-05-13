import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, query } from "firebase/firestore";
import { Copy, DoorOpen, Download, Plus, QrCode, X } from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import { getDb } from "../lib/firebase";
import { createMesaIfNotExists, setMesaActive } from "../lib/mesas";
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

  const sortedMesas = useMemo(() => {
    return [...mesas].sort((a, b) => {
      const aNum = Number(a.numero ?? a.id);
      const bNum = Number(b.numero ?? b.id);
      return aNum - bNum;
    });
  }, [mesas]);

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
      alert("Ingresá un número de mesa válido");
      return;
    }

    if (!canCreateTable(restaurantPlan, activeMesasCount)) {
      alert(
        `Tu plan ${PLAN_LABELS[restaurantPlan]} permite hasta ${tableLimitLabel} mesas activas.`
      );
      return;
    }

    try {
      setSaving(true);
      await createMesaIfNotExists(restaurantId, numero);
      setNewMesaNumber("");
    } catch (error) {
      console.error("Error creando mesa:", error);
      alert("No se pudo crear la mesa");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (mesa: MesaAdmin) => {
    const numero = Number(mesa.numero ?? mesa.id);

    if (!Number.isInteger(numero) || numero <= 0) return;

    const nextActive = mesa.active === false;

    if (nextActive && !canCreateTable(restaurantPlan, activeMesasCount)) {
      alert(
        `Tu plan ${PLAN_LABELS[restaurantPlan]} permite hasta ${tableLimitLabel} mesas activas.`
      );
      return;
    }

    if (!nextActive && mesa.estado === "occupied") {
      alert("No podés desactivar una mesa ocupada.");
      return;
    }

    try {
      setSaving(true);
      await setMesaActive(restaurantId, numero, nextActive);
    } catch (error) {
      console.error("Error actualizando mesa:", error);
      alert("No se pudo actualizar la mesa");
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
      <section className="mb-6 rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-zinc-950 text-white">
              <DoorOpen size={20} />
            </div>

            <div>
              <h2 className="text-xl font-black text-zinc-950">
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

          <form onSubmit={handleCreateMesa} className="flex gap-2">
            <input
              type="number"
              min={1}
              placeholder="N° mesa"
              value={newMesaNumber}
              onChange={(e) => setNewMesaNumber(e.target.value)}
              className="h-11 w-32 rounded-2xl border border-zinc-200 px-3 outline-none focus:ring-2 focus:ring-black/10"
            />

            <button
              type="submit"
              disabled={saving || reachedTableLimit}
              className="flex h-11 items-center gap-2 rounded-2xl bg-zinc-950 px-4 font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
            >
              <Plus size={16} />
              Crear
            </button>
          </form>
        </div>

        {reachedTableLimit && (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            Alcanzaste el límite de mesas activas para el plan{" "}
            {PLAN_LABELS[restaurantPlan]}. Desactivá una mesa o subí de plan.
          </div>
        )}

        {loading ? (
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500">
            Cargando mesas...
          </div>
        ) : sortedMesas.length === 0 ? (
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500">
            Todavía no hay mesas creadas.
          </div>
        ) : (
          <div className="max-h-[430px] overflow-y-auto rounded-2xl border border-zinc-200">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="sticky top-0 z-10 bg-zinc-50">
                <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                  <th className="py-3 pl-4 pr-4">Mesa</th>
                  <th className="py-3 pr-4">Estado operativo</th>
                  <th className="py-3 pr-4">Visible QR</th>
                  <th className="py-3 pr-4 text-right">Acciones</th>
                </tr>
              </thead>

              <tbody>
                {sortedMesas.map((mesa) => {
                  const numero = Number(mesa.numero ?? mesa.id);
                  const active = mesa.active !== false;

                  return (
                    <tr
                      key={mesa.id}
                      className="border-b border-zinc-100 last:border-0"
                    >
                      <td className="py-4 pl-4 pr-4">
                        <p className="text-lg font-black text-zinc-950">
                          Mesa {numero}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          Documento: {mesa.id}
                        </p>
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
                            className="flex h-10 items-center gap-2 rounded-2xl bg-zinc-950 px-4 font-semibold text-white transition hover:opacity-90"
                          >
                            <QrCode size={15} />
                            Ver QR
                          </button>

                          <button
                            onClick={() => copyQrLink(mesa)}
                            className="flex h-10 items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 font-semibold text-zinc-900 transition hover:bg-zinc-50"
                          >
                            <Copy size={15} />
                            Copiar link
                          </button>

                          <button
                            onClick={() => handleToggleActive(mesa)}
                            disabled={saving}
                            className={`h-10 rounded-2xl px-4 font-semibold text-white transition hover:opacity-90 disabled:opacity-60 ${
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
        )}
      </section>

      {qrMesa && qrMesaNumber && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-2xl font-black text-zinc-950">
                  QR Mesa {qrMesaNumber}
                </h3>
                <p className="mt-1 text-sm text-zinc-500">
                  Este QR abre el menú directo para esta mesa.
                </p>
              </div>

              <button
                onClick={() => setQrMesa(null)}
                className="flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200 text-zinc-700 transition hover:bg-zinc-50"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex justify-center rounded-3xl border border-zinc-200 bg-white p-5">
              <QRCodeCanvas
                id="mesa-qr-canvas"
                value={qrUrl}
                size={260}
                level="H"
                includeMargin
              />
            </div>

            <p className="mt-4 break-all rounded-2xl bg-zinc-50 p-3 text-xs text-zinc-500">
              {qrUrl}
            </p>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                onClick={() => copyQrLink(qrMesa)}
                className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white font-semibold text-zinc-900 transition hover:bg-zinc-50"
              >
                <Copy size={16} />
                Copiar link
              </button>

              <button
                onClick={downloadQr}
                className="flex h-11 items-center justify-center gap-2 rounded-2xl bg-zinc-950 font-semibold text-white transition hover:opacity-90"
              >
                <Download size={16} />
                Descargar PNG
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}