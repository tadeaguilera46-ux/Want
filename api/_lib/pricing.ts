/**
 * Motor único de precios — lógica idéntica al frontend (PromotionsPanel.tsx).
 * Importar en cada endpoint que cree o lea pedidos con precios.
 */

export const PROMO_CATEGORY_NONE = "__none__";

export type PromoDoc = {
  category?: string;
  productName?: string;
  discountType?: "percentage" | "fixed";
  discountValue?: number;
  fromTime?: string;
  toTime?: string;
  days?: number[];
  active?: boolean;
};

export type TwoForOneDoc = {
  productName?: string;
  fromTime?: string;
  toTime?: string;
  days?: number[];
  active?: boolean;
};

const isScheduleActive = (
  promo: { active?: boolean; days?: number[]; fromTime?: string; toTime?: string },
  now: Date
): boolean => {
  if (!promo.active) return false;
  const day = now.getDay();
  const days = promo.days ?? [];
  if (days.length > 0 && !days.includes(day)) return false;
  const fromStr = promo.fromTime ?? "00:00";
  const toStr = promo.toTime ?? "23:59";
  const fh = Number(fromStr.split(":")[0]) || 0;
  const fm = Number(fromStr.split(":")[1]) || 0;
  const th = Number(toStr.split(":")[0]) || 0;
  const tm = Number(toStr.split(":")[1]) || 0;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const fromMin = fh * 60 + fm;
  const toMin = th * 60 + tm;
  if (fromMin <= toMin) return nowMin >= fromMin && nowMin <= toMin;
  return nowMin >= fromMin || nowMin <= toMin;
};

/**
 * Aplica el descuento de la primera promoción activa que coincide con el ítem.
 * Retorna el precio final y el precio original si se aplicó algún descuento.
 */
export const applyPromotion = (
  basePrice: number,
  itemName: string,
  itemCategory: string,
  promotions: PromoDoc[],
  now: Date
): { price: number; originalPrice?: number } => {
  const promo = promotions.find((p) => {
    if (!isScheduleActive(p, now)) return false;
    if (p.productName) return p.productName.toLowerCase() === itemName.toLowerCase();
    if (p.category === PROMO_CATEGORY_NONE) return false;
    return !p.category || p.category === itemCategory;
  });

  if (!promo) return { price: basePrice };

  const discount =
    promo.discountType === "percentage"
      ? basePrice * ((promo.discountValue ?? 0) / 100)
      : (promo.discountValue ?? 0);

  return {
    price: Math.max(0, Math.round(basePrice - discount)),
    originalPrice: basePrice,
  };
};

/**
 * Calcula el subtotal aplicando 2x1 si hay una promo activa para el ítem.
 * En 2x1: por cada 2 unidades se paga 1 (se redondea hacia arriba).
 */
export const applyTwoForOne = (
  quantity: number,
  unitPrice: number,
  itemName: string,
  twoForOnePromos: TwoForOneDoc[],
  now: Date
): { subtotal: number; twoForOneApplied: boolean } => {
  const promo = twoForOnePromos.find(
    (p) =>
      isScheduleActive(p, now) &&
      !!p.productName &&
      p.productName.toLowerCase() === itemName.toLowerCase()
  );

  if (!promo) return { subtotal: unitPrice * quantity, twoForOneApplied: false };

  const paidQuantity = Math.ceil(quantity / 2);
  return { subtotal: unitPrice * paidQuantity, twoForOneApplied: true };
};
