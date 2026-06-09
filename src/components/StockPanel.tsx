import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpDown,
  Boxes,
  ChevronRight,
  Lock,
  PackagePlus,
  PauseCircle,
  Pencil,
  PlayCircle,
  Plus,
  Trash2,
  TrendingUp,
  X,
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
  bulkUpdateSupplierCost,
  createStockItem,
  deleteStockItem,
  removeStock,
  toggleStockItem,
  updateStockItem,
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

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editModeActive, setEditModeActive] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const [filterName, setFilterName] = useState("");
  const [filterSupplier, setFilterSupplier] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "quantity">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Create form state
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [unit, setUnit] = useState<StockUnit>("unit");
  const [quantity, setQuantity] = useState(0);
  const [minimumQuantity, setMinimumQuantity] = useState(0);
  const [costPerUnit, setCostPerUnit] = useState("");
  const [supplier, setSupplier] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Edit panel state
  const [editSupplier, setEditSupplier] = useState("");
  const [editUnit, setEditUnit] = useState<StockUnit>("unit");
  const [editCost, setEditCost] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // Quick stock controls
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Bulk supplier increase
  const [bulkSupplier, setBulkSupplier] = useState("");
  const [bulkPercent, setBulkPercent] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);

  const actor = useMemo(
    () => ({ actorUid: user?.uid || "", actorEmail: user?.email, actorRole: "admin" as const }),
    [user]
  );

  const getReasonFor = (id: string) => reasons[id] ?? "ajuste";
  const setReasonFor = (id: string, v: string) => setReasons((p) => ({ ...p, [id]: v }));
  const getAmountFor = (id: string) => amounts[id] ?? 1;
  const setAmountFor = (id: string, v: number) => setAmounts((p) => ({ ...p, [id]: Math.max(1, v) }));

  useEffect(() => {
    const q = query(collection(db, "restaurants", restaurantId, "stock"), orderBy("name"));
    const unsub = onSnapshot(q, (snapshot) => {
      setItems(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as StockItem[]);
      setLoading(false);
    });
    return () => unsub();
  }, [restaurantId]);

  // Pre-fill edit panel when item is selected
  useEffect(() => {
    if (!selectedItemId) return;
    const item = items.find((i) => i.id === selectedItemId);
    if (!item) return;
    setEditSupplier(item.supplier || "");
    setEditUnit(item.unit);
    setEditCost(item.costPerUnit != null ? String(item.costPerUnit) : "");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItemId]);

  const selectedItem = useMemo(
    () => items.find((i) => i.id === selectedItemId) ?? null,
    [items, selectedItemId]
  );

  const lowStockCount = useMemo(
    () => items.filter((i) => i.active && Number(i.currentQuantity || 0) <= Number(i.minimumQuantity || 0)).length,
    [items]
  );

  const suppliers = useMemo(
    () => [...new Set(items.map((i) => i.supplier).filter(Boolean) as string[])].sort(),
    [items]
  );

  const bulkAffectedCount = useMemo(
    () => items.filter((i) => (i.supplier ?? "").toLowerCase() === bulkSupplier.toLowerCase() && (i.costPerUnit ?? 0) > 0).length,
    [items, bulkSupplier]
  );

  const displayItems = useMemo(() => {
    const filtered = items.filter((item) => {
      const nameOk = !filterName || item.name.toLowerCase().includes(filterName.toLowerCase());
      const suppOk = !filterSupplier || (item.supplier || "").toLowerCase().includes(filterSupplier.toLowerCase());
      return nameOk && suppOk;
    });
    return [...filtered].sort((a, b) => {
      if (sortBy === "name") {
        const cmp = a.name.localeCompare(b.name, "es");
        return sortDir === "asc" ? cmp : -cmp;
      }
      const cmp = Number(a.currentQuantity || 0) - Number(b.currentQuantity || 0);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [items, filterName, filterSupplier, sortBy, sortDir]);

  const toggleSort = (field: "name" | "quantity") => {
    if (sortBy === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(field); setSortDir("asc"); }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stockEnabled || !user) return;
    try {
      setSaving(true);
      await createStockItem(
        { restaurantId, name, category, unit, currentQuantity: quantity, minimumQuantity,
          costPerUnit: costPerUnit ? Number(costPerUnit) : undefined, supplier, notes },
        actor
      );
      setName(""); setCategory(""); setQuantity(0); setMinimumQuantity(0);
      setCostPerUnit(""); setSupplier(""); setNotes("");
      setShowCreateForm(false);
      toast.success("Insumo creado.");
    } catch {
      toast.error("No se pudo crear el insumo.");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!selectedItem || !user) return;
    try {
      setEditSaving(true);
      await updateStockItem(restaurantId, selectedItem, {
        supplier: editSupplier.trim(),
        unit: editUnit,
        costPerUnit: editCost.trim() ? Number(editCost) : null,
      }, actor);
      toast.success("Guardado.");
    } catch {
      toast.error("No se pudo guardar.");
    } finally {
      setEditSaving(false);
    }
  };

  const handleBulkIncrease = async () => {
    if (!bulkSupplier || !bulkPercent || !user) return;
    const pct = Number(bulkPercent);
    if (!Number.isFinite(pct) || pct <= 0) { toast.error("Ingresá un porcentaje válido mayor a 0."); return; }
    try {
      setBulkSaving(true);
      const count = await bulkUpdateSupplierCost(restaurantId, bulkSupplier, pct, items, actor);
      toast.success(`${count} insumo${count !== 1 ? "s" : ""} actualizados (+${pct}%).`);
      setBulkPercent("");
    } catch {
      toast.error("No se pudo aplicar el aumento.");
    } finally {
      setBulkSaving(false);
    }
  };

  return (
    <section className="mt-8 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-zinc-950 text-white">
            <Boxes size={22} />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-zinc-950">Control de stock</h2>
            <p className="mt-1 text-sm text-zinc-500">Gestión manual de insumos e inventario.</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!stockEnabled && (
            <div className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-100 px-3 py-2 text-amber-900">
              <Lock size={14} />
              <span className="text-xs font-bold uppercase tracking-wide">Premium</span>
            </div>
          )}
          <button
            disabled={!stockEnabled}
            onClick={() => { setShowCreateForm((v) => !v); setEditModeActive(false); setSelectedItemId(null); }}
            className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50 ${showCreateForm ? "bg-zinc-950 text-white" : "border border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50"}`}
          >
            <Plus size={15} />
            Crear insumo
          </button>
          <button
            disabled={!stockEnabled}
            onClick={() => { setEditModeActive((v) => !v); setShowCreateForm(false); if (editModeActive) setSelectedItemId(null); }}
            className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50 ${editModeActive ? "bg-zinc-950 text-white" : "border border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50"}`}
          >
            <Pencil size={15} />
            Editar insumos
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <p className="text-sm text-zinc-500">Insumos totales</p>
          <p className="mt-1 text-3xl font-bold text-zinc-950">{items.length}</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <p className="text-sm text-zinc-500">Stock bajo</p>
          <p className="mt-1 text-3xl font-bold text-red-600">{lowStockCount}</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <p className="text-sm text-zinc-500">Proveedores</p>
          <p className="mt-1 text-3xl font-bold text-zinc-950">{suppliers.length}</p>
        </div>
      </div>

      {/* Low stock alert */}
      {lowStockCount > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <div className="mb-2 flex items-center gap-2">
            <AlertTriangle size={15} className="shrink-0 text-red-600" />
            <p className="text-sm font-bold text-red-800">
              {lowStockCount} {lowStockCount === 1 ? "insumo" : "insumos"} con stock bajo o agotado
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {items
              .filter((i) => i.active && Number(i.currentQuantity || 0) <= Number(i.minimumQuantity || 0))
              .map((i) => (
                <span key={i.id} className="rounded-full border border-red-200 bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700">
                  {i.name} — {i.currentQuantity} {i.unit}
                </span>
              ))}
          </div>
        </div>
      )}

      {/* Create form */}
      {showCreateForm && (
        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-bold text-zinc-950">Nuevo insumo</h3>
            <button onClick={() => setShowCreateForm(false)} className="text-zinc-400 hover:text-zinc-700">
              <X size={18} />
            </button>
          </div>
          <form onSubmit={handleCreate} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre *" required
              className="h-11 rounded-lg border border-zinc-200 px-3 text-sm" />
            <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Categoría *" required
              className="h-11 rounded-lg border border-zinc-200 px-3 text-sm" />
            <select value={unit} onChange={(e) => setUnit(e.target.value as StockUnit)}
              className="h-11 rounded-lg border border-zinc-200 px-3 text-sm">
              {units.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-500">Cantidad inicial</label>
              <input type="number" min={0} step="any" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))}
                className="h-11 w-full rounded-lg border border-zinc-200 px-3 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-500">Mínimo</label>
              <input type="number" min={0} step="any" value={minimumQuantity} onChange={(e) => setMinimumQuantity(Number(e.target.value))}
                className="h-11 w-full rounded-lg border border-zinc-200 px-3 text-sm" />
            </div>
            <input value={costPerUnit} onChange={(e) => setCostPerUnit(e.target.value)} type="number" min={0} step="any"
              placeholder="Costo por unidad ($)" className="h-11 rounded-lg border border-zinc-200 px-3 text-sm" />
            <input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Proveedor"
              className="h-11 rounded-lg border border-zinc-200 px-3 text-sm" />
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notas"
              rows={2} className="rounded-lg border border-zinc-200 p-3 text-sm sm:col-span-2" />
            <button type="submit" disabled={saving}
              className="flex h-11 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-5 text-sm font-bold text-white disabled:opacity-50 sm:col-span-2 lg:col-span-1">
              <PackagePlus size={16} />
              {saving ? "Guardando..." : "Crear insumo"}
            </button>
          </form>
        </div>
      )}

      {/* Main card */}
      <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
        {/* Filter bar */}
        <div className="border-b border-zinc-100 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={filterName}
              onChange={(e) => setFilterName(e.target.value)}
              placeholder="Buscar nombre..."
              className="h-9 min-w-[150px] flex-1 rounded-lg border border-zinc-200 px-3 text-sm outline-none focus:ring-2 focus:ring-black/10"
            />
            <input
              value={filterSupplier}
              onChange={(e) => setFilterSupplier(e.target.value)}
              placeholder="Filtrar proveedor..."
              className="h-9 min-w-[140px] flex-1 rounded-lg border border-zinc-200 px-3 text-sm outline-none focus:ring-2 focus:ring-black/10"
            />
            <button
              onClick={() => toggleSort("name")}
              className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors ${sortBy === "name" ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"}`}
            >
              <ArrowUpDown size={13} />
              A–Z {sortBy === "name" ? (sortDir === "asc" ? "↑" : "↓") : ""}
            </button>
            <button
              onClick={() => toggleSort("quantity")}
              className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors ${sortBy === "quantity" ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"}`}
            >
              <ArrowUpDown size={13} />
              Cantidad {sortBy === "quantity" ? (sortDir === "asc" ? "↑" : "↓") : ""}
            </button>
          </div>
        </div>

        {/* Bulk supplier increase (edit mode) */}
        {editModeActive && suppliers.length > 0 && (
          <div className="border-b border-zinc-100 bg-zinc-50 px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <TrendingUp size={14} className="shrink-0 text-zinc-500" />
              <span className="text-xs font-semibold text-zinc-600">Aumento masivo:</span>
              <select
                value={bulkSupplier}
                onChange={(e) => setBulkSupplier(e.target.value)}
                className="h-8 rounded-lg border border-zinc-200 bg-white px-2 text-xs"
              >
                <option value="">Seleccionar proveedor...</option>
                {suppliers.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <div className="flex items-center gap-1">
                <span className="text-xs text-zinc-400">+</span>
                <input
                  value={bulkPercent}
                  onChange={(e) => setBulkPercent(e.target.value)}
                  type="number" min={0.1} step={0.1} placeholder="0.0"
                  className="h-8 w-20 rounded-lg border border-zinc-200 px-2 text-xs"
                />
                <span className="text-xs text-zinc-400">%</span>
              </div>
              {bulkSupplier && (
                <span className="text-xs text-zinc-400">
                  {bulkAffectedCount > 0 ? `afecta ${bulkAffectedCount} insumo${bulkAffectedCount !== 1 ? "s" : ""}` : "sin insumos con costo"}
                </span>
              )}
              <button
                onClick={handleBulkIncrease}
                disabled={!bulkSupplier || !bulkPercent || bulkAffectedCount === 0 || bulkSaving}
                className="h-8 rounded-lg bg-zinc-950 px-3 text-xs font-bold text-white disabled:opacity-40"
              >
                {bulkSaving ? "Aplicando..." : "Aplicar"}
              </button>
            </div>
          </div>
        )}

        {/* List + lateral panel */}
        <div className={`flex ${selectedItem ? "divide-x divide-zinc-100" : ""}`}>
          {/* Item list */}
          <div className="min-w-0 flex-1">
            {loading ? (
              <div className="p-6 text-sm text-zinc-500">Cargando stock...</div>
            ) : displayItems.length === 0 ? (
              <div className="p-8 text-center text-sm text-zinc-400">
                {items.length === 0 ? "Todavía no hay insumos. Creá uno con el botón de arriba." : "Ningún insumo coincide con los filtros."}
              </div>
            ) : (
              <div className="divide-y divide-zinc-100">
                {displayItems.map((item) => {
                  const lowStock = Number(item.currentQuantity || 0) <= Number(item.minimumQuantity || 0);
                  const isSelected = selectedItem?.id === item.id;
                  return (
                    <div
                      key={item.id}
                      onClick={() => { if (editModeActive) setSelectedItemId((prev) => prev === item.id ? null : item.id); }}
                      className={`px-4 py-3 transition-colors ${editModeActive ? "cursor-pointer hover:bg-zinc-50" : ""} ${isSelected ? "bg-zinc-50" : ""}`}
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        {/* Name + meta */}
                        <div className="flex min-w-0 items-center gap-2">
                          {editModeActive && (
                            <ChevronRight
                              size={14}
                              className={`shrink-0 text-zinc-400 transition-transform ${isSelected ? "rotate-90 text-zinc-700" : ""}`}
                            />
                          )}
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-semibold text-zinc-950">{item.name}</span>
                              {!item.active && (
                                <span className="rounded-full bg-zinc-200 px-1.5 py-0.5 text-xs font-semibold text-zinc-600">Pausado</span>
                              )}
                              {lowStock && (
                                <span className="flex items-center gap-0.5 rounded-full bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700">
                                  <AlertTriangle size={10} /> Bajo
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-zinc-400">
                              {item.category}
                              {item.supplier ? ` · ${item.supplier}` : ""}
                            </p>
                          </div>
                        </div>

                        {/* Controls */}
                        <div
                          className="flex flex-wrap items-center gap-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm font-semibold text-zinc-900">
                            {item.currentQuantity} {item.unit}
                          </span>
                          {item.costPerUnit != null && (
                            <span className="text-xs text-zinc-400">
                              ${item.costPerUnit.toLocaleString("es-AR")}/{item.unit}
                            </span>
                          )}
                          {!editModeActive && (
                            <>
                              <select
                                value={getReasonFor(item.id)}
                                onChange={(e) => setReasonFor(item.id, e.target.value)}
                                disabled={!stockEnabled}
                                className="h-8 rounded-lg border border-zinc-200 bg-white px-2 text-xs disabled:opacity-50"
                              >
                                <option value="compra">Compra</option>
                                <option value="consumo">Consumo</option>
                                <option value="desperdicio">Desperdicio</option>
                                <option value="devolucion">Devolución</option>
                                <option value="ajuste">Ajuste</option>
                              </select>
                              <input
                                type="number" min={1} step={1}
                                value={getAmountFor(item.id)}
                                onChange={(e) => setAmountFor(item.id, Number(e.target.value))}
                                disabled={!stockEnabled}
                                className="h-8 w-14 rounded-lg border border-zinc-200 px-2 text-center text-sm disabled:opacity-50"
                              />
                              <button
                                disabled={!stockEnabled}
                                onClick={() => user && addStock(restaurantId, item, getAmountFor(item.id), actor, getReasonFor(item.id))}
                                className="h-8 rounded-lg border border-zinc-200 px-3 text-sm font-semibold text-zinc-900 disabled:opacity-50"
                              >
                                +{getAmountFor(item.id)}
                              </button>
                              <button
                                disabled={!stockEnabled}
                                onClick={() => user && removeStock(restaurantId, item, getAmountFor(item.id), actor, getReasonFor(item.id))}
                                className="h-8 rounded-lg border border-zinc-200 px-3 text-sm font-semibold text-zinc-900 disabled:opacity-50"
                              >
                                -{getAmountFor(item.id)}
                              </button>
                              <button
                                disabled={!stockEnabled}
                                onClick={() => toggleStockItem(restaurantId, item, !item.active, actor)}
                                className="flex h-8 items-center gap-1.5 rounded-lg bg-zinc-950 px-3 text-xs font-semibold text-white disabled:opacity-50"
                              >
                                {item.active ? <><PauseCircle size={13} />Pausar</> : <><PlayCircle size={13} />Activar</>}
                              </button>
                              {deletingId === item.id ? (
                                <>
                                  <button
                                    onClick={() => {
                                      if (!user) return;
                                      deleteStockItem(restaurantId, item, actor).catch(() => toast.error("No se pudo eliminar"));
                                      setDeletingId(null);
                                    }}
                                    className="h-8 rounded-lg bg-red-600 px-3 text-xs font-bold text-white"
                                  >
                                    Confirmar
                                  </button>
                                  <button onClick={() => setDeletingId(null)}
                                    className="h-8 rounded-lg border border-zinc-200 px-2 text-xs text-zinc-600">
                                    Cancelar
                                  </button>
                                </>
                              ) : (
                                <button
                                  disabled={!stockEnabled}
                                  onClick={() => setDeletingId(item.id)}
                                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 text-zinc-400 hover:border-red-200 hover:text-red-500 disabled:opacity-50"
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Lateral edit panel */}
          {selectedItem && (
            <div className="w-72 shrink-0 overflow-y-auto p-4">
              <div className="mb-4 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-bold text-zinc-950">{selectedItem.name}</p>
                  <p className="text-xs text-zinc-400">{selectedItem.category}</p>
                </div>
                <button onClick={() => setSelectedItemId(null)} className="shrink-0 text-zinc-400 hover:text-zinc-700">
                  <X size={16} />
                </button>
              </div>

              {/* Config */}
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-500">Proveedor</label>
                  <input
                    value={editSupplier}
                    onChange={(e) => setEditSupplier(e.target.value)}
                    placeholder="Nombre del proveedor"
                    className="h-9 w-full rounded-lg border border-zinc-200 px-3 text-sm outline-none focus:ring-2 focus:ring-black/10"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-500">Unidad de medida</label>
                  <select
                    value={editUnit}
                    onChange={(e) => setEditUnit(e.target.value as StockUnit)}
                    className="h-9 w-full rounded-lg border border-zinc-200 px-3 text-sm"
                  >
                    {units.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-500">Costo por unidad ($)</label>
                  <input
                    value={editCost}
                    onChange={(e) => setEditCost(e.target.value)}
                    type="number" min={0} step="any" placeholder="0"
                    className="h-9 w-full rounded-lg border border-zinc-200 px-3 text-sm outline-none focus:ring-2 focus:ring-black/10"
                  />
                </div>
                <button
                  onClick={handleSaveEdit}
                  disabled={editSaving || !stockEnabled}
                  className="h-9 w-full rounded-lg bg-zinc-950 text-sm font-bold text-white disabled:opacity-50"
                >
                  {editSaving ? "Guardando..." : "Guardar cambios"}
                </button>
              </div>

              <div className="my-4 border-t border-zinc-100" />

              {/* Stock adjustment */}
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Ajuste de stock</p>
              <p className="mb-2 text-sm font-semibold text-zinc-700">
                {selectedItem.currentQuantity} {selectedItem.unit}
              </p>
              <div className="space-y-2">
                <select
                  value={getReasonFor(selectedItem.id)}
                  onChange={(e) => setReasonFor(selectedItem.id, e.target.value)}
                  className="h-8 w-full rounded-lg border border-zinc-200 bg-white px-2 text-xs"
                >
                  <option value="compra">Compra</option>
                  <option value="consumo">Consumo</option>
                  <option value="desperdicio">Desperdicio</option>
                  <option value="devolucion">Devolución</option>
                  <option value="ajuste">Ajuste</option>
                </select>
                <div className="flex gap-2">
                  <input
                    type="number" min={1} step={1}
                    value={getAmountFor(selectedItem.id)}
                    onChange={(e) => setAmountFor(selectedItem.id, Number(e.target.value))}
                    className="h-8 w-14 rounded-lg border border-zinc-200 px-2 text-center text-sm"
                  />
                  <button
                    disabled={!stockEnabled}
                    onClick={() => user && addStock(restaurantId, selectedItem, getAmountFor(selectedItem.id), actor, getReasonFor(selectedItem.id))}
                    className="h-8 flex-1 rounded-lg border border-zinc-200 text-sm font-semibold text-zinc-900 disabled:opacity-50"
                  >
                    +{getAmountFor(selectedItem.id)}
                  </button>
                  <button
                    disabled={!stockEnabled}
                    onClick={() => user && removeStock(restaurantId, selectedItem, getAmountFor(selectedItem.id), actor, getReasonFor(selectedItem.id))}
                    className="h-8 flex-1 rounded-lg border border-zinc-200 text-sm font-semibold text-zinc-900 disabled:opacity-50"
                  >
                    -{getAmountFor(selectedItem.id)}
                  </button>
                </div>
              </div>

              <div className="my-4 border-t border-zinc-100" />

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  disabled={!stockEnabled}
                  onClick={() => toggleStockItem(restaurantId, selectedItem, !selectedItem.active, actor)}
                  className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg bg-zinc-950 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {selectedItem.active ? <><PauseCircle size={13} />Pausar</> : <><PlayCircle size={13} />Activar</>}
                </button>
                {deletingId === selectedItem.id ? (
                  <>
                    <button
                      onClick={() => {
                        if (!user) return;
                        deleteStockItem(restaurantId, selectedItem, actor)
                          .then(() => setSelectedItemId(null))
                          .catch(() => toast.error("No se pudo eliminar"));
                        setDeletingId(null);
                      }}
                      className="h-8 rounded-lg bg-red-600 px-3 text-xs font-bold text-white"
                    >
                      Confirmar
                    </button>
                    <button
                      onClick={() => setDeletingId(null)}
                      className="h-8 rounded-lg border border-zinc-200 px-2 text-xs text-zinc-600"
                    >
                      ✕
                    </button>
                  </>
                ) : (
                  <button
                    disabled={!stockEnabled}
                    onClick={() => setDeletingId(selectedItem.id)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 text-zinc-400 hover:border-red-200 hover:text-red-500 disabled:opacity-50"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
