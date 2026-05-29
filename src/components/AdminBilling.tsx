import { useState } from "react";
import {
  AlertTriangle,
  Ban,
  Calendar,
  Check,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Loader2,
  X,
} from "lucide-react";
import { useRestaurant } from "../lib/restaurant-context";
import { useBilling, type PaymentRecord } from "../hooks/useBilling";
import { PLAN_LABELS, type RestaurantPlan } from "../lib/plan";

const formatPriceARS = (value: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value);

const formatTimestamp = (
  ts: { toDate?: () => Date } | null | undefined,
  style: "long" | "short" = "short"
): string | null => {
  const date = ts?.toDate?.();
  if (!date) return null;
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: style === "long" ? "long" : "2-digit",
    year: "numeric",
  }).format(date);
};

type PlanConfig = {
  key: RestaurantPlan;
  label: string;
  price: number;
  features: string[];
  lockedFeatures: string[];
  popular?: boolean;
};

const PLANS: PlanConfig[] = [
  {
    key: "starter",
    label: "Starter",
    price: 70000,
    features: ["Hasta 15 mesas", "Hasta 7 empleados", "Branding personalizado"],
    lockedFeatures: [
      "Analytics",
      "Auditoría",
      "Facturación",
      "Gestión avanzada de staff",
      "Stock avanzado",
    ],
  },
  {
    key: "pro",
    label: "Pro",
    price: 90000,
    popular: true,
    features: [
      "Hasta 20 mesas",
      "Hasta 10 empleados",
      "Branding personalizado",
      "Analytics",
      "Auditoría",
      "Facturación",
      "Gestión avanzada de staff",
    ],
    lockedFeatures: ["Stock avanzado"],
  },
  {
    key: "premium",
    label: "Premium",
    price: 115000,
    features: [
      "Mesas ilimitadas",
      "Empleados ilimitados",
      "Branding personalizado",
      "Analytics",
      "Auditoría",
      "Facturación",
      "Gestión avanzada de staff",
      "Stock avanzado",
    ],
    lockedFeatures: [],
  },
];

const PLAN_ORDER: Record<RestaurantPlan, number> = {
  starter: 0,
  pro: 1,
  premium: 2,
};

const STATUS_LABELS: Record<string, string> = {
  trial: "Trial",
  active: "Activo",
  past_due: "Vencido",
  blocked: "Bloqueado",
};

const STATUS_STYLES: Record<string, string> = {
  trial: "border-blue-200 bg-blue-100 text-blue-800",
  active: "border-emerald-200 bg-emerald-100 text-emerald-800",
  past_due: "border-amber-200 bg-amber-100 text-amber-800",
  blocked: "border-red-200 bg-red-100 text-red-800",
};

