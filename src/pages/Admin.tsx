import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  MessageSquareText,
  LayoutDashboard,
  Search,
  Receipt,
  ChefHat,
  CircleDollarSign,
  DoorOpen,
  Users,
  X,
  ArrowRight,
  LogOut,
  UserPlus,
} from "lucide-react";
import { getDb } from "../lib/firebase";
import { toast } from "sonner";
import {
  markMesaAvailable,
  markMesaNeedsCleaning,
  type Mesa,
  type MesaEstado,
} from "../lib/mesas";
import { RestaurantBrandingPanel } from "../components/RestaurantBrandingPanel";
import { actualizarEstadoCuenta } from "../lib/bill";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { useRestaurant } from "../lib/restaurant-context";
import { useAuth } from "../lib/auth-context";
import { createStaffMember, type StaffRole } from "../lib/staff";
import { StaffManagementPanel } from "../components/StaffManagementPanel";
import { MesaManagementPanel } from "../components/MesaManagementPanel.tsx";
import { MenuManagementPanel } from "../components/MenuManagementPanel";
import { StockPanel } from "../components/StockPanel";
import { canUseStock } from "../lib/plan";
import { ReceiptText, Activity } from "lucide-react";
import type {
  CuentaRecord,
  EstadoCocinaBarra,
  FirestoreTimestampLike,
  MetodoPago,
  PedidoRecord,
} from "../lib/restaurant";

const db = getDb();

type Pedido = PedidoRecord;
type Cuenta = CuentaRecord;

type MesaDoc = Mesa & {
  id: string;
};

type MesaAdminData = {
  id: string;
  numero: number | string;
  estado: MesaEstado;
  activeSessionId: string | null;
  totalActual: number;
  pedidosSesion: Pedido[];
  pedidosActivos: Pedido[];
  pedidosListos: Pedido[];
  cuentaActual: Cuenta | null;
  prioridad: number;
  prioridadLabel: string | null;
};

const normalizeObservation = (value?: string) => value?.trim() || "";

const formatPrice = (value: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value || 0);

const formatDate = (dateValue?: FirestoreTimestampLike) => {
  if (!dateValue) return "-";

  try {
    if (typeof dateValue.toMillis === "function") {
      return new Date(dateValue.toMillis()).toLocaleString("es-AR");
    }

    if (typeof dateValue.seconds === "number") {
      return new Date(dateValue.seconds * 1000).toLocaleString("es-AR");
    }

    return "-";
  } catch {
    return "-";
  }
};

const isSameDay = (dateValue?: FirestoreTimestampLike) => {
  if (!dateValue) return false;

  const date =
    typeof dateValue.toMillis === "function"
      ? new Date(dateValue.toMillis())
      : typeof dateValue.seconds === "number"
        ? new Date(dateValue.seconds * 1000)
        : null;

  if (!date) return false;

  const now = new Date();

  return (
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
  );
};

const pedidoTieneObservaciones = (pedido: Pedido) => {
  return pedido.items?.some(
    (item) => normalizeObservation(item.observacion).length > 0
  );
};

const isPedidoActivo = (pedido: Pedido) => {
  const hasFood = pedido.items?.some((item) => item.category === "food");
  const hasDrinks = pedido.items?.some((item) => item.category === "drinks");

  if (hasFood && !hasDrinks) return pedido.estadoCocina !== "entregado";
  if (!hasFood && hasDrinks) return pedido.estadoBarra !== "entregado";

  if (hasFood && hasDrinks) {
    return (
      pedido.estadoCocina !== "entregado" || pedido.estadoBarra !== "entregado"
    );
  }

  return false;
};

const isPedidoListo = (pedido: Pedido) => {
  const hasFood = pedido.items?.some((item) => item.category === "food");
  const hasDrinks = pedido.items?.some((item) => item.category === "drinks");

  if (hasFood && !hasDrinks) return pedido.estadoCocina === "listo";
  if (!hasFood && hasDrinks) return pedido.estadoBarra === "listo";

  if (hasFood && hasDrinks) {
    return pedido.estadoCocina === "listo" && pedido.estadoBarra === "listo";
  }

  return false;
};

const getKitchenStatus = (pedido: Pedido): EstadoCocinaBarra =>
  pedido.estadoCocina || "pendiente";

const getBarStatus = (pedido: Pedido): EstadoCocinaBarra =>
  pedido.estadoBarra || "pendiente";

const statusBadge = (estado?: string | null) => {
  switch (estado) {
    case "pendiente":
      return "bg-amber-100 text-amber-800 border border-amber-200";
    case "preparando":
      return "bg-blue-100 text-blue-800 border border-blue-200";
    case "listo":
      return "bg-emerald-100 text-emerald-800 border border-emerald-200";
    case "entregado":
      return "bg-zinc-200 text-zinc-700 border border-zinc-300";
    case "en_camino":
      return "bg-violet-100 text-violet-800 border border-violet-200";
    case "pagada":
      return "bg-emerald-100 text-emerald-800 border border-emerald-200";
    case "available":
      return "bg-emerald-100 text-emerald-700 border border-emerald-200";
    case "occupied":
      return "bg-red-100 text-red-700 border border-red-200";
    case "needs_cleaning":
      return "bg-orange-100 text-orange-700 border border-orange-200";
    default:
      return "bg-zinc-100 text-zinc-700 border border-zinc-200";
  }
};

