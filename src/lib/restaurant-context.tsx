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
import { doc, onSnapshot } from "firebase/firestore";
import { getDb } from "./firebase";
import { normalizePlan, type RestaurantPlan } from "./plan";

type FirestoreTimestamp = {
  toDate: () => Date;
};

type RestaurantContextRestaurant = {
  id: string;
  name?: string;
  plan: RestaurantPlan;
  subscriptionStatus?: string;
  active?: boolean;
  nextBillingDate?: FirestoreTimestamp | null;
  trialEndsAt?: FirestoreTimestamp | null;
  monthlyPrice?: number;
  mpSubscriptionId?: string | null;
};

type RestaurantContextValue = {
  restaurantId: string | null;
  restaurant: RestaurantContextRestaurant | null;
  restaurantLoading: boolean;
  setRestaurantId: (restaurantId: string) => void;
  clearRestaurantId: () => void;
};

const STORAGE_KEY = "want:activeRestaurantId";

const db = getDb();

const RestaurantContext = createContext<RestaurantContextValue | undefined>(
  undefined
);

const normalizeRestaurantId = (value: unknown): string | null => {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const RestaurantProvider = ({ children }: { children: ReactNode }) => {
  const [searchParams] = useSearchParams();
  const location = useLocation();

  const [restaurantId, setRestaurantIdState] = useState<string | null>(null);
  const [restaurant, setRestaurant] =
    useState<RestaurantContextRestaurant | null>(null);
  const [restaurantLoading, setRestaurantLoading] = useState(false);

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

  useEffect(() => {
    if (!restaurantId) {
      setRestaurant(null);
      setRestaurantLoading(false);
      return;
    }

    setRestaurantLoading(true);

    const unsub = onSnapshot(
      doc(db, "restaurants", restaurantId),
      (snapshot) => {
        if (!snapshot.exists()) {
          setRestaurant(null);
          setRestaurantLoading(false);
          return;
        }

        const data = snapshot.data();

        const isTimestamp = (val: unknown): val is FirestoreTimestamp =>
          typeof (val as { toDate?: unknown } | null)?.toDate === "function";

        setRestaurant({
          id: snapshot.id,
          name: typeof data.name === "string" ? data.name : undefined,
          plan: normalizePlan(
            typeof data.plan === "string" ? data.plan : null
          ),
          subscriptionStatus:
            typeof data.subscriptionStatus === "string"
              ? data.subscriptionStatus
              : undefined,
          active: typeof data.active === "boolean" ? data.active : undefined,
          nextBillingDate: isTimestamp(data.nextBillingDate)
            ? data.nextBillingDate
            : null,
          trialEndsAt: isTimestamp(data.trialEndsAt)
            ? data.trialEndsAt
            : null,
          monthlyPrice:
            typeof data.monthlyPrice === "number"
              ? data.monthlyPrice
              : undefined,
          mpSubscriptionId:
            typeof data.mpSubscriptionId === "string"
              ? data.mpSubscriptionId
              : null,
        });

        setRestaurantLoading(false);
      },
      (error) => {
        console.error("Error escuchando restaurante:", error);
        setRestaurant(null);
        setRestaurantLoading(false);
      }
    );

    return () => unsub();
  }, [restaurantId]);

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
    setRestaurant(null);
    window.localStorage.removeItem(STORAGE_KEY);
  }, []);

  const value = useMemo(
    () => ({
      restaurantId,
      restaurant,
      restaurantLoading,
      setRestaurantId,
      clearRestaurantId,
    }),
    [
      restaurantId,
      restaurant,
      restaurantLoading,
      setRestaurantId,
      clearRestaurantId,
    ]
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