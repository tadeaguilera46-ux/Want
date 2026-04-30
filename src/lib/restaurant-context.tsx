import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useSearchParams } from "react-router-dom";

type RestaurantContextValue = {
  restaurantId: string | null;
  setRestaurantId: (restaurantId: string) => void;
  clearRestaurantId: () => void;
};

const STORAGE_KEY = "want:activeRestaurantId";

const RestaurantContext = createContext<RestaurantContextValue | undefined>(
  undefined
);

const normalizeRestaurantId = (value: unknown): string | null => {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const RestaurantProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [searchParams] = useSearchParams();
  const location = useLocation();

  const [restaurantId, setRestaurantIdState] = useState<string | null>(null);

  useEffect(() => {
    const restaurantIdFromQuery = normalizeRestaurantId(
      searchParams.get("restaurantId")
    );

    const restaurantIdFromState = normalizeRestaurantId(
      (location.state as { restaurantId?: string } | null)?.restaurantId
    );

    const restaurantIdFromStorage = normalizeRestaurantId(
      window.localStorage.getItem(STORAGE_KEY)
    );

    const resolvedRestaurantId =
      restaurantIdFromQuery ||
      restaurantIdFromState ||
      restaurantIdFromStorage ||
      null;

    if (resolvedRestaurantId) {
      setRestaurantIdState(resolvedRestaurantId);
      window.localStorage.setItem(STORAGE_KEY, resolvedRestaurantId);
      return;
    }

    setRestaurantIdState(null);
  }, [searchParams, location.state]);

  const setRestaurantId = useCallback((nextRestaurantId: string) => {
    const normalized = normalizeRestaurantId(nextRestaurantId);

    if (!normalized) {
      throw new Error("restaurantId inválido");
    }

    setRestaurantIdState(normalized);
    window.localStorage.setItem(STORAGE_KEY, normalized);
  }, []);

  const clearRestaurantId = useCallback(() => {
    setRestaurantIdState(null);
    window.localStorage.removeItem(STORAGE_KEY);
  }, []);

  const value = useMemo(
    () => ({
      restaurantId,
      setRestaurantId,
      clearRestaurantId,
    }),
    [restaurantId, setRestaurantId, clearRestaurantId]
  );

  return (
    <RestaurantContext.Provider value={value}>
      {children}
    </RestaurantContext.Provider>
  );
};

export const useRestaurant = () => {
  const context = useContext(RestaurantContext);

  if (!context) {
    throw new Error("useRestaurant debe usarse dentro de RestaurantProvider");
  }

  return context;
};