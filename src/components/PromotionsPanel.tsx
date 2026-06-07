import { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
import { Plus, Tag, Trash2 } from "lucide-react";
import { getDb } from "../lib/firebase";
import { toast } from "sonner";

export type Promotion = {
  id: string;
  name: string;
  category: string;
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
      await addDoc(collection(db, "restaurants", restaurantId, "promotions"), {
        name: name.trim(),
        category: category.trim(),
        discountType,
        discountValue: Number(discountValue),
        fromTime,
        toTime,
        days,
        active: true,
        restaurantId,
        createdAt: serverTimestamp(),
      });
      setName(""); setCategory(""); setDiscountValue("10");
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
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre (ej: Happy Hour)" required className="h-10 rounded-lg border border-zinc-200 px-3 text-sm" />
            <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Categoría afectada (vacío = todas)" className="h-10 rounded-lg border border-zinc-200 px-3 text-sm" />
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
                    {p.category ? ` en "${p.category}"` : " en todo el menú"}
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
            <input
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="Producto exacto (vacío = todos)"
              className="h-10 rounded-lg border border-zinc-200 px-3 text-sm"
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
