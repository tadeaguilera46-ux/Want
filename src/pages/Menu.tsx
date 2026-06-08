import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, Check, ChevronRight, Minus, Plus, Receipt, Search, ShoppingCart, X } from "lucide-react";
import { collection, doc, serverTimestamp, writeBatch } from "firebase/firestore";
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
import { writeAuditLog } from "../lib/audit-logs";
import CustomerOrderStatus from "@/components/menu/CustomerOrderStatus";
import MenuItemCard from "@/components/menu/MenuItemCard";
import {
  getDisplayCategory,
  getItemTags,
  getItemType,
  useMenuData,
  PROMOS_CATEGORY_KEY,
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

const normalizeSearchText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const MenuSkeleton = () => (
  <div className="animate-pulse space-y-5">
    {[1, 2, 3].map((item) => (
      <div
        key={item}
        className="overflow-hidden rounded-[30px] border border-black/5 bg-white shadow-[0_12px_30px_-16px_rgba(0,0,0,0.22)]"
      >
        <div className="aspect-[16/10] w-full bg-zinc-200" />
        <div className="space-y-3 p-4">
          <div className="h-5 w-2/3 rounded-full bg-zinc-200" />
          <div className="h-4 w-full rounded-full bg-zinc-100" />
          <div className="flex items-center justify-between pt-3">
            <div className="h-10 w-28 rounded-lg bg-zinc-100" />
            <div className="h-11 w-11 rounded-full bg-zinc-200" />
          </div>
        </div>
      </div>
    ))}
  </div>
);

const Menu = () => {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  const { table, restaurantId } = resolveRuntimeContext({ searchParams, location });
  const tableNumber = parseTableNumber(table);
  const { config } = useRestaurantConfig(restaurantId);

  const {
    stockItems,
    loading,
    categories,
    activeCategory,
    setActiveCategory,
    allItems,
    promotions,
    twoForOnePromos,
    isPromotionActive,
    isTwoForOneActive,
  } = useMenuData(restaurantId);

  const DAYS_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const hasPromos = promotions.length > 0 || twoForOnePromos.length > 0;

  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [selectedQuantity, setSelectedQuantity] = useState(1);
  const [note, setNote] = useState("");
  const [isInitializingSession, setIsInitializingSession] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [assistOpen, setAssistOpen] = useState(false);
  const [assistSent, setAssistSent] = useState<string | null>(null);
  const [sendingAssist, setSendingAssist] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const { addToCart, getQuantity, totalItems, total } = useCart();

  useEffect(() => {
    setSelectedItem((currentItem) => {
      if (!currentItem) return currentItem;
      return allItems.find((item) => item.id === currentItem.id) || null;
    });
  }, [allItems]);

  const primaryColor = config.primaryColor || "#000000";
  const secondaryColor = config.secondaryColor || "#FFFFFF";
  const pageBackground = secondaryColor === "#FFFFFF" ? "#f6f4ef" : secondaryColor;

  const restaurantName = config.name || "Restaurante";
  const logoUrl = config.logoUrl || "";
  const coverUrl = config.coverUrl || "";
  const welcomeMessage = config.welcomeMessage || "";

  const [coverError, setCoverError] = useState(false);
  const [logoError, setLogoError] = useState(false);

  // Refs for scroll spy
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const topbarRef = useRef<HTMLDivElement>(null);
  const tabsBarRef = useRef<HTMLDivElement>(null);
  const isScrollingByClick = useRef(false);

  useEffect(() => { setCoverError(false); }, [coverUrl]);
  useEffect(() => { setLogoError(false); }, [logoUrl]);

  // Session initialization
  useEffect(() => {
    let isMounted = true;

    const initializeMesaSession = async () => {
      try {
        setIsInitializingSession(true);
        setSessionError(null);

        const storedSessionId = getStoredTableSessionId({ restaurantId, table: tableNumber });
        if (!storedSessionId) {
          throw new Error("Para abrir esta mesa tenés que escanear el QR nuevamente.");
        }

        const mesa = await getMesa(restaurantId, tableNumber);
        const session = await getSessionById(restaurantId, storedSessionId);

        const isStillValid =
          mesa.estado === "occupied" &&
          mesa.activeSessionId === storedSessionId &&
          session?.status === "active";

        if (!isStillValid) {
          clearStoredTableSessionId({ restaurantId, table: tableNumber });
          throw new Error("Esta mesa ya fue cerrada. Para volver a pedir, escaneá nuevamente el QR.");
        }

        if (session?.ordersLocked === true) {
          throw new Error("La cuenta ya fue solicitada. No se pueden agregar más pedidos desde esta mesa.");
        }
      } catch (error) {
        console.error("Error inicializando sesión de mesa:", error);
        if (isMounted) {
          setSessionError(
            error instanceof Error ? error.message : "No se pudo inicializar la sesión de la mesa"
          );
        }
      } finally {
        if (isMounted) setIsInitializingSession(false);
      }
    };

    void initializeMesaSession();
    return () => { isMounted = false; };
  }, [restaurantId, tableNumber]);

  // Re-validate session on page return
  useEffect(() => {
    const validateOnReturn = async () => {
      try {
        const storedSessionId = getStoredTableSessionId({ restaurantId, table: tableNumber });
        if (!storedSessionId) return;

        const session = await getSessionById(restaurantId, storedSessionId);
        if (session?.ordersLocked === true) {
          setSessionError("La cuenta ya fue solicitada. No se pueden agregar más pedidos desde esta mesa.");
        }
        if (!session || session.status !== "active") {
          setSessionError("Esta mesa ya fue cerrada. Para volver a pedir, escaneá nuevamente el QR.");
        }
      } catch (error) {
        console.error("Error revalidando sesión al volver:", error);
      }
    };

    const handlePageShow = () => void validateOnReturn();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void validateOnReturn();
    };

    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pageshow", handlePageShow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [restaurantId, tableNumber]);

  // Scroll spy — updates active category as user scrolls
  useEffect(() => {
    if (!categories.length) return;

    const handleScroll = () => {
      if (isScrollingByClick.current) return;

      const topbarH = topbarRef.current?.offsetHeight ?? 56;
      const tabsH = tabsBarRef.current?.offsetHeight ?? 48;
      const triggerY = window.scrollY + topbarH + tabsH + 24;

      let current = "";

      // Check promo section (always first if rendered)
      const promoEl = sectionRefs.current[PROMOS_CATEGORY_KEY];
      if (promoEl && promoEl.offsetTop <= triggerY) {
        current = PROMOS_CATEGORY_KEY;
      }

      // Real categories override as user scrolls past them
      for (const cat of categories) {
        const el = sectionRefs.current[cat.key];
        if (!el) continue;
        if (el.offsetTop <= triggerY) {
          current = cat.key;
        }
      }

      if (!current) {
        current = promoEl ? PROMOS_CATEGORY_KEY : (categories[0]?.key ?? "");
      }

      setActiveCategory(current);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [categories, setActiveCategory]);

  // Auto-scroll the tabs strip to keep active tab visible
  useEffect(() => {
    const btn = tabRefs.current[activeCategory];
    const container = tabsContainerRef.current;
    if (!btn || !container) return;

    const btnLeft = btn.offsetLeft;
    const btnWidth = btn.offsetWidth;
    const containerScrollLeft = container.scrollLeft;
    const containerWidth = container.offsetWidth;

    if (btnLeft < containerScrollLeft + 16) {
      container.scrollTo({ left: btnLeft - 16, behavior: "smooth" });
    } else if (btnLeft + btnWidth > containerScrollLeft + containerWidth - 16) {
      container.scrollTo({ left: btnLeft + btnWidth - containerWidth + 16, behavior: "smooth" });
    }
  }, [activeCategory]);

  // Click a category tab → smooth scroll to that section
  const scrollToCategory = (key: string) => {
    setActiveCategory(key);
    const el = sectionRefs.current[key];
    if (!el) return;

    isScrollingByClick.current = true;
    const topbarH = topbarRef.current?.offsetHeight ?? 56;
    const tabsH = tabsBarRef.current?.offsetHeight ?? 48;
    const targetY = el.offsetTop - topbarH - tabsH - 8;
    window.scrollTo({ top: targetY, behavior: "smooth" });

    // Re-enable scroll spy after smooth scroll finishes
    setTimeout(() => { isScrollingByClick.current = false; }, 900);
  };

  // Items helpers
  const normalizedSearchQuery = normalizeSearchText(searchQuery);
  const isSearching = normalizedSearchQuery.length > 0;

  const searchResults = useMemo(() => {
    const activeItems = allItems.filter((item) => item.availabilityStatus !== "paused");
    if (!normalizedSearchQuery) return activeItems;

    const terms = normalizedSearchQuery.split(/\s+/).filter(Boolean);

    return activeItems.filter((item) => {
      const searchableText = normalizeSearchText(
        [
          item.name,
          getDisplayCategory(item),
          getItemType(item),
          item.description || "",
          ...(item.allergens || []),
          ...(item.ingredients || []).map((ingredient) => ingredient.stockItemName),
          ...(item.modifierGroups || []).flatMap((group) => [
            group.name,
            ...group.options.map((option) => option.name),
          ]),
          ...getItemTags(item),
        ].join(" ")
      );

      return terms.every((term) => searchableText.includes(term));
    });
  }, [allItems, normalizedSearchQuery]);

  const visibleCategories = useMemo(
    () =>
      categories.filter((category) =>
        searchResults.some(
          (item) => getDisplayCategory(item) === category.key
        )
      ),
    [categories, searchResults]
  );

  const getItemsForCategory = (categoryKey: string) =>
    searchResults.filter((item) => getDisplayCategory(item) === categoryKey);

  const getAutomaticObservation = (item: MenuItem) => {
    if (item.missingOptionalIngredients) {
      return buildMissingOptionalObservation(item.missingOptionalIngredients);
    }
    if (stockItems.length === 0) return "";
    const availability = getMenuItemAvailability({ ingredients: item.ingredients, stockItems });
    return buildMissingOptionalObservation(availability.missingOptionalIngredients);
  };

  const getAvailableQuantityToAdd = (item: MenuItem) => {
    if (
      item.availabilityStatus === "sold_out" ||
      item.availabilityStatus === "paused"
    ) {
      return 0;
    }
    if (typeof item.maxQuantity === "number") {
      return Math.max(0, item.maxQuantity - getQuantity(item.id));
    }
    const availability = getMenuItemAvailability({
      ingredients: item.ingredients,
      stockItems,
    });
    const maxQuantity = availability.maxQuantity;
    const currentQuantity = getQuantity(item.id);
    if (maxQuantity === null) return Math.max(0, 99 - currentQuantity);
    return Math.max(0, maxQuantity - currentQuantity);
  };

  const canAddQuantity = (item: MenuItem, quantity = 1) => {
    if (sessionError) { alert(sessionError); return false; }
    if (item.availabilityStatus === "sold_out") {
      toast.error(`${item.name} está agotado.`);
      return false;
    }
    if (item.availabilityStatus === "paused") {
      toast.error(`${item.name} está temporalmente pausado.`);
      return false;
    }
    const availableQuantity = getAvailableQuantityToAdd(item);
    if (quantity > availableQuantity) {
      toast.error(
        availableQuantity > 0
          ? `Podés agregar hasta ${availableQuantity} ${item.name}.`
          : `${item.name} ya no tiene unidades disponibles.`
      );
      return false;
    }
    return true;
  };

  const confirmOptionalMissing = (item: MenuItem) => {
    if (item.missingOptionalIngredients?.length) {
      return window.confirm(
        `No tenemos ${item.missingOptionalIngredients.join(", ")}. ¿Querés pedir igual ${item.name}?`
      );
    }
    if (stockItems.length === 0) return true;
    const availability = getMenuItemAvailability({ ingredients: item.ingredients, stockItems });
    if (availability.missingOptionalIngredients.length === 0) return true;
    return window.confirm(
      `No tenemos ${availability.missingOptionalIngredients.join(", ")}. ¿Querés pedir igual ${item.name}?`
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
      const requestRef = doc(
        collection(db, "restaurants", restaurantId, "assistanceRequests")
      );
      const batch = writeBatch(db);
      batch.set(requestRef, {
        mesa: tableNumber,
        type,
        status: "pending",
        sessionId,
        createdAt: serverTimestamp(),
      });
      writeAuditLog(batch, {
        restaurantId,
        action: "asistencia_solicitada",
        actorUid: `customer:${sessionId}`,
        actorRole: "customer",
        mesa: tableNumber,
        sessionId,
        entityType: "assistance_request",
        entityId: requestRef.id,
        description: `Cliente solicito asistencia ${type}`,
        changes: {
          before: { exists: false },
          after: { type, status: "pending" },
        },
      });
      await batch.commit();
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
    setSelectedQuantity(1);
    setNote("");
  };

  const closeNoteModal = () => {
    setSelectedItem(null);
    setSelectedQuantity(1);
    setNote("");
  };

  const handleAddWithoutNote = (item: MenuItem) => {
    openNoteModal(item);
  };

  const handleAddWithNote = () => {
    if (!selectedItem) return;
    if (!canAddQuantity(selectedItem, selectedQuantity)) return;
    if (!confirmOptionalMissing(selectedItem)) return;
    const automaticObservation = getAutomaticObservation(selectedItem);
    const finalObservation = mergeObservations(note, automaticObservation);
    addToCart({
      id: selectedItem.id, nombre: selectedItem.name, name: selectedItem.name,
      precio: selectedItem.price, price: selectedItem.price, cantidad: selectedQuantity,
      category: getItemType(selectedItem), displayCategory: getDisplayCategory(selectedItem),
      observacion: finalObservation,
      description: selectedItem.description || "", image: selectedItem.image || "",
      ingredients: selectedItem.ingredients || [],
    } as any, selectedQuantity);
    closeNoteModal();
  };

  // Loading / error states
  if (isInitializingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6" style={{ backgroundColor: pageBackground }}>
        <p className="text-sm font-semibold text-zinc-500">Inicializando mesa...</p>
      </div>
    );
  }

  if (sessionError) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6" style={{ backgroundColor: pageBackground }}>
        <div className="w-full max-w-md rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-bold text-zinc-950">No se pudo abrir la mesa</h1>
          <p className="mt-2 text-sm text-zinc-600">{sessionError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-32" style={{ backgroundColor: pageBackground }}>

      {/* ── Fixed top bar ─────────────────────────────────── */}
      <div
        ref={topbarRef}
        className="fixed left-0 right-0 top-0 z-50 border-b border-black/5 backdrop-blur"
        style={{ backgroundColor: `${pageBackground}F2` }}
      >
        <div className="mx-auto flex w-full max-w-lg items-center justify-between gap-3 px-4 pb-2 pt-[max(10px,env(safe-area-inset-top))]">
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
                navigate(`/bill?restaurantId=${restaurantId}&table=${table}&total=${total}`, {
                  state: { table, restaurantId },
                })
              }
              className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-white shadow-want transition-all hover:scale-[1.03] active:scale-[0.98]"
              style={{ backgroundColor: primaryColor }}
            >
              <Receipt size={16} />
              Pedir cuenta
            </button>
          </div>
        </div>
      </div>

      {/* ── Scrollable content ────────────────────────────── */}
      <div className="mx-auto w-full max-w-lg pt-14">
        {/* Hero — scrolls away */}
        <div className="px-4 pb-0 pt-3">
          <div className="overflow-hidden rounded-[24px] border border-black/5 bg-white shadow-[0_8px_24px_-14px_rgba(0,0,0,0.18)]">
            {coverUrl && !coverError ? (
              <div className="h-[150px] w-full overflow-hidden bg-zinc-100 sm:h-[184px]">
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
              <div className="h-[150px] w-full sm:h-[184px]" style={{ backgroundColor: primaryColor }} />
            )}

            <div className="flex items-center gap-3 px-4 py-2.5">
              {logoUrl && !logoError && (
                <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-black/5 bg-white shadow-sm">
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
                <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Menú digital</p>
                <h1 className="mt-0.5 truncate text-xl font-bold leading-tight tracking-tight text-zinc-950">
                  {restaurantName}
                </h1>
                {welcomeMessage && (
                  <p className="mt-0.5 truncate text-sm leading-tight text-zinc-500">{welcomeMessage}</p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="px-4 pb-3 pt-3">
          <div className="relative">
            <Search
              size={18}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Buscar producto, categoría o ingrediente"
              className="h-12 w-full rounded-xl border border-black/10 bg-white pl-11 pr-11 text-sm font-medium text-zinc-950 shadow-sm outline-none transition focus:border-black/20 focus:ring-2 focus:ring-black/5"
              aria-label="Buscar productos"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 transition hover:bg-zinc-200"
                aria-label="Limpiar búsqueda"
              >
                <X size={14} />
              </button>
            )}
          </div>
          {isSearching && (
            <p className="mt-2 px-1 text-xs font-semibold text-zinc-500">
              {searchResults.length} resultado(s) para “{searchQuery.trim()}”
            </p>
          )}
        </div>

        {/* Sticky category tabs — stick just below the fixed topbar */}
        <div className="px-4 pb-3">
          <CustomerOrderStatus
            restaurantId={restaurantId}
            table={tableNumber}
            primaryColor={primaryColor}
          />
        </div>

        {!isSearching && (
          <div
            ref={tabsBarRef}
            className="sticky top-14 z-40 border-b border-black/5 backdrop-blur"
            style={{ backgroundColor: `${pageBackground}F2` }}
          >
          <div
            ref={tabsContainerRef}
            className="no-scrollbar flex gap-2 overflow-x-auto px-4 py-2"
          >
            {hasPromos && (
              <button
                ref={(el) => { tabRefs.current[PROMOS_CATEGORY_KEY] = el; }}
                onClick={() => scrollToCategory(PROMOS_CATEGORY_KEY)}
                className={`relative inline-flex h-9 shrink-0 items-center rounded-full px-4 text-sm font-semibold transition-colors ${
                  activeCategory === PROMOS_CATEGORY_KEY
                    ? "text-white"
                    : "border border-black/10 bg-white text-zinc-700 shadow-sm"
                }`}
              >
                {activeCategory === PROMOS_CATEGORY_KEY && (
                  <motion.div
                    layoutId="active-category"
                    className="absolute inset-0 rounded-full shadow-sm"
                    style={{ backgroundColor: primaryColor }}
                    transition={{ type: "spring", stiffness: 500, damping: 35 }}
                  />
                )}
                <span className="relative z-10">Promociones</span>
              </button>
            )}
            {categories.map((category) => (
              <button
                key={category.key}
                ref={(el) => { tabRefs.current[category.key] = el; }}
                onClick={() => scrollToCategory(category.key)}
                className={`relative inline-flex h-9 shrink-0 items-center rounded-full px-4 text-sm font-semibold transition-colors ${
                  activeCategory === category.key
                    ? "text-white"
                    : "border border-black/10 bg-white text-zinc-700 shadow-sm"
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
          </div>
        )}

        {/* All items grouped by category */}
        <main className="px-4 py-4">
          {loading ? (
            <MenuSkeleton />
          ) : allItems.length === 0 ? (
            <div className="rounded-xl border border-black/5 bg-white p-6 text-center shadow-sm">
              <p className="font-bold text-zinc-950">No hay productos disponibles</p>
              <p className="mt-1 text-sm text-zinc-500">Consultá al staff.</p>
            </div>
          ) : isSearching && searchResults.length === 0 ? (
            <div className="rounded-xl border border-black/5 bg-white p-6 text-center shadow-sm">
              <Search size={24} className="mx-auto text-zinc-400" />
              <p className="mt-3 font-bold text-zinc-950">No encontramos productos</p>
              <p className="mt-1 text-sm text-zinc-500">
                Probá buscando otro nombre, categoría o ingrediente.
              </p>
            </div>
          ) : (
            <div className="space-y-8">
              {/* ── Sección Promociones ─────────────────────── */}
              {hasPromos && !isSearching && (
                <section
                  ref={(el) => { sectionRefs.current[PROMOS_CATEGORY_KEY] = el; }}
                  data-category={PROMOS_CATEGORY_KEY}
                >
                  <div className="mb-3 flex items-center gap-3">
                    <h2 className="text-base font-bold tracking-tight text-zinc-950">
                      Promociones
                    </h2>
                    <div className="h-px flex-1 bg-black/8" />
                    <span className="text-xs font-medium text-zinc-400">
                      {promotions.length + twoForOnePromos.length}
                    </span>
                  </div>

                  <div className="space-y-4">
                    {/* Descuentos automáticos */}
                    {promotions.map((promo) => {
                      const active = isPromotionActive(promo);

                      // Single product promo → full product card
                      if (promo.productName) {
                        const matchedItem = allItems.find(
                          (i) => i.name.toLowerCase() === promo.productName.toLowerCase()
                        );
                        if (
                          !matchedItem ||
                          matchedItem.availabilityStatus === "sold_out" ||
                          matchedItem.availabilityStatus === "paused"
                        ) {
                          return null;
                        }
                        const originalPrice =
                          active && matchedItem.originalPrice !== undefined
                            ? matchedItem.originalPrice
                            : matchedItem.price;
                        const discountedPrice =
                          promo.discountType === "percentage"
                            ? Math.max(0, Math.round(originalPrice * (1 - promo.discountValue / 100)))
                            : Math.max(0, Math.round(originalPrice - promo.discountValue));
                        return (
                          <div
                            key={promo.id}
                            className="overflow-hidden rounded-[24px] border border-black/5 bg-white shadow-[0_8px_24px_-14px_rgba(0,0,0,0.18)]"
                          >
                            <div className="relative aspect-[16/10] overflow-hidden bg-zinc-100">
                              {matchedItem.image ? (
                                <img
                                  src={matchedItem.image}
                                  alt={matchedItem.name}
                                  loading="lazy"
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <div className="h-full w-full" style={{ backgroundColor: primaryColor }} />
                              )}
                              <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
                              <div className="absolute right-4 top-4">
                                {active ? (
                                  <span className="rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white">
                                    ACTIVO
                                  </span>
                                ) : (
                                  <span className="rounded-full border border-white/40 bg-black/30 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur">
                                    PRÓXIMO
                                  </span>
                                )}
                              </div>
                              <div className="absolute bottom-0 left-0 right-0 p-4">
                                <h3 className="text-xl font-bold leading-tight text-white drop-shadow-sm">
                                  {matchedItem.name}
                                </h3>
                              </div>
                            </div>
                            <div className="p-4">
                              <p className="text-xs text-zinc-500">
                                {promo.fromTime}–{promo.toTime}
                                {promo.days.length > 0 &&
                                  ` · ${promo.days.map((d) => DAYS_SHORT[d]).join(", ")}`}
                              </p>
                              <div className="mt-2 flex items-baseline gap-2">
                                <span className="text-sm text-zinc-400 line-through">
                                  {formatPriceARS(originalPrice)}
                                </span>
                                <span className="text-xl font-bold text-emerald-600">
                                  {formatPriceARS(discountedPrice)}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      }

                      // Category promo → photo of first item + scroll button
                      if (promo.category && promo.category !== "__none__") {
                        const firstItem = allItems.find(
                          (i) =>
                            getDisplayCategory(i) === promo.category &&
                            i.availabilityStatus !== "sold_out" &&
                            i.availabilityStatus !== "paused"
                        );
                        if (!firstItem) return null;
                        return (
                          <div
                            key={promo.id}
                            className="overflow-hidden rounded-[24px] border border-black/5 bg-white shadow-[0_8px_24px_-14px_rgba(0,0,0,0.18)]"
                          >
                            <div className="relative aspect-[16/10] overflow-hidden bg-zinc-100">
                              {firstItem?.image ? (
                                <img
                                  src={firstItem.image}
                                  alt={promo.category}
                                  loading="lazy"
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <div className="h-full w-full" style={{ backgroundColor: primaryColor }} />
                              )}
                              <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/20 to-transparent" />
                              <div className="absolute right-4 top-4">
                                {active ? (
                                  <span className="rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white">
                                    ACTIVO
                                  </span>
                                ) : (
                                  <span className="rounded-full border border-white/40 bg-black/30 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur">
                                    PRÓXIMO
                                  </span>
                                )}
                              </div>
                              <div className="absolute bottom-0 left-0 right-0 p-4">
                                <h3 className="text-xl font-bold leading-tight text-white drop-shadow-sm">
                                  {promo.category}{" "}
                                  {promo.discountType === "percentage"
                                    ? `${promo.discountValue}% off`
                                    : `$${promo.discountValue} off`}
                                </h3>
                              </div>
                            </div>
                            <div className="flex items-center justify-between gap-3 p-4">
                              <p className="text-xs text-zinc-500">
                                {promo.fromTime}–{promo.toTime}
                                {promo.days.length > 0 &&
                                  ` · ${promo.days.map((d) => DAYS_SHORT[d]).join(", ")}`}
                              </p>
                              <button
                                onClick={() => scrollToCategory(promo.category)}
                                className="shrink-0 rounded-xl px-4 py-2 text-sm font-bold text-white"
                                style={{ backgroundColor: primaryColor }}
                              >
                                Ver {promo.category}
                              </button>
                            </div>
                          </div>
                        );
                      }

                      // "Todo el menú" promo → text card
                      return (
                        <div
                          key={promo.id}
                          className={`rounded-2xl border p-4 transition ${
                            active ? "border-emerald-200 bg-emerald-50" : "border-black/8 bg-white/80"
                          }`}
                        >
                          <div className="flex flex-wrap items-center gap-2 mb-0.5">
                            <span className="font-bold text-zinc-950">{promo.name}</span>
                            {active ? (
                              <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white">
                                ACTIVO
                              </span>
                            ) : (
                              <span className="rounded-full border border-zinc-300 px-2 py-0.5 text-[10px] font-semibold text-zinc-400">
                                PRÓXIMO
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-zinc-600">
                            {promo.discountType === "percentage"
                              ? `${promo.discountValue}% off`
                              : `$${promo.discountValue} off`}{" "}
                            en todo el menú
                          </p>
                          <p className="mt-0.5 text-xs text-zinc-400">
                            {promo.fromTime}–{promo.toTime}
                            {promo.days.length > 0 &&
                              ` · ${promo.days.map((d) => DAYS_SHORT[d]).join(", ")}`}
                          </p>
                        </div>
                      );
                    })}

                    {/* 2x1 */}
                    {twoForOnePromos.map((promo) => {
                      const active = isTwoForOneActive(promo);
                      const matchedItem = promo.productName
                        ? allItems.find(
                            (i) => i.name.toLowerCase() === promo.productName.toLowerCase()
                          )
                        : null;

                      if (
                        matchedItem &&
                        (matchedItem.availabilityStatus === "sold_out" ||
                          matchedItem.availabilityStatus === "paused")
                      ) {
                        return null;
                      }

                      if (
                        matchedItem &&
                        matchedItem.availabilityStatus !== "sold_out" &&
                        matchedItem.availabilityStatus !== "paused"
                      ) {
                        return (
                          <div
                            key={promo.id}
                            className="overflow-hidden rounded-[24px] border border-black/5 bg-white shadow-[0_8px_24px_-14px_rgba(0,0,0,0.18)]"
                          >
                            <div className="relative aspect-[16/10] overflow-hidden bg-zinc-100">
                              {matchedItem.image ? (
                                <img
                                  src={matchedItem.image}
                                  alt={matchedItem.name}
                                  loading="lazy"
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <div className="h-full w-full" style={{ backgroundColor: primaryColor }} />
                              )}
                              <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
                              <div className="absolute left-4 right-4 top-4 flex items-start justify-between">
                                <span className="rounded-full bg-amber-500 px-3 py-1 text-sm font-black text-white shadow-sm">
                                  2×1
                                </span>
                                {active ? (
                                  <span className="rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white">
                                    ACTIVO
                                  </span>
                                ) : (
                                  <span className="rounded-full border border-white/40 bg-black/30 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur">
                                    PRÓXIMO
                                  </span>
                                )}
                              </div>
                              <div className="absolute bottom-0 left-0 right-0 p-4">
                                <h3 className="text-xl font-bold leading-tight text-white drop-shadow-sm">
                                  {matchedItem.name}
                                </h3>
                              </div>
                            </div>
                            <div className="p-4">
                              <p className="text-base font-semibold text-zinc-950">
                                {formatPriceARS(matchedItem.originalPrice ?? matchedItem.price)} c/u
                              </p>
                              <p className="mt-0.5 text-xs text-zinc-500">
                                {promo.fromTime}–{promo.toTime}
                                {promo.days.length > 0 &&
                                  ` · ${promo.days.map((d) => DAYS_SHORT[d]).join(", ")}`}
                              </p>
                            </div>
                          </div>
                        );
                      }

                      // No matched item → text card
                      return (
                        <div
                          key={promo.id}
                          className={`rounded-2xl border p-4 transition ${
                            active ? "border-emerald-200 bg-emerald-50" : "border-black/8 bg-white/80"
                          }`}
                        >
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <span className="font-bold text-zinc-950">{promo.name}</span>
                            {active ? (
                              <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white">
                                ACTIVO
                              </span>
                            ) : (
                              <span className="rounded-full border border-zinc-300 px-2 py-0.5 text-[10px] font-semibold text-zinc-400">
                                PRÓXIMO
                              </span>
                            )}
                            <span className="rounded-full border border-zinc-300 px-2 py-0.5 text-[10px] font-bold text-zinc-600">
                              2×1
                            </span>
                          </div>
                          <p className="text-xs text-zinc-500">
                            {promo.productName
                              ? `Pedí 2 "${promo.productName}" y pagás solo 1`
                              : "Pedí 2 iguales de cualquier producto y pagás solo 1"}
                            {" · "}
                            {promo.fromTime}–{promo.toTime}
                            {promo.days.length > 0 &&
                              ` · ${promo.days.map((d) => DAYS_SHORT[d]).join(", ")}`}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {(() => {
                const activeTwoForOnePromos = twoForOnePromos.filter(isTwoForOneActive);
                return visibleCategories.map((cat) => {
                  const items = getItemsForCategory(cat.key);
                  if (items.length === 0) return null;

                  return (
                    <section
                      key={cat.key}
                      ref={(el) => { sectionRefs.current[cat.key] = el; }}
                      data-category={cat.key}
                    >
                      {/* Category heading */}
                      <div className="mb-3 flex items-center gap-3">
                        <h2 className="text-base font-bold tracking-tight text-zinc-950">
                          {cat.label}
                        </h2>
                        <div className="h-px flex-1 bg-black/8" />
                        <span className="text-xs font-medium text-zinc-400">{items.length}</span>
                      </div>

                      <div className="space-y-5">
                        {items.map((item) => {
                          const quantity = getQuantity(item.id);
                          const tags = getItemTags(item);
                          const availability = getMenuItemAvailability({
                            ingredients: item.ingredients,
                            stockItems,
                          });
                          const hasTwoForOne = activeTwoForOnePromos.some(
                            (p) => p.productName && p.productName.toLowerCase() === item.name.toLowerCase()
                          );

                          return (
                            <MenuItemCard
                              key={item.id}
                              item={item}
                              quantity={quantity}
                              tags={tags}
                              availability={{
                                ...availability,
                                lowStock: item.lowStock ?? availability.lowStock,
                                status: item.availabilityStatus,
                                message: item.availabilityMessage,
                              }}
                              primaryColor={primaryColor}
                              formatPrice={formatPriceARS}
                              onAdd={handleAddWithoutNote}
                              onNote={openNoteModal}
                              originalPrice={item.originalPrice}
                              twoForOne={hasTwoForOne}
                            />
                          );
                        })}
                      </div>
                    </section>
                  );
                });
              })()}
            </div>
          )}
        </main>
      </div>

      {/* Cart button */}
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
                  <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-white px-1 text-[11px] font-semibold text-zinc-950">
                    {totalItems}
                  </span>
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold">Ver pedido</p>
                  <p className="text-xs text-white/70">Total: {formatPriceARS(total)}</p>
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
              className="w-full max-w-lg rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-xl"
            >
              {assistSent ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.15 }}
                  className="flex flex-col items-center py-8 text-center"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-full border border-zinc-200 bg-zinc-50">
                    <Check size={20} className="text-zinc-700" />
                  </div>
                  <p className="mt-3 text-base font-bold text-zinc-950">Solicitud enviada</p>
                  <p className="mt-1 text-sm text-zinc-500">En un momento viene el mozo.</p>
                </motion.div>
              ) : (
                <>
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-400">Mesa {table}</p>
                      <h2 className="mt-0.5 text-xl font-bold tracking-tight text-zinc-950">¿Necesitás algo?</h2>
                    </div>
                    <button
                      onClick={() => setAssistOpen(false)}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-600"
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
                        className="flex w-full items-center justify-between rounded-lg border border-zinc-200 bg-white px-5 py-4 text-left transition hover:bg-zinc-50 active:bg-zinc-100 disabled:opacity-50"
                      >
                        <span className="text-sm font-semibold text-zinc-800">{opt.label}</span>
                        <ChevronRight size={15} className="shrink-0 text-zinc-400" />
                      </button>
                    ))}
                  </div>
                </>
              )}
            </motion.div>
            <button aria-label="Cerrar" onClick={() => setAssistOpen(false)} className="absolute inset-0 -z-10" />
          </div>
        )}
      </AnimatePresence>

      {/* Product confirmation modal */}
      <AnimatePresence>
        {selectedItem && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 24 }}
              transition={{ duration: 0.18 }}
              className="w-full max-w-lg rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-xl"
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Agregar producto</p>
                  <h2 className="mt-1 text-2xl font-bold tracking-tight text-zinc-950">{selectedItem.name}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-500">
                    Elegí cuántas unidades querés y agregá una observación si hace falta.
                  </p>
                </div>
                <button
                  onClick={closeNoteModal}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-700"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="mb-4 flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Cantidad
                  </p>
                  <p className="mt-1 text-sm font-bold text-zinc-950">
                    {formatPriceARS(selectedItem.price * selectedQuantity)}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedQuantity((current) => Math.max(1, current - 1))
                    }
                    disabled={selectedQuantity <= 1}
                    className="flex h-11 w-11 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-800 disabled:opacity-35"
                    aria-label="Restar cantidad"
                  >
                    <Minus size={16} />
                  </button>

                  <span className="min-w-[32px] text-center text-lg font-black text-zinc-950">
                    {selectedQuantity}
                  </span>

                  <button
                    type="button"
                    onClick={() =>
                      setSelectedQuantity((current) =>
                        Math.min(
                          getAvailableQuantityToAdd(selectedItem),
                          current + 1
                        )
                      )
                    }
                    disabled={
                      selectedQuantity >= getAvailableQuantityToAdd(selectedItem)
                    }
                    className="flex h-11 w-11 items-center justify-center rounded-full text-white disabled:opacity-35"
                    style={{ backgroundColor: primaryColor }}
                    aria-label="Sumar cantidad"
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </div>

              <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Observación opcional
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={4}
                maxLength={140}
                placeholder="Escribí una observación para este producto..."
                className="w-full rounded-lg border border-zinc-200 p-3 text-sm outline-none transition focus:ring-2 focus:ring-black/10"
              />
              <div className="mt-2 text-right text-xs text-zinc-400">{note.length}/140</div>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <button
                  onClick={closeNoteModal}
                  className="h-12 rounded-lg border border-zinc-200 bg-white font-semibold text-zinc-700"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleAddWithNote}
                  disabled={
                    selectedItem.availabilityStatus === "sold_out" ||
                    selectedItem.availabilityStatus === "paused"
                  }
                  className="h-12 rounded-lg font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ backgroundColor: primaryColor }}
                >
                  {selectedItem.availabilityStatus === "sold_out" ||
                  selectedItem.availabilityStatus === "paused"
                    ? "Producto no disponible"
                    : `Agregar ${selectedQuantity} al pedido`}
                </button>
              </div>
            </motion.div>
            <button aria-label="Close modal" onClick={closeNoteModal} className="absolute inset-0 -z-10" />
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Menu;
