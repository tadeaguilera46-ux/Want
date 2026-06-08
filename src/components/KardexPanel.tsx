import { useEffect, useMemo, useState } from "react";
import { ClipboardList, Lock } from "lucide-react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { getDb } from "../lib/firebase";
import { canUseStock } from "../lib/plan";
import type { KardexEntry, StockUnit } from "../types/stock";

const db = getDb();

type Props = {
  restaurantId: string;
  plan?: string | null;
};

const MOVEMENT_STYLE: Record<string, { label: string; className: string }> = {
  entrada:  { label: "Entrada",  className: "bg-emerald-100 text-emerald-800 border border-emerald-200" },
  salida:   { label: "Salida",   className: "bg-red-100 text-red-800 border border-red-200" },
  ajuste:   { label: "Ajuste",   className: "bg-blue-100 text-blue-800 border border-blue-200" },
  creacion: { label: "Creación", className: "bg-violet-100 text-violet-800 border border-violet-200" },
};

const formatTs = (ts: unknown): string => {
  if (!ts) return "-";
  try {
    if (typeof (ts as { toMillis?: () => number }).toMillis === "function")
      return new Date((ts as { toMillis: () => number }).toMillis()).toLocaleString("es-AR");
    if (typeof (ts as { seconds?: number }).seconds === "number")
      return new Date((ts as { seconds: number }).seconds * 1000).toLocaleString("es-AR");
  } catch { /* noop */ }
  return "-";
};

const fmtQty = (n: number, unit: StockUnit) => `${n} ${unit}`;

const sign = (type: string, qty: number) => {
  if (type === "salida") return `-${qty}`;
  if (type === "ajuste") return `~${qty}`;
  return `+${qty}`;
};

export const KardexPanel = ({ restaurantId, plan }: Props) => {
  const stockEnabled = canUseStock(plan);
  const [entries, setEntries] = useState<KardexEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState("all");

  useEffect(() => {
    if (!stockEnabled) { setLoading(false); return; }
    const q = query(
      collection(db, "restaurants", restaurantId, "kardex"),
      orderBy("createdAt", "desc"),
      limit(200)
    );
    return onSnapshot(q, (snap) => {
      setEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() } as KardexEntry)));
      setLoading(false);
    });
  }, [restaurantId, stockEnabled]);

  const itemOptions = useMemo(() => {
    const map = new Map<string, string>();
    entries.forEach((e) => map.set(e.stockItemId, e.stockItemName));
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [entries]);

  const filtered = useMemo(() =>
    selectedItem === "all" ? entries : entries.filter((e) => e.stockItemId === selectedItem),
    [entries, selectedItem]
  );

  if (!stockEnabled) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-zinc-500">
        <Lock size={32} className="opacity-40" />
        <p className="text-sm">El Kardex requiere plan Premium.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <select
          value={selectedItem}
          onChange={(e) => setSelectedItem(e.target.value)}
          className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-800 focus:outline-none"
        >
          <option value="all">Todos los insumos</option>
          {itemOptions.map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
        <span className="text-xs text-zinc-400">{filtered.length} movimientos</span>
      </div>

      {loading ? (
        <p className="py-8 text-center text-sm text-zinc-400">Cargando...</p>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-200 py-16">
          <ClipboardList size={28} className="text-zinc-300" />
          <p className="text-sm text-zinc-400">Sin movimientos registrados</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 bg-zinc-50 text-left text-xs font-medium text-zinc-500">
                <th className="px-4 py-2.5">Fecha</th>
                <th className="px-4 py-2.5">Insumo</th>
                <th className="px-4 py-2.5">Tipo</th>
                <th className="px-4 py-2.5 text-right">Movimiento</th>
                <th className="px-4 py-2.5 text-right">Antes</th>
                <th className="px-4 py-2.5 text-right">Después</th>
                <th className="px-4 py-2.5">Responsable</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filtered.map((entry) => {
                const mv = MOVEMENT_STYLE[entry.movementType] ?? {
                  label: entry.movementType,
                  className: "bg-zinc-100 text-zinc-600 border border-zinc-200",
                };
                return (
                  <tr key={entry.id} className="hover:bg-zinc-50/60">
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-zinc-500">
                      {formatTs(entry.createdAt)}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-zinc-800">
                      {entry.stockItemName}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${mv.className}`}>
                        {mv.label}
                      </span>
                    </td>
                    <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${
                      entry.movementType === "entrada" || entry.movementType === "creacion"
                        ? "text-emerald-600"
                        : entry.movementType === "salida"
                          ? "text-red-600"
                          : "text-zinc-600"
                    }`}>
                      {sign(entry.movementType, entry.quantityMoved)} {entry.unit}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-zinc-400">
                      {fmtQty(entry.quantityBefore, entry.unit)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700">
                      {fmtQty(entry.quantityAfter, entry.unit)}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-zinc-400">
                      {entry.actorEmail ?? "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
