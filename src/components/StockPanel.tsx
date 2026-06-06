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

const db = getDb();

type Props = {
  restaurantId: string;
  plan?: string | null;
};

const units: StockUnit[] = ["kg", "g", "l", "ml", "unit"];

export const StockPanel = ({ restaurantId, plan }: Props) => {
  const stockEnabled = canUseStock(plan);

  const [items, setItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [unit, setUnit] = useState<StockUnit>("unit");
  const [quantity, setQuantity] = useState(0);
  const [minimumQuantity, setMinimumQuantity] = useState(0);
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

    if (!stockEnabled) return;

    try {
      setSaving(true);

      await createStockItem({
        restaurantId,
        name,
        category,
        unit,
        currentQuantity: quantity,
        minimumQuantity,
        supplier,
        notes,
      });

      setName("");
      setCategory("");
      setQuantity(0);
      setMinimumQuantity(0);
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
    <section className="mt-8 rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-zinc-950 text-white">
            <Boxes size={22} />
          </div>

          <div>
            <h2 className="text-2xl font-bold text-foreground">
              Control de stock
            </h2>

            <p className="mt-1 text-sm text-muted-foreground">
              Gestión manual de insumos e inventario.
            </p>
          </div>
        </div>

        {!stockEnabled && (
          <div className="rounded-lg border border-amber-300 bg-amber-100 px-4 py-3 text-right">
            <div className="flex items-center gap-2 text-amber-300">
              <Lock size={16} />
              <span className="text-sm font-bold uppercase tracking-wide">
                Premium only
              </span>
            </div>

            <p className="mt-1 text-xs text-amber-400">
              Actualizá tu plan para desbloquear stock.
            </p>
          </div>
        )}
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-border bg-secondary p-4">
          <p className="text-sm text-muted-foreground">Items</p>
          <p className="mt-2 text-3xl font-bold text-foreground">
            {items.length}
          </p>
        </div>

        <div className="rounded-xl border border-border bg-secondary p-4">
          <p className="text-sm text-muted-foreground">Stock bajo</p>
          <p className="mt-2 text-3xl font-bold text-red-400">
            {lowStockCount}
          </p>
        </div>

        <div className="rounded-xl border border-border bg-secondary p-4">
          <p className="text-sm text-muted-foreground">Plan requerido</p>
          <p className="mt-2 text-3xl font-bold text-foreground">
            Premium
          </p>
        </div>
      </div>

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
          className="h-11 rounded-lg border border-border px-3"
        />

        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Categoría"
          disabled={!stockEnabled}
          required
          className="h-11 rounded-lg border border-border px-3"
        />

        <select
          value={unit}
          onChange={(e) => setUnit(e.target.value as StockUnit)}
          disabled={!stockEnabled}
          className="h-11 rounded-lg border border-border px-3"
        >
          {units.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>

        <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted-foreground">
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
                className="h-11 w-full rounded-lg border border-border px-3"
            />
        </div>

        <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted-foreground">
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
                className="h-11 w-full rounded-lg border border-border px-3"
            />
        </div>

        <input
          value={supplier}
          onChange={(e) => setSupplier(e.target.value)}
          placeholder="Proveedor"
          disabled={!stockEnabled}
          className="h-11 rounded-lg border border-border px-3"
        />

        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notas"
          disabled={!stockEnabled}
          className="min-h-[110px] rounded-lg border border-border p-3 lg:col-span-2"
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
        <div className="rounded-xl border border-border p-5 text-muted-foreground">
          Cargando stock...
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-muted-foreground">
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
                className="rounded-xl border border-border p-4"
              >
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-bold text-foreground">
                        {item.name}
                      </h3>

                      {!item.active && (
                        <span className="rounded-full bg-zinc-200 px-2 py-1 text-xs font-bold uppercase tracking-wide text-foreground">
                          Pausado
                        </span>
                      )}

                      {lowStock && (
                        <span className="flex items-center gap-1 rounded-full bg-red-100 px-2 py-1 text-xs font-bold uppercase tracking-wide text-red-400">
                          <AlertTriangle size={12} />
                          Stock bajo
                        </span>
                      )}
                    </div>

                    <p className="mt-1 text-sm text-muted-foreground">
                      {item.category}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="rounded-lg border border-border bg-secondary px-4 py-2 text-sm font-semibold text-foreground">
                      {item.currentQuantity} {item.unit}
                    </div>

                    <button
                      disabled={!stockEnabled}
                      onClick={() => addStock(restaurantId, item, 1)}
                      className="h-10 rounded-lg border border-border px-4 font-semibold text-foreground disabled:opacity-50"
                    >
                      +1
                    </button>

                    <button
                      disabled={!stockEnabled}
                      onClick={() => removeStock(restaurantId, item, 1)}
                      className="h-10 rounded-lg border border-border px-4 font-semibold text-foreground disabled:opacity-50"
                    >
                      -1
                    </button>

                    <button
                      disabled={!stockEnabled}
                      onClick={() =>
                        toggleStockItem(
                          restaurantId,
                          item.id,
                          !item.active
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