import { createContext, useContext, useState, type ReactNode } from "react";
import type { CartItem, MenuItem } from "@/lib/store";

interface CartContextType {
  cart: CartItem[];
  addToCart: (item: MenuItem) => void;
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

export const CartProvider = ({ children }: { children: ReactNode }) => {
  const [cart, setCart] = useState<CartItem[]>([]);

  const addToCart = (item: MenuItem) => {
    const normalizedObservation = normalizeObservation(item.observacion);
    const targetKey = getCartItemKey(item.id, normalizedObservation);

    setCart((prev) => {
      const existingIndex = prev.findIndex(
        (cartItem) =>
          getCartItemKey(cartItem.id, cartItem.observacion) === targetKey
      );

      if (existingIndex !== -1) {
        const updated = [...prev];
        updated[existingIndex] = {
          ...updated[existingIndex],
          quantity: updated[existingIndex].quantity + 1,
        };
        return updated;
      }

      return [
        ...prev,
        {
          ...item,
          observacion: normalizedObservation,
          quantity: 1,
        },
      ];
    });
  };

  const removeFromCart = (id: string, observacion?: string) => {
    const targetKey = getCartItemKey(id, observacion);

    setCart((prev) => {
      const existingIndex = prev.findIndex(
        (cartItem) =>
          getCartItemKey(cartItem.id, cartItem.observacion) === targetKey
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
        (cartItem) =>
          getCartItemKey(cartItem.id, cartItem.observacion) !== targetKey
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
      (cartItem) =>
        getCartItemKey(cartItem.id, cartItem.observacion) === targetKey
    );

    return found?.quantity || 0;
  };

  const totalItems = cart.reduce((sum, cartItem) => sum + cartItem.quantity, 0);

  const total = cart.reduce(
    (sum, cartItem) => sum + cartItem.price * cartItem.quantity,
    0
  );

  const clearCart = () => setCart([]);

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