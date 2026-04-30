import { useState } from "react";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, getDb } from "../lib/firebase";
import { useRestaurant } from "../lib/restaurant-context";

type StaffRole = "admin" | "kitchen" | "bar" | "runner";

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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { restaurantId: activeRestaurantId, setRestaurantId } = useRestaurant();

  const restaurantId =
    normalizeString(searchParams.get("restaurantId")) ||
    normalizeString(location.state?.restaurantId) ||
    normalizeString(activeRestaurantId);

  const table =
    normalizeString(searchParams.get("table")) ||
    normalizeString(location.state?.table);

  const handleLogin = async () => {
    setError("");

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPassword = password.trim();

    if (!normalizedEmail || !normalizedPassword) {
      setError("Completá email y contraseña");
      return;
    }

    if (!restaurantId) {
      setError("Falta restaurantId en la URL");
      return;
    }

    try {
      setSubmitting(true);

      const credential = await signInWithEmailAndPassword(
        auth,
        normalizedEmail,
        normalizedPassword
      );

      const staffRef = doc(
        db,
        "restaurants",
        restaurantId,
        "staff",
        credential.user.uid
      );

      const staffSnap = await getDoc(staffRef);

      if (!staffSnap.exists()) {
        setError("Este usuario no pertenece a este restaurante");
        return;
      }

      const staffData = staffSnap.data() as {
        role?: StaffRole;
        active?: boolean;
      };

      if (staffData.active !== true) {
        setError("Este usuario está desactivado");
        return;
      }

      if (!staffData.role || !roleHome[staffData.role]) {
        setError("El usuario no tiene un rol válido");
        return;
      }

      setRestaurantId(restaurantId);

      const params = new URLSearchParams();
      params.set("restaurantId", restaurantId);
      if (table) params.set("table", table);

      const finalPath = `${roleHome[staffData.role]}?${params.toString()}`;

      navigate(finalPath, {
        replace: true,
        state: {
          restaurantId,
          ...(table ? { table } : {}),
        },
      });
    } catch (err: any) {
      console.error("Error login staff:", err);
      setError(getFirebaseAuthMessage(err?.code));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-100 px-4">
      <div className="bg-white p-6 rounded-2xl shadow max-w-sm w-full">
        <h1 className="text-xl font-bold mb-4 text-center">Acceso Staff</h1>

        {restaurantId && (
          <p className="mb-3 text-center text-sm text-zinc-500">
            Restaurante activo:{" "}
            <span className="font-semibold">{restaurantId}</span>
          </p>
        )}

        <input
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (error) setError("");
          }}
          placeholder="Email"
          autoComplete="email"
          className="w-full h-12 border rounded-lg px-4 mb-3"
        />

        <input
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (error) setError("");
          }}
          placeholder="Contraseña"
          autoComplete="current-password"
          className="w-full h-12 border rounded-lg px-4 mb-3"
        />

        {error && (
          <p className="text-red-500 text-sm text-center mb-2">{error}</p>
        )}

        <button
          onClick={handleLogin}
          disabled={submitting}
          className="w-full h-12 bg-black text-white rounded-lg font-bold disabled:opacity-50"
        >
          {submitting ? "Ingresando..." : "Ingresar"}
        </button>
      </div>
    </div>
  );
};

export default StaffLogin;