import { useState } from "react";
import {
  AlertTriangle,
  Ban,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  CreditCard,
  Loader2,
  ReceiptText,
  XCircle,
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
  const subscriptionStatus = restaurant?.billing?.status ?? "trial";
  const nextBillingDate = restaurant?.billing?.currentPeriodEnd;
  const trialEndsAt = restaurant?.trialEndsAt;
  const monthlyPrice = PLANS.find((p) => p.key === currentPlan)?.price;
  const mpSubscriptionId = restaurant?.billing?.subscriptionId;

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
      <BillingHistory
        payments={payments}
        paymentsLoading={paymentsLoading}
        showAllPayments={showAllPayments}
        setShowAllPayments={setShowAllPayments}
      />

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

// ─── Billing History ─────────────────────────────────────────────────────────

type BillingFilter = "all" | "emitidas" | "pendientes" | "fallidas";

function classifyPayment(p: PaymentRecord): "emitidas" | "pendientes" | "fallidas" {
  if (p.billingStatus === "active") return "emitidas";
  if (p.billingStatus === "pending") return "pendientes";
  return "fallidas";
}

const EVENT_LABELS: Record<string, string> = {
  mp_authorized: "Pago aprobado",
  mp_paused: "Suscripción pausada",
  mp_cancelled: "Suscripción cancelada",
  mp_pending: "Pago pendiente",
};

const FILTER_TABS: { key: BillingFilter; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "emitidas", label: "Emitidas" },
  { key: "pendientes", label: "Pendientes" },
  { key: "fallidas", label: "Fallidas" },
];

