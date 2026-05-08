import type { VercelRequest, VercelResponse } from "@vercel/node";
import admin from "firebase-admin";

type StockUnit = "kg" | "g" | "l" | "ml" | "unit";

type PedidoItemInput = {
  id?: string;
  nombre: string;
  name?: string;
  cantidad: number;
  quantity?: number;
  precio?: number;
  price?: number;
  subtotal?: number;
  category: "food" | "drinks";
  displayCategory?: string;
  observacion?: string;
  note?: string;
};

type PedidoInput = {
  restaurantId: string;
  mesa: number;
  items: PedidoItemInput[];
  total: number;
};

type MenuIngredient = {
  stockItemId: string;
  stockItemName: string;
  quantity: number;
  unit: StockUnit;
  essential: boolean;
};

type MenuItemDoc = {
  name?: string;
  price?: number;
  type?: "food" | "drinks";
  category?: string;
  active?: boolean;
  ingredients?: MenuIngredient[];
};

type StockItemDoc = {
  name?: string;
  unit?: StockUnit;
  currentQuantity?: number;
  minimumQuantity?: number;
  active?: boolean;
};

const app =
  admin.apps.length > 0
    ? admin.app()
    : admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
        }),
      });

const db = app.firestore();

const toBaseUnit = (quantity: number, unit: StockUnit) => {
  if (unit === "kg") return quantity * 1000;
  if (unit === "g") return quantity;
  if (unit === "l") return quantity * 1000;
  if (unit === "ml") return quantity;
  return quantity;
};

const fromBaseUnit = (quantity: number, unit: StockUnit) => {
  if (unit === "kg") return quantity / 1000;
  if (unit === "l") return quantity / 1000;
  return quantity;
};

const compatibleUnits = (recipeUnit: StockUnit, stockUnit: StockUnit) => {
  if (recipeUnit === stockUnit) return true;

  const weight = ["kg", "g"];
  const liquid = ["l", "ml"];

  return (
    (weight.includes(recipeUnit) && weight.includes(stockUnit)) ||
    (liquid.includes(recipeUnit) && liquid.includes(stockUnit))
  );
};

const normalizeObservation = (value?: string) => value?.trim() || "";

const mergeObservations = (...values: string[]) => {
  return values.map((v) => v.trim()).filter(Boolean).join(" · ");
};

