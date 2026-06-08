export const PROMO_CATEGORY_NONE = "__none__";

export type Promotion = {
  id: string;
  name: string;
  category: string;
  productName: string;
  discountType: "percentage" | "fixed";
  discountValue: number;
  fromTime: string;
  toTime: string;
  days: number[];
  active: boolean;
};

export type TwoForOnePromo = {
  id: string;
  name: string;
  productName: string;
  fromTime: string;
  toTime: string;
  days: number[];
  active: boolean;
};

export type TwoForOneItem = {
  name: string;
  price: number;
  quantity: number;
};

type ScheduledPromo = Pick<Promotion | TwoForOnePromo, "active" | "days" | "fromTime" | "toTime">;

export const isActiveSchedule = (promo: ScheduledPromo): boolean => {
  if (!promo.active) return false;
  const now = new Date();
  const day = now.getDay();
  if (promo.days.length > 0 && !promo.days.includes(day)) return false;
  const [fh, fm] = promo.fromTime.split(":").map(Number);
  const [th, tm] = promo.toTime.split(":").map(Number);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const fromMin = fh * 60 + fm;
  const toMin = th * 60 + tm;
  if (fromMin <= toMin) return nowMin >= fromMin && nowMin <= toMin;
  return nowMin >= fromMin || nowMin <= toMin;
};

export const isPromotionActive = (promo: Promotion): boolean =>
  isActiveSchedule(promo);

export const isTwoForOneActive = (promo: TwoForOnePromo): boolean =>
  isActiveSchedule(promo);

/**
 * Calcula el descuento 2x1 dado una lista de ítems ya agrupados y las promos activas.
 * Por cada 2 unidades del mismo producto, 1 es gratis (Math.floor(qty / 2) * precio).
 */
export const calcTwoForOneDiscount = (
  items: TwoForOneItem[],
  promos: TwoForOnePromo[]
): number => {
  const activePromos = promos.filter(isTwoForOneActive);
  if (activePromos.length === 0) return 0;

  const grouped = new Map<string, { price: number; quantity: number }>();
  for (const item of items) {
    const existing = grouped.get(item.name);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      grouped.set(item.name, { price: item.price, quantity: item.quantity });
    }
  }

  let discount = 0;
  for (const [itemName, { price, quantity }] of grouped) {
    const matches = activePromos.some(
      (p) => !p.productName || p.productName.toLowerCase() === itemName.toLowerCase()
    );
    if (!matches) continue;
    discount += Math.floor(quantity / 2) * price;
  }

  return discount;
};
