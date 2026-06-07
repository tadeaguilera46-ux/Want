import type { VercelRequest, VercelResponse } from "@vercel/node";
import admin from "firebase-admin";

type StockUnit = "kg" | "g" | "l" | "ml" | "unit";

type MenuIngredient = {
  stockItemId?: string;
  stockItemName?: string;
  quantity?: number;
  unit?: StockUnit;
  essential?: boolean;
};

type StockItem = {
  active?: boolean;
  currentQuantity?: number;
  minimumQuantity?: number;
  unit?: StockUnit;
};

const getAdminDb = () => {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
    });
  }

  return admin.firestore();
};

const toBaseUnit = (quantity: number, unit: StockUnit) => {
  if (unit === "kg" || unit === "l") return quantity * 1000;
  return quantity;
};

const areCompatibleUnits = (recipeUnit: StockUnit, stockUnit: StockUnit) => {
  if (recipeUnit === stockUnit) return true;

  return (
    (["kg", "g"].includes(recipeUnit) && ["kg", "g"].includes(stockUnit)) ||
    (["l", "ml"].includes(recipeUnit) && ["l", "ml"].includes(stockUnit))
  );
};

const getAvailability = (
  ingredients: MenuIngredient[],
  stockById: Map<string, StockItem>,
  stockEnabled: boolean
) => {
  if (!stockEnabled || ingredients.length === 0) {
    return {
      availabilityStatus: "available",
      availabilityMessage: null,
      lowStock: false,
      maxQuantity: null,
      missingOptionalIngredients: [],
    };
  }

  let maxQuantity: number | null = null;
  let lowStock = false;
  const missingEssentialIngredients: string[] = [];
  const missingOptionalIngredients: string[] = [];

  for (const ingredient of ingredients) {
    const ingredientName = ingredient.stockItemName || "un ingrediente";
    const stockItem = ingredient.stockItemId
      ? stockById.get(ingredient.stockItemId)
      : null;
    const recipeUnit = ingredient.unit || "unit";
    const stockUnit = stockItem?.unit || "unit";

    if (
      !stockItem ||
      stockItem.active === false ||
      !areCompatibleUnits(recipeUnit, stockUnit)
    ) {
      (ingredient.essential
        ? missingEssentialIngredients
        : missingOptionalIngredients
      ).push(ingredientName);
      continue;
    }

    const required = toBaseUnit(Number(ingredient.quantity || 0), recipeUnit);
    const available = toBaseUnit(
      Number(stockItem.currentQuantity || 0),
      stockUnit
    );

    if (required <= 0) continue;

    const possibleQuantity = Math.floor(available / required);

    if (possibleQuantity <= 0) {
      (ingredient.essential
        ? missingEssentialIngredients
        : missingOptionalIngredients
      ).push(ingredientName);
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
    availabilityStatus:
      missingEssentialIngredients.length > 0 ? "sold_out" : "available",
    availabilityMessage:
      missingEssentialIngredients.length > 0 ? "Temporalmente agotado" : null,
    lowStock,
    maxQuantity,
    missingOptionalIngredients,
  };
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  const restaurantId =
    typeof req.query.restaurantId === "string"
      ? req.query.restaurantId.trim()
      : "";

  if (
    !restaurantId ||
    restaurantId.length > 128 ||
    !/^[A-Za-z0-9_-]+$/.test(restaurantId)
  ) {
    return res.status(400).json({ ok: false, error: "Restaurante inválido" });
  }

  try {
    const db = getAdminDb();
    const [restaurantSnap, menuSnap, stockSnap] = await Promise.all([
      db.doc(`restaurants/${restaurantId}`).get(),
      db.collection(`restaurants/${restaurantId}/menu`).get(),
      db.collection(`restaurants/${restaurantId}/stock`).get(),
    ]);
    const stockEnabled = restaurantSnap.data()?.plan === "premium";
    const stockById = new Map<string, StockItem>();
    stockSnap.docs.forEach((stockDoc) => {
      stockById.set(stockDoc.id, stockDoc.data() as StockItem);
    });

    const items = menuSnap.docs.map((menuDoc) => {
      const data = menuDoc.data();
      const ingredients = Array.isArray(data.ingredients)
        ? (data.ingredients as MenuIngredient[])
        : [];
      const availability =
        data.active === false
          ? {
              availabilityStatus: "paused",
              availabilityMessage: "Temporalmente pausado",
              lowStock: false,
              maxQuantity: 0,
              missingOptionalIngredients: [],
            }
          : getAvailability(ingredients, stockById, stockEnabled);

      return {
        id: menuDoc.id,
        name: data.name,
        price: data.price,
        description: data.description,
        type: data.type,
        category: data.category,
        active: data.active !== false,
        image: data.image,
        ingredients,
        availableFrom: data.availableFrom,
        availableTo: data.availableTo,
        availableDays: data.availableDays,
        allergens: data.allergens,
        modifierGroups: data.modifierGroups,
        comboItems: data.comboItems,
        ...availability,
      };
    });

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ok: true, items });
  } catch (error) {
    console.error("Error cargando menú público:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudo cargar el menú",
    });
  }
}