const validatePedido = (pedido: PedidoInput) => {
  if (!pedido.restaurantId || typeof pedido.restaurantId !== "string") {
    throw new Error("Falta restaurantId");
  }

  if (!Number.isInteger(pedido.mesa) || pedido.mesa <= 0) {
    throw new Error("Mesa inválida");
  }

  if (!Array.isArray(pedido.items) || pedido.items.length === 0) {
    throw new Error("El pedido no tiene productos");
  }

  if (
    typeof pedido.total !== "number" ||
    !Number.isFinite(pedido.total) ||
    pedido.total < 0
  ) {
    throw new Error("Total inválido");
  }
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Método no permitido",
    });
  }

  try {
    const pedido = req.body as PedidoInput;
    validatePedido(pedido);

    const restaurantId = pedido.restaurantId.trim();
    const mesa = Number(pedido.mesa);

    const pedidoId = await db.runTransaction(async (transaction) => {
      const restaurantRef = db.doc(`restaurants/${restaurantId}`);
      const restaurantSnap = await transaction.get(restaurantRef);

      if (!restaurantSnap.exists) {
        throw new Error("Restaurante inexistente");
      }

      const restaurantData = restaurantSnap.data() || {};
      const isPremium = restaurantData.plan === "premium";

      const mesaRef = db.doc(`restaurants/${restaurantId}/mesas/${mesa}`);
      const mesaSnap = await transaction.get(mesaRef);

      let sessionId: string | null = null;
      const mesaData = mesaSnap.exists ? mesaSnap.data() || {} : {};
      const activeSessionId = mesaData.activeSessionId;

      if (
        typeof activeSessionId === "string" &&
        activeSessionId.length > 0 &&
        (mesaData.estado === "occupied" || mesaData.estado === "needs_cleaning")
      ) {
        const sessionRef = db.doc(
          `restaurants/${restaurantId}/sessions/${activeSessionId}`
        );
        const sessionSnap = await transaction.get(sessionRef);

        if (!sessionSnap.exists) {
          throw new Error("La mesa tiene una sesión inválida");
        }

        const sessionData = sessionSnap.data() || {};

        if (sessionData.status !== "active") {
          throw new Error("La sesión de la mesa no está activa");
        }

        sessionId = activeSessionId;
      }

      if (!sessionId) {
        sessionId = crypto.randomUUID();

        const sessionRef = db.doc(
          `restaurants/${restaurantId}/sessions/${sessionId}`
        );

        transaction.set(sessionRef, {
          restaurantId,
          tableNumber: mesa,
          status: "active",
          openedAt: admin.firestore.FieldValue.serverTimestamp(),
          closedAt: null,
          closedReason: null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      const normalizedItems = [];
      const stockRefMap = new Map<string, FirebaseFirestore.DocumentReference>();
      const stockRequiredBaseMap = new Map<string, number>();
      const stockMovementMeta = new Map<
        string,
        {
          stockItemName: string;
          stockUnit: StockUnit;
        }
      >();

      let tieneComida = false;
      let tieneBebidas = false;

      for (const rawItem of pedido.items) {
        if (!rawItem.id) {
          throw new Error("Hay un producto inválido en el pedido");
        }

        const menuRef = db.doc(
          `restaurants/${restaurantId}/menu/${rawItem.id}`
        );
        const menuSnap = await transaction.get(menuRef);

        if (!menuSnap.exists) {
          throw new Error("Uno de los productos ya no está disponible");
        }

        const menuData = menuSnap.data() as MenuItemDoc;

        if (menuData.active === false) {
          throw new Error(`${menuData.name || rawItem.nombre} no está disponible`);
        }

        const quantity = Number(rawItem.cantidad || rawItem.quantity || 1);

        if (!Number.isFinite(quantity) || quantity <= 0) {
          throw new Error("Cantidad inválida en el pedido");
        }

        const itemCategory = menuData.type === "drinks" ? "drinks" : "food";

        if (itemCategory === "drinks") tieneBebidas = true;
        if (itemCategory === "food") tieneComida = true;

        const itemStockMovements = [];
        const missingOptionalIngredients: string[] = [];

        if (isPremium && Array.isArray(menuData.ingredients)) {
          for (const ingredient of menuData.ingredients) {
            const stockRef = db.doc(
              `restaurants/${restaurantId}/stock/${ingredient.stockItemId}`
            );

            const stockSnap = await transaction.get(stockRef);

            if (!stockSnap.exists) {
              if (ingredient.essential) {
                throw new Error(
                  `${menuData.name || rawItem.nombre} no está disponible por falta de ${ingredient.stockItemName}`
                );
              }

              missingOptionalIngredients.push(ingredient.stockItemName);
              continue;
            }

            const stockData = stockSnap.data() as StockItemDoc;

            if (stockData.active === false) {
              if (ingredient.essential) {
                throw new Error(
                  `${menuData.name || rawItem.nombre} no está disponible por falta de ${ingredient.stockItemName}`
                );
              }

              missingOptionalIngredients.push(ingredient.stockItemName);
              continue;
            }

            const stockUnit = stockData.unit || "unit";

            if (!compatibleUnits(ingredient.unit, stockUnit)) {
              throw new Error(
                `Unidad incompatible en ${ingredient.stockItemName}`
              );
            }

            const availableBase = toBaseUnit(
              Number(stockData.currentQuantity || 0),
              stockUnit
            );

            const requiredPerUnitBase = toBaseUnit(
              Number(ingredient.quantity || 0),
              ingredient.unit
            );

            const requiredTotalBase = requiredPerUnitBase * quantity;

            if (requiredPerUnitBase <= 0) continue;

            if (availableBase < requiredTotalBase) {
              const maxAvailable = Math.floor(
                availableBase / requiredPerUnitBase
              );

              if (ingredient.essential) {
                throw new Error(
                  `Nos quedan ${maxAvailable} ${menuData.name || rawItem.nombre} en stock.`
                );
              }

              missingOptionalIngredients.push(ingredient.stockItemName);
              continue;
            }

            const previousRequired =
              stockRequiredBaseMap.get(ingredient.stockItemId) || 0;

            stockRequiredBaseMap.set(
              ingredient.stockItemId,
              previousRequired + requiredTotalBase
            );

            stockRefMap.set(ingredient.stockItemId, stockRef);
            stockMovementMeta.set(ingredient.stockItemId, {
              stockItemName: stockData.name || ingredient.stockItemName,
              stockUnit,
            });

            itemStockMovements.push({
              stockItemId: ingredient.stockItemId,
              stockItemName: stockData.name || ingredient.stockItemName,
              quantity: fromBaseUnit(requiredTotalBase, stockUnit),
              unit: stockUnit,
              quantityInBaseUnit: requiredTotalBase,
            });
          }
        }

        const automaticObservation =
          missingOptionalIngredients.length > 0
            ? `Sin ${missingOptionalIngredients.join(", ")} por falta de stock.`
            : "";

        const itemName = menuData.name || rawItem.nombre || "Producto";
        const itemPrice = Number(menuData.price || rawItem.precio || rawItem.price || 0);

        normalizedItems.push({
          id: rawItem.id,
          nombre: itemName,
          name: itemName,
          cantidad: quantity,
          quantity,
          precio: itemPrice,
          price: itemPrice,
          subtotal: itemPrice * quantity,
          category: itemCategory,
          displayCategory: rawItem.displayCategory || menuData.category || "",
          observacion: mergeObservations(
            normalizeObservation(rawItem.observacion || rawItem.note),
            automaticObservation
          ),
          note: mergeObservations(
            normalizeObservation(rawItem.observacion || rawItem.note),
            automaticObservation
          ),
          stockMovements: itemStockMovements,
        });
      }

      if (isPremium) {
        for (const [stockItemId, requiredBase] of stockRequiredBaseMap.entries()) {
          const stockRef = stockRefMap.get(stockItemId);

          if (!stockRef) continue;

          const stockSnap = await transaction.get(stockRef);

          if (!stockSnap.exists) {
            throw new Error("El stock cambió. Reintentá el pedido.");
          }

          const stockData = stockSnap.data() as StockItemDoc;
          const stockUnit = stockData.unit || "unit";
          const availableBase = toBaseUnit(
            Number(stockData.currentQuantity || 0),
            stockUnit
          );

          if (availableBase < requiredBase) {
            throw new Error("El stock cambió. Reintentá el pedido.");
          }

          const nextBase = availableBase - requiredBase;
          const nextQuantity = fromBaseUnit(nextBase, stockUnit);

          transaction.update(stockRef, {
            currentQuantity: nextQuantity,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      }

      transaction.set(
        mesaRef,
        {
          restaurantId,
          numero: mesa,
          estado: "occupied",
          activeSessionId: sessionId,
          cleanedAt: null,
          createdAt:
            mesaData.createdAt || admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      const pedidoRef = db.collection(`restaurants/${restaurantId}/pedidos`).doc();

      transaction.set(pedidoRef, {
        restaurantId,
        mesa,
        items: normalizedItems,
        total: normalizedItems.reduce(
          (sum, item) => sum + Number(item.subtotal || 0),
          0
        ),
        sessionId,
        estadoCocina: tieneComida ? "pendiente" : null,
        estadoBarra: tieneBebidas ? "pendiente" : null,
        cancelado: false,
        stockReturned: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return pedidoRef.id;
    });

    return res.status(200).json({
      ok: true,
      pedidoId,
    });
  } catch (error) {
    console.error("Error creando pedido:", error);

    return res.status(400).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "No se pudo crear el pedido",
    });
  }
}