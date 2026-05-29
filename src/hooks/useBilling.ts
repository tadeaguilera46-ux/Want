import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getApp } from "firebase/app";
import { toast } from "sonner";
import { getDb } from "../lib/firebase";
import type { RestaurantPlan } from "../lib/plan";

// Mercado Pago plan IDs — must match created plans in MP dashboard
export const MP_PLAN_IDS: Record<RestaurantPlan, string> = {
  starter: "fe438d142dab44648be3a09064c905ac",
  pro: "4aa52e5168ef49ac8bad3657378430aa",
  premium: "76d2a6a94b2843bf981e4cfd995a800b",
};

export type PaymentRecord = {
  id: string;
  type?: "monthly" | "setup" | string;
  amount?: number;
  plan?: RestaurantPlan;
  notes?: string;
  paidAt?: { toDate?: () => Date };
  createdAt?: { toDate?: () => Date };
};

const db = getDb();

export function useBilling(restaurantId: string | null) {
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(true);
  const [subscribing, setSubscribing] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (!restaurantId) {
      setPayments([]);
      setPaymentsLoading(false);
      return;
    }

    setPaymentsLoading(true);

    const q = query(
      collection(db, "restaurants", restaurantId, "payments"),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        setPayments(
          snap.docs.map((d) => ({ id: d.id, ...d.data() })) as PaymentRecord[]
        );
        setPaymentsLoading(false);
      },
      () => {
        setPaymentsLoading(false);
      }
    );

    return () => unsub();
  }, [restaurantId]);

  const subscribeToPlan = async (plan: RestaurantPlan) => {
    if (!restaurantId) return;

    try {
      setSubscribing(true);
      // Assumes createSubscription is deployed as an onCall function.
      // If it's an onRequest function, replace with fetch() to the function URL.
      const fns = getFunctions(getApp(), "us-central1");
      const createSubscription = httpsCallable<
        { restaurantId: string; planId: string },
        { init_point: string }
      >(fns, "createSubscription");

      const { data } = await createSubscription({
        restaurantId,
        planId: MP_PLAN_IDS[plan],
      });

      if (data.init_point) {
        window.location.href = data.init_point;
      }
    } catch (error) {
      console.error("Error iniciando suscripción:", error);
      toast.error("No se pudo iniciar el pago. Intentá nuevamente.");
      setSubscribing(false);
    }
  };

  const cancelCurrentSubscription = async () => {
    if (!restaurantId) return;

    try {
      setCancelling(true);
      const fns = getFunctions(getApp(), "us-central1");
      const cancel = httpsCallable(fns, "cancelSubscription");
      await cancel({ restaurantId });
      toast.success("Suscripción cancelada correctamente.");
    } catch (error) {
      console.error("Error cancelando suscripción:", error);
      toast.error("No se pudo cancelar. Contactá soporte.");
    } finally {
      setCancelling(false);
    }
  };

  return {
    payments,
    paymentsLoading,
    subscribing,
    cancelling,
    subscribeToPlan,
    cancelCurrentSubscription,
  };
}
