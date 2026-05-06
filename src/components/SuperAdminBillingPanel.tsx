import { useMemo, useState } from "react";
import { doc, serverTimestamp, updateDoc, Timestamp } from "firebase/firestore";
import {
  BadgeDollarSign,
  Ban,
  CheckCircle2,
  Clock,
  CreditCard,
  Save,
} from "lucide-react";
import { getDb } from "@/lib/firebase";

const db = getDb();

type RestaurantPlan = "starter" | "pro" | "premium";
type SubscriptionStatus = "trial" | "active" | "past_due" | "blocked";

export type BillingRestaurantRecord = {
  id: string;
  name?: string;
  active?: boolean;
  plan?: RestaurantPlan;
  subscriptionStatus?: SubscriptionStatus;
  setupFeePaid?: boolean;
  monthlyPrice?: number;
  setupPrice?: number;
  billingDay?: number;
  nextBillingDate?: {
    toDate?: () => Date;
  };
  trialEndsAt?: {
    toDate?: () => Date;
  };
  blockedAt?: {
    toDate?: () => Date;
  } | null;
};

type Props = {
  restaurants: BillingRestaurantRecord[];
  onMessage?: (message: string) => void;
};

const PLAN_OPTIONS: RestaurantPlan[] = ["starter", "pro", "premium"];

const STATUS_OPTIONS: SubscriptionStatus[] = [
  "trial",
  "active",
  "past_due",
  "blocked",
];

