import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { getDb } from "./firebase";

const db = getDb();

export type RestaurantConfig = {
  id: string;
  name: string;
  logoUrl: string;
  coverUrl: string;
  primaryColor: string;
  secondaryColor: string;
  welcomeMessage: string;
  active: boolean;
};

export const DEFAULT_RESTAURANT_CONFIG: RestaurantConfig = {
  id: "",
  name: "Want",
  logoUrl: "",
  coverUrl: "",
  primaryColor: "#000000",
  secondaryColor: "#FFFFFF",
  welcomeMessage: "Bienvenidos",
  active: true,
};

const normalizeColor = (value: unknown, fallback: string) => {
  if (typeof value !== "string") return fallback;

  const color = value.trim();

  if (/^#[0-9A-Fa-f]{6}$/.test(color)) {
    return color;
  }

  return fallback;
};

const normalizeString = (value: unknown, fallback: string) => {
  if (typeof value !== "string") return fallback;

  const text = value.trim();

  return text || fallback;
};

export const mapRestaurantConfig = (
  restaurantId: string,
  data?: Record<string, unknown>
): RestaurantConfig => {
  return {
    id: restaurantId,
    name: normalizeString(data?.name, DEFAULT_RESTAURANT_CONFIG.name),
    logoUrl: normalizeString(data?.logoUrl, ""),
    coverUrl: normalizeString(data?.coverUrl, ""),
    primaryColor: normalizeColor(
      data?.primaryColor,
      DEFAULT_RESTAURANT_CONFIG.primaryColor
    ),
    secondaryColor: normalizeColor(
      data?.secondaryColor,
      DEFAULT_RESTAURANT_CONFIG.secondaryColor
    ),
    welcomeMessage: normalizeString(
      data?.welcomeMessage,
      DEFAULT_RESTAURANT_CONFIG.welcomeMessage
    ),
    active: data?.active !== false,
  };
};

export const useRestaurantConfig = (restaurantId?: string | null) => {
  const [config, setConfig] = useState<RestaurantConfig>({
    ...DEFAULT_RESTAURANT_CONFIG,
    id: restaurantId || "",
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!restaurantId) {
      setConfig(DEFAULT_RESTAURANT_CONFIG);
      setLoading(false);
      setError("Falta restaurantId");
      return;
    }

    setLoading(true);
    setError(null);

    const ref = doc(db, "restaurants", restaurantId);

    const unsubscribe = onSnapshot(
      ref,
      (snapshot) => {
        if (!snapshot.exists()) {
          setConfig({
            ...DEFAULT_RESTAURANT_CONFIG,
            id: restaurantId,
          });
          setError("Restaurante no encontrado");
          setLoading(false);
          return;
        }

        setConfig(
          mapRestaurantConfig(
            restaurantId,
            snapshot.data() as Record<string, unknown>
          )
        );
        setLoading(false);
      },
      (err) => {
        console.error("Error cargando branding del restaurante:", err);
        setError("No se pudo cargar el branding del restaurante");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [restaurantId]);

  return {
    config,
    loading,
    error,
  };
};