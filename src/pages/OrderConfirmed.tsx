import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { CheckCircle } from "lucide-react";
import CustomerOrderStatus from "../components/menu/CustomerOrderStatus";
import {
  parseTableNumber,
  resolveRuntimeContext,
} from "../lib/runtime-context";

const OrderConfirmed = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const { table, restaurantId } = resolveRuntimeContext({
    searchParams,
    location,
  });

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 text-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="mx-auto w-full max-w-lg"
      >
        <div className="flex justify-center mb-6">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-green-100">
            <CheckCircle size={40} className="text-green-600" />
          </div>
        </div>

        <h1 className="text-2xl font-display font-bold">
          Pedido enviado
        </h1>

        <p className="mt-2 text-sm text-muted-foreground">
          Tu pedido fue enviado a cocina/barra correctamente.
        </p>

        <p className="mt-1 text-xs text-muted-foreground">
          Mesa {table}
        </p>

        <div className="mt-6">
          <CustomerOrderStatus
            restaurantId={restaurantId}
            table={parseTableNumber(table)}
          />
        </div>

        <div className="mt-6 space-y-3">
          <button
            onClick={() =>
              navigate(`/menu?restaurantId=${restaurantId}&table=${table}`, {
                state: { table, restaurantId },
              })
            }
            className="h-12 w-full rounded-xl bg-primary text-primary-foreground font-bold shadow-want"
          >
            Volver al menú
          </button>

          <button
            onClick={() =>
              navigate(`/bill?restaurantId=${restaurantId}&table=${table}`, {
                state: { table, restaurantId },
              })
            }
            className="h-11 w-full rounded-xl border bg-white font-semibold text-accent"
          >
            Pedir cuenta
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default OrderConfirmed;
