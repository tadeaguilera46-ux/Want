const getStorageKey = ({
  restaurantId,
  table,
  sessionId,
}: {
  restaurantId: string;
  table: number;
  sessionId: string;
}) => `want:customer-orders:${restaurantId}:${table}:${sessionId}`;

const getPendingRequestStorageKey = ({
  restaurantId,
  table,
  sessionId,
}: {
  restaurantId: string;
  table: number;
  sessionId: string;
}) => `want:pending-order:${restaurantId}:${table}:${sessionId}`;

export const getStoredCustomerOrderIds = ({
  restaurantId,
  table,
  sessionId,
}: {
  restaurantId: string;
  table: number;
  sessionId: string;
}) => {
  const storedValue = window.sessionStorage.getItem(
    getStorageKey({ restaurantId, table, sessionId })
  );

  if (!storedValue) return [];

  try {
    const parsedValue = JSON.parse(storedValue);

    return Array.isArray(parsedValue)
      ? parsedValue.filter(
          (orderId): orderId is string =>
            typeof orderId === "string" && orderId.trim().length > 0
        )
      : [];
  } catch {
    return [];
  }
};

export const rememberCustomerOrderId = ({
  restaurantId,
  table,
  sessionId,
  orderId,
}: {
  restaurantId: string;
  table: number;
  sessionId: string;
  orderId: string;
}) => {
  const orderIds = getStoredCustomerOrderIds({
    restaurantId,
    table,
    sessionId,
  });

  const nextOrderIds = [
    orderId,
    ...orderIds.filter((storedOrderId) => storedOrderId !== orderId),
  ].slice(0, 25);

  window.sessionStorage.setItem(
    getStorageKey({ restaurantId, table, sessionId }),
    JSON.stringify(nextOrderIds)
  );
};

export const getOrCreateCustomerOrderRequestId = ({
  restaurantId,
  table,
  sessionId,
  orderFingerprint,
}: {
  restaurantId: string;
  table: number;
  sessionId: string;
  orderFingerprint: string;
}) => {
  const storageKey = getPendingRequestStorageKey({
    restaurantId,
    table,
    sessionId,
  });
  const storedValue = window.sessionStorage.getItem(storageKey);

  if (storedValue) {
    try {
      const pendingRequest = JSON.parse(storedValue) as {
        orderFingerprint?: unknown;
        requestId?: unknown;
      };

      if (
        pendingRequest.orderFingerprint === orderFingerprint &&
        typeof pendingRequest.requestId === "string" &&
        pendingRequest.requestId.length > 0
      ) {
        return pendingRequest.requestId;
      }
    } catch {
      // A malformed pending request is replaced below.
    }
  }

  const requestId = crypto.randomUUID();

  window.sessionStorage.setItem(
    storageKey,
    JSON.stringify({ orderFingerprint, requestId })
  );

  return requestId;
};

export const clearCustomerOrderRequestId = ({
  restaurantId,
  table,
  sessionId,
  requestId,
}: {
  restaurantId: string;
  table: number;
  sessionId: string;
  requestId: string;
}) => {
  const storageKey = getPendingRequestStorageKey({
    restaurantId,
    table,
    sessionId,
  });
  const storedValue = window.sessionStorage.getItem(storageKey);

  if (!storedValue) return;

  try {
    const pendingRequest = JSON.parse(storedValue) as {
      requestId?: unknown;
    };

    if (pendingRequest.requestId === requestId) {
      window.sessionStorage.removeItem(storageKey);
    }
  } catch {
    window.sessionStorage.removeItem(storageKey);
  }
};