function BillingHistory({
  payments,
  paymentsLoading,
  showAllPayments,
  setShowAllPayments,
}: {
  payments: PaymentRecord[];
  paymentsLoading: boolean;
  showAllPayments: boolean;
  setShowAllPayments: (v: boolean) => void;
}) {
  const [filter, setFilter] = useState<BillingFilter>("all");

  const emitidas = payments.filter((p) => classifyPayment(p) === "emitidas");
  const pendientes = payments.filter((p) => classifyPayment(p) === "pendientes");
  const fallidas = payments.filter((p) => classifyPayment(p) === "fallidas");

  const filtered =
    filter === "all"
      ? payments
      : filter === "emitidas"
        ? emitidas
        : filter === "pendientes"
          ? pendientes
          : fallidas;

  const visible = showAllPayments ? filtered : filtered.slice(0, 5);

  return (
    <div className="rounded-[2rem] border border-zinc-200 bg-white p-5 shadow-sm">
      {/* Header */}
      <div className="mb-5 flex items-center gap-2">
        <ReceiptText size={18} className="text-zinc-500" />
        <h3 className="text-base font-black text-zinc-950">
          Historial de facturación
        </h3>
      </div>

      {paymentsLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 size={20} className="animate-spin text-zinc-400" />
        </div>
      ) : payments.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-zinc-200 p-5 text-sm text-zinc-500">
          No hay movimientos registrados aún.
        </p>
      ) : (
        <>
          {/* Summary strip */}
          <div className="mb-5 grid grid-cols-3 gap-3">
            <div className="flex flex-col items-center gap-1 rounded-2xl border border-emerald-100 bg-emerald-50 px-3 py-3">
              <CheckCircle2 size={18} className="text-emerald-600" />
              <p className="text-xl font-black text-emerald-800">{emitidas.length}</p>
              <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-600">
                Emitidas
              </p>
            </div>
            <div className="flex flex-col items-center gap-1 rounded-2xl border border-amber-100 bg-amber-50 px-3 py-3">
              <Clock size={18} className="text-amber-600" />
              <p className="text-xl font-black text-amber-800">{pendientes.length}</p>
              <p className="text-[11px] font-bold uppercase tracking-wide text-amber-600">
                Pendientes
              </p>
            </div>
            <div className="flex flex-col items-center gap-1 rounded-2xl border border-red-100 bg-red-50 px-3 py-3">
              <XCircle size={18} className="text-red-500" />
              <p className="text-xl font-black text-red-700">{fallidas.length}</p>
              <p className="text-[11px] font-bold uppercase tracking-wide text-red-500">
                Fallidas
              </p>
            </div>
          </div>

          {/* Filter tabs */}
          <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
            {FILTER_TABS.map((tab) => {
              const count =
                tab.key === "all"
                  ? payments.length
                  : tab.key === "emitidas"
                    ? emitidas.length
                    : tab.key === "pendientes"
                      ? pendientes.length
                      : fallidas.length;
              return (
                <button
                  key={tab.key}
                  onClick={() => {
                    setFilter(tab.key);
                    setShowAllPayments(false);
                  }}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-black transition ${
                    filter === tab.key
                      ? "border-zinc-950 bg-zinc-950 text-white"
                      : "border-zinc-200 bg-zinc-50 text-zinc-600 hover:bg-zinc-100"
                  }`}
                >
                  {tab.label}
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-black ${
                      filter === tab.key
                        ? "bg-white/20 text-white"
                        : "bg-zinc-200 text-zinc-600"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Rows */}
          {filtered.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-zinc-200 p-4 text-center text-sm text-zinc-500">
              No hay registros en esta categoría.
            </p>
          ) : (
            <div className="space-y-2">
              {visible.map((payment) => (
                <PaymentRow key={payment.id} payment={payment} />
              ))}

              {filtered.length > 5 && (
                <button
                  onClick={() => setShowAllPayments(!showAllPayments)}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 py-2.5 text-sm font-bold text-zinc-600 transition hover:bg-zinc-100"
                >
                  {showAllPayments ? (
                    <>
                      <ChevronUp size={16} /> Mostrar menos
                    </>
                  ) : (
                    <>
                      <ChevronDown size={16} /> Ver todos ({filtered.length})
                    </>
                  )}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Payment Row ──────────────────────────────────────────────────────────────

const ROW_ICON: Record<string, React.ReactNode> = {
  emitidas: <CheckCircle2 size={16} className="text-emerald-600" />,
  pendientes: <Clock size={16} className="text-amber-500" />,
  fallidas: <XCircle size={16} className="text-red-500" />,
};

const ROW_BG: Record<string, string> = {
  emitidas: "bg-emerald-50 border-emerald-100",
  pendientes: "bg-amber-50 border-amber-100",
  fallidas: "bg-red-50 border-red-100",
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  active: "border-emerald-200 bg-emerald-100 text-emerald-800",
  past_due: "border-amber-200 bg-amber-100 text-amber-800",
  canceled: "border-red-200 bg-red-100 text-red-800",
  pending: "border-zinc-200 bg-zinc-100 text-zinc-600",
};

const STATUS_BADGE_LABELS: Record<string, string> = {
  active: "Emitida",
  past_due: "Vencida",
  canceled: "Cancelada",
  pending: "Pendiente",
};

function PaymentRow({ payment }: { payment: PaymentRecord }) {
  const category = classifyPayment(payment);
  const typeLabel = EVENT_LABELS[payment.type ?? ""] ?? payment.type ?? "Evento";
  const planLabel = payment.plan ? PLAN_LABELS[payment.plan] : null;
  const planPrice = payment.plan
    ? PLANS.find((p) => p.key === payment.plan)?.price
    : undefined;
  const dateStr = formatTimestamp(payment.createdAt, "short") ?? "—";
  const shortId = payment.subscriptionId
    ? `${payment.subscriptionId.slice(0, 8)}…`
    : null;
  const badgeClass =
    STATUS_BADGE_CLASS[payment.billingStatus ?? ""] ?? STATUS_BADGE_CLASS["pending"];
  const badgeLabel =
    STATUS_BADGE_LABELS[payment.billingStatus ?? ""] ?? payment.billingStatus ?? "—";

  return (
    <div
      className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${ROW_BG[category]}`}
    >
      <div className="shrink-0">{ROW_ICON[category]}</div>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-black text-zinc-950">{typeLabel}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-zinc-500">
          {planLabel && (
            <span className="flex items-center gap-1">
              <CreditCard size={11} />
              Plan {planLabel}
              {planPrice !== undefined && (
                <span className="text-zinc-400">
                  · {formatPriceARS(planPrice)}/mes
                </span>
              )}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Calendar size={11} />
            {dateStr}
          </span>
          {shortId && (
            <span className="font-mono text-zinc-400" title={payment.subscriptionId}>
              ID: {shortId}
            </span>
          )}
        </div>
      </div>

      <span
        className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-black ${badgeClass}`}
      >
        {badgeLabel}
      </span>
    </div>
  );
}
