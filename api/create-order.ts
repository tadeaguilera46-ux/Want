import * as Sentry from "@sentry/node";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import admin from "firebase-admin";
import { UserFacingError, toApiErrorMessage } from "./_lib/errors.js";

// Inicializar una vez por cold start — no lanza si ya está inicializado
if (!Sentry.isInitialized()) {
  Sentry.init({
    dsn: process.env.VITE_SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "production",
  });
}


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
  sessionId: string;
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

const mergeObservations = (...values: string[]) =>
  values.map((value) => value.trim()).filter(Boolean).join(" · ");

const validatePedido = (pedido: PedidoInput) => {
  if (!pedido.restaurantId || typeof pedido.restaurantId !== "string") {
    throw new UserFacingError("Falta restaurantId");
  }

  if (!Number.isInteger(pedido.mesa) || pedido.mesa <= 0) {
    throw new UserFacingError("Mesa inválida");
  }

  if (!Array.isArray(pedido.items) || pedido.items.length === 0) {
    throw new UserFacingError("El pedido no tiene productos");
  }
  if (!pedido.sessionId || typeof pedido.sessionId !== "string") {
    throw new UserFacingError(
      "Esta mesa ya fue cerrada. Para volver a pedir, escaneá nuevamente el QR."
    );
  }

  if (
    typeof pedido.total !== "number" ||
    !Number.isFinite(pedido.total) ||
    pedido.total < 0
  ) {
    throw new UserFacingError("Total inválido");
  }
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Método no permitido",
    });
  }

  try {
    const db = getAdminDb();
    const pedido = req.body as PedidoInput;

    validatePedido(pedido);

    const restaurantId = pedido.restaurantId.trim();
    const mesa = Number(pedido.mesa);

    const pedidoId = await db.runTransaction(async (transaction) => {
      const restaurantRef = db.doc(`restaurants/${restaurantId}`);
      const mesaRef = db.doc(`restaurants/${restaurantId}/mesas/${mesa}`);

      const restaurantSnap = await transaction.get(restaurantRef);
      const mesaSnap = await transaction.get(mesaRef);

      if (!restaurantSnap.exists) {
        throw new UserFacingError("Restaurante inexistente");
      }

      const restaurantData = restaurantSnap.data() || {};
      const isPremium = restaurantData.plan === "premium";

      const mesaData = mesaSnap.exists ? mesaSnap.data() || {} : {};
     const activeSessionId = mesaData.activeSessionId;
     const requestedSessionId = pedido.sessionId.trim();

     if (!mesaSnap.exists) {
        throw new UserFacingError(
          "Esta mesa ya fue cerrada. Para volver a pedir, escaneá nuevamente el QR."
        );
     }

     if (
      mesaData.estado !== "occupied" ||
      typeof activeSessionId !== "string" ||
      activeSessionId !== requestedSessionId
     ) {
      throw new UserFacingError(
        "Esta mesa ya fue cerrada. Para volver a pedir, escaneá nuevamente el QR."
      );
     }

     const sessionRef = db.doc(
      `restaurants/${restaurantId}/sessions/${requestedSessionId}`
     );

     const existingSessionSnap = await transaction.get(sessionRef);

     if (!existingSessionSnap.exists) {
      throw new UserFacingError(
        "Esta mesa ya fue cerrada. Para volver a pedir, escaneá nuevamente el QR."
      );
     }

     const sessionData = existingSessionSnap.data() || {};

     if (
      sessionData.status !== "active" ||
      sessionData.tableNumber !== mesa ||
      sessionData.restaurantId !== restaurantId
     ) {
      throw new UserFacingError(
        "Esta mesa ya fue cerrada. Para volver a pedir, escaneá nuevamente el QR."
      );
     }
     if (
      sessionData.ordersLocked === true ||
      sessionData.billRequested === true
     ) {
      throw new UserFacingError(
        "La cuenta ya fue solicitada. No se pueden agregar más pedidos desde esta mesa."
      );
     }

      const cuentaRef = db.doc(
        `restaurants/${restaurantId}/cuentas/${requestedSessionId}`
      );

      const cuentaSnap = await transaction.get(cuentaRef);

      if (cuentaSnap.exists) {
        const cuentaData = cuentaSnap.data() || {};
        const estadoCuenta = cuentaData.estado;

        if (
          estadoCuenta === "pendiente" ||
          estadoCuenta === "en_camino" ||
          estadoCuenta === "pagada" ||
          estadoCuenta === "cerrada"
        ) {
          throw new UserFacingError(
            "La cuenta ya fue solicitada. No se pueden agregar más pedidos desde esta mesa."
          );
        }
      }
     
     if (sessionData.ordersLocked === true) {
        throw new UserFacingError(
          "La cuenta ya fue solicitada. No se pueden agregar más pedidos desde esta mesa."
        );
     }

     const sessionId = requestedSessionId;

      const menuReads: {
        rawItem: PedidoItemInput;
        quantity: number;
        menuRef: FirebaseFirestore.DocumentReference;
        menuSnap: FirebaseFirestore.DocumentSnapshot;
      }[] = [];

      const stockRefsById = new Map<
        string,
        FirebaseFirestore.DocumentReference
      >();

      for (const rawItem of pedido.items) {
        if (!rawItem.id) {
          throw new UserFacingError("Hay un producto inválido en el pedido");
        }

        const quantity = Number(rawItem.cantidad || rawItem.quantity || 1);

        if (!Number.isFinite(quantity) || quantity <= 0) {
          throw new UserFacingError("Cantidad inválida en el pedido");
        }

        const menuRef = db.doc(`restaurants/${restaurantId}/menu/${rawItem.id}`);
        const menuSnap = await transaction.get(menuRef);

        if (!menuSnap.exists) {
          throw new UserFacingError("Uno de los productos ya no está disponible");
        }

        const menuData = menuSnap.data() as MenuItemDoc;

        if (Array.isArray(menuData.ingredients)) {
          for (const ingredient of menuData.ingredients) {
            if (!stockRefsById.has(ingredient.stockItemId)) {
              stockRefsById.set(
                ingredient.stockItemId,
                db.doc(
                  `restaurants/${restaurantId}/stock/${ingredient.stockItemId}`
                )
              );
            }
          }
        }

        menuReads.push({
          rawItem,
          quantity,
          menuRef,
          menuSnap,
        });
      }

      const stockSnapsById = new Map<
        string,
        FirebaseFirestore.DocumentSnapshot
      >();

      for (const [stockItemId, stockRef] of stockRefsById.entries()) {
        const stockSnap = await transaction.get(stockRef);
        stockSnapsById.set(stockItemId, stockSnap);
      }

      const normalizedItems = [];
      const stockRequiredBaseMap = new Map<string, number>();

      let tieneComida = false;
      let tieneBebidas = false;

      for (const menuRead of menuReads) {
        const { rawItem, quantity, menuSnap } = menuRead;
        const menuData = menuSnap.data() as MenuItemDoc;

        if (menuData.active === false) {
          throw new UserFacingError(`${menuData.name || rawItem.nombre} no está disponible`);
        }

        const itemCategory = menuData.type === "drinks" ? "drinks" : "food";

        if (itemCategory === "drinks") tieneBebidas = true;
        if (itemCategory === "food") tieneComida = true;

        const itemStockMovements = [];
        const missingOptionalIngredients: string[] = [];

        if (isPremium && Array.isArray(menuData.ingredients)) {
          for (const ingredient of menuData.ingredients) {
            const stockSnap = stockSnapsById.get(ingredient.stockItemId);

            if (!stockSnap || !stockSnap.exists) {
              if (ingredient.essential) {
                throw new UserFacingError(
                  `${menuData.name || rawItem.nombre} no está disponible por falta de ${ingredient.stockItemName}`
                );
              }

              missingOptionalIngredients.push(ingredient.stockItemName);
              continue;
            }

            const stockData = stockSnap.data() as StockItemDoc;

            if (stockData.active === false) {
              if (ingredient.essential) {
                throw new UserFacingError(
                  `${menuData.name || rawItem.nombre} no está disponible por falta de ${ingredient.stockItemName}`
                );
              }

              missingOptionalIngredients.push(ingredient.stockItemName);
              continue;
            }

            const stockUnit = stockData.unit || "unit";

            if (!compatibleUnits(ingredient.unit, stockUnit)) {
              throw new UserFacingError(`Unidad incompatible en ${ingredient.stockItemName}`);
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

            const previousRequired =
              stockRequiredBaseMap.get(ingredient.stockItemId) || 0;

            const nextRequired = previousRequired + requiredTotalBase;

            if (availableBase < nextRequired) {
              const maxAvailable = Math.floor(
                availableBase / requiredPerUnitBase
              );

              if (ingredient.essential) {
                throw new UserFacingError(
                  `Nos quedan ${maxAvailable} ${menuData.name || rawItem.nombre} en stock.`
                );
              }

              missingOptionalIngredients.push(ingredient.stockItemName);
              continue;
            }

            stockRequiredBaseMap.set(ingredient.stockItemId, nextRequired);

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
        const itemPrice = Number(
          menuData.price || rawItem.precio || rawItem.price || 0
        );

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

      for (const [stockItemId, requiredBase] of stockRequiredBaseMap.entries()) {
        const stockRef = stockRefsById.get(stockItemId);
        const stockSnap = stockSnapsById.get(stockItemId);

        if (!stockRef || !stockSnap || !stockSnap.exists) {
          throw new UserFacingError("El stock cambió. Reintentá el pedido.");
        }

        const stockData = stockSnap.data() as StockItemDoc;
        const stockUnit = stockData.unit || "unit";

        const availableBase = toBaseUnit(
          Number(stockData.currentQuantity || 0),
          stockUnit
        );

        const nextBase = availableBase - requiredBase;
        const nextQuantity = fromBaseUnit(nextBase, stockUnit);

        transaction.update(stockRef, {
          currentQuantity: nextQuantity,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
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

    // Solo reportar errores inesperados — UserFacingError son errores de negocio esperados
    if (!(error instanceof UserFacingError)) {
      Sentry.captureException(error, {
        extra: { restaurantId: (req.body as { restaurantId?: string })?.restaurantId },
      });
      await Sentry.flush(2000);
    }

    return res.status(400).json({
      ok: false,
      error: toApiErrorMessage(error),
    });
  }
}   