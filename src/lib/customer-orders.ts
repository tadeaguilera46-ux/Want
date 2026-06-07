const getStorageKey = ({
  restaurantId,
  table,
  sessionId,
}: {
  restaurantId: string;
  table: number;
  sessionId: string;
}) => `want:customer-orders:${restaurantId}:${table}:${sessionId}`;

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
