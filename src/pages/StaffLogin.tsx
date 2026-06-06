import { useState } from "react";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { sendPasswordResetEmail, signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, getDb } from "../lib/firebase";
import { useRestaurant } from "../lib/restaurant-context";

type StaffRole = "admin" | "kitchen" | "bar" | "runner" | "cashier";

const validRoles: StaffRole[] = ["admin", "kitchen", "bar", "runner", "cashier"];

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
    case "auth/invalid-email": return "Email inválido";
    case "auth/invalid-credential": return "Credenciales inválidas";
    case "auth/user-disabled": return "Usuario deshabilitado";
    case "auth/operation-not-allowed": return "El login por email/password no está habilitado en Firebase";
    default: return "No se pudo iniciar sesión";
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
    if (!cleanEmail) { setResetMessage("Ingresá tu email."); return; }
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
    normalizeString((location.state as { restaurantId?: string } | null)?.restaurantId);

  const handleLogin = async () => {
    setError("");
    if (!restaurantId) { setError("Falta restaurantId en la URL"); return; }
    if (!email.trim() || !password.trim()) { setError("Completá email y contraseña"); return; }

    try {
      setLoading(true);
      const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
      const user = credential.user;
      const staffRef = doc(db, "restaurants", restaurantId, "staff", user.uid);
      const staffSnap = await getDoc(staffRef);

      if (!staffSnap.exists()) { setError("Credenciales inválidas o acceso no autorizado"); return; }
      const staffData = staffSnap.data();
      if (staffData.active !== true) { setError("Credenciales inválidas o acceso no autorizado"); return; }

      const role = normalizeString(staffData.role) as StaffRole;
      if (!validRoles.includes(role)) { setError("Credenciales inválidas o acceso no autorizado"); return; }

      setRestaurantId(restaurantId);
      navigate(`${roleHome[role]}?restaurantId=${encodeURIComponent(restaurantId)}`, {
        replace: true,
        state: { restaurantId },
      });
    } catch (err: any) {
      console.error("Error login staff:", err);
      setError(getFirebaseAuthMessage(err?.code));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm rounded-[10px] border border-border bg-card p-8">

        {/* Logo */}
        <div className="mb-7">
          <div className="mb-5 flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-[4px] bg-foreground">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="hsl(40 25% 97%)" strokeWidth="2.5">
                <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
              </svg>
            </div>
            <span className="font-display text-base font-bold tracking-tight">WANT</span>
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Acceso Staff</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {restaurantId ? `Restaurante: ${restaurantId}` : "Sistema operativo para restaurantes"}
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Email</label>
            <input
              type="email"
              placeholder="tu@restaurante.com"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-10 w-full rounded-md border border-border bg-secondary px-3 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Contraseña</label>
            <input
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleLogin(); }}
              className="h-10 w-full rounded-md border border-border bg-secondary px-3 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700">
              {error}
            </div>
          )}

          <button
            onClick={() => void handleLogin()}
            disabled={loading}
            className="h-10 w-full rounded-md bg-foreground text-sm font-semibold text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Ingresando..." : "Ingresar"}
          </button>

          <button
            type="button"
            onClick={() => { setShowReset(!showReset); setResetMessage(""); setResetEmail(""); }}
            className="w-full pt-1 text-center text-xs text-muted-foreground transition hover:text-foreground"
          >
            {showReset ? "Volver al login" : "¿Olvidaste tu contraseña?"}
          </button>

          {showReset && (
            <div className="space-y-2.5 rounded-[10px] border border-border bg-secondary p-4">
              <p className="text-xs text-muted-foreground">
                Ingresá tu email y te mandamos un link para restablecer tu contraseña.
              </p>
              <input
                type="email"
                placeholder="tu@email.com"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
              {resetMessage && (
                <p className={`text-xs font-medium ${resetMessage.includes("mandamos") ? "text-green-700" : "text-red-600"}`}>
                  {resetMessage}
                </p>
              )}
              <button
                type="button"
                onClick={() => void handlePasswordReset()}
                disabled={resetLoading}
                className="h-9 w-full rounded-md border border-border bg-card text-sm font-medium text-foreground transition hover:bg-secondary disabled:opacity-60"
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
