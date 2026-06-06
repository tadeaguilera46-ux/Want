import { useEffect, useState } from "react";
import {
  BarChart3,
  Boxes,
  CheckCircle2,
  CreditCard,
  DoorOpen,
  Loader2,
  MessageCircleWarning,
  Sparkles,
  Users,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getApp } from "firebase/app";
import { toast } from "sonner";

import { getDb } from "@/lib/firebase";
import type { RestaurantPlan } from "@/lib/plan";
import { getPlanLimits } from "@/lib/plan";

const db = getDb();

const WHATSAPP_NUMBER = "543546403338";

const ACTIVATION_PLANS: {
  id: RestaurantPlan;
  name: string;
  monthly: number;
  setup: number;
  recommended?: boolean;
}[] = [
  { id: "starter", name: "Starter", monthly: 70000, setup: 250000 },
  { id: "pro",     name: "Pro",     monthly: 90000, setup: 350000, recommended: true },
  { id: "premium", name: "Premium", monthly: 115000, setup: 425000 },
];

const formatARS = (value: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value);

type RestaurantData = {
  subscriptionStatus?: "trial" | "active" | "past_due" | "blocked";
  nextBillingDate?: { toDate?: () => Date };
  trialEndsAt?: { toDate?: () => Date };
};

const canAccess = (data: RestaurantData) => {
  const status = data.subscriptionStatus || "trial";
  const now = new Date();

  if (status === "blocked") return false;

  if (status === "trial") {
    const trialEndsAt = data.trialEndsAt?.toDate?.();
    if (trialEndsAt && trialEndsAt < now) return false;
    return true;
  }

  if (status === "active") {
    const nextBillingDate = data.nextBillingDate?.toDate?.();
    if (nextBillingDate && nextBillingDate < now) return false;
    return true;
  }

  if (status === "past_due") return true;

  return false;
};

const isTrialExpired = (data: RestaurantData) => {
  const status = data.subscriptionStatus || "trial";
  if (status !== "trial") return false;
  const trialEndsAt = data.trialEndsAt?.toDate?.();
  return !!trialEndsAt && trialEndsAt < new Date();
};

// ─── Pantalla de activación (trial expirado) ─────────────────────────────────

