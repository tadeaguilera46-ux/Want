export type RestaurantPlan = "starter" | "pro" | "premium";

export type PlanFeature =
  | "analytics"
  | "stock"
  | "branding"
  | "auditLogs"
  | "invoices"
  | "advancedStaff";

export type PlanLimits = {
  maxTables: number | null;
  maxStaff: number | null;
  analytics: boolean;
  stock: boolean;
  branding: boolean;
  auditLogs: boolean;
  invoices: boolean;
  advancedStaff: boolean;
};

export const PLAN_LIMITS: Record<RestaurantPlan, PlanLimits> = {
  starter: {
    maxTables: 15,
    maxStaff: 7,
    analytics: false,
    stock: false,
    branding: true,
    auditLogs: false,
    invoices: false,
    advancedStaff: false,
  },
  pro: {
    maxTables: 20,
    maxStaff: 10,
    analytics: true,
    stock: false,
    branding: true,
    auditLogs: true,
    invoices: true,
    advancedStaff: true,
  },
  premium: {
    maxTables: null,
    maxStaff: null,
    analytics: true,
    stock: true,
    branding: true,
    auditLogs: true,
    invoices: true,
    advancedStaff: true,
  },
};

export const PLAN_LABELS: Record<RestaurantPlan, string> = {
  starter: "Starter",
  pro: "Pro",
  premium: "Premium",
};

export const FEATURE_LABELS: Record<PlanFeature, string> = {
  analytics: "Analytics",
  stock: "Stock avanzado",
  branding: "Branding personalizado",
  auditLogs: "Auditoría",
  invoices: "Facturación",
  advancedStaff: "Gestión avanzada de empleados",
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

export const canUseFeature = (
  plan: string | null | undefined,
  feature: PlanFeature
) => {
  return getPlanLimits(plan)[feature] === true;
};

export const canUseAnalytics = (plan?: string | null) => {
  return canUseFeature(plan, "analytics");
};

export const canUseStock = (plan?: string | null) => {
  return canUseFeature(plan, "stock");
};

export const canUseBranding = (plan?: string | null) => {
  return canUseFeature(plan, "branding");
};

export const canUseAuditLogs = (plan?: string | null) => {
  return canUseFeature(plan, "auditLogs");
};

export const canUseInvoices = (plan?: string | null) => {
  return canUseFeature(plan, "invoices");
};

export const canUseAdvancedStaff = (plan?: string | null) => {
  return canUseFeature(plan, "advancedStaff");
};

export const canCreateTable = (
  plan: string | null | undefined,
  currentTables: number
) => {
  const limit = getPlanLimits(plan).maxTables;

  if (limit === null) return true;

  return currentTables < limit;
};

export const canCreateStaff = (
  plan: string | null | undefined,
  currentStaff: number
) => {
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

export const getRequiredPlanForFeature = (
  feature: PlanFeature
): RestaurantPlan => {
  if (feature === "stock") return "premium";
  if (
    feature === "analytics" ||
    feature === "auditLogs" ||
    feature === "invoices" ||
    feature === "advancedStaff"
  ) {
    return "pro";
  }

  return "starter";
};