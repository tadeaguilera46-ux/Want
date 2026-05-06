import { ReactNode, useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";

import { getDb } from "@/lib/firebase";

const db = getDb();

type Props = {
  children: ReactNode;
};

type SubscriptionStatus =
  | "trial"
  | "active"
  | "past_due"
  | "blocked";

type RestaurantData = {
  subscriptionStatus?: SubscriptionStatus;
  nextBillingDate?: any;
  trialEndsAt?: any;
};

const SubscriptionGuard = ({ children }: Props) => {
  const [searchParams] = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);

  const restaurantId =
    searchParams.get("restaurantId") || "mi-restaurante";

  useEffect(() => {
    const validateSubscription = async () => {
      try {
        const restaurantRef = doc(db, "restaurants", restaurantId);

        const restaurantSnap = await getDoc(restaurantRef);

        if (!restaurantSnap.exists()) {
          setAllowed(false);
          setLoading(false);
          return;
        }

        const data = restaurantSnap.data() as RestaurantData;

        const status = data.subscriptionStatus || "trial";

        // 🔒 Bloqueado manualmente
        if (status === "blocked") {
          setAllowed(false);
          setLoading(false);
          return;
        }

        const now = new Date();

        // 🧪 Trial
        if (status === "trial") {
          if (data.trialEndsAt?.toDate) {
            const trialEndsAt = data.trialEndsAt.toDate();

            if (trialEndsAt < now) {
              setAllowed(false);
              setLoading(false);
              return;
            }
          }

          setAllowed(true);
          setLoading(false);
          return;
        }

        // 💳 Suscripción activa
        if (status === "active") {
          if (data.nextBillingDate?.toDate) {
            const nextBillingDate = data.nextBillingDate.toDate();

            // venció
            if (nextBillingDate < now) {
              setAllowed(false);
              setLoading(false);
              return;
            }
          }

          setAllowed(true);
          setLoading(false);
          return;
        }

        // ⚠️ Moroso
        if (status === "past_due") {
          setAllowed(true);
          setLoading(false);
          return;
        }

        setAllowed(false);
        setLoading(false);
      } catch (error) {
        console.error("Subscription guard error:", error);

        setAllowed(false);
        setLoading(false);
      }
    };

    void validateSubscription();
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