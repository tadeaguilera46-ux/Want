import { FormEvent, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import {
  doc,
  getDoc,
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
  BarChart3,
  Boxes,
  Users,
  DoorOpen,
} from "lucide-react";

import { auth, getDb } from "@/lib/firebase";
import {
  canCreateTable,
  getPlanLimits,
  getStaffLimitLabel,
  getTableLimitLabel,
  type RestaurantPlan,
} from "@/lib/plan";

const db = getDb();

const PLAN_OPTIONS: {
  id: RestaurantPlan;
  name: string;
  price: number;
  setup: number;
  description: string;
  recommended?: boolean;
}[] = [
  {
    id: "starter",
    name: "Starter",
    price: 70000,
    setup: 250000,
    description: "Ideal para bares chicos, cafés o restaurantes simples.",
  },
  {
    id: "pro",
    name: "Pro",
    price: 90000,
    setup: 350000,
    description: "Recomendado para restaurantes con más operación y métricas.",
    recommended: true,
  },
  {
    id: "premium",
    name: "Premium",
    price: 115000,
    setup: 425000,
    description: "Para locales grandes con stock, analytics y operación avanzada.",
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

  const selectedPlanLimits = useMemo(() => getPlanLimits(plan), [plan]);

  const selectedTableLimitLabel = getTableLimitLabel(plan);
  const selectedStaffLimitLabel = getStaffLimitLabel(plan);

  const normalizedTableCount = Number(tableCount);
  const tableLimitReached =
    Number.isInteger(normalizedTableCount) &&
    normalizedTableCount > 0 &&
    !canCreateTable(plan, normalizedTableCount - 1);

  const handleRestaurantNameChange = (value: string) => {
    setRestaurantName(value);

    if (!restaurantId.trim()) {
      setRestaurantId(normalizeRestaurantId(value));
    }
  };

  const handlePlanChange = (nextPlan: RestaurantPlan) => {
    setPlan(nextPlan);

    const nextLimits = getPlanLimits(nextPlan);
    const currentTables = Number(tableCount);

    if (
      nextLimits.maxTables !== null &&
      Number.isInteger(currentTables) &&
      currentTables > nextLimits.maxTables
    ) {
      setTableCount(String(nextLimits.maxTables));
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const cleanName = restaurantName.trim();
    const cleanRestaurantId = normalizeRestaurantId(restaurantId);
    const cleanEmail = email.trim().toLowerCase();
    const tablesToCreate = Number(tableCount);

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
      !Number.isInteger(tablesToCreate) ||
      tablesToCreate <= 0 ||
      tablesToCreate > 500
    ) {
      setMessage("Ingresá una cantidad de mesas válida.");
      return;
    }

    if (!canCreateTable(plan, tablesToCreate - 1)) {
      setMessage(
        `El plan ${selectedPlan.name} permite hasta ${selectedTableLimitLabel} mesas. Elegí menos mesas o seleccioná un plan superior.`
      );
      return;
    }

    try {
      setLoading(true);
      setMessage("");

      const existingSnap = await getDoc(doc(db, "restaurants", cleanRestaurantId));
      if (existingSnap.exists()) {
        setMessage("Ese ID de restaurante ya está en uso. Elegí otro nombre o cambiá el ID manualmente.");
        return;
      }

      const credential = await createUserWithEmailAndPassword(
        auth,
        cleanEmail,
        password
      );

      await updateProfile(credential.user, {
        displayName: cleanName,
      });

      const trialEndsAt = new Date();
      trialEndsAt.setDate(trialEndsAt.getDate() + 30);
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
          welcomeMessage: "Bienvenido. Elegí productos y agregalos a tu pedido.",
        }
      );

      batch.set(staffRef, {
        uid: credential.user.uid,
        email: cleanEmail,
        role: "admin",
        active: true,
        restaurantId: cleanRestaurantId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      for (let index = 1; index <= tablesToCreate; index += 1) {
        batch.set(
          doc(db, "restaurants", cleanRestaurantId, "mesas", String(index)),
          {
            restaurantId: cleanRestaurantId,
            numero: index,
            estado: "available",
            active: true,
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
    <div className="min-h-screen bg-background px-4 py-6">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-6 rounded-xl border border-border bg-card p-6 shadow-[0_18px_50px_-24px_rgba(0,0,0,0.22)]">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-zinc-950 text-white">
                <Sparkles size={24} />
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">
                  WANT RESTAURANT SAAS
                </p>
                <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground md:text-4xl">
                  Creá tu restaurante digital
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                  Configurá tu cuenta, generá tu panel admin y empezá con 30 días
                  de prueba.
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-emerald-800/50 bg-emerald-950/30 px-4 py-3 text-sm font-bold text-emerald-400">
              Trial gratis 30 días
            </div>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <form
            onSubmit={handleSubmit}
            className="rounded-xl border border-border bg-card p-6 shadow-[0_18px_50px_-24px_rgba(0,0,0,0.22)]"
          >
            <div className="mb-5 flex items-start gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-zinc-950 text-white">
                <Building2 size={20} />
              </div>

              <div>
                <h2 className="text-xl font-bold text-foreground">
                  Datos del restaurante
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Estos datos crean tu espacio privado en WANT.
                </p>
              </div>
            </div>

            {message && (
              <div className="mb-5 rounded-lg border border-red-800/50 bg-red-950/30 px-4 py-3 text-sm font-bold text-red-400">
                {message}
              </div>
            )}

            <div className="grid gap-4">
              <label className="grid gap-1 text-sm font-bold text-foreground">
                Nombre del restaurante
                <input
                  value={restaurantName}
                  onChange={(event) =>
                    handleRestaurantNameChange(event.target.value)
                  }
                  placeholder="Ej: La Parrilla"
                  disabled={loading}
                  className="h-12 w-full rounded-md border border-border bg-secondary px-4 text-sm text-foreground placeholder:text-muted-foreground outline-none transition focus:ring-2 focus:ring-ring/40 disabled:opacity-60"
                  required
                />
              </label>

              <label className="grid gap-1 text-sm font-bold text-foreground">
                ID del restaurante
                <input
                  value={restaurantId}
                  onChange={(event) =>
                    setRestaurantId(normalizeRestaurantId(event.target.value))
                  }
                  placeholder="la-parrilla"
                  disabled={loading}
                  className="h-12 w-full rounded-md border border-border bg-secondary px-4 text-sm text-foreground placeholder:text-muted-foreground outline-none transition focus:ring-2 focus:ring-ring/40 disabled:opacity-60"
                  required
                />
                <span className="text-xs font-medium text-muted-foreground">
                  Se usará para tus links internos.
                </span>
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-1 text-sm font-bold text-foreground">
                  Email del administrador
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="dueño@restaurante.com"
                    disabled={loading}
                    className="h-12 w-full rounded-md border border-border bg-secondary px-4 text-sm text-foreground placeholder:text-muted-foreground outline-none transition focus:ring-2 focus:ring-ring/40 disabled:opacity-60"
                    required
                  />
                </label>

                <label className="grid gap-1 text-sm font-bold text-foreground">
                  Contraseña
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    disabled={loading}
                    minLength={6}
                    className="h-12 w-full rounded-md border border-border bg-secondary px-4 text-sm text-foreground placeholder:text-muted-foreground outline-none transition focus:ring-2 focus:ring-ring/40 disabled:opacity-60"
                    required
                  />
                </label>
              </div>

              <label className="grid gap-1 text-sm font-bold text-foreground">
                Cantidad inicial de mesas
                <input
                  type="number"
                  min={1}
                  max={selectedPlanLimits.maxTables || 500}
                  value={tableCount}
                  onChange={(event) => setTableCount(event.target.value)}
                  disabled={loading}
                  className={`h-12 w-full rounded-md border px-4 text-sm text-foreground bg-secondary placeholder:text-muted-foreground outline-none transition focus:ring-2 focus:ring-ring/40 disabled:opacity-60 ${
                    tableLimitReached
                      ? "border-red-800/50 bg-red-950/30"
                      : "border-border"
                  }`}
                  required
                />

                <span
                  className={`text-xs font-semibold ${
                    tableLimitReached ? "text-red-400" : "text-muted-foreground"
                  }`}
                >
                  Límite del plan {selectedPlan.name}:{" "}
                  {selectedTableLimitLabel} mesas.
                </span>
              </label>
            </div>

            <div className="mt-6">
              <h3 className="mb-3 text-sm font-bold text-foreground">
                Elegí un plan
              </h3>

              <div className="grid gap-3">
                {PLAN_OPTIONS.map((option) => {
                  const selected = option.id === plan;
                  const limits = getPlanLimits(option.id);

                  return (
                    <button
                      key={option.id}
                      type="button"
                      disabled={loading}
                      onClick={() => handlePlanChange(option.id)}
                      className={`rounded-xl border p-4 text-left transition ${
                        selected
                          ? "border-zinc-950 bg-zinc-950 text-white"
                          : "border-border bg-card text-foreground hover:bg-secondary"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-lg font-bold">{option.name}</p>

                            {option.recommended && (
                              <span
                                className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                                  selected
                                    ? "bg-white/15 text-white"
                                    : "bg-emerald-100 text-emerald-400"
                                }`}
                              >
                                Recomendado
                              </span>
                            )}
                          </div>

                          <p
                            className={`mt-1 text-sm ${
                              selected ? "text-white/70" : "text-muted-foreground"
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
                          className={`rounded-lg px-3 py-2 ${
                            selected ? "bg-white/10" : "bg-secondary"
                          }`}
                        >
                          <p
                            className={`text-xs font-bold ${
                              selected ? "text-white/60" : "text-muted-foreground"
                            }`}
                          >
                            Mensualidad
                          </p>
                          <p className="text-sm font-bold">
                            {formatPriceARS(option.price)}
                          </p>
                        </div>

                        <div
                          className={`rounded-lg px-3 py-2 ${
                            selected ? "bg-white/10" : "bg-secondary"
                          }`}
                        >
                          <p
                            className={`text-xs font-bold ${
                              selected ? "text-white/60" : "text-muted-foreground"
                            }`}
                          >
                            Setup
                          </p>
                          <p className="text-sm font-bold">
                            {formatPriceARS(option.setup)}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-2">
                        <div
                          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold ${
                            selected ? "bg-white/10" : "bg-secondary"
                          }`}
                        >
                          <DoorOpen size={14} />
                          Mesas:{" "}
                          {limits.maxTables === null
                            ? "Ilimitadas"
                            : `hasta ${limits.maxTables}`}
                        </div>

                        <div
                          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold ${
                            selected ? "bg-white/10" : "bg-secondary"
                          }`}
                        >
                          <Users size={14} />
                          Empleados:{" "}
                          {limits.maxStaff === null
                            ? "Ilimitados"
                            : `hasta ${limits.maxStaff}`}
                        </div>

                        <div
                          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold ${
                            limits.analytics
                              ? selected
                                ? "bg-emerald-500/20 text-emerald-100"
                                : "bg-emerald-950/30 text-emerald-400"
                              : selected
                                ? "bg-white/10 text-white/50"
                                : "bg-secondary text-muted-foreground"
                          }`}
                        >
                          <BarChart3 size={14} />
                          Analytics {limits.analytics ? "incluido" : "no incluido"}
                        </div>

                        <div
                          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold ${
                            limits.stock
                              ? selected
                                ? "bg-emerald-500/20 text-emerald-100"
                                : "bg-emerald-950/30 text-emerald-400"
                              : selected
                                ? "bg-white/10 text-white/50"
                                : "bg-secondary text-muted-foreground"
                          }`}
                        >
                          <Boxes size={14} />
                          Stock {limits.stock ? "incluido" : "no incluido"}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || tableLimitReached}
              className="mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-lg bg-zinc-950 text-base font-bold text-white transition hover:opacity-90 disabled:opacity-40"
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

          <aside className="rounded-xl border border-border bg-zinc-950 p-6 text-white shadow-[0_18px_50px_-24px_rgba(0,0,0,0.35)]">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-white/10">
              <ShieldCheck size={24} />
            </div>

            <h2 className="mt-5 text-2xl font-bold tracking-tight">
              Qué se crea automáticamente
            </h2>

            <div className="mt-5 space-y-3">
              {[
                "Restaurante multi-tenant",
                "Usuario admin del dueño",
                "Mesas iniciales según el plan",
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

            <div className="mt-6 rounded-xl bg-white/10 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/50">
                Plan seleccionado
              </p>
              <p className="mt-2 text-2xl font-bold">{selectedPlan.name}</p>
              <p className="mt-1 text-sm text-white/60">
                {formatPriceARS(selectedPlan.price)} / mes
              </p>

              <div className="mt-4 grid gap-2 text-sm text-white/75">
                <p>Mesas: {selectedTableLimitLabel}</p>
                <p>Empleados: {selectedStaffLimitLabel}</p>
                <p>
                  Analytics:{" "}
                  {selectedPlanLimits.analytics ? "Incluido" : "No incluido"}
                </p>
                <p>
                  Stock: {selectedPlanLimits.stock ? "Incluido" : "No incluido"}
                </p>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default Onboarding;