const metodoLabel = (metodo: MetodoPago | null | undefined) => {
  switch (metodo) {
    case "cash":
      return "Efectivo";
    case "debit":
      return "Débito";
    case "credit":
      return "Crédito";
    case "transfer":
      return "Transferencia";
    default:
      return "-";
  }
};

const getPriorityStyles = (mesa: MesaAdminData) => {
  if (mesa.cuentaActual?.estado === "pendiente") {
    return {
      card: "border-red-200 bg-red-50/50",
      badge: "bg-red-500 text-white",
    };
  }

  if (mesa.cuentaActual?.estado === "en_camino") {
    return {
      card: "border-violet-200 bg-violet-50/50",
      badge: "bg-violet-500 text-white",
    };
  }

  if (mesa.pedidosListos.length > 0) {
    return {
      card: "border-emerald-200 bg-emerald-50/50",
      badge: "bg-emerald-500 text-white",
    };
  }

  if (mesa.pedidosActivos.length > 0) {
    return {
      card: "border-amber-200 bg-amber-50/50",
      badge: "bg-amber-400 text-black",
    };
  }

  return {
    card: "border-zinc-200 bg-white",
    badge: "bg-zinc-200 text-zinc-700",
  };
};

const getFirebaseErrorMessage = (error: unknown) => {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: string }).code)
      : "";

  switch (code) {
    case "auth/email-already-in-use":
      return "Ese email ya está registrado.";
    case "auth/invalid-email":
      return "El email no es válido.";
    case "auth/weak-password":
      return "La contraseña debe tener al menos 6 caracteres.";
    default:
      return "No se pudo crear el empleado.";
  }
};

