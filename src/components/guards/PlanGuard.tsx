import { type ReactNode } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useRestaurant } from "@/lib/restaurant-context";
import { canUseFeature, type PlanFeature } from "@/lib/plan";

type Props = {
  feature: PlanFeature;
  children: ReactNode;
};

const PlanGuard = ({ feature, children }: Props) => {
  const [searchParams] = useSearchParams();
  const {
    restaurant,
    restaurantLoading,
    restaurantId: contextRestaurantId,
  } = useRestaurant();

  const restaurantId =
    searchParams.get("restaurantId") || contextRestaurantId || "";

  if (restaurantLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-100">
        <p className="text-sm font-semibold text-zinc-500">
          Verificando plan...
        </p>
      </div>
    );
  }

  const plan = restaurant?.plan ?? null;

  if (!canUseFeature(plan, feature)) {
    return (
      <Navigate
        to={`/payment-required?restaurantId=${restaurantId}`}
        replace
      />
    );
  }

  return <>{children}</>;
};

export default PlanGuard;
