import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, Check, ChevronRight, Receipt, ShoppingCart, X } from "lucide-react";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { getDb } from "../lib/firebase";
import { useCart } from "@/lib/CartContext";
import { parseTableNumber, resolveRuntimeContext } from "../lib/runtime-context";
import { getMesa } from "../lib/mesas";
import { useRestaurantConfig } from "../lib/restaurant-config";
import { toast } from "sonner";
import {
  clearStoredTableSessionId,
  getStoredTableSessionId,
} from "../lib/table-session";
import { getSessionById } from "../lib/sessions";
import MenuItemCard from "@/components/menu/MenuItemCard";
import {
  getDisplayCategory,
  getItemTags,
  getItemType,
  useMenuData,
  type MenuItem,
} from "@/hooks/useMenuData";
import {
  buildMissingOptionalObservation,
  getMenuItemAvailability,
} from "../lib/stock-availability";

const formatPriceARS = (value: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value || 0);

const mergeObservations = (manualNote: string, automaticNote: string) => {
  const parts = [manualNote.trim(), automaticNote.trim()].filter(Boolean);
  return parts.join(" · ");
};

const MenuSkeleton = () => {
  return (
    <div className="animate-pulse space-y-5">
      {[1, 2, 3].map((item) => (
        <div
          key={item}
          className="overflow-hidden rounded-[30px] border border-border bg-card shadow-[0_12px_30px_-16px_rgba(0,0,0,0.22)]"
        >
          <div className="aspect-[16/10] w-full bg-zinc-200" />
          <div className="space-y-3 p-4">
            <div className="h-5 w-2/3 rounded-full bg-zinc-200" />
            <div className="h-4 w-full rounded-full bg-background" />
            <div className="h-4 w-4/5 rounded-full bg-background" />
            <div className="flex items-center justify-between pt-3">
              <div className="h-10 w-28 rounded-lg bg-background" />
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

  const {
    stockItems,
    loading,
    categories,
    activeCategory,
    setActiveCategory,
    filteredItems,
  } = useMenuData(restaurantId);

  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [note, setNote] = useState("");
  const [isInitializingSession, setIsInitializingSession] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [assistOpen, setAssistOpen] = useState(false);
  const [assistSent, setAssistSent] = useState<string | null>(null);
  const [sendingAssist, setSendingAssist] = useState(false);

  const { addToCart, getQuantity, totalItems, total } = useCart();

  const primaryColor = config.primaryColor || "#000000";
  const secondaryColor = config.secondaryColor || "#FFFFFF";
  const pageBackground =
    secondaryColor === "#FFFFFF" ? "#f6f4ef" : secondaryColor;

  const restaurantName = config.name || "Restaurante";
  const logoUrl = config.logoUrl || "";
  const coverUrl = config.coverUrl || "";
  const welcomeMessage = config.welcomeMessage || "";

  const [coverError, setCoverError] = useState(false);
  const [logoError, setLogoError] = useState(false);

  useEffect(() => { setCoverError(false); }, [coverUrl]);
  useEffect(() => { setLogoError(false); }, [logoUrl]);

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

    const handlePageShow = () => void validateOnReturn();

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

  const getAutomaticObservation = (item: MenuItem) => {
    // Sin stock cargado (cliente anónimo) no hay información real de faltantes.
    // create-order.ts agrega la observación correcta al momento de confirmar.
    if (stockItems.length === 0) return "";

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
      toast.error(`Nos quedan ${maxQuantity} ${item.name} en stock.`);
      return false;
    }

    return true;
  };

  const confirmOptionalMissing = (item: MenuItem) => {
    // Sin stock cargado (cliente anónimo) no podemos saber qué falta realmente.
    if (stockItems.length === 0) return true;

    const availability = getMenuItemAvailability({
      ingredients: item.ingredients,
      stockItems,
    });

    if (availability.missingOptionalIngredients.length === 0) return true;

    return window.confirm(
      `No tenemos ${availability.missingOptionalIngredients.join(
        ", "
      )}. ¿Querés pedir igual ${item.name}?`
    );
  };

  const ASSIST_OPTIONS = [
    { key: "sal" as const, label: "Pedir sal" },
    { key: "hielo" as const, label: "Pedir hielo" },
    { key: "runner" as const, label: "Llamar al mozo" },
  ];

  const sendAssistance = async (type: "sal" | "hielo" | "runner") => {
    if (sendingAssist) return;
    const sessionId = getStoredTableSessionId({ restaurantId, table: tableNumber });
    if (!sessionId) return;
    try {
      setSendingAssist(true);
      const db = getDb();
      await addDoc(
        collection(db, "restaurants", restaurantId, "assistanceRequests"),
        { mesa: tableNumber, type, status: "pending", sessionId, createdAt: serverTimestamp() }
      );
      setAssistSent(type);
      setTimeout(() => { setAssistOpen(false); setAssistSent(null); }, 2000);
    } catch (e) {
      console.error(e);
    } finally {
      setSendingAssist(false);
    }
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
        <p className="text-sm font-semibold text-muted-foreground">
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
        <div className="w-full max-w-md rounded-xl border border-red-800/50 bg-card p-6 text-center shadow-sm">
          <h1 className="text-lg font-bold text-foreground">
            No se pudo abrir la mesa
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{sessionError}</p>
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
          className="sticky top-0 z-40 border-b border-border backdrop-blur"
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

              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setAssistOpen(true); setAssistSent(null); }}
                  className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold shadow-sm transition-all hover:opacity-80 active:scale-[0.97]"
                  style={{ color: primaryColor, borderColor: primaryColor, backgroundColor: `${primaryColor}12` }}
                >
                  <Bell size={14} />
                  Asistencia
                </button>

                <button
                  onClick={() =>
                    navigate(
                      `/bill?restaurantId=${restaurantId}&table=${table}&total=${total}`,
                      { state: { table, restaurantId } }
                    )
                  }
                  className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-white shadow-want transition-all hover:scale-[1.03] active:scale-[0.98]"
                  style={{ backgroundColor: primaryColor }}
                >
                  <Receipt size={16} />
                  Pedir cuenta
                </button>
              </div>
            </div>

            <div className="mt-3 overflow-hidden rounded-[24px] border border-border bg-card shadow-[0_8px_24px_-14px_rgba(0,0,0,0.18)]">
              {coverUrl && !coverError ? (
                <div className="h-[150px] w-full overflow-hidden bg-background sm:h-[184px]">
                  <img
                    src={coverUrl}
                    alt={restaurantName}
                    loading="lazy"
                    decoding="async"
                    onError={() => setCoverError(true)}
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
                {logoUrl && !logoError && (
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-card shadow-sm">
                    <img
                      src={logoUrl}
                      alt={restaurantName}
                      loading="lazy"
                      decoding="async"
                      onError={() => setLogoError(true)}
                      className="h-full w-full object-contain"
                    />
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    Menú digital
                  </p>

                  <h1 className="mt-0.5 truncate text-xl font-bold leading-tight tracking-tight text-foreground">
                    {restaurantName}
                  </h1>

                  {welcomeMessage && (
                    <p className="mt-0.5 truncate text-sm leading-tight text-muted-foreground">
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
                className={`relative inline-flex h-9 shrink-0 items-center rounded-full px-4 text-sm font-semibold transition-colors ${
                  activeCategory === category.key
                    ? "text-white"
                    : "border border-border bg-card text-foreground shadow-sm"
                }`}
              >
                {activeCategory === category.key && (
                  <motion.div
                    layoutId="active-category"
                    className="absolute inset-0 rounded-full shadow-sm"
                    style={{ backgroundColor: primaryColor }}
                    transition={{ type: "spring", stiffness: 500, damping: 35 }}
                  />
                )}
                <span className="relative z-10">{category.label}</span>
              </button>
            ))}
          </div>
        </header>

        <main className="px-4 py-4">
          {loading ? (
            <MenuSkeleton />
          ) : filteredItems.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-6 text-center shadow-sm">
              <p className="font-bold text-foreground">
                No hay productos disponibles
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
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
              className="pointer-events-auto flex h-14 w-full items-center justify-between rounded-lg px-4 text-white shadow-[0_14px_34px_-12px_rgba(0,0,0,0.45)]"
              style={{ backgroundColor: primaryColor }}
            >
              <div className="flex items-center gap-3">
                <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-white/10">
                  <ShoppingCart size={20} />
                  <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-card px-1 text-[11px] font-semibold text-foreground">
                    {totalItems}
                  </span>
                </div>

                <div className="text-left">
                  <p className="text-sm font-semibold">Ver pedido</p>
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

      {/* Assistance modal */}
      <AnimatePresence>
        {assistOpen && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ duration: 0.18 }}
              className="w-full max-w-lg rounded-t-3xl bg-card p-5 shadow-2xl sm:rounded-xl"
            >
              {assistSent ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.15 }}
                  className="flex flex-col items-center py-8 text-center"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-secondary">
                    <Check size={20} className="text-foreground" />
                  </div>
                  <p className="mt-3 text-base font-bold text-foreground">
                    Solicitud enviada
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    En un momento viene el mozo.
                  </p>
                </motion.div>
              ) : (
                <>
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        Mesa {table}
                      </p>
                      <h2 className="mt-0.5 text-xl font-bold tracking-tight text-foreground">
                        ¿Necesitás algo?
                      </h2>
                    </div>
                    <button
                      onClick={() => setAssistOpen(false)}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-background text-muted-foreground"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  <div className="space-y-2">
                    {ASSIST_OPTIONS.map((opt) => (
                      <button
                        key={opt.key}
                        disabled={sendingAssist}
                        onClick={() => void sendAssistance(opt.key)}
                        className="flex w-full items-center justify-between rounded-lg border border-border bg-card px-5 py-4 text-left transition hover:bg-secondary active:bg-background disabled:opacity-50"
                      >
                        <span className="text-sm font-semibold text-zinc-800">
                          {opt.label}
                        </span>
                        <ChevronRight size={15} className="shrink-0 text-muted-foreground" />
                      </button>
                    ))}
                  </div>
                </>
              )}
            </motion.div>
            <button
              aria-label="Cerrar"
              onClick={() => setAssistOpen(false)}
              className="absolute inset-0 -z-10"
            />
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedItem && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 24 }}
              transition={{ duration: 0.18 }}
              className="w-full max-w-lg rounded-t-3xl bg-card p-5 shadow-2xl sm:rounded-xl"
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Observación
                  </p>
                  <h2 className="mt-1 text-2xl font-bold tracking-tight text-foreground">
                    {selectedItem.name}
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    Escribí detalles como ingredientes a quitar, punto de cocción
                    o preferencias del pedido.
                  </p>
                </div>

                <button
                  onClick={closeNoteModal}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-background text-foreground"
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
                className="w-full rounded-lg border border-border p-3 text-sm outline-none transition focus:ring-2 focus:ring-ring/40"
              />

              <div className="mt-2 text-right text-xs text-muted-foreground">
                {note.length}/140
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <button
                  onClick={closeNoteModal}
                  className="h-12 rounded-lg border border-border bg-card font-semibold text-foreground"
                >
                  Cancelar
                </button>

                <button
                  onClick={handleAddWithNote}
                  className="h-12 rounded-lg font-semibold text-white"
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