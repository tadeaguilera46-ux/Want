import { useState } from "react";
import {
  useNavigate,
  useLocation,
  useSearchParams,
} from "react-router-dom";
import { signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, getDb } from "../lib/firebase";
import { useRestaurant } from "../lib/restaurant-context";

type StaffRole =
  | "admin"
  | "kitchen"
  | "bar"
  | "runner"
  | "cashier";

const validRoles: StaffRole[] = [
  "admin",
  "kitchen",
  "bar",
  "runner",
  "cashier",
];

const db = getDb();

const roleHome: Record<StaffRole, string> = {
  admin: "/staff/admin",
  kitchen: "/staff/kitchen",
  bar: "/staff/bar",
  runner: "/staff/runner",
  cashier: "/staff/cashier",
};

const normalizeString = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const getFirebaseAuthMessage = (code?: string) => {
  switch (code) {
    case "auth/invalid-email":
      return "Email inválido";

    case "auth/invalid-credential":
      return "Credenciales inválidas";

    case "auth/user-disabled":
      return "Usuario deshabilitado";

    case "auth/operation-not-allowed":
      return "El login por email/password no está habilitado en Firebase";

    default:
      return "No se pudo iniciar sesión";
  }
};

const StaffLogin = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const { setRestaurantId } = useRestaurant();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const restaurantId =
    normalizeString(searchParams.get("restaurantId")) ||
    normalizeString(
      (location.state as { restaurantId?: string } | null)?.restaurantId
    );

  const handleLogin = async () => {
    setError("");

    if (!restaurantId) {
      setError("Falta restaurantId en la URL");
      return;
    }

    if (!email.trim() || !password.trim()) {
      setError("Completá email y contraseña");
      return;
    }

    try {
      setLoading(true);

      const credential = await signInWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );

      const user = credential.user;

      const staffRef = doc(
        db,
        "restaurants",
        restaurantId,
        "staff",
        user.uid
      );

      const staffSnap = await getDoc(staffRef);

      if (!staffSnap.exists()) {
        setError("El usuario no pertenece al staff");
        return;
      }

      const staffData = staffSnap.data();

      if (staffData.active !== true) {
        setError("El usuario está desactivado");
        return;
      }

      const role = normalizeString(staffData.role) as StaffRole;

      if (!validRoles.includes(role)) {
        setError("El usuario no tiene un rol válido");
        return;
      }

      setRestaurantId(restaurantId);

      const targetPath = roleHome[role];

      navigate(
        `${targetPath}?restaurantId=${encodeURIComponent(restaurantId)}`,
        {
          replace: true,
          state: {
            restaurantId,
          },
        }
      );
    } catch (err: any) {
      console.error("Error login staff:", err);

      setError(getFirebaseAuthMessage(err?.code));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-100 p-6">
      <div className="w-full max-w-md rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-black text-zinc-950">
            Acceso Staff
          </h1>

          <p className="mt-2 text-sm text-zinc-500">
            Restaurante activo:{" "}
            <span className="font-semibold">
              {restaurantId || "Sin restaurantId"}
            </span>
          </p>
        </div>

        <div className="space-y-4">
          <input
            type="email"
            placeholder="Email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-14 w-full rounded-2xl border border-zinc-200 bg-white px-4 outline-none transition focus:ring-2 focus:ring-black/10"
          />

          <input
            type="password"
            placeholder="Contraseña"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                void handleLogin();
              }
            }}
            className="h-14 w-full rounded-2xl border border-zinc-200 bg-white px-4 outline-none transition focus:ring-2 focus:ring-black/10"
          />

          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
              {error}
            </div>
          )}

          <button
            onClick={() => void handleLogin()}
            disabled={loading}
            className="h-14 w-full rounded-2xl bg-black text-lg font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Ingresando..." : "Ingresar"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default StaffLogin;