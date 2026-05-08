import type { MenuIngredient } from "./store";
import type { StockItem, StockUnit } from "../types/stock";

export type AvailabilityResult = {
  visible: boolean;
  maxQuantity: number | null;
  lowStock: boolean;
  missingEssentialIngredients: string[];
  missingOptionalIngredients: string[];
};

const toBaseUnit = (quantity: number, unit: StockUnit) => {
  if (unit === "kg") return quantity * 1000;
  if (unit === "g") return quantity;
  if (unit === "l") return quantity * 1000;
  if (unit === "ml") return quantity;
  return quantity;
};

const areCompatibleUnits = (recipeUnit: StockUnit, stockUnit: StockUnit) => {
  if (recipeUnit === stockUnit) return true;

  const weight = ["kg", "g"];
  const liquid = ["l", "ml"];

  return (
    (weight.includes(recipeUnit) && weight.includes(stockUnit)) ||
    (liquid.includes(recipeUnit) && liquid.includes(stockUnit))
  );
};

export const getStockItemById = (
  stockItems: StockItem[],
  stockItemId: string
) => stockItems.find((item) => item.id === stockItemId) || null;

export const getMenuItemAvailability = ({
  ingredients,
  stockItems,
}: {
  ingredients?: MenuIngredient[];
  stockItems: StockItem[];
}): AvailabilityResult => {
  if (!ingredients || ingredients.length === 0) {
    return {
      visible: true,
      maxQuantity: null,
      lowStock: false,
      missingEssentialIngredients: [],
      missingOptionalIngredients: [],
    };
  }

  let maxQuantity: number | null = null;
  let lowStock = false;

  const missingEssentialIngredients: string[] = [];
  const missingOptionalIngredients: string[] = [];

  for (const ingredient of ingredients) {
    const stockItem = getStockItemById(stockItems, ingredient.stockItemId);

    if (!stockItem || stockItem.active === false) {
      if (ingredient.essential) {
        missingEssentialIngredients.push(ingredient.stockItemName);
      } else {
        missingOptionalIngredients.push(ingredient.stockItemName);
      }
      continue;
    }

    if (!areCompatibleUnits(ingredient.unit, stockItem.unit)) {
      if (ingredient.essential) {
        missingEssentialIngredients.push(ingredient.stockItemName);
      } else {
        missingOptionalIngredients.push(ingredient.stockItemName);
      }
      continue;
    }

    const available = toBaseUnit(
      Number(stockItem.currentQuantity || 0),
      stockItem.unit
    );

    const required = toBaseUnit(Number(ingredient.quantity || 0), ingredient.unit);

    if (required <= 0) continue;

    const possibleQuantity = Math.floor(available / required);

    if (possibleQuantity <= 0) {
      if (ingredient.essential) {
        missingEssentialIngredients.push(ingredient.stockItemName);
      } else {
        missingOptionalIngredients.push(ingredient.stockItemName);
      }
      continue;
    }

    if (ingredient.essential) {
      maxQuantity =
        maxQuantity === null
          ? possibleQuantity
          : Math.min(maxQuantity, possibleQuantity);
    }

    if (
      Number(stockItem.currentQuantity || 0) <=
      Number(stockItem.minimumQuantity || 0)
    ) {
      lowStock = true;
    }
  }

  return {
    visible: missingEssentialIngredients.length === 0,
    maxQuantity,
    lowStock,
    missingEssentialIngredients,
    missingOptionalIngredients,
  };
};

export const buildMissingOptionalObservation = (ingredients: string[]) => {
  if (ingredients.length === 0) return "";

  return `Sin ${ingredients.join(", ")} por falta de stock.`;
};