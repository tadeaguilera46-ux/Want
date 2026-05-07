export type RestaurantPlan = "starter" | "pro" | "premium";

export type PlanFeature = "analytics" | "stock";

export type PlanLimits = {
  maxTables: number | null;
  maxStaff: number | null;
  analytics: boolean;
  stock: boolean;
};

export const PLAN_LIMITS: Record<RestaurantPlan, PlanLimits> = {
  starter: {
    maxTables: 15,
    maxStaff: 7,
    analytics: false,
    stock: false,
  },
  pro: {
    maxTables: 20,
    maxStaff: 10,
    analytics: true,
    stock: false,
  },
  premium: {
    maxTables: null,
    maxStaff: null,
    analytics: true,
    stock: true,
  },
};

export const PLAN_LABELS: Record<RestaurantPlan, string> = {
  starter: "Starter",
  pro: "Pro",
  premium: "Premium",
};

export const normalizePlan = (plan?: string | null): RestaurantPlan => {
  if (plan === "starter" || plan === "pro" || plan === "premium") {
    return plan;
  }

  return "starter";
};

export const getPlanLimits = (plan?: string | null) => {
  return PLAN_LIMITS[normalizePlan(plan)];
};

export const canUseAnalytics = (plan?: string | null) => {
  return getPlanLimits(plan).analytics;
};

export const canUseStock = (plan?: string | null) => {
  return getPlanLimits(plan).stock;
};

export const canCreateTable = (plan: string | null | undefined, currentTables: number) => {
  const limit = getPlanLimits(plan).maxTables;

  if (limit === null) return true;

  return currentTables < limit;
};

export const canCreateStaff = (plan: string | null | undefined, currentStaff: number) => {
  const limit = getPlanLimits(plan).maxStaff;

  if (limit === null) return true;

  return currentStaff < limit;
};

export const getTableLimitLabel = (plan?: string | null) => {
  const limit = getPlanLimits(plan).maxTables;
  return limit === null ? "Ilimitadas" : String(limit);
};

export const getStaffLimitLabel = (plan?: string | null) => {
  const limit = getPlanLimits(plan).maxStaff;
  return limit === null ? "Ilimitados" : String(limit);
};