import { useState } from "react";
import {
  useNavigate,
  useLocation,
  useSearchParams,
} from "react-router-dom";
import { sendPasswordResetEmail, signInWithEmailAndPassword } from "firebase/auth";
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

  const [showReset, setShowReset] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetMessage, setResetMessage] = useState("");

  const handlePasswordReset = async () => {
    const cleanEmail = resetEmail.trim();
    if (!cleanEmail) {
      setResetMessage("Ingresá tu email.");
      return;
    }
    try {
      setResetLoading(true);
      auth.languageCode = "es";
      await sendPasswordResetEmail(auth, cleanEmail);
      setResetMessage("Te mandamos un email para restablecer tu contraseña. Revisá tu bandeja de entrada.");
    } catch {
      setResetMessage("No se pudo enviar el email. Verificá que sea el correcto.");
    } finally {
      setResetLoading(false);
    }
  };

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
        setError("Credenciales inválidas o acceso no autorizado");
        return;
      }

      const staffData = staffSnap.data();

      if (staffData.active !== true) {
        setError("Credenciales inválidas o acceso no autorizado");
        return;
      }

      const role = normalizeString(staffData.role) as StaffRole;

      if (!validRoles.includes(role)) {
        setError("Credenciales inválidas o acceso no autorizado");
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
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold text-foreground">
            Acceso Staff
          </h1>

          <p className="mt-2 text-sm text-muted-foreground">
            Restaurante activo:{" "}
            <span className="font-medium text-foreground">
              {restaurantId || "Sin restaurantId"}
            </span>
          </p>
        </div>

        <div className="space-y-3">
          <input
            type="email"
            placeholder="Email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-11 w-full rounded-md border border-border bg-secondary px-4 text-foreground placeholder:text-muted-foreground outline-none transition focus:ring-2 focus:ring-ring/40"
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
            className="h-11 w-full rounded-md border border-border bg-secondary px-4 text-foreground placeholder:text-muted-foreground outline-none transition focus:ring-2 focus:ring-ring/40"
          />

          {error && (
            <div className="rounded-md border border-red-800/50 bg-red-950/50 px-4 py-3 text-sm font-medium text-red-400">
              {error}
            </div>
          )}

          <button
            onClick={() => void handleLogin()}
            disabled={loading}
            className="h-11 w-full rounded-md bg-primary text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Ingresando..." : "Ingresar"}
          </button>

          <button
            type="button"
            onClick={() => {
              setShowReset(!showReset);
              setResetMessage("");
              setResetEmail("");
            }}
            className="w-full text-center text-sm text-muted-foreground transition hover:text-foreground"
          >
            {showReset ? "Volver al login" : "¿Olvidaste tu contraseña?"}
          </button>

          {showReset && (
            <div className="space-y-3 rounded-md border border-border bg-secondary p-4">
              <p className="text-sm text-muted-foreground">
                Ingresá tu email y te mandamos un link para restablecer tu contraseña.
              </p>
              <input
                type="email"
                placeholder="tu@email.com"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                className="h-10 w-full rounded-md border border-border bg-background px-4 text-sm text-foreground placeholder:text-muted-foreground outline-none transition focus:ring-2 focus:ring-ring/40"
              />
              {resetMessage && (
                <p className={`text-xs font-medium ${resetMessage.includes("mandamos") ? "text-emerald-400" : "text-red-400"}`}>
                  {resetMessage}
                </p>
              )}
              <button
                type="button"
                onClick={() => void handlePasswordReset()}
                disabled={resetLoading}
                className="h-10 w-full rounded-md border border-border bg-secondary text-sm font-medium text-foreground transition hover:bg-muted disabled:opacity-60"
              >
                {resetLoading ? "Enviando..." : "Enviar email de recuperación"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default StaffLogin;