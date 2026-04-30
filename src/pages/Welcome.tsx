import { useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import logo from "@/assets/logo-want.webp";
import { TOTAL_MESAS } from "../lib/config";
import {
  buildClientNavState,
  buildClientRoute,
} from "../lib/runtime-context";

const isMesaValida = (value: string) => {
  const mesa = Number(value);

  if (!value || Number.isNaN(mesa)) return false;
  if (!Number.isInteger(mesa)) return false;
  if (mesa < 1 || mesa > TOTAL_MESAS) return false;

  return true;
};

type WelcomeLocationState = {
  restaurantId?: string;
  table?: string | number;
} | null;

const normalizeRestaurantId = (value: unknown): string | null => {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const Welcome = () => {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  const locationState = location.state as WelcomeLocationState;

  const restaurantId = useMemo(() => {
    return (
      normalizeRestaurantId(searchParams.get("restaurantId")) ||
      normalizeRestaurantId(locationState?.restaurantId) ||
      ""
    );
  }, [searchParams, locationState]);

  const initialTable = useMemo(() => {
    const queryTable = searchParams.get("table");
    return queryTable && isMesaValida(queryTable) ? String(Number(queryTable)) : "";
  }, [searchParams]);

  const [table, setTable] = useState(initialTable);
  const [error, setError] = useState("");

  useEffect(() => {
    const qrTable = searchParams.get("table");

    if (!restaurantId || !qrTable) return;
    if (!isMesaValida(qrTable)) return;

    const mesa = Number(qrTable);

    navigate(
      buildClientRoute({
        path: "/menu",
        restaurantId,
        table: mesa,
      }),
      {
        replace: true,
        state: buildClientNavState({
          restaurantId,
          table: mesa,
        }),
      }
    );
  }, [searchParams, navigate, restaurantId]);

  const handleStart = () => {
    if (!restaurantId) {
      setError("Falta restaurantId en la navegación");
      return;
    }

    if (!isMesaValida(table)) {
      if (!table) {
        setError("Ingresá un número de mesa válido");
        return;
      }

      const mesa = Number(table);

      if (Number.isNaN(mesa)) {
        setError("Ingresá un número de mesa válido");
        return;
      }

      if (!Number.isInteger(mesa)) {
        setError("Ingresá un número de mesa entero");
        return;
      }

      setError(`La mesa no existe. Ingresá una mesa entre 1 y ${TOTAL_MESAS}`);
      return;
    }

    const mesa = Number(table);

    setError("");

    navigate(
      buildClientRoute({
        path: "/menu",
        restaurantId,
        table: mesa,
      }),
      {
        state: buildClientNavState({
          restaurantId,
          table: mesa,
        }),
      }
    );
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="flex flex-col items-center w-full max-w-sm"
      >
        <img src={logo} alt="WANT" className="w-96 h-auto mb-4" />

        <p className="text-lg text-muted-foreground mb-10 font-display">
          Welcome
        </p>

        <div className="w-full space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">
              Table Number
            </label>

            <input
              type="number"
              min={1}
              max={TOTAL_MESAS}
              step={1}
              value={table}
              onChange={(e) => {
                setTable(e.target.value);
                if (error) setError("");
              }}
              placeholder="Enter your table number"
              className="w-full h-14 rounded-lg bg-card shadow-card border border-border px-4 text-lg font-display text-center focus:outline-none focus:ring-2 focus:ring-primary transition-all"
            />

            {error && (
              <p className="text-sm text-red-500 text-center">{error}</p>
            )}
          </div>

          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={handleStart}
            disabled={!table || !restaurantId}
            className="w-full h-14 rounded-lg bg-primary text-primary-foreground font-display font-bold text-lg shadow-want disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:brightness-105 active:brightness-95"
          >
            Start ordering
          </motion.button>
        </div>

        <p className="text-xs text-muted-foreground mt-8">
          Pide. Disfruta. Repite.
        </p>
      </motion.div>
    </div>
  );
};

export default Welcome;