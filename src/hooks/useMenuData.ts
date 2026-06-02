import { useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { getDb, auth } from "@/lib/firebase";
import type { MenuIngredient } from "@/lib/store";
import type { StockItem } from "@/types/stock";
import { getMenuItemAvailability } from "@/lib/stock-availability";

const db = getDb();

export type MenuType = "food" | "drinks";

export type MenuItem = {
  id: string;
  name: string;
  price: number;
  description?: string;
  type?: MenuType;
  category: string;
  active: boolean;
  image?: string;
  ingredients?: MenuIngredient[];
};

export const getItemType = (item: MenuItem): MenuType => {
  if (item.type === "food" || item.type === "drinks") return item.type;
  if (item.category === "drinks") return "drinks";
  return "food";
};

export const getDisplayCategory = (item: MenuItem) => {
  if (item.type && item.category) return item.category;
  if (item.category === "food") return "Comida";
  if (item.category === "drinks") return "Bebidas";
  return item.category || "General";
};

export const getItemTags = (item: MenuItem) => {
  const tags: string[] = [];

  tags.push(getItemType(item) === "drinks" ? "Barra" : "Cocina");
  tags.push(getDisplayCategory(item));

  return tags;
};

export const useMenuData = (restaurantId: string) => {
  const [activeCategory, setActiveCategory] = useState("");
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [loadingMenu, setLoadingMenu] = useState(true);
  const [loadingStock, setLoadingStock] = useState(true);
  // Stock solo se carga para usuarios autenticados (staff).
  // Clientes anónimos no tienen acceso a stock en Firestore rules (F-01).
  const [isAuthenticated, setIsAuthenticated] = useState(!!auth.currentUser);

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      setIsAuthenticated(!!user);
    });
  }, []);

  useEffect(() => {
    if (!restaurantId) return;

    let cancelled = false;

    const loadMenu = async () => {
      try {
        setLoadingMenu(true);

        const q = query(
          collection(db, "restaurants", restaurantId, "menu"),
          where("active", "==", true)
        );

        const snapshot = await getDocs(q);

        if (cancelled) return;

        const data = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        })) as MenuItem[];

        setMenuItems(data);
      } catch (error) {
        console.error("Error cargando menú:", error);

        if (!cancelled) {
          setMenuItems([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingMenu(false);
        }
      }
    };

    void loadMenu();

    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  useEffect(() => {
    if (!restaurantId || !isAuthenticated) {
      setStockItems([]);
      setLoadingStock(false);
      return;
    }

    setLoadingStock(true);

    const q = query(
      collection(db, "restaurants", restaurantId, "stock"),
      orderBy("name")
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        })) as StockItem[];

        setStockItems(data);
        setLoadingStock(false);
      },
      (error) => {
        console.error("Error cargando stock:", error);
        setStockItems([]);
        setLoadingStock(false);
      }
    );

    return () => unsubscribe();
  }, [restaurantId, isAuthenticated]);

  const availableMenuItems = useMemo(() => {
    // Anónimos: mostrar todos los items activos sin filtrar por stock.
    // La validación real de stock ocurre server-side en create-order.ts.
    if (!isAuthenticated) return menuItems;

    return menuItems.filter((item) => {
      const availability = getMenuItemAvailability({
        ingredients: item.ingredients,
        stockItems,
      });

      return availability.visible;
    });
  }, [menuItems, stockItems, isAuthenticated]);

  const categories = useMemo(() => {
    const unique = Array.from(
      new Set(availableMenuItems.map((item) => getDisplayCategory(item)))
    ).filter(Boolean);

    return unique.map((category) => ({
      key: category,
      label: category,
    }));
  }, [availableMenuItems]);

  useEffect(() => {
    if (categories.length > 0 && !activeCategory) {
      setActiveCategory(categories[0].key);
    }

    if (
      categories.length > 0 &&
      activeCategory &&
      !categories.some((category) => category.key === activeCategory)
    ) {
      setActiveCategory(categories[0].key);
    }
  }, [categories, activeCategory]);

  const filteredItems = useMemo(() => {
    return availableMenuItems.filter(
      (item) => getDisplayCategory(item) === activeCategory
    );
  }, [availableMenuItems, activeCategory]);

  return {
    stockItems,
    loading: loadingMenu || loadingStock,
    categories,
    activeCategory,
    setActiveCategory,
    filteredItems,
  };
};