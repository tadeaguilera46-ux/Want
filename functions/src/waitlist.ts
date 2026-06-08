export type WaitlistClosureStatus = "cancelled" | "abandoned" | "no_response";

const removeArgentineLocalMobilePrefix = (value: string) => {
  for (const index of [2, 3, 4]) {
    if (
      value.slice(index, index + 2) === "15" &&
      value.length - 2 === 10
    ) {
      return `${value.slice(0, index)}${value.slice(index + 2)}`;
    }
  }
  return value;
};

export function normalizeWaitlistWhatsAppPhone(value: unknown): string {
  if (typeof value !== "string") return "";

  const raw = value.trim();
  if (!raw) return "";

  const explicitlyInternational = raw.startsWith("+") || raw.startsWith("00");
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);

  if (digits.startsWith("54")) {
    let national = digits.slice(2).replace(/^0+/, "");
    national = removeArgentineLocalMobilePrefix(national);
    if (national.startsWith("9") && national.length === 11) {
      return `54${national}`;
    }
    return national.length === 10 ? `549${national}` : "";
  }

  if (explicitlyInternational) {
    return digits.length >= 8 && digits.length <= 15 ? digits : "";
  }

  const national = removeArgentineLocalMobilePrefix(digits.replace(/^0+/, ""));
  if (national.startsWith("9") && national.length === 11) {
    return `54${national}`;
  }
  return national.length === 10 ? `549${national}` : "";
}

export function isOpenWaitlistStatus(status: unknown): boolean {
  return status === "waiting" || status === "notified";
}

export function isWaitlistClosureStatus(
  value: unknown
): value is WaitlistClosureStatus {
  return (
    value === "cancelled" ||
    value === "abandoned" ||
    value === "no_response"
  );
}

export function isWaitlistTableAvailable(
  table: Record<string, unknown>,
  restaurantId: string,
  mesa: number
): boolean {
  return (
    table.restaurantId === restaurantId &&
    table.numero === mesa &&
    table.active !== false &&
    table.estado === "available" &&
    table.activeSessionId == null
  );
}