const renderPedidoItems = (pedido: Pedido) => {
  return (
    <div className="space-y-2">
      {pedido.items?.map((item, i) => {
        const observation = normalizeObservation(item.observacion);
        const hasObservation = observation.length > 0;

        return (
          <div
            key={`${item.nombre}-${observation || "sin-observacion"}-${i}`}
            className="rounded-2xl border border-zinc-200 bg-white p-3"
          >
            <div className="flex items-start justify-between gap-3 text-sm">
              <p className="font-semibold text-zinc-900">
                {item.nombre} x {item.cantidad}
                <span className="ml-1 text-zinc-500">({item.category})</span>
              </p>
            </div>

            {hasObservation && (
              <div className="mt-2 rounded-xl border border-amber-300 bg-amber-100 px-3 py-2">
                <div className="flex items-start gap-2">
                  <MessageSquareText
                    size={14}
                    className="mt-0.5 shrink-0 text-amber-900"
                  />
                  <div className="min-w-0">
                    <p className="mb-1 text-[11px] font-extrabold uppercase tracking-wide text-amber-900">
                      OBS
                    </p>
                    <p className="text-sm font-semibold leading-snug text-amber-950 break-words">
                      {observation}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

const Admin = () => {
  const navigate = useNavigate();
  const { restaurantId, restaurant } = useRestaurant(); 
  const { logout, user } = useAuth();

  const [mesas, setMesas] = useState<MesaDoc[]>([]);
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [filterEstado, setFilterEstado] = useState<
    "todas" | "available" | "occupied" | "needs_cleaning"
  >("todas");
  const [mesaDetalle, setMesaDetalle] = useState<MesaAdminData | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const [staffEmail, setStaffEmail] = useState("");
  const [staffPassword, setStaffPassword] = useState("");
  const [staffRole, setStaffRole] = useState<StaffRole>("runner");
  const [creatingStaff, setCreatingStaff] = useState(false);
  const [staffMessage, setStaffMessage] = useState("");

  useEffect(() => {
    if (!restaurantId) {
      setMesas([]);
      setPedidos([]);
      setCuentas([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const unsubMesas = onSnapshot(
      collection(db, "restaurants", restaurantId, "mesas"),
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => {
          const raw = docSnap.data() as Partial<Mesa>;
          return {
            id: docSnap.id,
            restaurantId: raw.restaurantId ?? restaurantId,
            numero: raw.numero ?? Number(docSnap.id),
            estado:
              raw.estado === "occupied" || raw.estado === "needs_cleaning"
                ? raw.estado
                : "available",
            activeSessionId:
              typeof raw.activeSessionId === "string"
                ? raw.activeSessionId
                : null,
            createdAt: raw.createdAt,
            updatedAt: raw.updatedAt,
            active: raw.active !== false,
          } as MesaDoc;
        });

        setMesas(data);
      }
    );

    const qPedidos = query(
      collection(db, "restaurants", restaurantId, "pedidos"),
      orderBy("createdAt", "desc")
    );

    const unsubPedidos = onSnapshot(qPedidos, (snapshot) => {
      const data = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      })) as Pedido[];

      setPedidos(data);
    });

    const qCuentas = query(
      collection(db, "restaurants", restaurantId, "cuentas"),
      orderBy("createdAt", "desc")
    );

    const unsubCuentas = onSnapshot(qCuentas, (snapshot) => {
      const data = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      })) as Cuenta[];

      setCuentas(data);
      setLoading(false);
    });

    return () => {
      unsubMesas();
      unsubPedidos();
      unsubCuentas();
    };
  }, [restaurantId]);

  const mesasAdmin = useMemo<MesaAdminData[]>(() => {
    return mesas
        .filter((mesa) => mesa.active !== false)
       .map((mesa) => {
        const numeroMesa = mesa.numero ?? mesa.id;

        const pedidosSesion = mesa.activeSessionId
          ? pedidos.filter(
              (pedido) =>
                String(pedido.mesa) === String(numeroMesa) &&
                pedido.sessionId === mesa.activeSessionId
            )
          : [];

        const pedidosActivos = pedidosSesion.filter(isPedidoActivo);
        const pedidosListos = pedidosActivos.filter(isPedidoListo);

        const totalActual = pedidosSesion.reduce(
          (acc, pedido) => acc + (pedido.total || 0),
          0
        );

        const cuentaActual = mesa.activeSessionId
          ? cuentas.find(
              (cuenta) =>
                String(cuenta.mesa) === String(numeroMesa) &&
                cuenta.sessionId === mesa.activeSessionId &&
                cuenta.estado !== "pagada" &&
                cuenta.estado !== "cerrada"
            ) || null
          : null;

        let prioridad = 5;
        let prioridadLabel: string | null = null;

        if (cuentaActual?.estado === "pendiente") {
          prioridad = 1;
          prioridadLabel = "CUENTA PENDIENTE";
        } else if (cuentaActual?.estado === "en_camino") {
          prioridad = 2;
          prioridadLabel = "CUENTA EN CAMINO";
        } else if (pedidosListos.length > 0) {
          prioridad = 3;
          prioridadLabel = "PEDIDO LISTO";
        } else if (pedidosActivos.length > 0) {
          prioridad = 4;
          prioridadLabel = "PEDIDOS EN CURSO";
        }

        return {
          id: mesa.id,
          numero: numeroMesa,
          estado: mesa.estado,
          activeSessionId: mesa.activeSessionId,
          totalActual,
          pedidosSesion,
          pedidosActivos,
          pedidosListos,
          cuentaActual,
          prioridad,
          prioridadLabel,
        };
      })
      .sort((a, b) => {
        if (a.prioridad !== b.prioridad) return a.prioridad - b.prioridad;
        return Number(a.numero) - Number(b.numero);
      });
  }, [mesas, pedidos, cuentas]);

  const mesasFiltradas = useMemo(() => {
    return mesasAdmin.filter((mesa) => {
      const matchSearch = String(mesa.numero).includes(search.trim());
      const matchEstado =
        filterEstado === "todas" ? true : mesa.estado === filterEstado;

      return matchSearch && matchEstado;
    });
  }, [mesasAdmin, search, filterEstado]);

  const stats = useMemo(() => {
    const libres = mesasAdmin.filter(
      (mesa) => mesa.estado === "available"
    ).length;
    const ocupadas = mesasAdmin.filter(
      (mesa) => mesa.estado === "occupied"
    ).length;
    const consumoActivo = mesasAdmin.reduce(
      (acc, mesa) => acc + mesa.totalActual,
      0
    );

    const cuentasPendientes = cuentas.filter(
      (cuenta) => cuenta.estado === "pendiente" || cuenta.estado === "en_camino"
    ).length;

    const pedidosListos = mesasAdmin.reduce(
      (acc, mesa) => acc + mesa.pedidosListos.length,
      0
    );

    const ventasHoy = cuentas
      .filter(
        (cuenta) =>
          (cuenta.estado === "pagada" || cuenta.estado === "cerrada") &&
          isSameDay(cuenta.createdAt)
      )
      .reduce((acc, cuenta) => acc + (cuenta.total || 0), 0);

    return {
      libres,
      ocupadas,
      consumoActivo,
      cuentasPendientes,
      pedidosListos,
      ventasHoy,
    };
  }, [mesasAdmin, cuentas]);

  const mesaDetalleLive = useMemo(() => {
    if (!mesaDetalle) return null;

    return (
      mesasAdmin.find(
        (mesa) => String(mesa.numero) === String(mesaDetalle.numero)
      ) || null
    );
  }, [mesasAdmin, mesaDetalle]);

  const cuentasMesaDetalle = useMemo(() => {
    if (!mesaDetalleLive) return [];

    return cuentas
      .filter((cuenta) => String(cuenta.mesa) === String(mesaDetalleLive.numero))
      .sort((a, b) => {
        const aTime =
          typeof a.createdAt?.toMillis === "function"
            ? a.createdAt.toMillis()
            : typeof a.createdAt?.seconds === "number"
              ? a.createdAt.seconds * 1000
              : 0;

        const bTime =
          typeof b.createdAt?.toMillis === "function"
            ? b.createdAt.toMillis()
            : typeof b.createdAt?.seconds === "number"
              ? b.createdAt.seconds * 1000
              : 0;

        return bTime - aTime;
      });
  }, [cuentas, mesaDetalleLive]);

  const handleCreateStaff = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!restaurantId) return;

    try {
      setCreatingStaff(true);
      setStaffMessage("");

      await createStaffMember({
        restaurantId,
        email: staffEmail,
        password: staffPassword,
        role: staffRole,
      });

      setStaffEmail("");
      setStaffPassword("");
      setStaffRole("runner");
      setStaffMessage("Empleado creado correctamente.");
    } catch (error) {
      console.error("Error creando empleado:", error);
      setStaffMessage(getFirebaseErrorMessage(error));
    } finally {
      setCreatingStaff(false);
    }
  };

  const avanzarCuenta = async (cuenta: Cuenta) => {
    if (!restaurantId) return;

    try {
      if (cuenta.estado === "pendiente") {
        await actualizarEstadoCuenta(
          restaurantId,
          cuenta.id,
          "en_camino",
          Number(cuenta.mesa)
        );
        return;
      }

      if (cuenta.estado === "en_camino") {
        await actualizarEstadoCuenta(
          restaurantId,
          cuenta.id,
          "pagada",
          Number(cuenta.mesa)
        );
      }
    } catch (error) {
      console.error("Error al actualizar cuenta:", error);
      toast.error("No se pudo actualizar la cuenta");
    }
  };

  const marcarMesaLista = async (numeroMesa: number) => {
    if (!restaurantId) return;

    const ok = window.confirm(
      `¿Confirmás que la mesa ${numeroMesa} ya está preparada para nuevos clientes?`
    );
    if (!ok) return;

    try {
      await markMesaAvailable(restaurantId, numeroMesa);
      toast.success("Mesa marcada como disponible");
    } catch (error) {
      console.error("Error al marcar mesa disponible:", error);
      toast.error("Error al actualizar la mesa");
    }
  };

  const marcarMesaParaLimpieza = async (numeroMesa: number) => {
    if (!restaurantId) return;

    const ok = window.confirm(
      `¿Querés marcar la mesa ${numeroMesa} como pendiente de limpieza?`
    );
    if (!ok) return;

    try {
      await markMesaNeedsCleaning(restaurantId, numeroMesa);
      toast.success("Mesa marcada como pendiente de limpieza");
    } catch (error) {
      console.error("Error al marcar mesa para limpieza:", error);
      toast.error("Error al actualizar la mesa");
    }
  };

  const handleLogout = async () => {
    try {
      setLoggingOut(true);
      await logout();

      const nextPath = restaurantId
        ? `/staff/login?restaurantId=${encodeURIComponent(restaurantId)}`
        : "/staff/login";

      navigate(nextPath, { replace: true });
    } catch (error) {
      console.error("Error cerrando sesión:", error);
      toast.error("No se pudo cerrar la sesión");
    } finally {
      setLoggingOut(false);
    }
  };

  if (!restaurantId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-100 p-6">
        <div className="rounded-3xl border border-zinc-200 bg-white px-6 py-5 shadow-sm text-center">
          <h1 className="text-lg font-black text-zinc-950">
            Falta restaurante activo
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            Seleccioná un restaurante antes de entrar al panel admin.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-100 p-6">
        <div className="rounded-3xl border border-zinc-200 bg-white px-6 py-5 shadow-sm">
          Cargando panel admin...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-100">
      <div className="mx-auto max-w-[1800px] px-4 py-4 md:px-6 lg:px-8">
        <header className="mb-6 rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-zinc-950 text-white shadow-sm">
                <LayoutDashboard size={22} />
              </div>

              <div>
                <h1 className="text-3xl font-black tracking-tight text-zinc-950">
                  Panel Admin
                </h1>
                <p className="mt-1 text-sm text-zinc-500">
                  Estado en tiempo real de mesas, pedidos y cuentas
                </p>
                {user?.email && (
                  <p className="mt-1 text-xs text-zinc-400">
                    Sesión activa: {user.email}
                  </p>
                )}
              </div>
            </div>
            <button
              onClick={() => navigate("/staff/admin/audit-logs")}
              className="flex items-center gap-3 rounded-3xl border border-zinc-200 bg-white px-5 py-4 shadow-sm transition hover:scale-[1.01]"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-950 text-white">
                <Activity size={22} />
              </div>

              <div className="text-left">
                <p className="text-sm font-black text-zinc-950">
                  Actividad
                </p>

                <p className="text-xs text-zinc-500">
                  Ver auditoría y eventos del sistema
                </p>
              </div>
            </button>
            <button
              onClick={() => navigate("/staff/cashier/invoices")}
              className="flex items-center gap-3 rounded-3xl border border-zinc-200 bg-white px-5 py-4 shadow-sm transition hover:scale-[1.01]"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-950 text-white">
                <ReceiptText size={22} />
              </div>

              <div className="text-left">
                <p className="text-sm font-black text-zinc-950">
                  Facturas
                </p>

                <p className="text-xs text-zinc-500">
                  Ver comprobantes y pagos
                </p>
              </div>
            </button>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => navigate("/staff/admin/analytics")}
                className="flex h-11 items-center gap-2 rounded-2xl bg-zinc-950 px-4 font-semibold text-white transition hover:opacity-90"
              >
                <ArrowRight size={16} />
                Ver analytics
              </button>

              <button
                onClick={handleLogout}
                disabled={loggingOut}
                className="flex h-11 items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 font-semibold text-zinc-900 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <LogOut size={16} />
                {loggingOut ? "Cerrando..." : "Cerrar sesión"}
              </button>
            </div>
          </div>
        </header>

        <section className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          <div className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-zinc-500">
              <Users size={16} />
              <p className="text-sm">Mesas ocupadas</p>
            </div>
            <p className="mt-2 text-3xl font-black text-zinc-950">
              {stats.ocupadas}
            </p>
          </div>

          <div className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-zinc-500">
              <DoorOpen size={16} />
              <p className="text-sm">Mesas libres</p>
            </div>
            <p className="mt-2 text-3xl font-black text-zinc-950">
              {stats.libres}
            </p>
          </div>

          <div className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-zinc-500">
              <ChefHat size={16} />
              <p className="text-sm">Pedidos listos</p>
            </div>
            <p className="mt-2 text-3xl font-black text-zinc-950">
              {stats.pedidosListos}
            </p>
          </div>

          <div className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-zinc-500">
              <Receipt size={16} />
              <p className="text-sm">Cuentas por cobrar</p>
            </div>
            <p className="mt-2 text-3xl font-black text-zinc-950">
              {stats.cuentasPendientes}
            </p>
          </div>

          <div className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-zinc-500">
              <CircleDollarSign size={16} />
              <p className="text-sm">Ventas de hoy</p>
            </div>
            <p className="mt-2 text-3xl font-black text-zinc-950">
              {formatPrice(stats.ventasHoy)}
            </p>
          </div>

          <div className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-zinc-500">
              <CircleDollarSign size={16} />
              <p className="text-sm">Consumo activo</p>
            </div>
            <p className="mt-2 text-3xl font-black text-zinc-950">
              {formatPrice(stats.consumoActivo)}
            </p>
          </div>
        </section>

        <section className="mb-6 rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 lg:grid-cols-4">
            <div className="relative">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
              />
              <input
                type="text"
                placeholder="Buscar mesa..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-11 w-full rounded-2xl border border-zinc-200 bg-white pl-9 pr-3 outline-none focus:ring-2 focus:ring-black/10"
              />
            </div>

            <select
              value={filterEstado}
              onChange={(e) =>
                setFilterEstado(
                  e.target.value as
                    | "todas"
                    | "available"
                    | "occupied"
                    | "needs_cleaning"
                )
              }
              className="h-11 rounded-2xl border border-zinc-200 bg-white px-3 outline-none focus:ring-2 focus:ring-black/10"
            >
              <option value="todas">Todas las mesas</option>
              <option value="occupied">Solo ocupadas</option>
              <option value="needs_cleaning">Pendientes de limpieza</option>
              <option value="available">Solo libres</option>
            </select>

            <div className="flex h-11 items-center rounded-2xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-600">
              Mostrando {mesasFiltradas.length} mesa(s)
            </div>

            <div className="flex h-11 items-center rounded-2xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-600">
              Prioridad automática activa
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {mesasFiltradas.map((mesa) => {
            const priorityStyles = getPriorityStyles(mesa);

            return (
              <div
                key={mesa.id}
                className={`rounded-3xl border p-5 shadow-sm transition-all duration-200 hover:shadow-md ${priorityStyles.card}`}
              >
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-2xl font-black tracking-tight text-zinc-950">
                      Mesa {mesa.numero}
                    </h2>
                    <p className="mt-1 truncate text-xs text-zinc-500">
                      Session: {mesa.activeSessionId ?? "sin sesión"}
                    </p>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <span
                      className={`rounded-full px-3 py-1 text-[11px] font-extrabold uppercase tracking-wide ${priorityStyles.badge}`}
                    >
                      {mesa.prioridadLabel || mesa.estado.toUpperCase()}
                    </span>

                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${statusBadge(
                        mesa.estado
                      )}`}
                    >
                      {mesa.estado}
                    </span>
                  </div>
                </div>

                <div className="mb-4 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-zinc-200 bg-white/90 p-3">
                    <p className="text-xs text-zinc-500">Total actual</p>
                    <p className="mt-1 font-bold text-zinc-950">
                      {formatPrice(mesa.totalActual)}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-zinc-200 bg-white/90 p-3">
                    <p className="text-xs text-zinc-500">Pedidos activos</p>
                    <p className="mt-1 font-bold text-zinc-950">
                      {mesa.pedidosActivos.length}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-zinc-200 bg-white/90 p-3">
                    <p className="text-xs text-zinc-500">Pedidos listos</p>
                    <p className="mt-1 font-bold text-zinc-950">
                      {mesa.pedidosListos.length}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-zinc-200 bg-white/90 p-3">
                    <p className="text-xs text-zinc-500">Cuenta</p>
                    <p className="mt-1 font-bold text-zinc-950">
                      {mesa.cuentaActual ? mesa.cuentaActual.estado : "sin pedir"}
                    </p>
                  </div>
                </div>

                {mesa.cuentaActual && (
                  <div className="mb-4">
                    <button
                      onClick={() => avanzarCuenta(mesa.cuentaActual)}
                      className="h-11 w-full rounded-2xl bg-emerald-600 font-semibold text-white transition hover:opacity-90"
                    >
                      {mesa.cuentaActual.estado === "pendiente"
                        ? "Marcar cuenta en camino"
                        : mesa.cuentaActual.estado === "en_camino"
                          ? "Marcar cuenta pagada"
                          : "Cuenta cerrada"}
                    </button>
                  </div>
                )}

                <div className="mb-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="font-semibold text-zinc-950">
                      Pedidos activos
                    </h3>
                    <span className="text-xs text-zinc-500">
                      {mesa.pedidosActivos.length}
                    </span>
                  </div>

                  {mesa.pedidosActivos.length === 0 ? (
                    <div className="rounded-2xl border border-zinc-200 bg-white/90 p-4 text-sm text-zinc-500">
                      No hay pedidos activos
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {mesa.pedidosActivos.slice(0, 2).map((pedido) => (
                        <div
                          key={pedido.id}
                          className="rounded-2xl border border-zinc-200 bg-white/90 p-3"
                        >
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <span className="font-semibold text-zinc-950">
                              Pedido #{pedido.id.slice(0, 6)}
                            </span>

                            <div className="flex items-center gap-2">
                              {pedidoTieneObservaciones(pedido) && (
                                <span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-extrabold uppercase tracking-wide text-amber-900">
                                  CON OBS
                                </span>
                              )}

                              <span className="text-sm font-medium text-zinc-700">
                                {formatPrice(pedido.total)}
                              </span>
                            </div>
                          </div>

                          {renderPedidoItems(pedido)}

                          <div className="mt-3 flex flex-wrap gap-2">
                            {pedido.items?.some(
                              (item) => item.category === "food"
                            ) && (
                              <span
                                className={`rounded-full px-2 py-1 text-xs font-bold uppercase tracking-wide ${statusBadge(
                                  getKitchenStatus(pedido)
                                )}`}
                              >
                                Cocina: {getKitchenStatus(pedido)}
                              </span>
                            )}

                            {pedido.items?.some(
                              (item) => item.category === "drinks"
                            ) && (
                              <span
                                className={`rounded-full px-2 py-1 text-xs font-bold uppercase tracking-wide ${statusBadge(
                                  getBarStatus(pedido)
                                )}`}
                              >
                                Barra: {getBarStatus(pedido)}
                              </span>
                            )}

                            {isPedidoListo(pedido) && (
                              <span className="rounded-full bg-emerald-500 px-2 py-1 text-xs font-bold uppercase tracking-wide text-white">
                                Listo
                              </span>
                            )}
                          </div>
                        </div>
                      ))}

                      {mesa.pedidosActivos.length > 2 && (
                        <p className="text-xs text-zinc-500">
                          + {mesa.pedidosActivos.length - 2} pedido(s) más
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setMesaDetalle(mesa)}
                    className="h-11 rounded-2xl border border-zinc-200 bg-white font-semibold text-zinc-900 transition hover:bg-zinc-50"
                  >
                    Ver detalle
                  </button>

                  {mesa.estado === "needs_cleaning" ? (
                    <button
                      onClick={() => marcarMesaLista(Number(mesa.numero))}
                      className="h-11 rounded-2xl bg-zinc-950 font-semibold text-white transition hover:opacity-90"
                    >
                      Marcar lista
                    </button>
                  ) : mesa.estado === "occupied" ? (
                    <button
                      onClick={() => marcarMesaParaLimpieza(Number(mesa.numero))}
                      className="h-11 rounded-2xl bg-zinc-950 font-semibold text-white transition hover:opacity-90"
                    >
                      A limpieza
                    </button>
                  ) : (
                    <button
                      onClick={() => marcarMesaLista(Number(mesa.numero))}
                      className="h-11 rounded-2xl bg-zinc-950 font-semibold text-white transition hover:opacity-90"
                    >
                      Disponible
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </section>

        {mesasFiltradas.length === 0 && (
          <div className="mt-6 rounded-3xl border border-zinc-200 bg-white p-8 text-center text-zinc-500 shadow-sm">
            No se encontraron mesas con ese filtro
          </div>
        )}
        <div className="mt-8">
      <MesaManagementPanel
        restaurantId={restaurantId}
        qrBasePath="/qr"
      />

</div>
<RestaurantBrandingPanel restaurantId={restaurantId} />
        <section className="mb-6 rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-zinc-950 text-white">
              <UserPlus size={20} />
            </div>

            <div>
              <h2 className="text-xl font-black text-zinc-950">
                Crear empleado
              </h2>
              <p className="mt-1 text-sm text-zinc-500">
                Creá usuarios para cocina, barra, runners o administradores.
              </p>
            </div>
          </div>

          <form
            onSubmit={handleCreateStaff}
            className="grid gap-3 lg:grid-cols-[1.4fr_1fr_1fr_auto]"
          >
            <input
              type="email"
              placeholder="Email del empleado"
              value={staffEmail}
              onChange={(e) => setStaffEmail(e.target.value)}
              required
              className="h-11 rounded-2xl border border-zinc-200 bg-white px-3 outline-none focus:ring-2 focus:ring-black/10"
            />

            <input
              type="password"
              placeholder="Contraseña temporal"
              value={staffPassword}
              onChange={(e) => setStaffPassword(e.target.value)}
              required
              minLength={6}
              className="h-11 rounded-2xl border border-zinc-200 bg-white px-3 outline-none focus:ring-2 focus:ring-black/10"
            />

            <select
              value={staffRole}
              onChange={(e) => setStaffRole(e.target.value as StaffRole)}
              className="h-11 rounded-2xl border border-zinc-200 bg-white px-3 outline-none focus:ring-2 focus:ring-black/10"
            >
              <option value="runner">Runner</option>
              <option value="kitchen">Cocina</option>
              <option value="bar">Barra</option>
              <option value="admin">Admin</option>
            </select>

            <button
              type="submit"
              disabled={creatingStaff}
              className="h-11 rounded-2xl bg-zinc-950 px-5 font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {creatingStaff ? "Creando..." : "Crear"}
            </button>
          </form>

          {staffMessage && (
            <p className="mt-3 text-sm font-medium text-zinc-700">
              {staffMessage}
            </p>
          )}
        </section>

        <StaffManagementPanel restaurantId={restaurantId} />
        <MenuManagementPanel restaurantId={restaurantId} />
        <StockPanel
          restaurantId={restaurantId}
          plan={restaurant?.plan}
        />
      </div>

      {mesaDetalleLive && (
        <div className="fixed inset-0 z-50 flex bg-black/40">
          <div className="flex-1" onClick={() => setMesaDetalle(null)} />

          <aside className="h-full w-full max-w-3xl overflow-y-auto border-l border-zinc-200 bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-zinc-200 bg-white p-5">
              <div>
                <h2 className="text-2xl font-black tracking-tight text-zinc-950">
                  Mesa {mesaDetalleLive.numero}
                </h2>
                <p className="text-sm text-zinc-500">
                  Session actual: {mesaDetalleLive.activeSessionId ?? "sin sesión"}
                </p>
              </div>

              <button
                onClick={() => setMesaDetalle(null)}
                className="flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-200 text-zinc-700 transition hover:bg-zinc-50"
              >
                <X size={18} />
              </button>
            </div>
            
            <div className="space-y-6 p-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                  <p className="text-sm text-zinc-500">Estado mesa</p>
                  <p className="mt-1 font-bold text-zinc-950">
                    {mesaDetalleLive.estado}
                  </p>
                </div>

                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                  <p className="text-sm text-zinc-500">Total sesión</p>
                  <p className="mt-1 font-bold text-zinc-950">
                    {formatPrice(mesaDetalleLive.totalActual)}
                  </p>
                </div>

                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                  <p className="text-sm text-zinc-500">Pedidos sesión</p>
                  <p className="mt-1 font-bold text-zinc-950">
                    {mesaDetalleLive.pedidosSesion.length}
                  </p>
                </div>

                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                  <p className="text-sm text-zinc-500">Cuenta actual</p>
                  <p className="mt-1 font-bold text-zinc-950">
                    {mesaDetalleLive.cuentaActual
                      ? mesaDetalleLive.cuentaActual.estado
                      : "sin pedir"}
                  </p>
                </div>
              </div>

              {mesaDetalleLive.cuentaActual && (
                <div className="rounded-3xl border border-zinc-200 bg-zinc-50 p-4">
                  <h3 className="mb-3 font-bold text-zinc-950">
                    Acción rápida de cuenta
                  </h3>
                  <button
                    onClick={() => avanzarCuenta(mesaDetalleLive.cuentaActual!)}
                    className="h-11 w-full rounded-2xl bg-emerald-600 font-semibold text-white transition hover:opacity-90"
                  >
                    {mesaDetalleLive.cuentaActual.estado === "pendiente"
                      ? "Marcar cuenta en camino"
                      : mesaDetalleLive.cuentaActual.estado === "en_camino"
                        ? "Marcar cuenta pagada"
                        : "Cuenta cerrada"}
                  </button>
                </div>
              )}

              <section>
                <h3 className="mb-3 text-lg font-black text-zinc-950">
                  Pedidos de la sesión
                </h3>

                {mesaDetalleLive.pedidosSesion.length === 0 ? (
                  <div className="rounded-3xl border border-zinc-200 p-4 text-zinc-500">
                    No hay pedidos en esta sesión
                  </div>
                ) : (
                  <div className="space-y-3">
                    {mesaDetalleLive.pedidosSesion.map((pedido) => (
                      <div
                        key={pedido.id}
                        className="rounded-3xl border border-zinc-200 bg-white p-4"
                      >
                        <div className="mb-3 flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-bold text-zinc-950">
                                Pedido #{pedido.id.slice(0, 6)}
                              </p>

                              {pedidoTieneObservaciones(pedido) && (
                                <span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-extrabold uppercase tracking-wide text-amber-900">
                                  CON OBS
                                </span>
                              )}
                            </div>

                            <p className="text-xs text-zinc-500">
                              {formatDate(pedido.createdAt)}
                            </p>
                          </div>

                          <p className="font-bold text-zinc-950">
                            {formatPrice(pedido.total)}
                          </p>
                        </div>

                        <div className="mb-3">{renderPedidoItems(pedido)}</div>

                        <div className="flex flex-wrap gap-2">
                          {pedido.items?.some(
                            (item) => item.category === "food"
                          ) && (
                            <span
                              className={`rounded-full px-2 py-1 text-xs font-bold uppercase tracking-wide ${statusBadge(
                                getKitchenStatus(pedido)
                              )}`}
                            >
                              Cocina: {getKitchenStatus(pedido)}
                            </span>
                          )}

                          {pedido.items?.some(
                            (item) => item.category === "drinks"
                          ) && (
                            <span
                              className={`rounded-full px-2 py-1 text-xs font-bold uppercase tracking-wide ${statusBadge(
                                getBarStatus(pedido)
                              )}`}
                            >
                              Barra: {getBarStatus(pedido)}
                            </span>
                          )}

                          <span
                            className={`rounded-full px-2 py-1 text-xs font-bold uppercase tracking-wide ${
                              isPedidoActivo(pedido)
                                ? "bg-orange-100 text-orange-700 border border-orange-200"
                                : "bg-zinc-200 text-zinc-700 border border-zinc-300"
                            }`}
                          >
                            {isPedidoActivo(pedido) ? "Activo" : "Cerrado"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <h3 className="mb-3 text-lg font-black text-zinc-950">
                  Cuentas de esta mesa
                </h3>

                {cuentasMesaDetalle.length === 0 ? (
                  <div className="rounded-3xl border border-zinc-200 p-4 text-zinc-500">
                    No hay cuentas registradas
                  </div>
                ) : (
                  <div className="space-y-3">
                    {cuentasMesaDetalle.map((cuenta) => (
                      <div
                        key={cuenta.id}
                        className="rounded-3xl border border-zinc-200 bg-white p-4"
                      >
                        <div className="mb-3 flex items-center justify-between gap-2">
                          <div>
                            <p className="font-bold text-zinc-950">
                              Cuenta #{cuenta.id.slice(0, 6)}
                            </p>
                            <p className="text-xs text-zinc-500">
                              {formatDate(cuenta.createdAt)}
                            </p>
                          </div>

                          <span
                            className={`rounded-full px-2 py-1 text-xs font-bold uppercase tracking-wide ${statusBadge(
                              cuenta.estado
                            )}`}
                          >
                            {cuenta.estado}
                          </span>
                        </div>

                        <div className="mb-3 grid grid-cols-2 gap-3 text-sm text-zinc-700">
                          <p>
                            <b>Total:</b> {formatPrice(cuenta.total)}
                          </p>
                          <p>
                            <b>Método:</b> {metodoLabel(cuenta.metodo)}
                          </p>
                          <p>
                            <b>SessionId:</b> {cuenta.sessionId}
                          </p>
                          <p>
                            <b>Dividida:</b> {cuenta.splitBill ? "Sí" : "No"}
                          </p>
                        </div>

                        {(cuenta.estado === "pendiente" ||
                          cuenta.estado === "en_camino") && (
                          <button
                            onClick={() => avanzarCuenta(cuenta)}
                            className="h-10 w-full rounded-2xl bg-emerald-600 font-semibold text-white transition hover:opacity-90"
                          >
                            {cuenta.estado === "pendiente"
                              ? "Marcar en camino"
                              : "Marcar pagada"}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
};

export default Admin;