const ActivationScreen = ({ restaurantId }: { restaurantId: string }) => {
  const [selectedPlan, setSelectedPlan] = useState<RestaurantPlan>("pro");
  const [subscribing, setSubscribing] = useState(false);

  const plan = ACTIVATION_PLANS.find((p) => p.id === selectedPlan)!

  const handleActivate = async () => {
    const auth = getAuth();
    const user = auth.currentUser;

    if (!user) {
      toast.error("Tu sesión expiró. Volvé a iniciar sesión.");
      return;
    }

    try {
      setSubscribing(true);
      const fns = getFunctions(getApp(), "us-central1");
      const createSubscription = httpsCallable<
        { restaurantId: string; plan: RestaurantPlan; payerEmail: string },
        { subscriptionId: string | null; initPoint: string }
      >(fns, "createSubscription");

      const { data } = await createSubscription({
        restaurantId,
        plan: selectedPlan,
        payerEmail: user.email ?? "",
      });

      if (data.initPoint) {
        window.location.href = data.initPoint;
      }
    } catch (error) {
      console.error("Error activando plan:", error);
      toast.error("No se pudo iniciar el pago. Intentá nuevamente.");
      setSubscribing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f6f4ef] px-4 py-8">
      <div className="mx-auto w-full max-w-4xl">

        {/* Header */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-zinc-950 text-white">
            <Sparkles size={28} />
          </div>
          <p className="text-xs font-extrabold uppercase tracking-[0.28em] text-zinc-500">
            WANT RESTAURANT SAAS
          </p>
          <h1 className="mt-3 text-3xl font-black tracking-tight text-zinc-950 md:text-4xl">
            Tu prueba gratuita terminó
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-zinc-500">
            Elegí tu plan para activar WANT. La suscripción mensual se configura
            ahora vía Mercado Pago — el setup inicial lo coordinamos con vos por separado.
          </p>
        </div>

        {/* Aviso dos pasos */}
        <div className="mb-6 rounded-2xl border border-zinc-200 bg-zinc-50 px-5 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:gap-6">
            <div className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-950 text-xs font-black text-white">1</span>
              <div>
                <p className="text-sm font-black text-zinc-950">Setup inicial</p>
                <p className="text-xs text-zinc-500">Instalación, video de capacitación y carga de datos — lo coordinamos con vos.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-950 text-xs font-black text-white">2</span>
              <div>
                <p className="text-sm font-black text-zinc-950">Suscripción mensual</p>
                <p className="text-xs text-zinc-500">Débito automático mensual por Mercado Pago — lo configurás ahora.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Planes */}
        <div className="grid gap-4 md:grid-cols-3">
          {ACTIVATION_PLANS.map((option) => {
            const isSelected = option.id === selectedPlan;
            const optionLimits = getPlanLimits(option.id);
            const total = option.setup + option.monthly;

            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setSelectedPlan(option.id)}
                className={`relative rounded-3xl border p-5 text-left transition ${
                  isSelected
                    ? "border-zinc-950 bg-zinc-950 text-white shadow-[0_18px_50px_-18px_rgba(0,0,0,0.4)]"
                    : "border-zinc-200 bg-white text-zinc-950 hover:bg-zinc-50"
                }`}
              >
                {option.recommended && (
                  <span
                    className={`absolute right-4 top-4 rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide ${
                      isSelected
                        ? "bg-white/15 text-white"
                        : "bg-emerald-100 text-emerald-700"
                    }`}
                  >
                    Popular
                  </span>
                )}

                {isSelected && (
                  <CheckCircle2
                    size={18}
                    className="absolute left-4 top-4 text-emerald-400"
                  />
                )}

                <p
                  className={`text-lg font-black ${isSelected ? "mt-0 pl-7" : ""}`}
                >
                  {option.name}
                </p>

                {/* Suscripción mensual — lo que cobra MP */}
                <div
                  className={`mt-4 rounded-2xl p-3 ${
                    isSelected ? "bg-white/10" : "bg-zinc-50"
                  }`}
                >
                  <p
                    className={`text-xs font-extrabold uppercase tracking-wide ${
                      isSelected ? "text-white/60" : "text-zinc-400"
                    }`}
                  >
                    Suscripción mensual
                  </p>
                  <p className="mt-1 text-2xl font-black">
                    {formatARS(option.monthly)}
                    <span className={`ml-1 text-xs font-semibold ${isSelected ? "text-white/50" : "text-zinc-400"}`}>/ mes</span>
                  </p>
                  <p className={`mt-1 text-xs ${isSelected ? "text-white/40" : "text-zinc-400"}`}>
                    Débito automático por Mercado Pago
                  </p>
                </div>

                {/* Setup — coordinado por separado */}
                <div
                  className={`mt-2 rounded-2xl p-3 ${
                    isSelected ? "bg-white/10" : "bg-zinc-50"
                  }`}
                >
                  <p
                    className={`text-xs font-extrabold uppercase tracking-wide ${
                      isSelected ? "text-white/60" : "text-zinc-400"
                    }`}
                  >
                    Setup inicial
                  </p>
                  <p className="mt-1 text-base font-black">
                    {formatARS(option.setup)}
                  </p>
                  <p className={`mt-1 text-xs ${isSelected ? "text-white/40" : "text-zinc-400"}`}>
                    Coordinado con el equipo de WANT
                  </p>
                </div>

                {/* Features */}
                <div className="mt-3 space-y-2">
                  <div
                    className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold ${
                      isSelected ? "bg-white/10" : "bg-zinc-50"
                    }`}
                  >
                    <DoorOpen size={13} />
                    {optionLimits.maxTables === null
                      ? "Mesas ilimitadas"
                      : `Hasta ${optionLimits.maxTables} mesas`}
                  </div>
                  <div
                    className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold ${
                      isSelected ? "bg-white/10" : "bg-zinc-50"
                    }`}
                  >
                    <Users size={13} />
                    {optionLimits.maxStaff === null
                      ? "Empleados ilimitados"
                      : `Hasta ${optionLimits.maxStaff} empleados`}
                  </div>
                  <div
                    className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold ${
                      optionLimits.analytics
                        ? isSelected
                          ? "bg-emerald-500/20 text-emerald-200"
                          : "bg-emerald-50 text-emerald-700"
                        : isSelected
                          ? "bg-white/10 text-white/40"
                          : "bg-zinc-50 text-zinc-400"
                    }`}
                  >
                    <BarChart3 size={13} />
                    Analytics {optionLimits.analytics ? "incluido" : "no incluido"}
                  </div>
                  <div
                    className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold ${
                      optionLimits.stock
                        ? isSelected
                          ? "bg-emerald-500/20 text-emerald-200"
                          : "bg-emerald-50 text-emerald-700"
                        : isSelected
                          ? "bg-white/10 text-white/40"
                          : "bg-zinc-50 text-zinc-400"
                    }`}
                  >
                    <Boxes size={13} />
                    Stock {optionLimits.stock ? "incluido" : "no incluido"}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* CTA */}
        <div className="mt-6 rounded-3xl border border-black/5 bg-white p-5 shadow-[0_18px_50px_-24px_rgba(0,0,0,0.15)]">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
            <div>
              <p className="text-sm font-bold text-zinc-950">
                Plan {plan.name} — suscripción mensual
              </p>
              <p className="mt-0.5 text-xl font-black text-zinc-950">
                {formatARS(plan.monthly)}<span className="text-sm font-medium text-zinc-400"> / mes</span>
              </p>
              <p className="text-xs text-zinc-400">
                Setup inicial {formatARS(plan.setup)} — lo coordinamos con vos por separado.
              </p>
            </div>

            <button
              type="button"
              onClick={() => void handleActivate()}
              disabled={subscribing}
              className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-zinc-950 px-8 text-base font-black text-white transition hover:opacity-90 disabled:opacity-50 sm:w-auto"
            >
              {subscribing ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Redirigiendo a MP...
                </>
              ) : (
                <>
                  <CreditCard size={18} />
                  Configurar suscripción mensual
                </>
              )}
            </button>
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-zinc-400">
          El pago se procesa de forma segura a través de Mercado Pago.
        </p>
      </div>
    </div>
  );
};

