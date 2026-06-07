import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { doc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import type { CartItem, MenuItem } from "@/lib/store";
import { getStoredTableSessionId } from "./table-session";
import { getDb } from "./firebase";

interface CartContextType {
  cart: CartItem[];
  addToCart: (item: MenuItem, quantity?: number) => void;
  removeFromCart: (id: string, observacion?: string) => void;
  getQuantity: (id: string) => number;
  getItemQuantity: (id: string, observacion?: string) => number;
  totalItems: number;
  total: number;
  clearCart: () => void;
}

const CartContext = createContext<CartContextType | null>(null);

export const useCart = () => {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
};

const normalizeObservation = (value?: string) => value?.trim() || "";

const getCartItemKey = (id: string, observacion?: string) => {
  return `${id}__${normalizeObservation(observacion)}`;
};

const buildStorageKey = (restaurantId: string, table: number, sessionId: string) =>
  `want:cart:${restaurantId}:${table}:${sessionId}`;

const loadCart = (key: string): CartItem[] => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as CartItem[]) : [];
  } catch {
    return [];
  }
};

const saveCart = (key: string, cart: CartItem[]) => {
  try {
    if (cart.length > 0) {
      localStorage.setItem(key, JSON.stringify(cart));
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // localStorage unavailable — cart won't persist this session
  }
};

export const CartProvider = ({ children }: { children: ReactNode }) => {
  const [searchParams] = useSearchParams();

  const restaurantId = searchParams.get("restaurantId")?.trim() || null;
  const rawTable = searchParams.get("table")?.trim() || null;
  const parsedTable = rawTable ? parseInt(rawTable, 10) : NaN;
  const tableNumber = Number.isInteger(parsedTable) && parsedTable > 0 ? parsedTable : null;

  const sessionId = (() => {
    if (!restaurantId || !tableNumber) return null;
    return getStoredTableSessionId({ restaurantId, table: tableNumber });
  })();

  const storageKey = sessionId
    ? buildStorageKey(restaurantId!, tableNumber!, sessionId)
    : null;

  // Tracks the last storageKey seen to detect null→value transitions
  const storageKeyRef = useRef<string | null>(storageKey);
  // JSON of the last cart state synced to/from Firestore — prevents write-back loops
  const lastFirestoreDataRef = useRef<string>("");
  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [cart, setCart] = useState<CartItem[]>(() =>
    storageKey ? loadCart(storageKey) : []
  );

  // localStorage persistence with null→value key transition guard
  useEffect(() => {
    if (!storageKey) {
      storageKeyRef.current = null;
      return;
    }
    if (storageKeyRef.current !== storageKey) {
      // storageKey just became available — load instead of overwriting with []
      storageKeyRef.current = storageKey;
      setCart(loadCart(storageKey));
      return;
    }
    saveCart(storageKey, cart);
  }, [cart, storageKey]);

  // Cross-tab sync via localStorage storage event (same browser, different tabs)
  useEffect(() => {
    if (!storageKey) return;
    const handleStorage = (e: StorageEvent) => {
      if (e.key !== storageKey) return;
      const incoming = e.newValue ? (JSON.parse(e.newValue) as CartItem[]) : [];
      // Mark as already synced so Effect 4 doesn't write it back to Firestore
      lastFirestoreDataRef.current = JSON.stringify(incoming);
      setCart(incoming);
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [storageKey]);

  // Cross-device sync via Firestore onSnapshot
  useEffect(() => {
    if (!restaurantId || !tableNumber || !sessionId) return;
    const db = getDb();
    const cartRef = doc(db, "restaurants", restaurantId, "carts", sessionId);
    const unsub = onSnapshot(
      cartRef,
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        if (!Array.isArray(data.items)) return;
        const items = data.items as CartItem[];
        const serialized = JSON.stringify(items);
        // Mark as synced so the write effect skips writing back the same data
        lastFirestoreDataRef.current = serialized;
        setCart(items);
      },
      (err) => console.error("Cart Firestore sync error:", err)
    );
    return unsub;
  }, [restaurantId, tableNumber, sessionId]);

  // Debounced Firestore write when cart changes locally
  useEffect(() => {
    if (!restaurantId || !sessionId || !storageKey) return;
    const serialized = JSON.stringify(cart);
    // Skip if already synced (came from Firestore or from another tab)
    if (serialized === lastFirestoreDataRef.current) return;

    if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
    writeTimerRef.current = setTimeout(() => {
      const db = getDb();
      const cartRef = doc(db, "restaurants", restaurantId, "carts", sessionId);
      lastFirestoreDataRef.current = serialized;
      setDoc(cartRef, { items: cart, updatedAt: serverTimestamp() }).catch(console.error);
    }, 400);

    return () => {
      if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, restaurantId, sessionId, storageKey]);

  const addToCart = (item: MenuItem, quantity = 1) => {
    const safeQuantity =
      Number.isInteger(quantity) && quantity > 0 ? quantity : 1;
    const normalizedObservation = normalizeObservation(item.observacion);
    const targetKey = getCartItemKey(item.id, normalizedObservation);

    setCart((prev) => {
      const existingIndex = prev.findIndex(
        (cartItem) => getCartItemKey(cartItem.id, cartItem.observacion) === targetKey
      );

      if (existingIndex !== -1) {
        const updated = [...prev];
        updated[existingIndex] = {
          ...updated[existingIndex],
          quantity: updated[existingIndex].quantity + safeQuantity,
        };
        return updated;
      }

      return [
        ...prev,
        {
          ...item,
          observacion: normalizedObservation,
          quantity: safeQuantity,
        },
      ];
    });
  };

  const removeFromCart = (id: string, observacion?: string) => {
    const targetKey = getCartItemKey(id, observacion);

    setCart((prev) => {
      const existingIndex = prev.findIndex(
        (cartItem) => getCartItemKey(cartItem.id, cartItem.observacion) === targetKey
      );

      if (existingIndex === -1) return prev;

      const currentItem = prev[existingIndex];

      if (currentItem.quantity > 1) {
        const updated = [...prev];
        updated[existingIndex] = {
          ...currentItem,
          quantity: currentItem.quantity - 1,
        };
        return updated;
      }

      return prev.filter(
        (cartItem) => getCartItemKey(cartItem.id, cartItem.observacion) !== targetKey
      );
    });
  };

  const getQuantity = (id: string) => {
    return cart
      .filter((cartItem) => cartItem.id === id)
      .reduce((sum, cartItem) => sum + cartItem.quantity, 0);
  };

  const getItemQuantity = (id: string, observacion?: string) => {
    const targetKey = getCartItemKey(id, observacion);
    const found = cart.find(
      (cartItem) => getCartItemKey(cartItem.id, cartItem.observacion) === targetKey
    );
    return found?.quantity || 0;
  };

  const totalItems = cart.reduce((sum, cartItem) => sum + cartItem.quantity, 0);

  const total = cart.reduce(
    (sum, cartItem) => sum + cartItem.price * cartItem.quantity,
    0
  );

  const clearCart = () => {
    if (storageKey) {
      try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
    }
    // Propagate clear to all devices sharing this session
    if (restaurantId && sessionId) {
      const db = getDb();
      const cartRef = doc(db, "restaurants", restaurantId, "carts", sessionId);
      lastFirestoreDataRef.current = "[]";
      setDoc(cartRef, { items: [], updatedAt: serverTimestamp() }).catch(console.error);
    }
    setCart([]);
  };

  return (
    <CartContext.Provider
      value={{
        cart,
        addToCart,
        removeFromCart,
        getQuantity,
        getItemQuantity,
        totalItems,
        total,
        clearCart,
      }}
    >
      {children}
    </CartContext.Provider>
  );
};
