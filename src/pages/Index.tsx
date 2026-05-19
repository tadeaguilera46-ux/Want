import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Smartphone, LockKeyhole } from "lucide-react";
import logo from "@/assets/logo-want.webp";
import { useRestaurant } from "../lib/restaurant-context";
import { toast } from "sonner";

const normalizeString = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const Index = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { restaurantId: activeRestaurantId, setRestaurantId } = useRestaurant();

  const restaurantId =
    normalizeString(searchParams.get("restaurantId")) ||
    normalizeString(activeRestaurantId);

  const table = normalizeString(searchParams.get("table"));

  const buildState = () => ({
    ...(table ? { table } : {}),
    ...(restaurantId ? { restaurantId } : {}),
    ...(location.state && typeof location.state === "object"
      ? (location.state as Record<string, unknown>)
      : {}),
  });

  const handleCustomer = () => {
    if (!restaurantId || !table) {
      toast.error("El acceso de cliente solo está disponible desde el QR de una mesa.");
      return;
    }

    setRestaurantId(restaurantId);

    navigate(
      `/welcome?restaurantId=${encodeURIComponent(
        restaurantId
      )}&table=${encodeURIComponent(table)}`,
      { state: buildState() }
    );
  };

  const handleStaffLogin = () => {
    if (restaurantId) {
      setRestaurantId(restaurantId);
    }

    const query = new URLSearchParams();

    if (restaurantId) {
      query.set("restaurantId", restaurantId);
    }

    const queryString = query.toString();

    navigate(queryString ? `/staff/login?${queryString}` : "/staff/login", {
      state: buildState(),
    });
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center w-full max-w-sm"
      >
        <img src={logo} alt="WANT" className="w-40 h-auto mb-2" />
        <p className="text-sm text-muted-foreground mb-10 font-display">
          Acceso al restaurante
        </p>

        <div className="w-full space-y-3">
          <motion.button
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            whileTap={{ scale: 0.97 }}
            onClick={handleCustomer}
            className="w-full flex items-center gap-4 bg-card rounded-lg shadow-card p-4 text-left hover:shadow-want transition-shadow"
          >
            <div className="w-12 h-12 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
              <Smartphone size={22} />
            </div>

            <div>
              <p className="font-display font-bold">Cliente</p>
              <p className="text-xs text-muted-foreground">
                Solo desde QR de mesa
              </p>
            </div>
          </motion.button>

          <motion.button
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 }}
            whileTap={{ scale: 0.97 }}
            onClick={handleStaffLogin}
            className="w-full flex items-center gap-4 bg-card rounded-lg shadow-card p-4 text-left hover:shadow-want transition-shadow"
          >
            <div className="w-12 h-12 rounded-lg bg-accent text-primary-foreground flex items-center justify-center">
              <LockKeyhole size={22} />
            </div>

            <div>
              <p className="font-display font-bold">Staff</p>
              <p className="text-xs text-muted-foreground">
                Cocina, barra, runner o admin
              </p>
            </div>
          </motion.button>
        </div>
      </motion.div>
    </div>
  );
};

export default Index;