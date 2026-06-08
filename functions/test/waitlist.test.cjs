const assert = require("node:assert/strict");
const test = require("node:test");

const {
  isOpenWaitlistStatus,
  isWaitlistClosureStatus,
  isWaitlistTableAvailable,
  normalizeWaitlistWhatsAppPhone,
} = require("../lib/waitlist.js");

test("normaliza formatos argentinos comunes para WhatsApp", () => {
  assert.equal(normalizeWaitlistWhatsAppPhone("+54 9 11 5555-1234"), "5491155551234");
  assert.equal(normalizeWaitlistWhatsAppPhone("011 15 5555-1234"), "5491155551234");
  assert.equal(normalizeWaitlistWhatsAppPhone("11 5555-1234"), "5491155551234");
  assert.equal(normalizeWaitlistWhatsAppPhone("123"), "");
});

test("una entrada cerrada no puede volver a asignarse", () => {
  assert.equal(isOpenWaitlistStatus("waiting"), true);
  assert.equal(isOpenWaitlistStatus("notified"), true);
  assert.equal(isOpenWaitlistStatus("cancelled"), false);
  assert.equal(isOpenWaitlistStatus("seated"), false);
});

test("solo acepta estados de cierre conocidos", () => {
  assert.equal(isWaitlistClosureStatus("cancelled"), true);
  assert.equal(isWaitlistClosureStatus("abandoned"), true);
  assert.equal(isWaitlistClosureStatus("no_response"), true);
  assert.equal(isWaitlistClosureStatus("notified"), false);
});

test("una mesa ocupada o con sesion activa nunca esta disponible", () => {
  const baseTable = {
    restaurantId: "restaurant-a",
    numero: 4,
    active: true,
    estado: "available",
    activeSessionId: null,
  };

  assert.equal(isWaitlistTableAvailable(baseTable, "restaurant-a", 4), true);
  assert.equal(
    isWaitlistTableAvailable(
      { ...baseTable, estado: "occupied", activeSessionId: "session-a" },
      "restaurant-a",
      4
    ),
    false
  );
  assert.equal(isWaitlistTableAvailable(baseTable, "restaurant-b", 4), false);
});
