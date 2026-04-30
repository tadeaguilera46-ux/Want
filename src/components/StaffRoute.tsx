import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Navigate,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { LogOut } from "lucide-react";
import { getDb } from "../lib/firebase";
import { useAuth } from "../lib/auth-context";
import { useRestaurant } from "../lib/restaurant-context";

type StaffRole = "admin" | "kitchen" | "bar" | "runner";

type StaffRouteProps = {
  children: ReactNode;
  allowedRoles?: StaffRole[];
};

type StaffDoc = {
  uid?: string;
  role?: StaffRole;
  active?: boolean;
};

const db = getDb();

const roleHome: Record<StaffRole, string> = {
  admin: "/staff/admin",
  kitchen: "/staff/kitchen",
  bar: "/staff/bar",
  runner: "/staff/runner",
};

const normalizeString = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const StaffRoute = ({ children, allowedRoles }: StaffRouteProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const { user, loading: authLoading, logout } = useAuth();
  const { restaurantId: contextRestaurantId, setRestaurantId } = useRestaurant();

  const [checkingStaff, setCheckingStaff] = useState(true);
  const [isAllowed, setIsAllowed] = useState(false);
  const [staffRole, setStaffRole] = useState<StaffRole | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const restaurantId = useMemo(() => {
    return (
      normalizeString(searchParams.get("restaurantId")) ||
      normalizeString(
        (location.state as { restaurantId?: string } | null)?.restaurantId
      ) ||
      normalizeString(contextRestaurantId)
    );
  }, [searchParams, location.state, contextRestaurantId]);

  useEffect(() => {
    if (restaurantId && restaurantId !== contextRestaurantId) {
      setRestaurantId(restaurantId);
    }
  }, [restaurantId, contextRestaurantId, setRestaurantId]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (authLoading) return;

      if (!user || !restaurantId) {
        if (!cancelled) {
          setIsAllowed(false);
          setStaffRole(null);
          setCheckingStaff(false);
        }
        return;
      }

      try {
        setCheckingStaff(true);

        const ref = doc(db, "restaurants", restaurantId, "staff", user.uid);
        const snapshot = await getDoc(ref);

        if (!snapshot.exists()) {
          if (!cancelled) {
            setIsAllowed(false);
            setStaffRole(null);
            setCheckingStaff(false);
          }
          return;
        }

        const data = snapshot.data() as StaffDoc;
        const role = data.role ?? null;
        const active = data.active === true;

        if (!active || !role) {
          if (!cancelled) {
            setIsAllowed(false);
            setStaffRole(null);
            setCheckingStaff(false);
          }
          return;
        }

        const roleAllowed =
          !allowedRoles || allowedRoles.length === 0
            ? true
            : allowedRoles.includes(role);

        if (!cancelled) {
          setIsAllowed(roleAllowed);
          setStaffRole(role);
          setCheckingStaff(false);
        }
      } catch (error) {
        console.error("Error validando staff:", error);

        if (!cancelled) {
          setIsAllowed(false);
          setStaffRole(null);
          setCheckingStaff(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [authLoading, user, restaurantId, allowedRoles]);

  const handleLogout = async () => {
    try {
      setLoggingOut(true);
      await logout();

      const loginPath = restaurantId
        ? `/staff/login?restaurantId=${encodeURIComponent(restaurantId)}`
        : "/staff/login";

      navigate(loginPath, { replace: true });
    } catch (error) {
      console.error("Error cerrando sesión:", error);
      alert("No se pudo cerrar la sesión");
    } finally {
      setLoggingOut(false);
    }
  };

  if (authLoading || checkingStaff) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-100 p-6">
        <div className="rounded-3xl border border-zinc-200 bg-white px-6 py-5 shadow-sm">
          Verificando acceso staff...
        </div>
      </div>
    );
  }

  if (!user) {
    const params = new URLSearchParams();

    if (restaurantId) {
      params.set("restaurantId", restaurantId);
    }

    const loginPath = params.toString()
      ? `/staff/login?${params.toString()}`
      : "/staff/login";

    return (
      <Navigate
        to={loginPath}
        state={{
          from: location.pathname,
          ...(restaurantId ? { restaurantId } : {}),
        }}
        replace
      />
    );
  }

  if (!restaurantId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-100 p-6">
        <div className="rounded-3xl border border-zinc-200 bg-white px-6 py-5 shadow-sm text-center">
          <h1 className="text-lg font-black text-zinc-950">
            Falta restaurante activo
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            Entrá desde una URL con{" "}
            <span className="font-mono">?restaurantId=...</span>
          </p>
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="mt-4 h-11 w-full rounded-2xl bg-red-600 font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
          >
            {loggingOut ? "Cerrando..." : "Cerrar sesión"}
          </button>
        </div>
      </div>
    );
  }

  // Redirección automática por rol
  if (!isAllowed && staffRole) {
    const target = `${roleHome[staffRole]}?restaurantId=${encodeURIComponent(
      restaurantId
    )}`;

    if (location.pathname !== roleHome[staffRole]) {
      return <Navigate to={target} replace />;
    }
  }

  if (!isAllowed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-100 p-6">
        <div className="rounded-3xl border border-zinc-200 bg-white px-6 py-5 shadow-sm text-center max-w-md">
          <h1 className="text-lg font-black text-zinc-950">Acceso denegado</h1>

          <p className="mt-2 text-sm text-zinc-600">
            No tenés permisos para entrar a esta sección del restaurante{" "}
            <span className="font-semibold">{restaurantId}</span>.
          </p>

          {staffRole && (
            <p className="mt-2 text-xs text-zinc-500">
              Rol actual: <span className="font-semibold">{staffRole}</span>
            </p>
          )}

          {user?.email && (
            <p className="mt-1 text-xs text-zinc-400">
              Usuario: {user.email}
            </p>
          )}

          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-red-600 font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
          >
            <LogOut size={16} />
            {loggingOut ? "Cerrando..." : "Cerrar sesión"}
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default StaffRoute;