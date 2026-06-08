import { describe, expect, it } from "vitest";
import {
  buildWaitlistWhatsAppUrl,
  isMobileWhatsAppDevice,
  normalizeWhatsAppPhone,
  renderWaitlistWhatsAppMessage,
} from "./waitlist-whatsapp";

describe("waitlist WhatsApp manual", () => {
  it("normaliza formatos argentinos comunes", () => {
    expect(normalizeWhatsAppPhone("+54 9 11 5555-1234")).toBe("5491155551234");
    expect(normalizeWhatsAppPhone("011 15 5555-1234")).toBe("5491155551234");
    expect(normalizeWhatsAppPhone("11 5555-1234")).toBe("5491155551234");
    expect(normalizeWhatsAppPhone("123")).toBe("");
  });

  it("renderiza variables y construye el enlace hacia el cliente", () => {
    const message = renderWaitlistWhatsAppMessage(
      "Hola {customerName}, mesa {tableName}, espera {waitMinutes}",
      {
        customerName: "Ana",
        restaurantName: "WANT",
        partySize: 3,
        tableName: "Mesa 4",
        waitMinutes: 12,
      }
    );

    expect(message).toBe("Hola Ana, mesa Mesa 4, espera 12");
    expect(
      buildWaitlistWhatsAppUrl({
        phone: "11 5555-1234",
        message,
        isMobile: true,
      })
    ).toBe(
      `https://wa.me/5491155551234?text=${encodeURIComponent(message)}`
    );
    expect(
      buildWaitlistWhatsAppUrl({
        phone: "11 5555-1234",
        message,
        isMobile: false,
      })
    ).toBe(
      `https://web.whatsapp.com/send?phone=5491155551234&text=${encodeURIComponent(message)}`
    );
  });

  it("distingue mobile de desktop", () => {
    expect(isMobileWhatsAppDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17)")).toBe(
      true
    );
    expect(isMobileWhatsAppDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(
      false
    );
  });
});
