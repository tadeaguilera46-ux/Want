import type { Location } from "react-router-dom";

type NavigationState = {
  table?: string | number;
  restaurantId?: string;
} | null | undefined;

export type RuntimeContext = {
  restaurantId: string;
  table: string;
};

export type RestaurantRuntimeContext = {
  restaurantId: string;
};

const normalizeTable = (value: unknown): string | null => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return String(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const parsed = Number(trimmed);
    if (Number.isFinite(parsed) && parsed > 0) {
      return String(parsed);
    }
  }

  return null;
};

const normalizeRestaurantId = (value: unknown): string | null => {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const parseTableNumber = (table: string): number => {
  const parsed = Number(table);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Mesa inválida: "${table}"`);
  }

  return parsed;
};

export const resolveRestaurantContext = ({
  searchParams,
  location,
}: {
  searchParams: URLSearchParams;
  location: Location;
}): RestaurantRuntimeContext => {
  const state = location.state as NavigationState;

  const restaurantId =
    normalizeRestaurantId(searchParams.get("restaurantId")) ||
    normalizeRestaurantId(state?.restaurantId);

  if (!restaurantId) {
    throw new Error("Falta restaurantId en la navegación");
  }

  return { restaurantId };
};

export const resolveRuntimeContext = ({
  searchParams,
  location,
}: {
  searchParams: URLSearchParams;
  location: Location;
}): RuntimeContext => {
  const state = location.state as NavigationState;

  const restaurantId =
    normalizeRestaurantId(searchParams.get("restaurantId")) ||
    normalizeRestaurantId(state?.restaurantId);

  const table =
    normalizeTable(searchParams.get("table")) ||
    normalizeTable(state?.table);

  if (!restaurantId) {
    throw new Error("Falta restaurantId en la navegación");
  }

  if (!table) {
    throw new Error("Falta table en la navegación");
  }

  return {
    restaurantId,
    table,
  };
};

export const buildClientRoute = ({
  path,
  restaurantId,
  table,
}: {
  path: string;
  restaurantId: string;
  table?: string | number;
}) => {
  const normalizedRestaurantId = normalizeRestaurantId(restaurantId);
  if (!normalizedRestaurantId) {
    throw new Error("restaurantId inválido para navegación");
  }

  const params = new URLSearchParams();
  params.set("restaurantId", normalizedRestaurantId);

  if (table !== undefined && table !== null) {
    const normalizedTable = normalizeTable(table);
    if (!normalizedTable) {
      throw new Error("table inválida para navegación");
    }
    params.set("table", normalizedTable);
  }

  return `${path}?${params.toString()}`;
};

export const buildClientNavState = ({
  restaurantId,
  table,
}: {
  restaurantId: string;
  table?: string | number;
}) => {
  const normalizedRestaurantId = normalizeRestaurantId(restaurantId);
  if (!normalizedRestaurantId) {
    throw new Error("restaurantId inválido para navegación");
  }

  const normalizedTable =
    table !== undefined && table !== null ? normalizeTable(table) : undefined;

  if (table !== undefined && table !== null && !normalizedTable) {
    throw new Error("table inválida para navegación");
  }

  return {
    restaurantId: normalizedRestaurantId,
    ...(normalizedTable ? { table: normalizedTable } : {}),
  };
};