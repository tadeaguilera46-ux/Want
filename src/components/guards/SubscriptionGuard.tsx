import { ReactNode, useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";

import { getDb } from "@/lib/firebase";
import { useRestaurant } from "@/lib/restaurant-context";

const db = getDb();

type Props = {
  children: ReactNode;
};

type SubscriptionStatus = "trial" | "active" | "past_due" | "blocked";

type RestaurantData = {
  subscriptionStatus?: SubscriptionStatus;
  nextBillingDate?: {
    toDate?: () => Date;
  };
  trialEndsAt?: {
    toDate?: () => Date;
  };
};

const SubscriptionGuard = ({ children }: Props) => {
  const [searchParams] = useSearchParams();
  const { restaurantId: contextRestaurantId } = useRestaurant();

  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);

  // URL param takes priority; fall back to context (which itself falls back to localStorage).
  // Only truly absent when neither URL nor any prior navigation provided an ID.
  const restaurantId =
    searchParams.get("restaurantId") || contextRestaurantId || "";

  useEffect(() => {
    if (!restaurantId) {
      // Defer one event-loop tick so RestaurantContext's useEffect has a chance
      // to resolve contextRestaurantId from localStorage before we decide to
      // pass through. If restaurantId is still empty after the tick, there is
      // truly no restaurant available and StaffRoute handles the missing-restaurant UI.
      const timer = setTimeout(() => {
        setAllowed(true);
        setLoading(false);
      }, 0);
      return () => clearTimeout(timer);
    }

    setLoading(true);

    const restaurantRef = doc(db, "restaurants", restaurantId);

    const unsubscribe = onSnapshot(
      restaurantRef,
      (restaurantSnap) => {
        if (!restaurantSnap.exists()) {
          setAllowed(false);
          setLoading(false);
          return;
        }

        const data = restaurantSnap.data() as RestaurantData;
        const status = data.subscriptionStatus || "trial";
        const now = new Date();

        if (status === "blocked") {
          setAllowed(false);
          setLoading(false);
          return;
        }

        if (status === "trial") {
          const trialEndsAt = data.trialEndsAt?.toDate?.();

          if (trialEndsAt && trialEndsAt < now) {
            setAllowed(false);
            setLoading(false);
            return;
          }

          setAllowed(true);
          setLoading(false);
          return;
        }

        if (status === "active") {
          const nextBillingDate = data.nextBillingDate?.toDate?.();

          if (nextBillingDate && nextBillingDate < now) {
            setAllowed(false);
            setLoading(false);
            return;
          }

          setAllowed(true);
          setLoading(false);
          return;
        }

        if (status === "past_due") {
          setAllowed(true);
          setLoading(false);
          return;
        }

        setAllowed(false);
        setLoading(false);
      },
      (error) => {
        console.error("Subscription guard error:", error);
        setAllowed(false);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [restaurantId]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f6f4ef]">
        <p className="text-sm font-semibold text-zinc-500">
          Verificando suscripción...
        </p>
      </div>
    );
  }

  if (!allowed) {
    return (
      <Navigate
        to={`/payment-required?restaurantId=${restaurantId}`}
        replace
      />
    );
  }

  return <>{children}</>;
};

export default SubscriptionGuard;