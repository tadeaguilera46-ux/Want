import { FormEvent, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import {
  doc,
  serverTimestamp,
  Timestamp,
  writeBatch,
} from "firebase/firestore";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { auth, getDb } from "@/lib/firebase";

const db = getDb();

type RestaurantPlan = "starter" | "pro" | "premium";

const PLAN_OPTIONS: {
  id: RestaurantPlan;
  name: string;
  price: number;
  setup: number;
  description: string;
}[] = [
  {
    id: "starter",
    name: "Starter",
    price: 70000,
    setup: 250000,
    description: "Ideal para bares chicos o restaurantes simples.",
  },
  {
    id: "pro",
    name: "Pro",
    price: 100000,
    setup: 400000,
    description: "Recomendado para restaurantes con operación completa.",
  },
  {
    id: "premium",
    name: "Premium",
    price: 160000,
    setup: 600000,
    description: "Para locales con más volumen y soporte premium.",
  },
];

const normalizeRestaurantId = (value: string) => {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
};

const formatPriceARS = (value: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value || 0);

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
    case "permission-denied":
      return "No tenés permisos para completar el onboarding. Revisá las reglas de Firestore.";
    default:
      return "No se pudo crear el restaurante. Revisá los datos e intentá de nuevo.";
  }
};

const Onboarding = () => {
  const navigate = useNavigate();

  const [restaurantName, setRestaurantName] = useState("");
  const [restaurantId, setRestaurantId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [plan, setPlan] = useState<RestaurantPlan>("pro");
  const [tableCount, setTableCount] = useState("10");

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const selectedPlan = useMemo(() => {
    return PLAN_OPTIONS.find((item) => item.id === plan) || PLAN_OPTIONS[1];
  }, [plan]);

  const handleRestaurantNameChange = (value: string) => {
    setRestaurantName(value);

    if (!restaurantId.trim()) {
      setRestaurantId(normalizeRestaurantId(value));
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const cleanName = restaurantName.trim();
    const cleanRestaurantId = normalizeRestaurantId(restaurantId);
    const cleanEmail = email.trim().toLowerCase();
    const normalizedTableCount = Number(tableCount);

    if (!cleanName) {
      setMessage("Ingresá el nombre del restaurante.");
      return;
    }

    if (!cleanRestaurantId) {
      setMessage("Ingresá un ID válido para el restaurante.");
      return;
    }

    if (!cleanEmail) {
      setMessage("Ingresá tu email.");
      return;
    }

    if (password.length < 6) {
      setMessage("La contraseña debe tener al menos 6 caracteres.");
      return;
    }

    if (
      !Number.isInteger(normalizedTableCount) ||
      normalizedTableCount <= 0 ||
      normalizedTableCount > 100
    ) {
      setMessage("Ingresá una cantidad de mesas válida entre 1 y 100.");
      return;
    }

    try {
      setLoading(true);
      setMessage("");

      const credential = await createUserWithEmailAndPassword(
        auth,
        cleanEmail,
        password
      );

      await updateProfile(credential.user, {
        displayName: cleanName,
      });

      const trialEndsAt = new Date();
      trialEndsAt.setDate(trialEndsAt.getDate() + 7);
      trialEndsAt.setHours(12, 0, 0, 0);

      const batch = writeBatch(db);

      const restaurantRef = doc(db, "restaurants", cleanRestaurantId);
      const staffRef = doc(
        db,
        "restaurants",
        cleanRestaurantId,
        "staff",
        credential.user.uid
      );

      batch.set(restaurantRef, {
        id: cleanRestaurantId,
        name: cleanName,
        active: true,

        plan: selectedPlan.id,
        subscriptionStatus: "trial",
        trialEndsAt: Timestamp.fromDate(trialEndsAt),
        setupFeePaid: false,
        monthlyPrice: selectedPlan.price,
        setupPrice: selectedPlan.setup,
        billingDay: new Date().getDate(),
        nextBillingDate: null,
        blockedAt: null,

        primaryColor: "#000000",
        secondaryColor: "#FFFFFF",
        logoUrl: "",
        coverUrl: "",
        welcomeMessage: "Bienvenido. Elegí productos y agregalos a tu pedido.",

        onboardingCompleted: true,
        ownerUid: credential.user.uid,
        ownerEmail: cleanEmail,

        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      batch.set(staffRef, {
        uid: credential.user.uid,
        email: cleanEmail,
        role: "admin",
        active: true,
        restaurantId: cleanRestaurantId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      for (let index = 1; index <= normalizedTableCount; index += 1) {
        batch.set(
          doc(db, "restaurants", cleanRestaurantId, "mesas", String(index)),
          {
            restaurantId: cleanRestaurantId,
            numero: index,
            estado: "available",
            activeSessionId: null,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }
        );
      }

      await batch.commit();

      navigate(`/staff/admin?restaurantId=${cleanRestaurantId}`, {
        replace: true,
      });
    } catch (error) {
      console.error("Error onboarding:", error);
      setMessage(getFirebaseErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f6f4ef] px-4 py-6">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-6 rounded-[32px] border border-black/5 bg-white p-6 shadow-[0_18px_50px_-24px_rgba(0,0,0,0.22)]">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-3xl bg-zinc-950 text-white">
                <Sparkles size={24} />
              </div>

              <div>
                <p className="text-xs font-extrabold uppercase tracking-[0.28em] text-zinc-500">
                  WANT RESTAURANT SAAS
                </p>
                <h1 className="mt-2 text-3xl font-black tracking-tight text-zinc-950 md:text-4xl">
                  Creá tu restaurante digital
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-500">
                  Configurá tu cuenta, generá tu panel admin y empezá con 7 días
                  de prueba.
                </p>
              </div>
            </div>

            <div className="rounded-3xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
              Trial gratis 7 días
            </div>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <form
            onSubmit={handleSubmit}
            className="rounded-[32px] border border-black/5 bg-white p-6 shadow-[0_18px_50px_-24px_rgba(0,0,0,0.22)]"
          >
            <div className="mb-5 flex items-start gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-zinc-950 text-white">
                <Building2 size={20} />
              </div>

              <div>
                <h2 className="text-xl font-black text-zinc-950">
                  Datos del restaurante
                </h2>
                <p className="mt-1 text-sm text-zinc-500">
                  Estos datos crean tu espacio privado en WANT.
                </p>
              </div>
            </div>

            {message && (
              <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
                {message}
              </div>
            )}

            <div className="grid gap-4">
              <label className="grid gap-1 text-sm font-bold text-zinc-700">
                Nombre del restaurante
                <input
                  value={restaurantName}
                  onChange={(event) =>
                    handleRestaurantNameChange(event.target.value)
                  }
                  placeholder="Ej: La Parrilla"
                  disabled={loading}
                  className="h-12 rounded-2xl border border-zinc-200 px-4 text-sm font-medium outline-none transition focus:ring-2 focus:ring-black/10 disabled:opacity-60"
                  required
                />
              </label>

              <label className="grid gap-1 text-sm font-bold text-zinc-700">
                ID del restaurante
                <input
                  value={restaurantId}
                  onChange={(event) =>
                    setRestaurantId(normalizeRestaurantId(event.target.value))
                  }
                  placeholder="la-parrilla"
                  disabled={loading}
                  className="h-12 rounded-2xl border border-zinc-200 px-4 text-sm font-medium outline-none transition focus:ring-2 focus:ring-black/10 disabled:opacity-60"
                  required
                />
                <span className="text-xs font-medium text-zinc-400">
                  Se usará para tus links internos.
                </span>
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-1 text-sm font-bold text-zinc-700">
                  Email del administrador
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="dueño@restaurante.com"
                    disabled={loading}
                    className="h-12 rounded-2xl border border-zinc-200 px-4 text-sm font-medium outline-none transition focus:ring-2 focus:ring-black/10 disabled:opacity-60"
                    required
                  />
                </label>

                <label className="grid gap-1 text-sm font-bold text-zinc-700">
                  Contraseña
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    disabled={loading}
                    minLength={6}
                    className="h-12 rounded-2xl border border-zinc-200 px-4 text-sm font-medium outline-none transition focus:ring-2 focus:ring-black/10 disabled:opacity-60"
                    required
                  />
                </label>
              </div>

              <label className="grid gap-1 text-sm font-bold text-zinc-700">
                Cantidad inicial de mesas
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={tableCount}
                  onChange={(event) => setTableCount(event.target.value)}
                  disabled={loading}
                  className="h-12 rounded-2xl border border-zinc-200 px-4 text-sm font-medium outline-none transition focus:ring-2 focus:ring-black/10 disabled:opacity-60"
                  required
                />
              </label>
            </div>

            <div className="mt-6">
              <h3 className="mb-3 text-sm font-black text-zinc-950">
                Elegí un plan
              </h3>

              <div className="grid gap-3">
                {PLAN_OPTIONS.map((option) => {
                  const selected = option.id === plan;

                  return (
                    <button
                      key={option.id}
                      type="button"
                      disabled={loading}
                      onClick={() => setPlan(option.id)}
                      className={`rounded-3xl border p-4 text-left transition ${
                        selected
                          ? "border-zinc-950 bg-zinc-950 text-white"
                          : "border-zinc-200 bg-white text-zinc-950 hover:bg-zinc-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-lg font-black">{option.name}</p>
                          <p
                            className={`mt-1 text-sm ${
                              selected ? "text-white/70" : "text-zinc-500"
                            }`}
                          >
                            {option.description}
                          </p>
                        </div>

                        {selected && (
                          <CheckCircle2 className="shrink-0" size={20} />
                        )}
                      </div>

                      <div className="mt-4 grid gap-2 sm:grid-cols-2">
                        <div
                          className={`rounded-2xl px-3 py-2 ${
                            selected ? "bg-white/10" : "bg-zinc-50"
                          }`}
                        >
                          <p
                            className={`text-xs font-bold ${
                              selected ? "text-white/60" : "text-zinc-400"
                            }`}
                          >
                            Mensualidad
                          </p>
                          <p className="text-sm font-black">
                            {formatPriceARS(option.price)}
                          </p>
                        </div>

                        <div
                          className={`rounded-2xl px-3 py-2 ${
                            selected ? "bg-white/10" : "bg-zinc-50"
                          }`}
                        >
                          <p
                            className={`text-xs font-bold ${
                              selected ? "text-white/60" : "text-zinc-400"
                            }`}
                          >
                            Setup
                          </p>
                          <p className="text-sm font-black">
                            {formatPriceARS(option.setup)}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-zinc-950 text-base font-black text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {loading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Creando restaurante...
                </>
              ) : (
                <>
                  Crear mi restaurante
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>

          <aside className="rounded-[32px] border border-black/5 bg-zinc-950 p-6 text-white shadow-[0_18px_50px_-24px_rgba(0,0,0,0.35)]">
            <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-white/10">
              <ShieldCheck size={24} />
            </div>

            <h2 className="mt-5 text-2xl font-black tracking-tight">
              Qué se crea automáticamente
            </h2>

            <div className="mt-5 space-y-3">
              {[
                "Restaurante multi-tenant",
                "Usuario admin del dueño",
                "Mesas iniciales",
                "Trial gratis de 7 días",
                "Billing en Super Admin",
                "Panel listo para cargar menú y branding",
              ].map((item) => (
                <div key={item} className="flex items-center gap-3">
                  <CheckCircle2 size={18} className="text-emerald-400" />
                  <span className="text-sm font-semibold text-white/80">
                    {item}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-3xl bg-white/10 p-4">
              <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-white/50">
                Plan seleccionado
              </p>
              <p className="mt-2 text-2xl font-black">{selectedPlan.name}</p>
              <p className="mt-1 text-sm text-white/60">
                {formatPriceARS(selectedPlan.price)} / mes
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default Onboarding;