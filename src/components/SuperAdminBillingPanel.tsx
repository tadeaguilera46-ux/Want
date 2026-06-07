import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  writeBatch,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";
import {
  BadgeDollarSign,
  Ban,
  CheckCircle2,
  Clock,
  CreditCard,
  Save,
  TrendingUp,
  AlertTriangle,
  Wallet,
  RefreshCw,
  History,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { getDb } from "@/lib/firebase";
import { writeAuditLog } from "@/lib/audit-logs";

const db = getDb();
const auth = getAuth();

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

type PaymentRecord = {
  id: string;
  restaurantId?: string;
  type?: "monthly" | "setup" | string;
  amount?: number;
  plan?: RestaurantPlan;
  notes?: string;
  paidAt?: {
    toDate?: () => Date;
  };
  createdAt?: {
    toDate?: () => Date;
  };
};

type MesaLimitRecord = {
  id: string;
  numero?: number;
  active?: boolean;
};

type StaffLimitRecord = {
  id: string;
  role?: string;
  active?: boolean;
  createdAt?: {
    seconds?: number;
    toMillis?: () => number;
  };
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

const PLAN_TABLE_LIMITS: Record<RestaurantPlan, number | null> = {
  starter: 15,
  pro: 20,
  premium: null,
};

const PLAN_STAFF_LIMITS: Record<RestaurantPlan, number | null> = {
  starter: 7,
  pro: 10,
  premium: null,
};

const GRACE_DAYS_BEFORE_BLOCK = 7;

const formatPriceARS = (value: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value || 0);

const formatDateInput = (value?: { toDate?: () => Date } | null) => {
  const date = value?.toDate?.();

  if (!date) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const formatShortDate = (value?: { toDate?: () => Date } | null) => {
  const date = value?.toDate?.();

  if (!date) return "Sin fecha";

  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
};

const getDateTimestamp = (value: string) => {
  if (!value) return null;
  return Timestamp.fromDate(new Date(`${value}T12:00:00`));
};

const getTimestampDate = (value?: { toDate?: () => Date } | null) =>
  value?.toDate?.() || null;

const getPlanLabel = (plan?: RestaurantPlan) => {
  if (plan === "starter") return "Starter";
  if (plan === "pro") return "Pro";
  if (plan === "premium") return "Premium";
  return "Sin plan";
};

const getStatusLabel = (status?: SubscriptionStatus) => {
  if (status === "trial") return "Trial";
  if (status === "active") return "Activo";
  if (status === "past_due") return "Moroso";
  if (status === "blocked") return "Bloqueado";
  return "Sin definir";
};

const getPaymentTypeLabel = (type?: string) => {
  if (type === "monthly") return "Mensualidad";
  if (type === "setup") return "Setup inicial";
  return "Pago";
};

const getStatusStyle = (status?: SubscriptionStatus) => {
  switch (status) {
    case "active":
      return "border-emerald-200 bg-emerald-100 text-emerald-800";
    case "trial":
      return "border-blue-200 bg-blue-100 text-blue-800";
    case "past_due":
      return "border-amber-200 bg-amber-100 text-amber-800";
    case "blocked":
      return "border-red-200 bg-red-100 text-red-800";
    default:
      return "border-zinc-200 bg-zinc-100 text-zinc-700";
  }
};

const addOneBillingMonth = (baseDate: Date, billingDay?: number) => {
  const nextDate = new Date(baseDate);
  const desiredDay = Math.min(Math.max(Number(billingDay || 10), 1), 31);

  const targetYear = nextDate.getFullYear();
  const targetMonth = nextDate.getMonth() + 1;
  const lastDayOfTargetMonth = new Date(
    targetYear,
    targetMonth + 1,
    0
  ).getDate();

  nextDate.setFullYear(targetYear);
  nextDate.setMonth(targetMonth);
  nextDate.setDate(Math.min(desiredDay, lastDayOfTargetMonth));
  nextDate.setHours(12, 0, 0, 0);

  return nextDate;
};

const getEffectiveStatus = (
  restaurant: BillingRestaurantRecord
): SubscriptionStatus => {
  const currentStatus = restaurant.subscriptionStatus || "trial";
  const now = new Date();

  if (currentStatus === "blocked") return "blocked";

  if (currentStatus === "trial") {
    const trialEndsAt = getTimestampDate(restaurant.trialEndsAt);

    if (trialEndsAt && trialEndsAt < now) return "past_due";

    return "trial";
  }

  const nextBillingDate = getTimestampDate(restaurant.nextBillingDate);

  if (currentStatus === "active" && nextBillingDate && nextBillingDate < now) {
    return "past_due";
  }

  if (
    currentStatus === "past_due" &&
    nextBillingDate &&
    now.getTime() - nextBillingDate.getTime() >
      GRACE_DAYS_BEFORE_BLOCK * 24 * 60 * 60 * 1000
  ) {
    return "blocked";
  }

  return currentStatus;
};

const getCreatedAtMillis = (item: StaffLimitRecord) => {
  if (typeof item.createdAt?.toMillis === "function") {
    return item.createdAt.toMillis();
  }

  if (typeof item.createdAt?.seconds === "number") {
    return item.createdAt.seconds * 1000;
  }

  return 0;
};

const enforcePlanLimits = async (
  restaurantId: string,
  plan: RestaurantPlan
) => {
  const tableLimit = PLAN_TABLE_LIMITS[plan];
  const staffLimit = PLAN_STAFF_LIMITS[plan];

  if (tableLimit === null && staffLimit === null) {
    return {
      disabledTables: 0,
      disabledStaff: 0,
    };
  }

  const [mesasSnapshot, staffSnapshot] = await Promise.all([
    getDocs(collection(db, "restaurants", restaurantId, "mesas")),
    getDocs(collection(db, "restaurants", restaurantId, "staff")),
  ]);

  const mesas = mesasSnapshot.docs.map((document) => ({
    id: document.id,
    ...document.data(),
  })) as MesaLimitRecord[];

  const staff = staffSnapshot.docs.map((document) => ({
    id: document.id,
    ...document.data(),
  })) as StaffLimitRecord[];

  const batch = writeBatch(db);

  let disabledTables = 0;
  let disabledStaff = 0;

  if (tableLimit !== null) {
    const activeMesas = mesas
      .filter((mesa) => mesa.active !== false)
      .sort((a, b) => {
        const aNumber = Number(a.numero ?? a.id);
        const bNumber = Number(b.numero ?? b.id);
        return aNumber - bNumber;
      });

    activeMesas.slice(tableLimit).forEach((mesa) => {
      batch.update(doc(db, "restaurants", restaurantId, "mesas", mesa.id), {
        active: false,
        updatedAt: serverTimestamp(),
      });

      disabledTables += 1;
    });
  }

  if (staffLimit !== null) {
    const activeStaff = staff
      .filter((member) => member.active === true)
      .sort((a, b) => {
        if (a.role === "admin" && b.role !== "admin") return -1;
        if (a.role !== "admin" && b.role === "admin") return 1;

        return getCreatedAtMillis(a) - getCreatedAtMillis(b);
      });

    activeStaff.slice(staffLimit).forEach((member) => {
      if (member.role === "admin") return;

      batch.update(doc(db, "restaurants", restaurantId, "staff", member.id), {
        active: false,
        updatedAt: serverTimestamp(),
      });

      disabledStaff += 1;
    });
  }

  if (disabledTables > 0 || disabledStaff > 0) {
    await batch.commit();
  }

  return {
    disabledTables,
    disabledStaff,
  };
};

const SuperAdminBillingPanel = ({ restaurants, onMessage }: Props) => {
  const [savingId, setSavingId] = useState<string | null>(null);
  const [syncingOverdue, setSyncingOverdue] = useState(false);
  const [expandedPaymentsId, setExpandedPaymentsId] = useState<string | null>(
    null
  );
  const [paymentsByRestaurant, setPaymentsByRestaurant] = useState<
    Record<string, PaymentRecord[]>
  >({});

  const sortedRestaurants = useMemo(() => {
    return [...restaurants].sort((a, b) => a.id.localeCompare(b.id));
  }, [restaurants]);

  useEffect(() => {
    if (restaurants.length === 0) {
      setPaymentsByRestaurant({});
      return;
    }

    const unsubscribers = restaurants.map((restaurant) => {
      return onSnapshot(
        collection(db, "restaurants", restaurant.id, "payments"),
        (snapshot) => {
          const payments = snapshot.docs.map((paymentDoc) => ({
            id: paymentDoc.id,
            ...paymentDoc.data(),
          })) as PaymentRecord[];

          payments.sort((a, b) => {
            const aDate =
              a.paidAt?.toDate?.()?.getTime() ||
              a.createdAt?.toDate?.()?.getTime() ||
              0;
            const bDate =
              b.paidAt?.toDate?.()?.getTime() ||
              b.createdAt?.toDate?.()?.getTime() ||
              0;

            return bDate - aDate;
          });

          setPaymentsByRestaurant((prev) => ({
            ...prev,
            [restaurant.id]: payments,
          }));
        },
        (error) => {
          console.error("Error cargando pagos:", error);
        }
      );
    });

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [restaurants]);

  const metrics = useMemo(() => {
    const now = new Date();
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(now.getDate() + 7);

    return restaurants.reduce(
      (acc, restaurant) => {
        const effectiveStatus = getEffectiveStatus(restaurant);
        const monthlyPrice = Number(restaurant.monthlyPrice || 0);
        const setupPrice = Number(restaurant.setupPrice || 0);
        const nextBillingDate = getTimestampDate(restaurant.nextBillingDate);

        acc.total += 1;

        if (effectiveStatus === "active") {
          acc.active += 1;
          acc.mrr += monthlyPrice;
        }

        if (effectiveStatus === "trial") acc.trial += 1;
        if (effectiveStatus === "past_due") acc.pastDue += 1;
        if (effectiveStatus === "blocked") acc.blocked += 1;

        if (!restaurant.setupFeePaid) {
          acc.setupPending += setupPrice;
        }

        if (
          effectiveStatus === "active" &&
          nextBillingDate &&
          nextBillingDate >= now &&
          nextBillingDate <= sevenDaysFromNow
        ) {
          acc.dueSoon += 1;
        }

        return acc;
      },
      {
        total: 0,
        active: 0,
        trial: 0,
        pastDue: 0,
        blocked: 0,
        dueSoon: 0,
        mrr: 0,
        setupPending: 0,
      }
    );
  }, [restaurants]);

  const createPaymentRecord = async (
    restaurantId: string,
    data: Record<string, unknown>
  ) => {
    const user = auth.currentUser;
    if (!user) throw new Error("Superadmin no autenticado.");
    const paymentRef = doc(collection(db, "restaurants", restaurantId, "payments"));
    const batch = writeBatch(db);
    batch.set(paymentRef, {
      restaurantId,
      ...data,
      createdAt: serverTimestamp(),
      paidAt: serverTimestamp(),
    });
    writeAuditLog(batch, {
      restaurantId,
      action: "saas_payment_registered",
      actorUid: user.uid,
      actorEmail: user.email,
      actorRole: "superadmin",
      entityType: "payment",
      entityId: paymentRef.id,
      description: `Superadmin registro pago ${paymentRef.id}`,
      changes: {
        before: { exists: false },
        after: data,
      },
    });
    await batch.commit();
  };

  const updateRestaurantBilling = async (
    restaurantId: string,
    data: Record<string, unknown>,
    successMessage: string
  ) => {
    try {
      setSavingId(restaurantId);
      const user = auth.currentUser;
      if (!user) throw new Error("Superadmin no autenticado.");

      const batch = writeBatch(db);
      batch.update(doc(db, "restaurants", restaurantId), {
        ...data,
        updatedAt: serverTimestamp(),
      });
      writeAuditLog(batch, {
        restaurantId,
        action: "saas_billing_updated",
        actorUid: user.uid,
        actorEmail: user.email,
        actorRole: "superadmin",
        entityType: "restaurant_billing",
        entityId: restaurantId,
        description: "Superadmin actualizo billing",
        changes: { before: {}, after: data },
      });
      await batch.commit();

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
    const currentNextBillingDate = getTimestampDate(restaurant.nextBillingDate);
    const baseDate = currentNextBillingDate || new Date();
    const nextDate = addOneBillingMonth(baseDate, restaurant.billingDay);
    const amount = Number(restaurant.monthlyPrice || 0);

    try {
      setSavingId(restaurant.id);
      const user = auth.currentUser;
      if (!user) throw new Error("Superadmin no autenticado.");

      const batch = writeBatch(db);
      batch.update(doc(db, "restaurants", restaurant.id), {
        subscriptionStatus: "active",
        nextBillingDate: Timestamp.fromDate(nextDate),
        blockedAt: null,
        updatedAt: serverTimestamp(),
      });
      writeAuditLog(batch, {
        restaurantId: restaurant.id,
        action: "saas_monthly_payment_applied",
        actorUid: user.uid,
        actorEmail: user.email,
        actorRole: "superadmin",
        entityType: "restaurant_billing",
        entityId: restaurant.id,
        description: "Superadmin aplico pago mensual",
        changes: {
          before: { subscriptionStatus: restaurant.subscriptionStatus ?? "trial" },
          after: { subscriptionStatus: "active", nextBillingDate: nextDate.toISOString() },
        },
      });
      await batch.commit();

      await createPaymentRecord(restaurant.id, {
        type: "monthly",
        amount,
        plan: restaurant.plan || "pro",
        nextBillingDate: Timestamp.fromDate(nextDate),
        notes: "Pago mensual registrado desde Super Admin.",
      });

      onMessage?.(
        `Pago mensual registrado. Nuevo vencimiento: ${new Intl.DateTimeFormat(
          "es-AR"
        ).format(nextDate)}.`
      );
    } catch (error) {
      console.error("Error registrando pago mensual:", error);
      onMessage?.("No se pudo registrar el pago mensual.");
    } finally {
      setSavingId(null);
    }
  };

  const handleMarkSetupPaid = async (restaurant: BillingRestaurantRecord) => {
    const amount = Number(restaurant.setupPrice || 0);

    try {
      setSavingId(restaurant.id);
      const user = auth.currentUser;
      if (!user) throw new Error("Superadmin no autenticado.");

      const batch = writeBatch(db);
      batch.update(doc(db, "restaurants", restaurant.id), {
        setupFeePaid: true,
        updatedAt: serverTimestamp(),
      });
      writeAuditLog(batch, {
        restaurantId: restaurant.id,
        action: "saas_setup_payment_applied",
        actorUid: user.uid,
        actorEmail: user.email,
        actorRole: "superadmin",
        entityType: "restaurant_billing",
        entityId: restaurant.id,
        description: "Superadmin marco setup pagado",
        changes: {
          before: { setupFeePaid: restaurant.setupFeePaid ?? false },
          after: { setupFeePaid: true },
        },
      });
      await batch.commit();

      await createPaymentRecord(restaurant.id, {
        type: "setup",
        amount,
        plan: restaurant.plan || "pro",
        notes: "Setup inicial marcado como pagado desde Super Admin.",
      });

      onMessage?.("Setup inicial marcado como pagado.");
    } catch (error) {
      console.error("Error marcando setup pagado:", error);
      onMessage?.("No se pudo marcar el setup como pagado.");
    } finally {
      setSavingId(null);
    }
  };

  const handleSyncOverdueRestaurants = async () => {
    try {
      setSyncingOverdue(true);

      const batch = writeBatch(db);
      let updates = 0;

      sortedRestaurants.forEach((restaurant) => {
        const storedStatus = restaurant.subscriptionStatus || "trial";
        const effectiveStatus = getEffectiveStatus(restaurant);

        if (storedStatus === effectiveStatus) return;

        batch.update(doc(db, "restaurants", restaurant.id), {
          subscriptionStatus: effectiveStatus,
          blockedAt: effectiveStatus === "blocked" ? serverTimestamp() : null,
          updatedAt: serverTimestamp(),
        });
        const user = auth.currentUser;
        if (!user) throw new Error("Superadmin no autenticado.");
        writeAuditLog(batch, {
          restaurantId: restaurant.id,
          action: "saas_subscription_synced",
          actorUid: user.uid,
          actorEmail: user.email,
          actorRole: "superadmin",
          entityType: "restaurant_billing",
          entityId: restaurant.id,
          description: "Superadmin sincronizo vencimiento",
          changes: {
            before: { subscriptionStatus: storedStatus },
            after: { subscriptionStatus: effectiveStatus },
          },
        });

        updates += 1;
      });

      if (updates === 0) {
        onMessage?.("No hay vencimientos para sincronizar.");
        return;
      }

      await batch.commit();
      onMessage?.(`${updates} restaurante(s) sincronizado(s).`);
    } catch (error) {
      console.error("Error sincronizando vencidos:", error);
      onMessage?.("No se pudieron sincronizar los vencimientos.");
    } finally {
      setSyncingOverdue(false);
    }
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

    try {
      setSavingId(restaurant.id);
      const user = auth.currentUser;
      if (!user) throw new Error("Superadmin no autenticado.");

      const batch = writeBatch(db);
      batch.update(doc(db, "restaurants", restaurant.id), {
        plan,
        subscriptionStatus,
        setupFeePaid,
        monthlyPrice,
        setupPrice,
        billingDay,
        nextBillingDate: getDateTimestamp(nextBillingDateValue),
        trialEndsAt: getDateTimestamp(trialEndsAtValue),
        blockedAt: subscriptionStatus === "blocked" ? serverTimestamp() : null,
        updatedAt: serverTimestamp(),
      });
      writeAuditLog(batch, {
        restaurantId: restaurant.id,
        action: "saas_billing_updated",
        actorUid: user.uid,
        actorEmail: user.email,
        actorRole: "superadmin",
        entityType: "restaurant_billing",
        entityId: restaurant.id,
        description: "Superadmin guardo billing manual",
        changes: {
          before: {
            plan: restaurant.plan ?? "pro",
            subscriptionStatus: restaurant.subscriptionStatus ?? "trial",
            setupFeePaid: restaurant.setupFeePaid ?? false,
          },
          after: { plan, subscriptionStatus, setupFeePaid, monthlyPrice, setupPrice, billingDay },
        },
      });
      await batch.commit();

      const limitsResult = await enforcePlanLimits(restaurant.id, plan);

      if (setupFeePaid && restaurant.setupFeePaid !== true) {
        await createPaymentRecord(restaurant.id, {
          type: "setup",
          amount: setupPrice,
          plan,
          notes: "Setup inicial registrado desde guardado manual.",
        });
      }

      const limitMessage =
        limitsResult.disabledTables > 0 || limitsResult.disabledStaff > 0
          ? ` Se ajustaron límites: ${limitsResult.disabledTables} mesa(s) y ${limitsResult.disabledStaff} empleado(s) desactivado(s).`
          : "";

      onMessage?.(`Billing guardado correctamente.${limitMessage}`);
    } catch (error) {
      console.error("Error guardando billing:", error);
      onMessage?.("No se pudo guardar el billing.");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <section className="mb-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-zinc-950 text-white">
            <BadgeDollarSign size={20} />
          </div>

          <div>
            <h2 className="text-xl font-bold text-zinc-950">
              Control de pagos SaaS
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Administrá planes, mensualidades, trials, bloqueos e historial de
              pagos.
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={syncingOverdue}
          onClick={() => void handleSyncOverdueRestaurants()}
          className="flex h-11 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-sm font-bold text-zinc-900 transition hover:bg-zinc-50 disabled:opacity-60"
        >
          <RefreshCw
            size={16}
            className={syncingOverdue ? "animate-spin" : ""}
          />
          {syncingOverdue ? "Sincronizando..." : "Sincronizar vencidos"}
        </button>
      </div>

      <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <TrendingUp className="mb-3 text-zinc-950" size={22} />
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
            MRR activo
          </p>
          <p className="mt-1 text-2xl font-bold text-zinc-950">
            {formatPriceARS(metrics.mrr)}
          </p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <CheckCircle2 className="mb-3 text-emerald-600" size={22} />
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Activos
          </p>
          <p className="mt-1 text-2xl font-bold text-zinc-950">
            {metrics.active} / {metrics.total}
          </p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <AlertTriangle className="mb-3 text-amber-500" size={22} />
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Morosos / Bloqueados
          </p>
          <p className="mt-1 text-2xl font-bold text-zinc-950">
            {metrics.pastDue} / {metrics.blocked}
          </p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <Wallet className="mb-3 text-blue-600" size={22} />
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Setup pendiente
          </p>
          <p className="mt-1 text-2xl font-bold text-zinc-950">
            {formatPriceARS(metrics.setupPending)}
          </p>
        </div>
      </div>

      {sortedRestaurants.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-500">
          Todavía no hay restaurantes para administrar.
        </div>
      ) : (
        <div className="space-y-4">
          {sortedRestaurants.map((restaurant) => {
            const currentStatus = restaurant.subscriptionStatus || "trial";
            const effectiveStatus = getEffectiveStatus(restaurant);
            const currentPlan = restaurant.plan || "pro";
            const saving = savingId === restaurant.id;
            const hasCalculatedStatus = currentStatus !== effectiveStatus;
            const restaurantPayments = paymentsByRestaurant[restaurant.id] || [];
            const isPaymentsOpen = expandedPaymentsId === restaurant.id;

            return (
              <form
                key={`${restaurant.id}-${restaurant.subscriptionStatus}-${restaurant.setupFeePaid}-${restaurant.nextBillingDate?.toDate?.()?.getTime() || "no-date"}-${restaurant.trialEndsAt?.toDate?.()?.getTime() || "no-trial"}`}
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSaveManual(
                    restaurant,
                    new FormData(event.currentTarget)
                  );
                }}
                className={`rounded-xl border p-4 ${
                  effectiveStatus === "blocked"
                    ? "border-red-200 bg-red-50"
                    : effectiveStatus === "past_due"
                      ? "border-amber-200 bg-amber-50"
                      : "border-zinc-200 bg-zinc-50"
                }`}
              >
                <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-lg font-bold text-zinc-950">
                      {restaurant.name || restaurant.id}
                    </p>
                    <p className="mt-1 text-sm text-zinc-500">
                      ID: {restaurant.id}
                    </p>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-zinc-700 shadow-sm">
                        Plan: {getPlanLabel(currentPlan)}
                      </span>

                      <span
                        className={`rounded-full border px-3 py-1 text-xs font-bold shadow-sm ${getStatusStyle(
                          effectiveStatus
                        )}`}
                      >
                        Estado: {getStatusLabel(effectiveStatus)}
                      </span>

                      {hasCalculatedStatus && (
                        <span className="rounded-full border border-orange-200 bg-orange-100 px-3 py-1 text-xs font-bold text-orange-800 shadow-sm">
                          Pendiente sincronizar
                        </span>
                      )}

                      <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-zinc-700 shadow-sm">
                        Setup:{" "}
                        {restaurant.setupFeePaid ? "Pagado" : "Pendiente"}
                      </span>

                      <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-zinc-700 shadow-sm">
                        Vence: {formatShortDate(restaurant.nextBillingDate)}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() =>
                        void handleQuickStatus(restaurant.id, "active")
                      }
                      className="flex h-10 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white disabled:opacity-60"
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
                      className="flex h-10 items-center gap-2 rounded-lg bg-amber-500 px-4 text-sm font-semibold text-white disabled:opacity-60"
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
                      className="flex h-10 items-center gap-2 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      <Ban size={15} />
                      Bloquear
                    </button>

                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void handleMarkMonthlyPaid(restaurant)}
                      className="flex h-10 items-center gap-2 rounded-lg bg-zinc-950 px-4 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      <CreditCard size={15} />
                      Pago mensual
                    </button>

                    {!restaurant.setupFeePaid && (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void handleMarkSetupPaid(restaurant)}
                        className="flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-60"
                      >
                        <Wallet size={15} />
                        Setup pagado
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <label className="grid gap-1 text-xs font-bold text-zinc-600">
                    Plan
                    <select
                      name="plan"
                      defaultValue={currentPlan}
                      className="h-11 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-black/10"
                    >
                      {PLAN_OPTIONS.map((planOption) => (
                        <option key={planOption} value={planOption}>
                          {getPlanLabel(planOption)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="grid gap-1 text-xs font-bold text-zinc-600">
                    Estado
                    <select
                      name="subscriptionStatus"
                      defaultValue={currentStatus}
                      className="h-11 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-black/10"
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
                      className="h-11 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-black/10"
                    />
                  </label>

                  <label className="grid gap-1 text-xs font-bold text-zinc-600">
                    Setup inicial
                    <input
                      name="setupPrice"
                      type="number"
                      min={0}
                      defaultValue={restaurant.setupPrice || 0}
                      className="h-11 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-black/10"
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
                      className="h-11 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-black/10"
                    />
                  </label>

                  <label className="grid gap-1 text-xs font-bold text-zinc-600">
                    Próximo vencimiento
                    <input
                      name="nextBillingDate"
                      type="date"
                      defaultValue={formatDateInput(restaurant.nextBillingDate)}
                      className="h-11 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-black/10"
                    />
                  </label>

                  <label className="grid gap-1 text-xs font-bold text-zinc-600">
                    Fin de trial
                    <input
                      name="trialEndsAt"
                      type="date"
                      defaultValue={formatDateInput(restaurant.trialEndsAt)}
                      className="h-11 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-black/10"
                    />
                  </label>

                  <label className="flex h-11 items-center gap-2 self-end rounded-lg border border-zinc-200 bg-white px-3 text-sm font-bold text-zinc-700">
                    <input
                      key={`setup-${restaurant.id}-${
                        restaurant.setupFeePaid ? "paid" : "pending"
                      }`}
                      name="setupFeePaid"
                      type="checkbox"
                      defaultChecked={Boolean(restaurant.setupFeePaid)}
                      className="h-4 w-4 rounded border-zinc-300"
                    />
                    Setup pagado
                  </label>
                </div>

                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedPaymentsId((current) =>
                        current === restaurant.id ? null : restaurant.id
                      )
                    }
                    className="flex h-11 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-sm font-bold text-zinc-900 transition hover:bg-zinc-50"
                  >
                    <History size={16} />
                    Historial de pagos ({restaurantPayments.length})
                    {isPaymentsOpen ? (
                      <ChevronUp size={16} />
                    ) : (
                      <ChevronDown size={16} />
                    )}
                  </button>

                  <button
                    type="submit"
                    disabled={saving}
                    className="flex h-11 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-5 font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
                  >
                    <Save size={16} />
                    {saving ? "Guardando..." : "Guardar billing"}
                  </button>
                </div>

                {isPaymentsOpen && (
                  <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-3">
                    {restaurantPayments.length === 0 ? (
                      <p className="text-sm font-medium text-zinc-500">
                        Todavía no hay pagos registrados.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {restaurantPayments.slice(0, 8).map((payment) => (
                          <div
                            key={payment.id}
                            className="flex flex-col gap-1 rounded-lg bg-zinc-50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div>
                              <p className="text-sm font-bold text-zinc-950">
                                {getPaymentTypeLabel(payment.type)} ·{" "}
                                {formatPriceARS(Number(payment.amount || 0))}
                              </p>
                              <p className="mt-0.5 text-xs text-zinc-500">
                                {formatShortDate(payment.paidAt)} · Plan{" "}
                                {getPlanLabel(payment.plan)}
                              </p>
                              {payment.notes && (
                                <p className="mt-1 text-xs text-zinc-400">
                                  {payment.notes}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </form>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default SuperAdminBillingPanel;