export function AdminBilling({ restaurantId }: { restaurantId: string }) {
  const { restaurant } = useRestaurant();
  const {
    payments,
    paymentsLoading,
    subscribing,
    cancelling,
    subscribeToPlan,
    cancelCurrentSubscription,
  } = useBilling(restaurantId);

  const [showAllPayments, setShowAllPayments] = useState(false);

  const currentPlan = restaurant?.plan ?? "starter";
  const subscriptionStatus = restaurant?.subscriptionStatus ?? "trial";
  const nextBillingDate = restaurant?.nextBillingDate;
  const trialEndsAt = restaurant?.trialEndsAt;
  const monthlyPrice = restaurant?.monthlyPrice;
  const mpSubscriptionId = restaurant?.mpSubscriptionId;

  const isBlocked = subscriptionStatus === "blocked";
  const isPastDue = subscriptionStatus === "past_due";
  const isTrial = subscriptionStatus === "trial";

  const handleSubscribe = async (plan: RestaurantPlan) => {
    if (plan === currentPlan && subscriptionStatus === "active") return;

    const config = PLANS.find((p) => p.key === plan);
    const isUpgrade = PLAN_ORDER[plan] > PLAN_ORDER[currentPlan];
    const isDowngrade = PLAN_ORDER[plan] < PLAN_ORDER[currentPlan];

    let message = `¿Querés suscribirte al plan ${PLAN_LABELS[plan]} por ${formatPriceARS(config?.price ?? 0)}/mes?`;
    if (isUpgrade)
      message = `¿Querés hacer upgrade al plan ${PLAN_LABELS[plan]} por ${formatPriceARS(config?.price ?? 0)}/mes?`;
    if (isDowngrade)
      message = `¿Querés cambiar al plan ${PLAN_LABELS[plan]}? Algunas funcionalidades quedarán deshabilitadas.`;

    if (!window.confirm(message)) return;

    await subscribeToPlan(plan);
  };

  const handleCancel = async () => {
    if (
      !window.confirm(
        "¿Estás seguro de que querés cancelar tu suscripción? Tu plan continuará activo hasta el próximo vencimiento."
      )
    )
      return;

    await cancelCurrentSubscription();
  };

  const visiblePayments = showAllPayments ? payments : payments.slice(0, 4);

  return (
    <div className="space-y-6">
      {isBlocked && (
        <div className="flex items-start gap-4 rounded-3xl border border-red-200 bg-red-50 p-5">
          <Ban size={22} className="mt-0.5 shrink-0 text-red-600" />
          <div>
            <p className="font-black text-red-900">Cuenta bloqueada</p>
            <p className="mt-1 text-sm text-red-700">
              Tu cuenta fue bloqueada por falta de pago. Contactá al soporte de
              WANT para regularizar tu situación.
            </p>
          </div>
        </div>
      )}

      {isPastDue && (
        <div className="flex items-start gap-4 rounded-3xl border border-amber-200 bg-amber-50 p-5">
          <AlertTriangle size={22} className="mt-0.5 shrink-0 text-amber-600" />
          <div>
            <p className="font-black text-amber-900">Suscripción vencida</p>
            <p className="mt-1 text-sm text-amber-700">
              Tu suscripción está vencida. Seleccioná un plan para renovar y
              seguir accediendo a todas las funcionalidades.
            </p>
          </div>
        </div>
      )}

      {/* Current plan summary */}
      <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-zinc-950 p-6 text-white shadow-xl lg:p-8">
        <div className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-white/5 blur-3xl" />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-white/50">
              Tu plan actual
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <h2 className="text-4xl font-black tracking-tight">
                {PLAN_LABELS[currentPlan]}
              </h2>
              <span
                className={`rounded-full border px-3 py-1 text-xs font-black uppercase tracking-wide ${
                  STATUS_STYLES[subscriptionStatus] ?? STATUS_STYLES["trial"]
                }`}
              >
                {STATUS_LABELS[subscriptionStatus] ?? "Trial"}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2 lg:text-right">
            {monthlyPrice !== undefined && (
              <p className="text-3xl font-black">
                {formatPriceARS(monthlyPrice)}
                <span className="ml-1 text-sm font-medium text-white/40">
                  /mes
                </span>
              </p>
            )}
            {!isTrial && nextBillingDate && (
              <div className="flex items-center gap-2 text-sm text-white/60 lg:justify-end">
                <Calendar size={14} />
                <span>
                  Próximo vencimiento:{" "}
                  {formatTimestamp(nextBillingDate, "long") ?? "—"}
                </span>
              </div>
            )}
            {isTrial && trialEndsAt && (
              <div className="flex items-center gap-2 text-sm text-white/60 lg:justify-end">
                <Calendar size={14} />
                <span>
                  Trial hasta: {formatTimestamp(trialEndsAt, "long") ?? "—"}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Plan cards */}
      <div>
        <h3 className="mb-4 text-lg font-black text-zinc-950">
          Planes disponibles
        </h3>
        <div className="grid gap-4 md:grid-cols-3">
          {PLANS.map((plan) => {
            const isCurrent = plan.key === currentPlan;
            const isUpgrade = PLAN_ORDER[plan.key] > PLAN_ORDER[currentPlan];

            return (
              <div
                key={plan.key}
                className={`relative flex flex-col overflow-hidden rounded-[2rem] border p-6 shadow-sm transition ${
                  isCurrent
                    ? "border-zinc-950 bg-white ring-2 ring-zinc-950/10"
                    : plan.popular
                      ? "border-zinc-200 bg-white"
                      : "border-zinc-200 bg-zinc-50"
                }`}
              >
                {plan.popular && !isCurrent && (
                  <div className="absolute right-4 top-4">
                    <span className="rounded-full bg-zinc-950 px-3 py-1 text-[11px] font-black uppercase tracking-wide text-white">
                      Popular
                    </span>
                  </div>
                )}

                {isCurrent && (
                  <div className="absolute right-4 top-4">
                    <span className="rounded-full bg-emerald-600 px-3 py-1 text-[11px] font-black uppercase tracking-wide text-white">
                      Actual
                    </span>
                  </div>
                )}

                <div className="mb-5">
                  <p className="text-base font-black text-zinc-950">
                    {plan.label}
                  </p>
                  <p className="mt-1 text-3xl font-black tracking-tight text-zinc-950">
                    {formatPriceARS(plan.price)}
                    <span className="ml-1 text-sm font-medium text-zinc-400">
                      /mes
                    </span>
                  </p>
                </div>

                <ul className="mb-6 flex-1 space-y-2">
                  {plan.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-center gap-2 text-sm text-zinc-700"
                    >
                      <Check
                        size={14}
                        className="shrink-0 text-emerald-600"
                      />
                      {feature}
                    </li>
                  ))}
                  {plan.lockedFeatures.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-center gap-2 text-sm text-zinc-400"
                    >
                      <X size={14} className="shrink-0 text-zinc-300" />
                      {feature}
                    </li>
                  ))}
                </ul>

                {isCurrent ? (
                  <div className="flex h-12 items-center justify-center rounded-2xl border-2 border-zinc-200 text-sm font-black text-zinc-500">
                    Plan actual
                  </div>
                ) : (
                  <button
                    onClick={() => void handleSubscribe(plan.key)}
                    disabled={subscribing || cancelling}
                    className={`flex h-12 items-center justify-center gap-2 rounded-2xl text-sm font-black transition disabled:opacity-60 ${
                      isUpgrade
                        ? "bg-zinc-950 text-white hover:opacity-90"
                        : "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                    }`}
                  >
                    {subscribing ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : isUpgrade ? (
                      "Hacer upgrade"
                    ) : (
                      "Cambiar plan"
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Payment history */}
      <div className="rounded-[2rem] border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <CreditCard size={18} className="text-zinc-500" />
          <h3 className="text-base font-black text-zinc-950">
            Historial de pagos
          </h3>
        </div>

        {paymentsLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={20} className="animate-spin text-zinc-400" />
          </div>
        ) : payments.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-zinc-200 p-4 text-sm text-zinc-500">
            No hay pagos registrados aún.
          </p>
        ) : (
          <div className="space-y-2">
            {visiblePayments.map((payment) => (
              <PaymentRow key={payment.id} payment={payment} />
            ))}
            {payments.length > 4 && (
              <button
                onClick={() => setShowAllPayments((v) => !v)}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 py-2.5 text-sm font-bold text-zinc-600 transition hover:bg-zinc-100"
              >
                {showAllPayments ? (
                  <>
                    <ChevronUp size={16} /> Mostrar menos
                  </>
                ) : (
                  <>
                    <ChevronDown size={16} /> Ver todos ({payments.length})
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Cancel subscription — only shown when an active MP subscription exists */}
      {mpSubscriptionId && (
        <div className="rounded-[2rem] border border-red-200 bg-red-50 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-black text-red-900">Cancelar suscripción</p>
              <p className="mt-1 text-sm text-red-700">
                Tu plan seguirá activo hasta el próximo vencimiento.
              </p>
            </div>
            <button
              onClick={() => void handleCancel()}
              disabled={cancelling || subscribing}
              className="flex h-11 shrink-0 items-center gap-2 rounded-2xl border border-red-300 bg-white px-5 text-sm font-black text-red-700 transition hover:bg-red-100 disabled:opacity-60"
            >
              {cancelling && <Loader2 size={15} className="animate-spin" />}
              {cancelling ? "Cancelando..." : "Cancelar suscripción"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PaymentRow({ payment }: { payment: PaymentRecord }) {
  const typeLabel =
    payment.type === "monthly"
      ? "Mensualidad"
      : payment.type === "setup"
        ? "Setup inicial"
        : "Pago";

  const planLabel = payment.plan ? PLAN_LABELS[payment.plan] : null;
  const dateStr =
    formatTimestamp(payment.paidAt ?? payment.createdAt, "short") ?? "—";

  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl bg-zinc-50 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-black text-zinc-950">
          {typeLabel}
          {planLabel && (
            <span className="ml-2 text-xs font-bold text-zinc-400">
              · Plan {planLabel}
            </span>
          )}
        </p>
        <p className="text-xs text-zinc-500">{dateStr}</p>
      </div>
      {payment.amount !== undefined && (
        <p className="shrink-0 text-sm font-black text-zinc-950">
          {formatPriceARS(payment.amount)}
        </p>
      )}
    </div>
  );
}
