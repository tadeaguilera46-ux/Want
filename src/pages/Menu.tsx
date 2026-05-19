import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShoppingCart,
  Receipt,
  X,
  ChevronRight,
} from "lucide-react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { useCart } from "@/lib/CartContext";
import {
  parseTableNumber,
  resolveRuntimeContext,
} from "../lib/runtime-context";
import { getMesa } from "../lib/mesas";
import { getDb } from "../lib/firebase";
import { useRestaurantConfig } from "../lib/restaurant-config";
import type { MenuIngredient } from "../lib/store";
import type { StockItem } from "../types/stock";
import { getStoredTableSessionId, clearStoredTableSessionId, } from "../lib/table-session";
import { getSessionById } from "../lib/sessions";
import MenuItemCard from "@/components/menu/MenuItemCard";
import {
  buildMissingOptionalObservation,
  getMenuItemAvailability,
} from "../lib/stock-availability";

const db = getDb();

type MenuType = "food" | "drinks";

type MenuItem = {
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

const formatPriceARS = (value: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value || 0);

const getItemType = (item: MenuItem): MenuType => {
  if (item.type === "food" || item.type === "drinks") return item.type;
  if (item.category === "drinks") return "drinks";
  return "food";
};

const getDisplayCategory = (item: MenuItem) => {
  if (item.type && item.category) return item.category;
  if (item.category === "food") return "Comida";
  if (item.category === "drinks") return "Bebidas";
  return item.category || "General";
};

const getItemTags = (item: MenuItem) => {
  const tags: string[] = [];

  tags.push(getItemType(item) === "drinks" ? "Barra" : "Cocina");
  tags.push(getDisplayCategory(item));

  return tags;
};

const mergeObservations = (manualNote: string, automaticNote: string) => {
  const parts = [manualNote.trim(), automaticNote.trim()].filter(Boolean);
  return parts.join(" · ");
};

const MenuSkeleton = () => {
  return (
    <div className="animate-pulse space-y-5">
      <div className="no-scrollbar flex gap-2 overflow-x-auto">
        {[1, 2, 3, 4].map((item) => (
          <div
            key={item}
            className="h-9 w-24 shrink-0 rounded-full bg-white/70"
          />
        ))}
      </div>

      {[1, 2, 3].map((item) => (
        <div
          key={item}
          className="overflow-hidden rounded-[30px] border border-black/5 bg-white shadow-[0_12px_30px_-16px_rgba(0,0,0,0.22)]"
        >
          <div className="aspect-[16/10] w-full bg-zinc-200" />

          <div className="space-y-3 p-4">
            <div className="h-5 w-2/3 rounded-full bg-zinc-200" />
            <div className="h-4 w-full rounded-full bg-zinc-100" />
            <div className="h-4 w-4/5 rounded-full bg-zinc-100" />

            <div className="flex items-center justify-between pt-3">
              <div className="h-10 w-28 rounded-2xl bg-zinc-100" />
              <div className="h-11 w-11 rounded-full bg-zinc-200" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

const Menu = () => {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  const { table, restaurantId } = resolveRuntimeContext({
    searchParams,
    location,
  });

  const tableNumber = parseTableNumber(table);
  const { config } = useRestaurantConfig(restaurantId);

  const [activeCategory, setActiveCategory] = useState("");
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [loadingMenu, setLoadingMenu] = useState(true);
  const [loadingStock, setLoadingStock] = useState(true);

  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [note, setNote] = useState("");
  const [isInitializingSession, setIsInitializingSession] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const { addToCart, getQuantity, totalItems, total } = useCart();

  const primaryColor = config.primaryColor || "#000000";
  const secondaryColor = config.secondaryColor || "#FFFFFF";
  const pageBackground =
    secondaryColor === "#FFFFFF" ? "#f6f4ef" : secondaryColor;

  const restaurantName = config.name || "Restaurante";
  const logoUrl = config.logoUrl || "";
  const coverUrl = config.coverUrl || "";
  const welcomeMessage = config.welcomeMessage || "";

  useEffect(() => {
    let isMounted = true;

   const initializeMesaSession = async () => {
      try {
        setIsInitializingSession(true);
        setSessionError(null);

        const storedSessionId = getStoredTableSessionId({
          restaurantId,
          table: tableNumber,
        });

        if (!storedSessionId) {
          throw new Error(
            "Para abrir esta mesa tenés que escanear el QR nuevamente."
          );
        }

        const mesa = await getMesa(restaurantId, tableNumber);
        const session = await getSessionById(restaurantId, storedSessionId);

        const isStillValid =
          mesa.estado === "occupied" &&
          mesa.activeSessionId === storedSessionId &&
          session?.status === "active";

        if (!isStillValid) {
          clearStoredTableSessionId({
            restaurantId,
            table: tableNumber,
          });

          throw new Error(
            "Esta mesa ya fue cerrada. Para volver a pedir, escaneá nuevamente el QR."
          );
        }

        if (session?.ordersLocked === true) {
          throw new Error(
            "La cuenta ya fue solicitada. No se pueden agregar más pedidos desde esta mesa."
          );
        }
      } catch (error) {
        console.error("Error inicializando sesión de mesa:", error);

        if (isMounted) {
          setSessionError(
            error instanceof Error
              ? error.message
              : "No se pudo inicializar la sesión de la mesa"
          );
        }
      } finally {
        if (isMounted) {
          setIsInitializingSession(false);
        }
      }
    };

    void initializeMesaSession();

    return () => {
      isMounted = false;
    };
  }, [restaurantId, tableNumber]);

  useEffect(() => {
    const validateOnReturn = async () => {
      try {
        const storedSessionId = getStoredTableSessionId({
          restaurantId,
          table: tableNumber,
        });

        if (!storedSessionId) return;

        const session = await getSessionById(restaurantId, storedSessionId);

        if (session?.ordersLocked === true) {
          setSessionError(
            "La cuenta ya fue solicitada. No se pueden agregar más pedidos desde esta mesa."
          );
        }

        if (!session || session.status !== "active") {
          setSessionError(
            "Esta mesa ya fue cerrada. Para volver a pedir, escaneá nuevamente el QR."
          );
        }
      } catch (error) {
        console.error("Error revalidando sesión al volver:", error);
      }
    };

    const handlePageShow = () => {
      void validateOnReturn();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void validateOnReturn();
      }
    };

    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pageshow", handlePageShow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [restaurantId, tableNumber]);

  useEffect(() => {
    if (!restaurantId) return;

    setLoadingMenu(true);

    const q = query(
      collection(db, "restaurants", restaurantId, "menu"),
      where("active", "==", true)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        })) as MenuItem[];

        setMenuItems(data);
        setLoadingMenu(false);
      },
      (error) => {
        console.error("Error cargando menú:", error);
        setLoadingMenu(false);
      }
    );

    return () => unsubscribe();
  }, [restaurantId]);

  useEffect(() => {
    if (!restaurantId) return;

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
  }, [restaurantId]);

  const availableMenuItems = useMemo(() => {
    return menuItems.filter((item) => {
      const availability = getMenuItemAvailability({
        ingredients: item.ingredients,
        stockItems,
      });

      return availability.visible;
    });
  }, [menuItems, stockItems]);

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

  const getAutomaticObservation = (item: MenuItem) => {
    const availability = getMenuItemAvailability({
      ingredients: item.ingredients,
      stockItems,
    });

    return buildMissingOptionalObservation(
      availability.missingOptionalIngredients
    );
  };

  const canAddQuantity = (item: MenuItem) => {
    if (sessionError) {
      alert(sessionError);
      return false;
    }

    const availability = getMenuItemAvailability({
      ingredients: item.ingredients,
      stockItems,
    });

    const currentQuantity = getQuantity(item.id);
    const maxQuantity = availability.maxQuantity;

    if (maxQuantity !== null && currentQuantity >= maxQuantity) {
      alert(`Nos quedan ${maxQuantity} ${item.name} en stock.`);
      return false;
    }

    return true;
  };

  const confirmOptionalMissing = (item: MenuItem) => {
    const availability = getMenuItemAvailability({
      ingredients: item.ingredients,
      stockItems,
    });

    if (availability.missingOptionalIngredients.length === 0) {
      return true;
    }

    return window.confirm(
      `No tenemos ${availability.missingOptionalIngredients.join(
        ", "
      )}. ¿Querés pedir igual ${item.name}?`
    );
  };

  const openNoteModal = (item: MenuItem) => {
    if (!canAddQuantity(item)) return;

    setSelectedItem(item);
    setNote("");
  };

  const closeNoteModal = () => {
    setSelectedItem(null);
    setNote("");
  };

  const handleAddWithoutNote = (item: MenuItem) => {
    if (!canAddQuantity(item)) return;
    if (!confirmOptionalMissing(item)) return;

    const automaticObservation = getAutomaticObservation(item);

    addToCart({
      id: item.id,
      nombre: item.name,
      name: item.name,
      precio: item.price,
      price: item.price,
      cantidad: 1,
      category: getItemType(item),
      displayCategory: getDisplayCategory(item),
      observacion: automaticObservation,
      description: item.description || "",
      image: item.image || "",
      ingredients: item.ingredients || [],
    } as any);
  };

  const handleAddWithNote = () => {
    if (!selectedItem) return;
    if (!canAddQuantity(selectedItem)) return;
    if (!confirmOptionalMissing(selectedItem)) return;

    const automaticObservation = getAutomaticObservation(selectedItem);
    const finalObservation = mergeObservations(note, automaticObservation);

    addToCart({
      id: selectedItem.id,
      nombre: selectedItem.name,
      name: selectedItem.name,
      precio: selectedItem.price,
      price: selectedItem.price,
      cantidad: 1,
      category: getItemType(selectedItem),
      displayCategory: getDisplayCategory(selectedItem),
      observacion: finalObservation,
      description: selectedItem.description || "",
      image: selectedItem.image || "",
      ingredients: selectedItem.ingredients || [],
    } as any);

    closeNoteModal();
  };

  if (isInitializingSession) {
    return (
      <div
        className="flex min-h-screen items-center justify-center px-6"
        style={{ backgroundColor: pageBackground }}
      >
        <p className="text-sm font-semibold text-zinc-500">
          Inicializando mesa...
        </p>
      </div>
    );
  }

  if (sessionError) {
    return (
      <div
        className="flex min-h-screen items-center justify-center px-6"
        style={{ backgroundColor: pageBackground }}
      >
        <div className="w-full max-w-md rounded-3xl border border-red-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-black text-zinc-950">
            No se pudo abrir la mesa
          </h1>
          <p className="mt-2 text-sm text-zinc-600">{sessionError}</p>
        </div>
      </div>
    );
  }

  const loading = loadingMenu || loadingStock;

  return (
  <div
    className="min-h-screen pb-32"
    style={{ backgroundColor: pageBackground }}
  >
    <div className="mx-auto w-full max-w-lg">
      <header
        className="sticky top-0 z-40 border-b border-black/5 backdrop-blur"
        style={{ backgroundColor: `${pageBackground}F2` }}
      >
        <div className="px-4 pb-2 pt-[max(12px,env(safe-area-inset-top))]">
          <div className="flex items-center justify-between gap-3">
            <div
              className="rounded-full px-3 py-1.5 text-xs font-bold text-white shadow-sm"
              style={{ backgroundColor: primaryColor }}
            >
              Mesa {table}
            </div>

            <button
              onClick={() =>
                navigate(
                  `/bill?restaurantId=${restaurantId}&table=${table}&total=${total}`,
                  { state: { table, restaurantId } }
                )
              }
              className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-extrabold text-white shadow-want transition-all hover:scale-[1.03] active:scale-[0.98]"
              style={{ backgroundColor: primaryColor }}
            >
              <Receipt size={16} />
              Pedir cuenta
            </button>
          </div>

          <div className="mt-3 overflow-hidden rounded-[24px] border border-black/5 bg-white shadow-[0_8px_24px_-14px_rgba(0,0,0,0.18)]">
            {coverUrl ? (
              <div className="h-[150px] w-full overflow-hidden bg-zinc-100 sm:h-[184px]">
                <img
                  src={coverUrl}
                  alt={restaurantName}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              </div>
            ) : (
              <div
                className="h-[150px] w-full sm:h-[184px]"
                style={{ backgroundColor: primaryColor }}
              />
            )}

            <div className="flex items-center gap-3 px-4 py-2.5">
              {logoUrl && (
                <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm">
                  <img
                    src={logoUrl}
                    alt={restaurantName}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-contain"
                  />
                </div>
              )}

              <div className="min-w-0 flex-1">
                <p className="text-[9px] font-extrabold uppercase tracking-[0.22em] text-zinc-500">
                  Menú digital
                </p>

                <h1 className="mt-0.5 truncate text-xl font-black leading-tight tracking-tight text-zinc-950">
                  {restaurantName}
                </h1>

                {welcomeMessage && (
                  <p className="mt-0.5 truncate text-sm leading-tight text-zinc-500">
                    {welcomeMessage}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-2 pt-0">
          {categories.map((category) => (
            <button
              key={category.key}
              onClick={() => setActiveCategory(category.key)}
              className={`inline-flex h-9 shrink-0 items-center rounded-full px-4 text-sm font-semibold transition-all ${
                activeCategory === category.key
                  ? "text-white shadow-sm"
                  : "border border-black/10 bg-white text-zinc-700 shadow-sm"
              }`}
              style={
                activeCategory === category.key
                  ? { backgroundColor: primaryColor }
                  : undefined
              }
            >
              {category.label}
            </button>
          ))}
        </div>
      </header>

      <main className="px-4 py-4">
        {loading ? (
          <MenuSkeleton />
        ) : filteredItems.length === 0 ? (
          <div className="rounded-3xl border border-black/5 bg-white p-6 text-center shadow-sm">
            <p className="font-bold text-zinc-950">
              No hay productos disponibles
            </p>
            <p className="mt-1 text-sm text-zinc-500">
              Probá otra categoría o consultá al staff.
            </p>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={activeCategory}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className="space-y-5"
            >
              {filteredItems.map((item) => {
                const quantity = getQuantity(item.id);
                const tags = getItemTags(item);

                const availability = getMenuItemAvailability({
                  ingredients: item.ingredients,
                  stockItems,
                });

                return (
                  <MenuItemCard
                    key={item.id}
                    item={item}
                    quantity={quantity}
                    tags={tags}
                    availability={availability}
                    primaryColor={primaryColor}
                    formatPrice={formatPriceARS}
                    onAdd={handleAddWithoutNote}
                    onNote={openNoteModal}
                  />
                );
              })}
            </motion.div>
          </AnimatePresence>
        )}
      </main>
    </div>

      {totalItems > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 px-4 pb-[max(16px,env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-lg">
            <motion.button
              initial={{ y: 18, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              onClick={() =>
                navigate(`/cart?restaurantId=${restaurantId}&table=${table}`, {
                  state: { table, restaurantId },
                })
              }
              className="pointer-events-auto flex h-14 w-full items-center justify-between rounded-2xl px-4 text-white shadow-[0_14px_34px_-12px_rgba(0,0,0,0.45)]"
              style={{ backgroundColor: primaryColor }}
            >
              <div className="flex items-center gap-3">
                <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-white/10">
                  <ShoppingCart size={20} />
                  <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-white px-1 text-[11px] font-extrabold text-zinc-950">
                    {totalItems}
                  </span>
                </div>

                <div className="text-left">
                  <p className="text-sm font-extrabold">Ver pedido</p>
                  <p className="text-xs text-white/70">
                    Total: {formatPriceARS(total)}
                  </p>
                </div>
              </div>

              <ChevronRight size={18} />
            </motion.button>
          </div>
        </div>
      )}

      <AnimatePresence>
        {selectedItem && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 24 }}
              transition={{ duration: 0.18 }}
              className="w-full max-w-lg rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl"
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-zinc-500">
                    Observación
                  </p>
                  <h2 className="mt-1 text-2xl font-black tracking-tight text-zinc-950">
                    {selectedItem.name}
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-500">
                    Escribí detalles como ingredientes a quitar, punto de cocción
                    o preferencias del pedido.
                  </p>
                </div>

                <button
                  onClick={closeNoteModal}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-700"
                >
                  <X size={18} />
                </button>
              </div>

              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={4}
                maxLength={140}
                placeholder="Escribí una observación para este producto..."
                className="w-full rounded-2xl border border-zinc-200 p-3 text-sm outline-none transition focus:ring-2 focus:ring-black/10"
              />

              <div className="mt-2 text-right text-xs text-zinc-400">
                {note.length}/140
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <button
                  onClick={closeNoteModal}
                  className="h-12 rounded-2xl border border-zinc-200 bg-white font-semibold text-zinc-700"
                >
                  Cancelar
                </button>

                <button
                  onClick={handleAddWithNote}
                  className="h-12 rounded-2xl font-semibold text-white"
                  style={{ backgroundColor: primaryColor }}
                >
                  Agregar al pedido
                </button>
              </div>
            </motion.div>

            <button
              aria-label="Close modal"
              onClick={closeNoteModal}
              className="absolute inset-0 -z-10"
            />
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Menu;