// ─── Pantalla de bloqueado ────────────────────────────────────────────────────

const BlockedScreen = ({ restaurantId }: { restaurantId: string }) => {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f6f4ef] px-4">
      <div className="w-full max-w-md rounded-[32px] border border-black/5 bg-white p-8 shadow-[0_18px_50px_-18px_rgba(0,0,0,0.22)]">
        <div className="flex justify-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[#6B4423]/10">
            <CreditCard size={38} className="text-[#6B4423]" />
          </div>
        </div>

        <div className="mt-6 text-center">
          <p className="text-xs font-extrabold uppercase tracking-[0.28em] text-zinc-500">
            WANT RESTAURANT SAAS
          </p>
          <h1 className="mt-3 text-3xl font-black tracking-tight text-zinc-950">
            Suscripción vencida
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-zinc-600">
            Tu restaurante fue suspendido porque la suscripción mensual está
            vencida o el período de prueba finalizó.
          </p>
        </div>

        <div className="mt-7 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <MessageCircleWarning size={20} className="mt-0.5 text-amber-600" />
            <div>
              <p className="text-sm font-bold text-amber-900">
                Acceso temporalmente restringido
              </p>
              <p className="mt-1 text-xs leading-relaxed text-amber-800">
                Contactate con soporte de WANT para reactivar tu cuenta.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-7 space-y-3">
          <a
            href={`https://wa.me/${WHATSAPP_NUMBER}?text=Hola,%20quiero%20reactivar%20mi%20suscripci%C3%B3n%20de%20WANT.%20Restaurante:%20${encodeURIComponent(restaurantId)}`}
            target="_blank"
            rel="noreferrer"
            className="flex h-14 w-full items-center justify-center rounded-2xl bg-[#6B4423] text-sm font-extrabold text-white transition-all hover:scale-[1.01] active:scale-[0.99]"
          >
            Contactar soporte
          </a>

          <button
            type="button"
            onClick={() => navigate(`/staff/admin?restaurantId=${restaurantId}`, { replace: true })}
            className="h-12 w-full rounded-2xl border border-black/10 bg-white text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
          >
            Reintentar acceso
          </button>
        </div>

        <p className="mt-6 text-center text-xs text-zinc-400">
          WANT © Plataforma SaaS para restaurantes
        </p>
      </div>
    </div>
  );
};

// ─── Página principal ─────────────────────────────────────────────────────────

const PaymentRequired = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const restaurantId = searchParams.get("restaurantId") || "mi-restaurante";

  const [restaurantData, setRestaurantData] = useState<RestaurantData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!restaurantId) return;

    const restaurantRef = doc(db, "restaurants", restaurantId);

    const checkAndRedirect = (data: RestaurantData) => {
      if (canAccess(data)) {
        navigate(`/staff/admin?restaurantId=${restaurantId}`, { replace: true });
      }
    };

    getDoc(restaurantRef)
      .then((snap) => {
        if (snap.exists()) {
          const data = snap.data() as RestaurantData;
          setRestaurantData(data);
          checkAndRedirect(data);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));

    const unsubscribe = onSnapshot(
      restaurantRef,
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data() as RestaurantData;
        setRestaurantData(data);
        checkAndRedirect(data);
      },
      (error) => {
        console.error("Payment required listener error:", error);
        setLoading(false);
      }
    );

    const interval = window.setInterval(() => {
      getDoc(restaurantRef).then((snap) => {
        if (!snap.exists()) return;
        const data = snap.data() as RestaurantData;
        checkAndRedirect(data);
      });
    }, 5000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        getDoc(restaurantRef).then((snap) => {
          if (!snap.exists()) return;
          checkAndRedirect(snap.data() as RestaurantData);
        });
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      unsubscribe();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [navigate, restaurantId]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f6f4ef]">
        <Loader2 size={32} className="animate-spin text-zinc-400" />
      </div>
    );
  }

  if (restaurantData && isTrialExpired(restaurantData)) {
    return <ActivationScreen restaurantId={restaurantId} />;
  }

  return <BlockedScreen restaurantId={restaurantId} />;
};

export default PaymentRequired;