const formatDateInput = (value?: { toDate?: () => Date } | null) => {
  const date = value?.toDate?.();

  if (!date) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const getDateTimestamp = (value: string) => {
  if (!value) return null;

  const date = new Date(`${value}T12:00:00`);

  return Timestamp.fromDate(date);
};

const getStatusLabel = (status?: SubscriptionStatus) => {
  switch (status) {
    case "trial":
      return "Trial";
    case "active":
      return "Activo";
    case "past_due":
      return "Moroso";
    case "blocked":
      return "Bloqueado";
    default:
      return "Sin definir";
  }
};

const getPlanLabel = (plan?: RestaurantPlan) => {
  switch (plan) {
    case "starter":
      return "Starter";
    case "pro":
      return "Pro";
    case "premium":
      return "Premium";
    default:
      return "Sin plan";
  }
};

const SuperAdminBillingPanel = ({ restaurants, onMessage }: Props) => {
  const sortedRestaurants = useMemo(() => {
    return [...restaurants].sort((a, b) => a.id.localeCompare(b.id));
  }, [restaurants]);

  const [savingId, setSavingId] = useState<string | null>(null);

  const updateRestaurantBilling = async (
    restaurantId: string,
    data: Record<string, unknown>,
    successMessage: string
  ) => {
    try {
      setSavingId(restaurantId);

      await updateDoc(doc(db, "restaurants", restaurantId), {
        ...data,
        updatedAt: serverTimestamp(),
      });

      onMessage?.(successMessage);
    } catch (error) {
      console.error("Error actualizando billing:", error);
      onMessage?.("No se pudo actualizar el billing del restaurante.");
    } finally {
      setSavingId(null);
    }
  };

  const handleQuickStatus = async (
    restaurantId: string,
    status: SubscriptionStatus
  ) => {
    await updateRestaurantBilling(
      restaurantId,
      {
        subscriptionStatus: status,
        blockedAt: status === "blocked" ? serverTimestamp() : null,
      },
      `Estado actualizado a ${getStatusLabel(status)}.`
    );
  };

  const handleMarkMonthlyPaid = async (restaurant: BillingRestaurantRecord) => {
    const nextDate = new Date();
    nextDate.setMonth(nextDate.getMonth() + 1);

    const billingDay = restaurant.billingDay || nextDate.getDate();
    nextDate.setDate(Math.min(billingDay, 28));

    await updateRestaurantBilling(
      restaurant.id,
      {
        subscriptionStatus: "active",
        nextBillingDate: Timestamp.fromDate(nextDate),
        blockedAt: null,
      },
      "Pago mensual registrado correctamente."
    );
  };

  const handleSaveManual = async (
    restaurant: BillingRestaurantRecord,
    formData: FormData
  ) => {
    const plan = String(formData.get("plan") || "pro") as RestaurantPlan;
    const subscriptionStatus = String(
      formData.get("subscriptionStatus") || "active"
    ) as SubscriptionStatus;

    const setupFeePaid = formData.get("setupFeePaid") === "on";
    const monthlyPrice = Number(formData.get("monthlyPrice") || 0);
    const setupPrice = Number(formData.get("setupPrice") || 0);
    const billingDay = Number(formData.get("billingDay") || 1);

    const nextBillingDateValue = String(formData.get("nextBillingDate") || "");
    const trialEndsAtValue = String(formData.get("trialEndsAt") || "");

    await updateRestaurantBilling(
      restaurant.id,
      {
        plan,
        subscriptionStatus,
        setupFeePaid,
        monthlyPrice,
        setupPrice,
        billingDay,
        nextBillingDate: getDateTimestamp(nextBillingDateValue),
        trialEndsAt: getDateTimestamp(trialEndsAtValue),
        blockedAt:
          subscriptionStatus === "blocked" ? serverTimestamp() : null,
      },
      "Billing guardado correctamente."
    );
  };

  return (
    <section className="mb-6 rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-zinc-950 text-white">
          <BadgeDollarSign size={20} />
        </div>

        <div>
          <h2 className="text-xl font-black text-zinc-950">
            Control de pagos SaaS
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Administrá planes, mensualidades, trials y bloqueos.
          </p>
        </div>
      </div>

      {sortedRestaurants.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-500">
          Todavía no hay restaurantes para administrar.
        </div>
      ) : (
        <div className="space-y-4">
          {sortedRestaurants.map((restaurant) => {
            const currentStatus = restaurant.subscriptionStatus || "trial";
            const currentPlan = restaurant.plan || "pro";
            const saving = savingId === restaurant.id;

            return (
              <form
                key={restaurant.id}
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSaveManual(
                    restaurant,
                    new FormData(event.currentTarget)
                  );
                }}
                className="rounded-3xl border border-zinc-200 bg-zinc-50 p-4"
              >
                <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-lg font-black text-zinc-950">
                      {restaurant.name || restaurant.id}
                    </p>
                    <p className="mt-1 text-sm text-zinc-500">
                      ID: {restaurant.id}
                    </p>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-zinc-700 shadow-sm">
                        Plan: {getPlanLabel(currentPlan)}
                      </span>

                      <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-zinc-700 shadow-sm">
                        Estado: {getStatusLabel(currentStatus)}
                      </span>

                      <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-zinc-700 shadow-sm">
                        Setup: {restaurant.setupFeePaid ? "Pagado" : "Pendiente"}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void handleQuickStatus(restaurant.id, "active")}
                      className="flex h-10 items-center gap-2 rounded-2xl bg-emerald-600 px-4 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      <CheckCircle2 size={15} />
                      Activar
                    </button>

                    <button
                      type="button"
                      disabled={saving}
                      onClick={() =>
                        void handleQuickStatus(restaurant.id, "past_due")
                      }
                      className="flex h-10 items-center gap-2 rounded-2xl bg-amber-500 px-4 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      <Clock size={15} />
                      Moroso
                    </button>

                    <button
                      type="button"
                      disabled={saving}
                      onClick={() =>
                        void handleQuickStatus(restaurant.id, "blocked")
                      }
                      className="flex h-10 items-center gap-2 rounded-2xl bg-red-600 px-4 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      <Ban size={15} />
                      Bloquear
                    </button>

                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void handleMarkMonthlyPaid(restaurant)}
                      className="flex h-10 items-center gap-2 rounded-2xl bg-zinc-950 px-4 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      <CreditCard size={15} />
                      Pago mensual
                    </button>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <label className="grid gap-1 text-xs font-bold text-zinc-600">
                    Plan
                    <select
                      name="plan"
                      defaultValue={currentPlan}
                      className="h-11 rounded-2xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-black/10"
                    >
                      {PLAN_OPTIONS.map((plan) => (
                        <option key={plan} value={plan}>
                          {getPlanLabel(plan)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="grid gap-1 text-xs font-bold text-zinc-600">
                    Estado
                    <select
                      name="subscriptionStatus"
                      defaultValue={currentStatus}
                      className="h-11 rounded-2xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-black/10"
                    >
                      {STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>
                          {getStatusLabel(status)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="grid gap-1 text-xs font-bold text-zinc-600">
                    Mensualidad
                    <input
                      name="monthlyPrice"
                      type="number"
                      min={0}
                      defaultValue={restaurant.monthlyPrice || 0}
                      className="h-11 rounded-2xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-black/10"
                    />
                  </label>

                  <label className="grid gap-1 text-xs font-bold text-zinc-600">
                    Setup inicial
                    <input
                      name="setupPrice"
                      type="number"
                      min={0}
                      defaultValue={restaurant.setupPrice || 0}
                      className="h-11 rounded-2xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-black/10"
                    />
                  </label>

                  <label className="grid gap-1 text-xs font-bold text-zinc-600">
                    Día de cobro
                    <input
                      name="billingDay"
                      type="number"
                      min={1}
                      max={31}
                      defaultValue={restaurant.billingDay || 10}
                      className="h-11 rounded-2xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-black/10"
                    />
                  </label>

                  <label className="grid gap-1 text-xs font-bold text-zinc-600">
                    Próximo vencimiento
                    <input
                      name="nextBillingDate"
                      type="date"
                      defaultValue={formatDateInput(restaurant.nextBillingDate)}
                      className="h-11 rounded-2xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-black/10"
                    />
                  </label>

                  <label className="grid gap-1 text-xs font-bold text-zinc-600">
                    Fin de trial
                    <input
                      name="trialEndsAt"
                      type="date"
                      defaultValue={formatDateInput(restaurant.trialEndsAt)}
                      className="h-11 rounded-2xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-black/10"
                    />
                  </label>

                  <label className="flex h-11 items-center gap-2 self-end rounded-2xl border border-zinc-200 bg-white px-3 text-sm font-bold text-zinc-700">
                    <input
                      name="setupFeePaid"
                      type="checkbox"
                      defaultChecked={restaurant.setupFeePaid === true}
                      className="h-4 w-4 rounded border-zinc-300"
                    />
                    Setup pagado
                  </label>
                </div>

                <div className="mt-4 flex justify-end">
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex h-11 items-center justify-center gap-2 rounded-2xl bg-zinc-950 px-5 font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
                  >
                    <Save size={16} />
                    {saving ? "Guardando..." : "Guardar billing"}
                  </button>
                </div>
              </form>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default SuperAdminBillingPanel;