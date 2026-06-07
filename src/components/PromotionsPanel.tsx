import { useEffect, useRef, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { ChevronDown, Plus, Search, Tag, Trash2, X } from "lucide-react";
import { getDb } from "../lib/firebase";
import { toast } from "sonner";

type MenuItemOption = {
  id: string;
  name: string;
  category: string;
  price: number;
};

function MenuItemPicker({
  restaurantId,
  value,
  onChange,
  placeholder = "Seleccionar producto (opcional)",
}: {
  restaurantId: string;
  value: string;
  onChange: (name: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<MenuItemOption[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const loadItems = async () => {
    if (items.length > 0) return;
    setLoading(true);
    try {
      const snap = await getDocs(
        query(
          collection(getDb(), "restaurants", restaurantId, "menu"),
          where("active", "==", true)
        )
      );
      const data = snap.docs.map((d) => ({
        id: d.id,
        name: String(d.data().name || ""),
        category: String(d.data().category || ""),
        price: Number(d.data().price || 0),
      }));
      data.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
      setItems(data);
    } catch {
      toast.error("No se pudo cargar el menú.");
    } finally {
      setLoading(false);
    }
  };

  const handleOpen = () => {
    setOpen(true);
    setSearch("");
    void loadItems();
    setTimeout(() => searchRef.current?.focus(), 50);
  };

  const handleSelect = (name: string) => {
    onChange(name);
    setOpen(false);
  };

  const filtered = search.trim()
    ? items.filter((i) => i.name.toLowerCase().includes(search.toLowerCase()))
    : items;

  // Group by category
  const grouped = filtered.reduce<Record<string, MenuItemOption[]>>((acc, item) => {
    const cat = item.category || "Sin categoría";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {});

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="flex h-10 w-full items-center justify-between rounded-lg border border-zinc-200 px-3 text-sm transition hover:border-zinc-400"
      >
        <span className={value ? "text-zinc-950" : "text-zinc-400"}>
          {value || placeholder}
        </span>
        <div className="flex items-center gap-1">
          {value && (
            <span
              role="button"
              onClick={(e) => { e.stopPropagation(); onChange(""); }}
              className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-zinc-100"
            >
              <X size={11} className="text-zinc-400" />
            </span>
          )}
          <ChevronDown size={14} className="text-zinc-400" />
        </div>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative z-10 flex w-full max-w-md flex-col rounded-t-2xl sm:rounded-2xl bg-white shadow-2xl max-h-[80vh]">
            <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
              <p className="font-bold text-zinc-950">Seleccionar producto</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-zinc-100"
              >
                <X size={16} />
              </button>
            </div>

            <div className="px-4 py-2 border-b border-zinc-100">
              <div className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3">
                <Search size={14} className="text-zinc-400 shrink-0" />
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar producto..."
                  className="h-9 flex-1 bg-transparent text-sm outline-none"
                />
              </div>
            </div>

            <div className="overflow-y-auto flex-1 py-2">
              {loading && (
                <p className="px-4 py-6 text-center text-sm text-zinc-400">Cargando menú...</p>
              )}

              {!loading && filtered.length === 0 && (
                <p className="px-4 py-6 text-center text-sm text-zinc-400">Sin resultados.</p>
              )}

              {!loading && (
                <>
                  <button
                    type="button"
                    onClick={() => handleSelect("")}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition hover:bg-zinc-50 ${!value ? "font-semibold text-zinc-950" : "text-zinc-500"}`}
                  >
                    Todos los productos
                  </button>
                  <div className="mx-4 my-1 h-px bg-zinc-100" />

                  {Object.entries(grouped).map(([cat, catItems]) => (
                    <div key={cat}>
                      <p className="px-4 pb-1 pt-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                        {cat}
                      </p>
                      {catItems.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handleSelect(item.name)}
                          className={`flex w-full items-center justify-between px-4 py-2.5 text-left transition hover:bg-zinc-50 ${
                            value === item.name ? "bg-zinc-50 font-semibold text-zinc-950" : "text-zinc-700"
                          }`}
                        >
                          <span className="text-sm">{item.name}</span>
                          <span className="text-xs text-zinc-400">
                            {new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(item.price)}
                          </span>
                        </button>
                      ))}
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Sentinel: el descuento no aplica a ninguna categoría, solo al producto seleccionado
export const PROMO_CATEGORY_NONE = "__none__";

function CategoryPicker({
  restaurantId,
  value,
  onChange,
}: {
  restaurantId: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [categories, setCategories] = useState<string[]>([]);

  useEffect(() => {
    void getDocs(
      query(
        collection(db, "restaurants", restaurantId, "menu"),
        where("active", "==", true)
      )
    ).then((snap) => {
      const cats = [
        ...new Set(
          snap.docs
            .map((d) => String(d.data().category || ""))
            .filter(Boolean)
        ),
      ].sort();
      setCategories(cats);
    });
  }, [restaurantId]);

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 w-full rounded-lg border border-zinc-200 px-3 text-sm"
    >
      <option value="">Todas las categorías</option>
      {categories.map((cat) => (
        <option key={cat} value={cat}>
          {cat}
        </option>
      ))}
    </select>
  );
}

export type Promotion = {
  id: string;
  name: string;
  category: string;
  productName: string;
  discountType: "percentage" | "fixed";
  discountValue: number;
  fromTime: string;
  toTime: string;
  days: number[];
  active: boolean;
};

export type TwoForOnePromo = {
  id: string;
  name: string;
  productName: string;
  fromTime: string;
  toTime: string;
  days: number[];
  active: boolean;
};

const db = getDb();
const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

const isActiveSchedule = (promo: {
  active: boolean;
  days: number[];
  fromTime: string;
  toTime: string;
}): boolean => {
  if (!promo.active) return false;
  const now = new Date();
  const day = now.getDay();
  if (promo.days.length > 0 && !promo.days.includes(day)) return false;
  const [fh, fm] = promo.fromTime.split(":").map(Number);
  const [th, tm] = promo.toTime.split(":").map(Number);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const fromMin = fh * 60 + fm;
  const toMin = th * 60 + tm;
  if (fromMin <= toMin) return nowMin >= fromMin && nowMin <= toMin;
  return nowMin >= fromMin || nowMin <= toMin;
};

export const isPromotionActive = (promo: Promotion): boolean =>
  isActiveSchedule(promo);

export const isTwoForOneActive = (promo: TwoForOnePromo): boolean =>
  isActiveSchedule(promo);

export function PromotionsPanel({ restaurantId }: { restaurantId: string }) {
  const [promos, setPromos] = useState<Promotion[]>([]);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [productName, setProductName] = useState("");
  const [productMode, setProductMode] = useState<"all" | "none" | "specific">("all");
  const [discountType, setDiscountType] = useState<"percentage" | "fixed">("percentage");
  const [discountValue, setDiscountValue] = useState("10");
  const [fromTime, setFromTime] = useState("18:00");
  const [toTime, setToTime] = useState("20:00");
  const [days, setDays] = useState<number[]>([]);

  useEffect(() => {
    return onSnapshot(
      collection(db, "restaurants", restaurantId, "promotions"),
      (snap) => setPromos(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Promotion))
    );
  }, [restaurantId]);

  const toggleDay = (d: number) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !discountValue) return;
    try {
      setSaving(true);
      const savedProductName = productMode === "specific" ? productName.trim() : "";
      const savedCategory =
        productMode === "all" ? "" : productMode === "specific" ? PROMO_CATEGORY_NONE : category.trim();
      await addDoc(collection(db, "restaurants", restaurantId, "promotions"), {
        name: name.trim(),
        category: savedCategory,
        productName: savedProductName,
        discountType,
        discountValue: Number(discountValue),
        fromTime,
        toTime,
        days,
        active: true,
        restaurantId,
        createdAt: serverTimestamp(),
      });
      setName(""); setCategory(""); setProductName(""); setProductMode("all"); setDiscountValue("10");
      setFromTime("18:00"); setToTime("20:00"); setDays([]);
      toast.success("Promoción creada.");
    } catch {
      toast.error("No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteDoc(doc(db, "restaurants", restaurantId, "promotions", id));
    toast.success("Promoción eliminada.");
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-zinc-200 bg-white p-5">
        <div className="mb-4 flex items-center gap-2">
          <Tag size={18} className="text-zinc-600" />
          <h2 className="text-lg font-bold text-zinc-950">Descuentos automáticos</h2>
        </div>
        <form onSubmit={handleAdd} className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre (ej: Happy Hour)" required className="h-10 rounded-lg border border-zinc-200 px-3 text-sm sm:col-span-2" />
            <div className="sm:col-span-2 flex overflow-hidden rounded-lg border border-zinc-200">
              {(["all", "none", "specific"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => { setProductMode(mode); if (mode !== "specific") setProductName(""); }}
                  className={`flex-1 h-10 text-xs font-semibold transition border-r last:border-r-0 border-zinc-200 ${productMode === mode ? "bg-zinc-950 text-white" : "bg-white text-zinc-500 hover:bg-zinc-50"}`}
                >
                  {mode === "all" ? "Todos los productos" : mode === "none" ? "Ningún producto" : "Producto específico"}
                </button>
              ))}
            </div>
            {productMode === "specific" && (
              <div className="sm:col-span-2">
                <MenuItemPicker
                  restaurantId={restaurantId}
                  value={productName}
                  onChange={setProductName}
                  placeholder="Seleccionar producto..."
                />
              </div>
            )}
            <div className="sm:col-span-2">
              {productMode !== "none" ? (
                <div className="flex h-10 items-center rounded-lg border border-zinc-100 bg-zinc-50 px-3">
                  <span className="text-xs text-zinc-400">
                    {productMode === "all"
                      ? "Categoría deshabilitada: el descuento aplica a todo el menú"
                      : "Categoría deshabilitada: el descuento aplica solo al producto seleccionado"}
                  </span>
                </div>
              ) : (
                <CategoryPicker restaurantId={restaurantId} value={category} onChange={setCategory} />
              )}
            </div>
            <select value={discountType} onChange={(e) => setDiscountType(e.target.value as "percentage" | "fixed")} className="h-10 rounded-lg border border-zinc-200 px-3 text-sm">
              <option value="percentage">Porcentaje (%)</option>
              <option value="fixed">Monto fijo ($)</option>
            </select>
            <input type="number" min={1} value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} placeholder="Valor del descuento" className="h-10 rounded-lg border border-zinc-200 px-3 text-sm" />
            <div className="flex items-center gap-2">
              <label className="text-xs text-zinc-500 shrink-0">Desde</label>
              <input type="time" value={fromTime} onChange={(e) => setFromTime(e.target.value)} className="h-10 flex-1 rounded-lg border border-zinc-200 px-3 text-sm" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-zinc-500 shrink-0">Hasta</label>
              <input type="time" value={toTime} onChange={(e) => setToTime(e.target.value)} className="h-10 flex-1 rounded-lg border border-zinc-200 px-3 text-sm" />
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((label, idx) => (
              <button key={idx} type="button" onClick={() => toggleDay(idx)}
                className={`h-8 w-10 rounded-full text-xs font-bold transition ${days.includes(idx) ? "bg-zinc-900 text-white" : "border border-zinc-200 bg-white text-zinc-500"}`}>
                {label}
              </button>
            ))}
            <span className="text-xs text-zinc-400 self-center ml-1">Sin días = todos</span>
          </div>
          <button type="submit" disabled={saving} className="flex h-10 items-center gap-1.5 rounded-lg bg-zinc-950 px-5 text-sm font-bold text-white disabled:opacity-50">
            <Plus size={15} /> Crear promoción
          </button>
        </form>
      </div>

      {promos.length === 0 ? (
        <p className="text-sm text-zinc-500">No hay promociones configuradas.</p>
      ) : (
        <div className="space-y-2">
          {promos.map((p) => {
            const nowActive = isPromotionActive(p);
            return (
              <div key={p.id} className={`flex items-start gap-3 rounded-xl border p-4 ${nowActive ? "border-emerald-200 bg-emerald-50" : "border-zinc-200 bg-white"}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold text-zinc-950">{p.name}</p>
                    {nowActive && <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-bold text-white">ACTIVA AHORA</span>}
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {p.discountType === "percentage" ? `${p.discountValue}% off` : `$${p.discountValue} off`}
                    {p.productName
                      ? ` en "${p.productName}"`
                      : p.category === PROMO_CATEGORY_NONE
                        ? " solo en producto específico"
                        : p.category
                          ? ` en categoría "${p.category}"`
                          : " en todo el menú"}
                    {" · "}{p.fromTime}–{p.toTime}
                    {p.days.length > 0 && ` · ${p.days.map(d => DAYS[d]).join(", ")}`}
                  </p>
                </div>
                <button onClick={() => handleDelete(p.id)} className="shrink-0 flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-500 hover:bg-red-100">
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function TwoForOnePanel({ restaurantId }: { restaurantId: string }) {
  const [promos, setPromos] = useState<TwoForOnePromo[]>([]);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [productName, setProductName] = useState("");
  const [fromTime, setFromTime] = useState("00:00");
  const [toTime, setToTime] = useState("23:59");
  const [days, setDays] = useState<number[]>([]);

  useEffect(() => {
    return onSnapshot(
      collection(db, "restaurants", restaurantId, "promotions2x1"),
      (snap) =>
        setPromos(
          snap.docs.map((d) => ({ id: d.id, ...d.data() }) as TwoForOnePromo)
        )
    );
  }, [restaurantId]);

  const toggleDay = (d: number) =>
    setDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]
    );

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      setSaving(true);
      await addDoc(
        collection(db, "restaurants", restaurantId, "promotions2x1"),
        {
          name: name.trim(),
          productName: productName.trim(),
          fromTime,
          toTime,
          days,
          active: true,
          restaurantId,
          createdAt: serverTimestamp(),
        }
      );
      setName("");
      setProductName("");
      setFromTime("00:00");
      setToTime("23:59");
      setDays([]);
      toast.success("Promoción 2x1 creada.");
    } catch {
      toast.error("No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteDoc(
      doc(db, "restaurants", restaurantId, "promotions2x1", id)
    );
    toast.success("Promoción 2x1 eliminada.");
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-zinc-200 bg-white p-5">
        <div className="mb-4 flex items-center gap-2">
          <Tag size={18} className="text-zinc-600" />
          <h2 className="text-lg font-bold text-zinc-950">2x1</h2>
        </div>
        <p className="mb-4 text-sm text-zinc-500">
          Cuando el cliente pide 2 unidades del mismo producto, paga 1 y come 2.
          El descuento se aplica automáticamente en la caja.
        </p>
        <form onSubmit={handleAdd} className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nombre (ej: 2x1 Hamburguesas)"
              required
              className="h-10 rounded-lg border border-zinc-200 px-3 text-sm"
            />
            <MenuItemPicker
              restaurantId={restaurantId}
              value={productName}
              onChange={setProductName}
              placeholder="Producto específico (vacío = todos)"
            />
            <div className="flex items-center gap-2">
              <label className="text-xs text-zinc-500 shrink-0">Desde</label>
              <input
                type="time"
                value={fromTime}
                onChange={(e) => setFromTime(e.target.value)}
                className="h-10 flex-1 rounded-lg border border-zinc-200 px-3 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-zinc-500 shrink-0">Hasta</label>
              <input
                type="time"
                value={toTime}
                onChange={(e) => setToTime(e.target.value)}
                className="h-10 flex-1 rounded-lg border border-zinc-200 px-3 text-sm"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((label, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => toggleDay(idx)}
                className={`h-8 w-10 rounded-full text-xs font-bold transition ${days.includes(idx) ? "bg-zinc-900 text-white" : "border border-zinc-200 bg-white text-zinc-500"}`}
              >
                {label}
              </button>
            ))}
            <span className="text-xs text-zinc-400 self-center ml-1">
              Sin días = todos
            </span>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="flex h-10 items-center gap-1.5 rounded-lg bg-zinc-950 px-5 text-sm font-bold text-white disabled:opacity-50"
          >
            <Plus size={15} /> Crear 2x1
          </button>
        </form>
      </div>

      {promos.length === 0 ? (
        <p className="text-sm text-zinc-500">No hay promos 2x1 configuradas.</p>
      ) : (
        <div className="space-y-2">
          {promos.map((p) => {
            const nowActive = isTwoForOneActive(p);
            return (
              <div
                key={p.id}
                className={`flex items-start gap-3 rounded-xl border p-4 ${nowActive ? "border-emerald-200 bg-emerald-50" : "border-zinc-200 bg-white"}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold text-zinc-950">{p.name}</p>
                    {nowActive && (
                      <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-bold text-white">
                        ACTIVA AHORA
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    2x1
                    {p.productName ? ` en "${p.productName}"` : " en todos los productos"}
                    {" · "}
                    {p.fromTime}–{p.toTime}
                    {p.days.length > 0 &&
                      ` · ${p.days.map((d) => DAYS[d]).join(", ")}`}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(p.id)}
                  className="shrink-0 flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-500 hover:bg-red-100"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
