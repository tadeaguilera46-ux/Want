import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Activity,
  CheckSquare2,
  Clock,
  Receipt,
  Square,
  Trash2,
  Truck,
  User,
  Utensils,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  writeBatch,
  type Timestamp,
} from "firebase/firestore";
import { getDb } from "../lib/firebase";
import { useRestaurant } from "../lib/restaurant-context";

const db = getDb();

type AuditLog = {
  id: string;
  action?: string;
  userUid?: string | null;
  userEmail?: string | null;
  userRole?: string | null;
  mesa?: number | null;
  pedidoId?: string | null;
  cuentaId?: string | null;
  description?: string;
  createdAt?: Timestamp;
};

const actionLabel = (action?: string) => {
  switch (action) {
    case "pedido_creado":
      return "Pedido creado";
    case "pedido_listo":
      return "Pedido listo";
    case "pedido_entregado":
      return "Pedido entregado";
    case "cuenta_solicitada":
      return "Cuenta actualizada";
    case "cuenta_pagada":
      return "Cuenta pagada";
    case "mesa_limpiada":
      return "Mesa limpiada";
    case "branding_actualizado":
      return "Branding actualizado";
    case "empleado_actualizado":
      return "Empleado actualizado";
    case "cierre_caja":
      return "Cierre de caja";
    default:
      return "Actividad";
  }
};

const actionIcon = (action?: string) => {
  switch (action) {
    case "pedido_creado":
    case "pedido_listo":
      return <Utensils size={18} />;
    case "pedido_entregado":
      return <Truck size={18} />;
    case "cuenta_solicitada":
    case "cuenta_pagada":
      return <Receipt size={18} />;
    case "mesa_limpiada":
      return <ShieldCheck size={18} />;
    default:
      return <Activity size={18} />;
  }
};

const formatDate = (createdAt?: Timestamp) => {
  if (!createdAt) return "Sin fecha";

  const date = createdAt.toDate();

  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
};

