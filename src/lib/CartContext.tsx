import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type { CartItem, MenuItem } from "@/lib/store";
import { getStoredTableSessionId } from "./table-session";

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

  const storageKey = (() => {
    if (!restaurantId || !tableNumber) return null;
    const sessionId = getStoredTableSessionId({ restaurantId, table: tableNumber });
    if (!sessionId) return null;
    return buildStorageKey(restaurantId, tableNumber, sessionId);
  })();

  // Tracks the last storageKey this effect saw, so we can detect null→value transitions
  const storageKeyRef = useRef<string | null>(storageKey);

  const [cart, setCart] = useState<CartItem[]>(() =>
    storageKey ? loadCart(storageKey) : []
  );

  useEffect(() => {
    if (!storageKey) {
      storageKeyRef.current = null;
      return;
    }
    if (storageKeyRef.current !== storageKey) {
      // storageKey just became available (new tab, sessionStorage was empty on mount).
      // Load the existing cart instead of overwriting localStorage with [].
      storageKeyRef.current = storageKey;
      setCart(loadCart(storageKey));
      return;
    }
    saveCart(storageKey, cart);
  }, [cart, storageKey]);

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
