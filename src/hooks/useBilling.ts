import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getAuth } from "firebase/auth";
import { getApp } from "firebase/app";
import { toast } from "sonner";
import { getDb } from "../lib/firebase";
import type { RestaurantPlan } from "../lib/plan";

export type PaymentRecord = {
  id: string;
  type?: string;
  plan?: RestaurantPlan;
  billingStatus?: string;
  subscriptionId?: string;
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
      collection(db, "restaurants", restaurantId, "billingEvents"),
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
      const auth = getAuth();
      const payerEmail = auth.currentUser?.email ?? "";

      const fns = getFunctions(getApp(), "us-central1");
      const createSubscription = httpsCallable<
        { restaurantId: string; plan: RestaurantPlan; payerEmail: string },
        { subscriptionId: string; initPoint: string }
      >(fns, "createSubscription");

      const { data } = await createSubscription({
        restaurantId,
        plan,
        payerEmail,
      });

      if (data.initPoint) {
        window.location.href = data.initPoint;
      }
    } catch (error: unknown) {
      console.error("Error iniciando suscripción:", error);
      const code = (error as { code?: string })?.code;
      if (code === "functions/already-exists") {
        toast.error("Ya hay un proceso de pago en curso. Esperá unos minutos antes de intentar de nuevo.");
      } else {
        toast.error("No se pudo iniciar el pago. Intentá nuevamente.");
      }
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