const AdminAuditLogs = () => {
  const navigate = useNavigate();
  const { restaurantId } = useRestaurant();

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!restaurantId) {
      setLogs([]);
      setLoading(false);
      setError("Falta restaurante activo.");
      return;
    }

    setLoading(true);

    const q = query(
      collection(db, "restaurants", restaurantId, "auditLogs"),
      orderBy("createdAt", "desc"),
      limit(100)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((document) => ({
          id: document.id,
          ...document.data(),
        })) as AuditLog[];

        setLogs(data);
        setError(null);
        setLoading(false);
      },
      (err) => {
        console.error("Error cargando audit logs:", err);
        setError("No se pudo cargar la actividad del restaurante.");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [restaurantId]);

  const actions = useMemo(() => {
    const unique = Array.from(
      new Set(logs.map((log) => log.action).filter(Boolean))
    ) as string[];
    return unique.sort();
  }, [logs]);

  const filteredLogs = useMemo(() => {
    if (actionFilter === "all") return logs;
    return logs.filter((log) => log.action === actionFilter);
  }, [logs, actionFilter]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const deleteSelected = async () => {
    if (!restaurantId || selectedIds.size === 0) return;
    if (!window.confirm(`¿Borrar ${selectedIds.size} registro(s) seleccionado(s)?`)) return;

    try {
      setDeleting(true);
      const batch = writeBatch(db);
      selectedIds.forEach((id) => {
        batch.delete(doc(db, "restaurants", restaurantId, "auditLogs", id));
      });
      await batch.commit();
      exitSelectMode();
    } catch (err) {
      console.error(err);
    } finally {
      setDeleting(false);
    }
  };

  const deleteAll = async () => {
    if (!restaurantId || filteredLogs.length === 0) return;
    if (!window.confirm(`¿Borrar todos los ${filteredLogs.length} registros? Esta acción no se puede deshacer.`)) return;

    try {
      setDeleting(true);
      // Firestore batch limit is 500; split if needed
      const chunks: AuditLog[][] = [];
      for (let i = 0; i < filteredLogs.length; i += 500) {
        chunks.push(filteredLogs.slice(i, i + 500));
      }
      for (const chunk of chunks) {
        const batch = writeBatch(db);
        chunk.forEach((log) => {
          batch.delete(doc(db, "restaurants", restaurantId, "auditLogs", log.id));
        });
        await batch.commit();
      }
      exitSelectMode();
    } catch (err) {
      console.error(err);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto w-full max-w-5xl px-4 py-6">
        <header className="mb-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <button
                onClick={() => navigate("/staff/admin")}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-sm"
              >
                <ArrowLeft size={18} />
              </button>

              <div className="flex items-center gap-2">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white">
                  <Activity size={20} />
                </div>
                <div>
                  <h1 className="text-2xl font-black tracking-tight text-slate-950">
                    Actividad del restaurante
                  </h1>
                  <p className="mt-0.5 text-sm text-slate-500">
                    Historial de acciones críticas del equipo.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-bold text-slate-700">
                {filteredLogs.length} evento(s)
              </span>

              {!selectMode ? (
                <>
                  <button
                    onClick={() => setSelectMode(true)}
                    disabled={filteredLogs.length === 0 || deleting}
                    className="flex h-10 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
                  >
                    <CheckSquare2 size={15} />
                    Seleccionar
                  </button>

                  <button
                    onClick={deleteAll}
                    disabled={filteredLogs.length === 0 || deleting}
                    className="flex h-10 items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 text-sm font-black text-red-700 transition hover:bg-red-100 disabled:opacity-40"
                  >
                    <Trash2 size={15} />
                    Borrar todo
                  </button>
                </>
              ) : (
                <>
                  <span className="text-sm font-bold text-slate-600">
                    {selectedIds.size} seleccionado(s)
                  </span>

                  <button
                    onClick={deleteSelected}
                    disabled={selectedIds.size === 0 || deleting}
                    className="flex h-10 items-center gap-2 rounded-2xl bg-red-600 px-4 text-sm font-black text-white transition hover:bg-red-700 disabled:opacity-40"
                  >
                    <Trash2 size={15} />
                    {deleting ? "Borrando..." : "Borrar seleccionadas"}
                  </button>

                  <button
                    onClick={exitSelectMode}
                    disabled={deleting}
                    className="flex h-10 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 transition hover:bg-slate-50"
                  >
                    <X size={15} />
                    Cancelar
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="mt-5">
            <select
              value={actionFilter}
              onChange={(event) => setActionFilter(event.target.value)}
              className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-black/10 sm:w-72"
            >
              <option value="all">Todas las acciones</option>
              {actions.map((action) => (
                <option key={action} value={action}>
                  {actionLabel(action)}
                </option>
              ))}
            </select>
          </div>
        </header>

        {error && (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-6 text-center text-sm font-semibold text-slate-500 shadow-sm">
            Cargando actividad...
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center shadow-sm">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-500">
              <Activity size={24} />
            </div>
            <h2 className="mt-4 text-lg font-black text-slate-950">
              Todavía no hay actividad
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              Cuando el equipo entregue pedidos, cobre cuentas o limpie mesas,
              los eventos van a aparecer acá.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredLogs.map((log) => {
              const isSelected = selectedIds.has(log.id);
              return (
                <article
                  key={log.id}
                  onClick={() => selectMode && toggleSelect(log.id)}
                  className={`rounded-3xl border p-4 shadow-sm transition ${
                    selectMode ? "cursor-pointer" : ""
                  } ${
                    isSelected
                      ? "border-red-300 bg-red-50 ring-2 ring-red-200"
                      : "border-slate-200 bg-white"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {selectMode && (
                      <div className="mt-0.5 shrink-0">
                        {isSelected ? (
                          <CheckSquare2 size={20} className="text-red-600" />
                        ) : (
                          <Square size={20} className="text-slate-400" />
                        )}
                      </div>
                    )}

                    <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white ${isSelected ? "bg-red-500" : "bg-slate-950"}`}>
                      {actionIcon(log.action)}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <h3 className="text-base font-black text-slate-950">
                            {actionLabel(log.action)}
                          </h3>
                          <p className="mt-1 text-sm leading-relaxed text-slate-600">
                            {log.description || "Sin descripción"}
                          </p>
                        </div>
                        <div className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-600">
                          <Clock size={13} />
                          {formatDate(log.createdAt)}
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {log.mesa && (
                          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">
                            Mesa {log.mesa}
                          </span>
                        )}
                        {log.userEmail && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                            <User size={12} />
                            {log.userEmail}
                          </span>
                        )}
                        {log.userRole && (
                          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold uppercase text-emerald-700">
                            {log.userRole}
                          </span>
                        )}
                        {log.pedidoId && (
                          <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-mono font-bold text-zinc-600">
                            Pedido {log.pedidoId.slice(0, 8)}
                          </span>
                        )}
                        {log.cuentaId && (
                          <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-mono font-bold text-zinc-600">
                            Cuenta {log.cuentaId.slice(0, 8)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminAuditLogs;