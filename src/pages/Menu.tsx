import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShoppingCart,
  Receipt,
  Plus,
  X,
  MessageSquareText,
  ChevronRight,
} from "lucide-react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useCart } from "@/lib/CartContext";
import {
  parseTableNumber,
  resolveRuntimeContext,
} from "../lib/runtime-context";
import { getOrCreateMesaSession } from "../lib/mesas";
import { getDb } from "../lib/firebase";
import { useRestaurantConfig } from "../lib/restaurant-config";

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
  const [loadingMenu, setLoadingMenu] = useState(true);

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

        await getOrCreateMesaSession(restaurantId, tableNumber);
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

  const categories = useMemo(() => {
    const unique = Array.from(
      new Set(menuItems.map((item) => getDisplayCategory(item)))
    ).filter(Boolean);

    return unique.map((category) => ({
      key: category,
      label: category,
    }));
  }, [menuItems]);

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
    return menuItems.filter(
      (item) => getDisplayCategory(item) === activeCategory
    );
  }, [menuItems, activeCategory]);

  const openNoteModal = (item: MenuItem) => {
    setSelectedItem(item);
    setNote("");
  };

  const closeNoteModal = () => {
    setSelectedItem(null);
    setNote("");
  };

  const handleAddWithoutNote = (item: MenuItem) => {
    addToCart({
      id: item.id,
      nombre: item.name,
      name: item.name,
      precio: item.price,
      price: item.price,
      cantidad: 1,
      category: getItemType(item),
      displayCategory: getDisplayCategory(item),
      observacion: "",
      description: item.description || "",
      image: item.image || "",
    } as any);
  };

  const handleAddWithNote = () => {
    if (!selectedItem) return;

    addToCart({
      id: selectedItem.id,
      nombre: selectedItem.name,
      name: selectedItem.name,
      precio: selectedItem.price,
      price: selectedItem.price,
      cantidad: 1,
      category: getItemType(selectedItem),
      displayCategory: getDisplayCategory(selectedItem),
      observacion: note.trim(),
      description: selectedItem.description || "",
      image: selectedItem.image || "",
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
                    className="h-full w-full object-cover"
                  />
                </div>
              ) : (
               <div
                  className="h-[184px] w-full"
                  style={{ backgroundColor: primaryColor }}
                />
              )}

              <div className="flex items-center gap-3 px-4 py-2.5">
                {logoUrl && (
                  <div className="h-10 w-10 overflow-hidden rounded-xl border border-black/5 bg-white shadow-sm">
                    <img
                      src={logoUrl}
                      alt={restaurantName}
                      className="h-full w-full object-cover"
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
          {loadingMenu ? (
            <div className="rounded-3xl border border-black/5 bg-white p-6 text-center text-sm font-semibold text-zinc-500 shadow-sm">
              Cargando menú...
            </div>
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
                  const qty = getQuantity(item.id);
                  const tags = getItemTags(item);

                  return (
                    <motion.div
                      key={item.id}
                      layout
                      initial={{ opacity: 0, y: 18 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.22 }}
                      className="overflow-hidden rounded-[30px] border border-black/5 bg-white shadow-[0_12px_30px_-16px_rgba(0,0,0,0.22)]"
                    >
                      <div className="relative aspect-[16/10] w-full overflow-hidden bg-zinc-100">
                        {item.image ? (
                          <img
                            src={item.image}
                            alt={item.name}
                            className="h-full w-full object-cover transition-transform duration-500 hover:scale-[1.03]"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-zinc-200">
                            <p className="text-sm font-semibold text-zinc-500">
                              Sin imagen
                            </p>
                          </div>
                        )}

                        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />

                        <div className="absolute left-4 right-4 top-4 flex items-start justify-between gap-3">
                          <div className="flex flex-wrap gap-2">
                            {tags.slice(0, 2).map((tag) => (
                              <span
                                key={tag}
                                className="rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-zinc-800 backdrop-blur"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>

                          <div className="shrink-0 rounded-full bg-white/95 px-3 py-1.5 text-sm font-extrabold text-zinc-950 shadow-sm backdrop-blur">
                            {formatPriceARS(item.price)}
                          </div>
                        </div>

                        <div className="absolute bottom-0 left-0 right-0 p-4">
                          <h3 className="text-xl font-black leading-tight text-white drop-shadow-sm">
                            {item.name}
                          </h3>
                        </div>
                      </div>

                      <div className="p-4">
                        <p className="text-sm leading-relaxed text-zinc-600">
                          {item.description || "Sin descripción"}
                        </p>

                        <div className="mt-4 flex items-center justify-between gap-3">
                          <button
                            onClick={() => openNoteModal(item)}
                            className="inline-flex h-10 items-center gap-2 rounded-2xl border border-black/10 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50"
                          >
                            <MessageSquareText size={14} />
                            Agregar nota
                          </button>

                          <div className="flex items-center gap-3">
                            {qty > 0 && (
                              <span className="min-w-[24px] text-center text-sm font-black text-zinc-700">
                                {qty}
                              </span>
                            )}

                            <motion.button
                              whileTap={{ scale: 0.92 }}
                              onClick={() => handleAddWithoutNote(item)}
                              className="flex h-11 w-11 items-center justify-center rounded-full text-white shadow-want"
                              style={{ backgroundColor: primaryColor }}
                            >
                              <Plus size={18} />
                            </motion.button>
                          </div>
                        </div>
                      </div>
                    </motion.div>
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