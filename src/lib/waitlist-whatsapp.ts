export const DEFAULT_WAITLIST_WHATSAPP_MESSAGE =
  "Hola {customerName}, tu mesa en {restaurantName} ya está lista. Por favor acercate a recepción. Te esperamos.";

export const WAITLIST_WHATSAPP_VARIABLES = [
  "{customerName}",
  "{restaurantName}",
  "{partySize}",
  "{tableName}",
  "{waitMinutes}",
] as const;

type WaitlistWhatsAppMessageValues = {
  customerName: string;
  restaurantName: string;
  partySize: number;
  tableName: string;
  waitMinutes: number;
};

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

export const normalizeWhatsAppPhone = (value: unknown) => {
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
    if (national.length === 10) return `549${national}`;
    return "";
  }

  if (explicitlyInternational) {
    return digits.length >= 8 && digits.length <= 15 ? digits : "";
  }

  let national = removeArgentineLocalMobilePrefix(digits.replace(/^0+/, ""));
  if (national.startsWith("9") && national.length === 11) {
    return `54${national}`;
  }
  return national.length === 10 ? `549${national}` : "";
};

export const renderWaitlistWhatsAppMessage = (
  template: string,
  values: WaitlistWhatsAppMessageValues
) => {
  const replacements: Record<string, string> = {
    "{customerName}": values.customerName,
    "{restaurantName}": values.restaurantName,
    "{partySize}": String(values.partySize),
    "{tableName}": values.tableName,
    "{waitMinutes}": String(Math.max(0, values.waitMinutes)),
  };

  return Object.entries(replacements).reduce(
    (message, [variable, replacement]) =>
      message.replaceAll(variable, replacement),
    template || DEFAULT_WAITLIST_WHATSAPP_MESSAGE
  );
};

export const buildWaitlistWhatsAppUrl = ({
  phone,
  message,
  isMobile,
}: {
  phone: string;
  message: string;
  isMobile: boolean;
}) => {
  const normalizedPhone = normalizeWhatsAppPhone(phone);
  if (!normalizedPhone) return "";
  const encodedMessage = encodeURIComponent(message);
  return isMobile
    ? `https://wa.me/${normalizedPhone}?text=${encodedMessage}`
    : `https://web.whatsapp.com/send?phone=${normalizedPhone}&text=${encodedMessage}`;
};

export const isMobileWhatsAppDevice = (userAgent: string) =>
  /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(userAgent);
