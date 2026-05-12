const getStorageKey = (restaurantId: string, table: number) => {
  return `want:table-session:${restaurantId}:${table}`;
};

export const saveTableSessionId = ({
  restaurantId,
  table,
  sessionId,
}: {
  restaurantId: string;
  table: number;
  sessionId: string;
}) => {
  window.sessionStorage.setItem(getStorageKey(restaurantId, table), sessionId);
};

export const getStoredTableSessionId = ({
  restaurantId,
  table,
}: {
  restaurantId: string;
  table: number;
}) => {
  return window.sessionStorage.getItem(getStorageKey(restaurantId, table));
};

export const clearStoredTableSessionId = ({
  restaurantId,
  table,
}: {
  restaurantId: string;
  table: number;
}) => {
  window.sessionStorage.removeItem(getStorageKey(restaurantId, table));
};