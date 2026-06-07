import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Boxes,
  Lock,
  PackagePlus,
  PauseCircle,
  PlayCircle,
} from "lucide-react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";

import { getDb } from "../lib/firebase";
import { canUseStock } from "../lib/plan";
import { toast } from "sonner";
import {
  addStock,
  createStockItem,
  removeStock,
  toggleStockItem,
} from "../lib/stock";

import type { StockItem, StockUnit } from "../types/stock";
import { useAuth } from "../lib/auth-context";

const db = getDb();

type Props = {
  restaurantId: string;
  plan?: string | null;
};

const units: StockUnit[] = ["kg", "g", "l", "ml", "unit"];

export const StockPanel = ({ restaurantId, plan }: Props) => {
  const { user } = useAuth();
  const stockEnabled = canUseStock(plan);

  const [items, setItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [unit, setUnit] = useState<StockUnit>("unit");
  const [quantity, setQuantity] = useState(0);
  const [minimumQuantity, setMinimumQuantity] = useState(0);
  const [costPerUnit, setCostPerUnit] = useState("");
  const [supplier, setSupplier] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const q = query(
      collection(db, "restaurants", restaurantId, "stock"),
      orderBy("name")
    );

    const unsub = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      })) as StockItem[];

      setItems(data);
      setLoading(false);
    });

    return () => unsub();
  }, [restaurantId]);

  const lowStockCount = useMemo(() => {
    return items.filter(
      (item) =>
        item.active &&
        Number(item.currentQuantity || 0) <=
          Number(item.minimumQuantity || 0)
    ).length;
  }, [items]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stockEnabled || !user) return;

    try {
      setSaving(true);

      await createStockItem({
        restaurantId,
        name,
        category,
        unit,
        currentQuantity: quantity,
        minimumQuantity,
        costPerUnit: costPerUnit ? Number(costPerUnit) : undefined,
        supplier,
        notes,
      }, {
        actorUid: user.uid,
        actorEmail: user.email,
        actorRole: "admin",
      });

      setName("");
      setCategory("");
      setQuantity(0);
      setMinimumQuantity(0);
      setCostPerUnit("");
      setSupplier("");
      setNotes("");
    } catch (error) {
      console.error(error);
      toast.error("No se pudo crear el insumo");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mt-8 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-zinc-950 text-white">
            <Boxes size={22} />
          </div>

          <div>
            <h2 className="text-2xl font-bold text-zinc-950">
              Control de stock
            </h2>

            <p className="mt-1 text-sm text-zinc-500">
              Gestión manual de insumos e inventario.
            </p>
          </div>
        </div>

        {!stockEnabled && (
          <div className="rounded-lg border border-amber-300 bg-amber-100 px-4 py-3 text-right">
            <div className="flex items-center gap-2 text-amber-900">
              <Lock size={16} />
              <span className="text-sm font-bold uppercase tracking-wide">
                Premium only
              </span>
            </div>

            <p className="mt-1 text-xs text-amber-800">
              Actualizá tu plan para desbloquear stock.
            </p>
          </div>
        )}
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <p className="text-sm text-zinc-500">Items</p>
          <p className="mt-2 text-3xl font-bold text-zinc-950">
            {items.length}
          </p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <p className="text-sm text-zinc-500">Stock bajo</p>
          <p className="mt-2 text-3xl font-bold text-red-600">
            {lowStockCount}
          </p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <p className="text-sm text-zinc-500">Plan requerido</p>
          <p className="mt-2 text-3xl font-bold text-zinc-950">
            Premium
          </p>
        </div>
      </div>

      {/* F-007: Banner de alerta de stock bajo */}
      {lowStockCount > 0 && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-red-600 shrink-0" />
            <p className="text-sm font-bold text-red-800">
              {lowStockCount} {lowStockCount === 1 ? "insumo" : "insumos"} con stock bajo o agotado
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {items
              .filter((i) => i.active && Number(i.currentQuantity || 0) <= Number(i.minimumQuantity || 0))
              .map((i) => (
                <span key={i.id} className="rounded-full bg-red-100 border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-700">
                  {i.name} — {i.currentQuantity} {i.unit}
                </span>
              ))}
          </div>
        </div>
      )}

      <form
        onSubmit={handleCreate}
        className="mb-8 grid gap-3 lg:grid-cols-3"
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre"
          disabled={!stockEnabled}
          required
          className="h-11 rounded-lg border border-zinc-200 px-3"
        />

        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Categoría"
          disabled={!stockEnabled}
          required
          className="h-11 rounded-lg border border-zinc-200 px-3"
        />

        <select
          value={unit}
          onChange={(e) => setUnit(e.target.value as StockUnit)}
          disabled={!stockEnabled}
          className="h-11 rounded-lg border border-zinc-200 px-3"
        >
          {units.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>

        <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-zinc-500">
                Cantidad actual del producto
            </label>
            <input
                type="number"
                min={0}
                step="any"
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                placeholder="Ej: 10"
                disabled={!stockEnabled}
                className="h-11 w-full rounded-lg border border-zinc-200 px-3"
            />
        </div>

        <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-zinc-500">
                Mínimo del producto
            </label>
            <input
                type="number"
                min={0}
                step="any"
                value={minimumQuantity}
                onChange={(e) => setMinimumQuantity(Number(e.target.value))}
                placeholder="Ej: 2"
                disabled={!stockEnabled}
                className="h-11 w-full rounded-lg border border-zinc-200 px-3"
            />
        </div>

        <input
          value={costPerUnit}
          onChange={(e) => setCostPerUnit(e.target.value)}
          type="number"
          min={0}
          step="any"
          placeholder="Costo por unidad ($)"
          disabled={!stockEnabled}
          className="h-11 rounded-lg border border-zinc-200 px-3"
          title="F-029: Costo por unidad para calcular margen"
        />

        <input
          value={supplier}
          onChange={(e) => setSupplier(e.target.value)}
          placeholder="Proveedor"
          disabled={!stockEnabled}
          className="h-11 rounded-lg border border-zinc-200 px-3"
        />

        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notas"
          disabled={!stockEnabled}
          className="min-h-[110px] rounded-lg border border-zinc-200 p-3 lg:col-span-2"
        />

        <button
          type="submit"
          disabled={!stockEnabled || saving}
          className="flex min-h-[110px] items-center justify-center gap-2 rounded-lg bg-zinc-950 px-5 font-bold text-white disabled:opacity-50"
        >
          <PackagePlus size={18} />
          {saving ? "Guardando..." : "Crear insumo"}
        </button>
      </form>

      {loading ? (
        <div className="rounded-xl border border-zinc-200 p-5 text-zinc-500">
          Cargando stock...
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-zinc-500">
          Todavía no hay insumos cargados.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const lowStock =
              Number(item.currentQuantity || 0) <=
              Number(item.minimumQuantity || 0);

            return (
              <div
                key={item.id}
                className="rounded-xl border border-zinc-200 p-4"
              >
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-bold text-zinc-950">
                        {item.name}
                      </h3>

                      {!item.active && (
                        <span className="rounded-full bg-zinc-200 px-2 py-1 text-xs font-bold uppercase tracking-wide text-zinc-700">
                          Pausado
                        </span>
                      )}

                      {lowStock && (
                        <span className="flex items-center gap-1 rounded-full bg-red-100 px-2 py-1 text-xs font-bold uppercase tracking-wide text-red-700">
                          <AlertTriangle size={12} />
                          Stock bajo
                        </span>
                      )}
                    </div>

                    <p className="mt-1 text-sm text-zinc-500">
                      {item.category}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2 text-sm font-semibold text-zinc-700">
                      {item.currentQuantity} {item.unit}
                    </div>

                    <button
                      disabled={!stockEnabled}
                      onClick={() =>
                        user &&
                        addStock(restaurantId, item, 1, {
                          actorUid: user.uid,
                          actorEmail: user.email,
                          actorRole: "admin",
                        })
                      }
                      className="h-10 rounded-lg border border-zinc-200 px-4 font-semibold text-zinc-900 disabled:opacity-50"
                    >
                      +1
                    </button>

                    <button
                      disabled={!stockEnabled}
                      onClick={() =>
                        user &&
                        removeStock(restaurantId, item, 1, {
                          actorUid: user.uid,
                          actorEmail: user.email,
                          actorRole: "admin",
                        })
                      }
                      className="h-10 rounded-lg border border-zinc-200 px-4 font-semibold text-zinc-900 disabled:opacity-50"
                    >
                      -1
                    </button>

                    <button
                      disabled={!stockEnabled}
                      onClick={() =>
                        toggleStockItem(
                          restaurantId,
                          item,
                          !item.active,
                          {
                            actorUid: user?.uid || "",
                            actorEmail: user?.email,
                            actorRole: "admin",
                          }
                        )
                      }
                      className="flex h-10 items-center gap-2 rounded-lg bg-zinc-950 px-4 font-semibold text-white disabled:opacity-50"
                    >
                      {item.active ? (
                        <>
                          <PauseCircle size={16} />
                          Pausar
                        </>
                      ) : (
                        <>
                          <PlayCircle size={16} />
                          Activar
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
