import { useEffect, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import {
  Building2,
  LogOut,
  Plus,
  ShieldCheck,
  ExternalLink,
  Copy,
} from "lucide-react";
import { getDb } from "../lib/firebase";
import SuperAdminBillingPanel from "../components/SuperAdminBillingPanel";
import { createStaffMember } from "../lib/staff";
import { writeAuditLog } from "../lib/audit-logs";

const db = getDb();
const auth = getAuth();

type RestaurantRecord = {
  id: string;
  name?: string;
  active?: boolean;
  createdAt?: unknown;
};

const normalizeRestaurantId = (value: string) => {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "");
};

const getFirebaseErrorMessage = (error: unknown) => {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: string }).code)
      : "";

  switch (code) {
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Email o contraseña incorrectos.";
    case "auth/invalid-email":
      return "El email no es válido.";
    case "auth/email-already-in-use":
      return "Ese email ya está registrado.";
    case "auth/weak-password":
      return "La contraseña debe tener al menos 6 caracteres.";
    case "permission-denied":
      return "No tenés permisos para hacer esta acción.";
    default:
      return "Ocurrió un error. Revisá consola.";
  }
};

const SuperAdmin = () => {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [restaurants, setRestaurants] = useState<RestaurantRecord[]>([]);
  const [restaurantName, setRestaurantName] = useState("");
  const [restaurantId, setRestaurantId] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);

      if (currentUser) {
        try {
          const result = await currentUser.getIdTokenResult(true);
          setIsSuperAdmin(result.claims["superAdmin"] === true);
        } catch {
          setIsSuperAdmin(false);
        }
      } else {
        setIsSuperAdmin(false);
      }
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    if (!isSuperAdmin) {
      setRestaurants([]);
      return;
    }

    const unsub = onSnapshot(
      collection(db, "restaurants"),
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        })) as RestaurantRecord[];

        setRestaurants(data);
      },
      (error) => {
        console.error("Error cargando restaurantes:", error);
        setMessage("No se pudieron cargar los restaurantes.");
      }
    );

    return () => unsub();
  }, [isSuperAdmin]);

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage(`${label} copiado correctamente.`);
    } catch {
      window.prompt(`Copiá el link de ${label}:`, text);
    }
  };

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) return;

    try {
      setLoading(true);
      setMessage("");

      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (error) {
      console.error("Error login super admin:", error);
      setMessage(getFirebaseErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  const handleRestaurantNameChange = (value: string) => {
    setRestaurantName(value);

    if (!restaurantId.trim()) {
      setRestaurantId(normalizeRestaurantId(value));
    }
  };

  const handleCreateRestaurant = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    const cleanRestaurantId = normalizeRestaurantId(restaurantId);
    const cleanName = restaurantName.trim();
    const cleanOwnerEmail = ownerEmail.trim();

    if (!cleanRestaurantId) {
      setMessage("Ingresá un ID válido para el restaurante.");
      return;
    }

    if (!cleanName) {
      setMessage("Ingresá el nombre del restaurante.");
      return;
    }

    if (!cleanOwnerEmail) {
      setMessage("Ingresá el email del dueño.");
      return;
    }

    if (ownerPassword.length < 6) {
      setMessage("La contraseña temporal debe tener al menos 6 caracteres.");
      return;
    }

    try {
      setLoading(true);
      setMessage("");

      const batch = writeBatch(db);
      batch.set(doc(db, "restaurants", cleanRestaurantId), {
        id: cleanRestaurantId,
        name: cleanName,
        active: true,

        plan: "pro",
        subscriptionStatus: "trial",
        setupFeePaid: false,
        monthlyPrice: 100000,
        setupPrice: 400000,
        billingDay: 10,
        nextBillingDate: null,
        trialEndsAt: null,
        blockedAt: null,

        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // Crear subcollección pública con solo campos de branding.
      batch.set(
        doc(db, "restaurants", cleanRestaurantId, "public", "branding"),
        {
          name: cleanName,
          active: true,
          primaryColor: "#000000",
          secondaryColor: "#FFFFFF",
          logoUrl: "",
          coverUrl: "",
          welcomeMessage: "",
        }
      );
      writeAuditLog(batch, {
        restaurantId: cleanRestaurantId,
        action: "restaurante_creado",
        actorUid: user.uid,
        actorEmail: user.email,
        actorRole: "superadmin",
        entityType: "restaurant",
        entityId: cleanRestaurantId,
        description: `Superadmin creo restaurante ${cleanName}`,
        changes: {
          before: { exists: false },
          after: { name: cleanName, active: true, plan: "pro" },
        },
      });
      await batch.commit();
      
      await createStaffMember({
        restaurantId: cleanRestaurantId,
        email: cleanOwnerEmail,
        password: ownerPassword,
        role: "admin",
        actor: {
          actorUid: user.uid,
          actorEmail: user.email,
          actorRole: "superadmin",
        },
      });

      setRestaurantName("");
      setRestaurantId("");
      setOwnerEmail("");
      setOwnerPassword("");

      setMessage("Restaurante y dueño admin creados correctamente.");
    } catch (error) {
      console.error("Error creando restaurante:", error);
      setMessage(getFirebaseErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-100 p-6">
        <div className="rounded-xl border border-zinc-200 bg-white px-6 py-5 shadow-sm">
          Cargando super admin...
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-100 p-6">
        <form
          onSubmit={handleLogin}
          className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-sm"
        >
          <div className="mb-5 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-zinc-950 text-white">
              <ShieldCheck size={22} />
            </div>

            <h1 className="text-2xl font-bold text-zinc-950">Super Admin</h1>
            <p className="mt-1 text-sm text-zinc-500">
              Acceso interno para crear restaurantes.
            </p>
          </div>

          {message && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {message}
            </div>
          )}

          <div className="space-y-3">
            <input
              type="email"
              placeholder="Email super admin"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 w-full rounded-lg border border-zinc-200 px-4 outline-none focus:ring-2 focus:ring-black/10"
              required
            />

            <input
              type="password"
              placeholder="Contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12 w-full rounded-lg border border-zinc-200 px-4 outline-none focus:ring-2 focus:ring-black/10"
              required
            />

            <button
              type="submit"
              disabled={loading}
              className="h-12 w-full rounded-lg bg-zinc-950 font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {loading ? "Ingresando..." : "Ingresar"}
            </button>
          </div>
        </form>
      </div>
    );
  }

  if (!isSuperAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-100 p-6">
        <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-xl font-bold text-zinc-950">
            Sin permiso de super admin
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            Tu usuario no está habilitado para administrar la plataforma.
          </p>

          {user.email && (
            <p className="mt-3 rounded-lg bg-zinc-100 px-4 py-3 text-sm font-semibold text-zinc-700">
              {user.email}
            </p>
          )}

          <button
            onClick={handleLogout}
            className="mt-5 h-11 rounded-lg bg-zinc-950 px-5 font-semibold text-white"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-100">
      <div className="mx-auto max-w-[1400px] px-4 py-4 md:px-6 lg:px-8">
        <header className="mb-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-zinc-950 text-white">
                <ShieldCheck size={22} />
              </div>

              <div>
                <h1 className="text-3xl font-bold tracking-tight text-zinc-950">
                  Super Admin
                </h1>
                <p className="mt-1 text-sm text-zinc-500">
                  Crear restaurantes y primer dueño/admin.
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  Sesión: {user.email}
                </p>
              </div>
            </div>

            <button
              onClick={handleLogout}
              className="flex h-11 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 font-semibold text-zinc-900 transition hover:bg-zinc-50"
            >
              <LogOut size={16} />
              Cerrar sesión
            </button>
          </div>
        </header>

        {message && (
          <div className="mb-6 rounded-xl border border-zinc-200 bg-white px-5 py-4 text-sm font-semibold text-zinc-700 shadow-sm">
            {message}
          </div>
        )}
        <SuperAdminBillingPanel
          restaurants={restaurants}
          onMessage={setMessage}
        />

        <section className="mb-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-zinc-950 text-white">
              <Plus size={20} />
            </div>

            <div>
              <h2 className="text-xl font-bold text-zinc-950">
                Crear restaurante
              </h2>
              <p className="mt-1 text-sm text-zinc-500">
                Esto crea el restaurante y el primer usuario admin del dueño.
              </p>
            </div>
          </div>

          <form onSubmit={handleCreateRestaurant} className="grid gap-3">
            <div className="grid gap-3 md:grid-cols-2">
              <input
                placeholder="Nombre del restaurante"
                value={restaurantName}
                onChange={(e) => handleRestaurantNameChange(e.target.value)}
                className="h-11 rounded-lg border border-zinc-200 px-3 outline-none focus:ring-2 focus:ring-black/10"
                required
              />

              <input
                placeholder="restaurantId, ej: la-parrilla"
                value={restaurantId}
                onChange={(e) =>
                  setRestaurantId(normalizeRestaurantId(e.target.value))
                }
                className="h-11 rounded-lg border border-zinc-200 px-3 outline-none focus:ring-2 focus:ring-black/10"
                required
              />
            </div>

            <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <input
                type="email"
                placeholder="Email del dueño"
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                className="h-11 rounded-lg border border-zinc-200 px-3 outline-none focus:ring-2 focus:ring-black/10"
                required
              />

              <input
                type="password"
                placeholder="Contraseña temporal"
                value={ownerPassword}
                onChange={(e) => setOwnerPassword(e.target.value)}
                className="h-11 rounded-lg border border-zinc-200 px-3 outline-none focus:ring-2 focus:ring-black/10"
                required
                minLength={6}
              />

              <button
                type="submit"
                disabled={loading}
                className="flex h-11 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-5 font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
              >
                <Plus size={16} />
                {loading ? "Creando..." : "Crear"}
              </button>
            </div>
          </form>
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-zinc-950 text-white">
              <Building2 size={20} />
            </div>

            <div>
              <h2 className="text-xl font-bold text-zinc-950">
                Restaurantes creados
              </h2>
              <p className="mt-1 text-sm text-zinc-500">
                Links de acceso para cada cliente.
              </p>
            </div>
          </div>

          {restaurants.length === 0 ? (
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-500">
              Todavía no hay restaurantes creados.
            </div>
          ) : (
            <div className="space-y-3">
              {restaurants
                .sort((a, b) => a.id.localeCompare(b.id))
                .map((restaurant) => {
                  const staffUrl = `${window.location.origin}/staff/login?restaurantId=${restaurant.id}`;
                  const mesa1Url = `${window.location.origin}/menu?restaurantId=${restaurant.id}&table=1`;

                  return (
                    <div
                      key={restaurant.id}
                      className="rounded-lg border border-zinc-200 bg-zinc-50 p-4"
                    >
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <p className="text-lg font-bold text-zinc-950">
                            {restaurant.name || restaurant.id}
                          </p>
                          <p className="mt-1 text-sm text-zinc-500">
                            ID: {restaurant.id}
                          </p>
                          <p className="mt-1 text-xs font-semibold text-zinc-500">
                            Estado:{" "}
                            {restaurant.active === false ? "Inactivo" : "Activo"}
                          </p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <a
                            href={staffUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="flex h-10 items-center gap-2 rounded-lg bg-zinc-950 px-4 text-sm font-semibold text-white"
                          >
                            Staff
                            <ExternalLink size={14} />
                          </a>

                          <button
                            type="button"
                            onClick={() =>
                              copyToClipboard(staffUrl, "Link Staff")
                            }
                            className="flex h-10 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900"
                          >
                            <Copy size={14} />
                            Copiar Staff
                          </button>

                          <a
                            href={mesa1Url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex h-10 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900"
                          >
                            Mesa 1
                            <ExternalLink size={14} />
                          </a>

                          <button
                            type="button"
                            onClick={() =>
                              copyToClipboard(mesa1Url, "Link Mesa 1")
                            }
                            className="flex h-10 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900"
                          >
                            <Copy size={14} />
                            Copiar Mesa 1
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default SuperAdmin;
