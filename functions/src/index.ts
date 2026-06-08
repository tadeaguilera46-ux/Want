import * as Sentry from "@sentry/node";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import * as crypto from "crypto";
import { Resend } from "resend";
import PDFDocument from "pdfkit";
import * as forge from "node-forge";
import { generateKeyPairAndCsr, encryptPrivateKey, decryptPrivateKey } from "./afip/crypto.js";
import { getAfipToken } from "./afip/wsaa.js";
import { getLastInvoiceNumber, issueFECAE } from "./afip/wsfe.js";
import { INVOICE_TYPE_CODES, type InvoiceRequest, type AfipConfig, type AfipInvoiceResult } from "./afip/types.js";
import {
  isOpenWaitlistStatus,
  isWaitlistClosureStatus,
  isWaitlistTableAvailable,
  normalizeWaitlistWhatsAppPhone,
} from "./waitlist.js";

admin.initializeApp();

// Inicializar Sentry una vez — Cloud Functions reutiliza la instancia entre invocaciones calientes.
// DSN via functions/.env (SENTRY_DSN=https://...) o variable de entorno de Firebase.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? "production",
  tracesSampleRate: 0, // Sin tracing en functions — solo captura de errores
});

const MP_ACCESS_TOKEN = defineSecret("MP_ACCESS_TOKEN");
const MP_WEBHOOK_SECRET = defineSecret("MP_WEBHOOK_SECRET");
const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const AFIP_MASTER_KEY = defineSecret("AFIP_MASTER_KEY");

const RESERVATION_CALLABLE_OPTIONS: {
  cors: Array<string | RegExp>;
  invoker: "public";
} = {
  cors: [
    "https://want-livid.vercel.app",
    /^http:\/\/localhost(?::\d+)?$/,
    /^http:\/\/127\.0\.0\.1(?::\d+)?$/,
  ],
  // Browser preflight must be public; each handler still enforces auth or token.
  invoker: "public",
};

const WAITLIST_ASSIGN_CALLABLE_OPTIONS = {
  cors: RESERVATION_CALLABLE_OPTIONS.cors,
  invoker: "public" as const,
};

// Reception is not a StaffRole today. Add it here and to StaffRoute when the
// product introduces that role; Waitlist permissions stay isolated here.
const WAITLIST_STAFF_ROLES = ["admin", "cashier", "runner"];

// Entorno AFIP: "homologacion" en dev, "produccion" en prod
const AFIP_ENV = (process.env.AFIP_ENV ?? "produccion") as "homologacion" | "produccion";

const PLAN_LABELS: Record<string, string> = {
  starter: "Starter",
  pro: "Pro",
  premium: "Premium",
};

async function sendEmail(
  apiKey: string,
  to: string,
  subject: string,
  html: string,
  attachments?: { filename: string; content: Buffer }[],
  idempotencyKey?: string
): Promise<boolean> {
  const resend = new Resend(apiKey);
  const from = process.env.EMAIL_FROM || "WANT <onboarding@resend.dev>";
  const { error } = await resend.emails.send(
    { from, to, subject, html, attachments },
    idempotencyKey ? { idempotencyKey } : undefined
  );
  if (error) {
    console.error("sendEmail error:", error);
    return false;
  }
  return true;
}

function emailWrapper(title: string, body: string): string {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f6f4ef;font-family:sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px">
  <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:24px;overflow:hidden">
    <tr><td style="background:#0a0a0a;padding:32px;text-align:center">
      <span style="color:#fff;font-size:22px;font-weight:900;letter-spacing:-0.5px">WANT</span>
    </td></tr>
    <tr><td style="padding:32px">
      <h1 style="margin:0 0 16px;font-size:22px;font-weight:900;color:#09090b">${title}</h1>
      ${body}
      <p style="margin:32px 0 0;font-size:12px;color:#a1a1aa">WANT © Plataforma SaaS para restaurantes</p>
    </td></tr>
  </table></td></tr></table></body></html>`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

type ReservationSettings = {
  openTime: string;
  closeTime: string;
  slotMinutes: number;
  capacityPerSlot: number;
};

type ReservationStatus =
  | "pending"
  | "confirmed"
  | "seated"
  | "completed"
  | "cancelled"
  | "no_show";

const RESERVATION_STATUSES: ReservationStatus[] = [
  "pending",
  "confirmed",
  "seated",
  "completed",
  "cancelled",
  "no_show",
];

const OCCUPYING_RESERVATION_STATUSES = new Set<ReservationStatus>([
  "confirmed",
  "seated",
]);

const RESERVATION_STATUS_TRANSITIONS: Record<
  ReservationStatus,
  ReservationStatus[]
> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["seated", "cancelled", "no_show"],
  seated: ["completed", "cancelled"],
  completed: [],
  cancelled: ["confirmed"],
  no_show: ["confirmed"],
};

const RESERVATION_STATUS_TIMESTAMP_FIELDS: Record<ReservationStatus, string> = {
  pending: "pendingAt",
  confirmed: "confirmedAt",
  seated: "seatedAt",
  completed: "completedAt",
  cancelled: "cancelledAt",
  no_show: "noShowAt",
};

const DEFAULT_RESERVATION_SETTINGS: ReservationSettings = {
  openTime: "12:00",
  closeTime: "23:00",
  slotMinutes: 60,
  capacityPerSlot: 40,
};

function parseTimeToMinutes(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }
  return hours * 60 + minutes;
}

function isValidReservationDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function getReservationTimeMs(date: unknown, time: unknown): number | null {
  if (!isValidReservationDate(date) || parseTimeToMinutes(time) === null) {
    return null;
  }

  const reservationTime = Date.parse(`${date}T${time}:00-03:00`);
  return Number.isFinite(reservationTime) ? reservationTime : null;
}

function isValidReservationDocumentId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function normalizeReservationPhone(value: unknown): string {
  if (typeof value !== "string") return "";
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 ? digits : "";
}

function normalizeReservationSettings(value: unknown): ReservationSettings {
  const settings =
    value && typeof value === "object"
      ? (value as Partial<ReservationSettings>)
      : {};
  const openMinutes = parseTimeToMinutes(settings.openTime);
  const closeMinutes = parseTimeToMinutes(settings.closeTime);
  const slotMinutes = Number(settings.slotMinutes);
  const capacityPerSlot = Number(settings.capacityPerSlot);

  if (
    openMinutes === null ||
    closeMinutes === null ||
    openMinutes === closeMinutes ||
    !Number.isInteger(slotMinutes) ||
    slotMinutes < 15 ||
    slotMinutes > 240 ||
    !Number.isInteger(capacityPerSlot) ||
    capacityPerSlot < 1 ||
    capacityPerSlot > 1000
  ) {
    throw new HttpsError("invalid-argument", "Configuración de reservas inválida");
  }

  return {
    openTime: settings.openTime as string,
    closeTime: settings.closeTime as string,
    slotMinutes,
    capacityPerSlot,
  };
}

function getReservationSlot(time: unknown, settings: ReservationSettings): string {
  const timeMinutes = parseTimeToMinutes(time);
  const openMinutes = parseTimeToMinutes(settings.openTime);
  const rawCloseMinutes = parseTimeToMinutes(settings.closeTime);

  if (
    timeMinutes === null ||
    openMinutes === null ||
    rawCloseMinutes === null
  ) {
    throw new HttpsError("invalid-argument", "Horario de reserva inválido");
  }

  const closeMinutes =
    rawCloseMinutes <= openMinutes ? rawCloseMinutes + 24 * 60 : rawCloseMinutes;
  const adjustedTime =
    timeMinutes < openMinutes ? timeMinutes + 24 * 60 : timeMinutes;
  const offset = adjustedTime - openMinutes;

  if (
    adjustedTime < openMinutes ||
    adjustedTime >= closeMinutes ||
    offset % settings.slotMinutes !== 0
  ) {
    throw new HttpsError(
      "failed-precondition",
      "El horario elegido no corresponde a una franja disponible"
    );
  }

  return String(time);
}

async function requireRestaurantAdmin(
  restaurantId: string,
  uid: string
): Promise<FirebaseFirestore.DocumentData> {
  if (!isValidReservationDocumentId(restaurantId)) {
    throw new HttpsError("invalid-argument", "restaurantId inválido");
  }

  const staffSnap = await admin
    .firestore()
    .doc(`restaurants/${restaurantId}/staff/${uid}`)
    .get();

  if (
    !staffSnap.exists ||
    staffSnap.data()?.role !== "admin" ||
    staffSnap.data()?.active !== true
  ) {
    throw new HttpsError("permission-denied", "No tenés permisos");
  }

  return staffSnap.data() || {};
}

async function requireRestaurantWaitlistStaff(
  restaurantId: string,
  uid: string
): Promise<FirebaseFirestore.DocumentData> {
  if (!isValidReservationDocumentId(restaurantId)) {
    throw new HttpsError("invalid-argument", "restaurantId inválido");
  }

  const staffSnap = await admin
    .firestore()
    .doc(`restaurants/${restaurantId}/staff/${uid}`)
    .get();
  const staff = staffSnap.data() || {};

  if (
    !staffSnap.exists ||
    staff.active !== true ||
    !WAITLIST_STAFF_ROLES.includes(staff.role)
  ) {
    throw new HttpsError("permission-denied", "No tenés permisos");
  }

  return staff;
}

function reservationAuditData({
  restaurantId,
  action,
  actorUid,
  actorEmail,
  actorRole = "admin",
  entityId,
  mesa,
  description,
  before,
  after,
}: {
  restaurantId: string;
  action: string;
  actorUid: string;
  actorEmail?: string | null;
  actorRole?: string;
  entityId: string;
  mesa?: number | null;
  description: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}) {
  return {
    restaurantId,
    action,
    actorUid,
    actorEmail: actorEmail || null,
    actorRole,
    userUid: actorUid,
    userEmail: actorEmail || null,
    userRole: actorRole,
    mesa: mesa || null,
    pedidoId: null,
    cuentaId: null,
    sessionId: null,
    entityType: "reservation",
    entityId,
    description,
    reason: null,
    changes: { before, after },
    metadata: {},
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

function isValidReservationCancellationToken(token: unknown): token is string {
  return typeof token === "string" && /^[a-f0-9]{64}$/.test(token);
}

function reservationCancellationUrl(
  restaurantId: string,
  reservationId: string,
  token: string
): string {
  const appUrl = (process.env.APP_URL || "https://want-livid.vercel.app").replace(
    /\/+$/,
    ""
  );
  const params = new URLSearchParams({ restaurantId, reservationId, token });
  return `${appUrl}/reservation/cancel?${params.toString()}`;
}

function tokensMatch(received: string, expected: unknown): boolean {
  if (!isValidReservationCancellationToken(expected)) return false;
  return crypto.timingSafeEqual(
    Buffer.from(received, "hex"),
    Buffer.from(expected, "hex")
  );
}

async function getOrCreateReservationCancellationToken(
  restaurantId: string,
  reservationId: string
): Promise<string> {
  const secretRef = admin
    .firestore()
    .doc(`restaurants/${restaurantId}/reservationSecrets/${reservationId}`);

  return admin.firestore().runTransaction(async (transaction) => {
    const secretSnap = await transaction.get(secretRef);
    const currentToken = secretSnap.data()?.cancellationToken;
    if (isValidReservationCancellationToken(currentToken)) return currentToken;

    const cancellationToken = crypto.randomBytes(32).toString("hex");
    transaction.set(secretRef, {
      cancellationToken,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return cancellationToken;
  });
}

function reservationTableSlotRef(
  db: FirebaseFirestore.Firestore,
  restaurantId: string,
  date: string,
  slot: string,
  mesa: number
): FirebaseFirestore.DocumentReference {
  return db.doc(
    `restaurants/${restaurantId}/reservationTableSlots/${date}_${slot.replace(":", "-")}_${mesa}`
  );
}

async function requireAvailableReservationTable({
  transaction,
  db,
  restaurantId,
  reservationId,
  date,
  slot,
  mesa,
}: {
  transaction: FirebaseFirestore.Transaction;
  db: FirebaseFirestore.Firestore;
  restaurantId: string;
  reservationId: string;
  date: string;
  slot: string;
  mesa: number;
}): Promise<FirebaseFirestore.DocumentReference> {
  const mesaRef = db.doc(`restaurants/${restaurantId}/mesas/${mesa}`);
  const tableSlotRef = reservationTableSlotRef(
    db,
    restaurantId,
    date,
    slot,
    mesa
  );
  const reservationsQuery = db
    .collection(`restaurants/${restaurantId}/reservations`)
    .where("date", "==", date);
  const [mesaSnap, tableSlotSnap, reservationsSnap] = await Promise.all([
    transaction.get(mesaRef),
    transaction.get(tableSlotRef),
    transaction.get(reservationsQuery),
  ]);

  if (!mesaSnap.exists || mesaSnap.data()?.active === false) {
    throw new HttpsError(
      "failed-precondition",
      `La mesa ${mesa} no existe o no está disponible`
    );
  }
  const lockingReservationId = tableSlotSnap.data()?.reservationId;
  const hasLiveConflictingLock =
    tableSlotSnap.exists &&
    lockingReservationId !== reservationId &&
    reservationsSnap.docs.some((document) => {
      if (document.id !== lockingReservationId) return false;
      const reservation = document.data();
      return (
        OCCUPYING_RESERVATION_STATUSES.has(reservation.status) &&
        Number(reservation.mesa) === mesa &&
        (reservation.slot || reservation.time) === slot
      );
    });
  if (hasLiveConflictingLock) {
    throw new HttpsError(
      "resource-exhausted",
      `La mesa ${mesa} ya está reservada en la franja de ${slot}`
    );
  }

  const overlapsExistingReservation = reservationsSnap.docs.some((document) => {
    if (document.id === reservationId) return false;
    const reservation = document.data();
    return (
      OCCUPYING_RESERVATION_STATUSES.has(reservation.status) &&
      Number(reservation.mesa) === mesa &&
      (reservation.slot || reservation.time) === slot
    );
  });
  if (overlapsExistingReservation) {
    throw new HttpsError(
      "resource-exhausted",
      `La mesa ${mesa} ya está reservada en la franja de ${slot}`
    );
  }

  return tableSlotRef;
}

function reservationTableSlotData({
  restaurantId,
  reservationId,
  date,
  slot,
  mesa,
}: {
  restaurantId: string;
  reservationId: string;
  date: string;
  slot: string;
  mesa: number;
}) {
  return {
    restaurantId,
    reservationId,
    date,
    slot,
    mesa,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

export const saveReservationSettings = onCall(RESERVATION_CALLABLE_OPTIONS, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "No autenticado");

  const data = request.data as { restaurantId?: unknown; settings?: unknown };
  const restaurantId =
    typeof data.restaurantId === "string" ? data.restaurantId.trim() : "";
  if (!restaurantId) throw new HttpsError("invalid-argument", "Falta restaurantId");

  const staff = await requireRestaurantAdmin(restaurantId, request.auth.uid);
  const settings = normalizeReservationSettings(data.settings);
  const db = admin.firestore();
  const settingsRef = db.doc(
    `restaurants/${restaurantId}/reservationSettings/main`
  );
  const auditRef = db.collection(`restaurants/${restaurantId}/auditLogs`).doc();

  await db.runTransaction(async (transaction) => {
    const currentSnap = await transaction.get(settingsRef);
    transaction.set(settingsRef, {
      ...settings,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    transaction.set(
      auditRef,
      reservationAuditData({
        restaurantId,
        action: "reserva_capacidad_actualizada",
        actorUid: request.auth!.uid,
        actorEmail: staff.email || request.auth!.token.email || null,
        entityId: "settings",
        description: "Se actualizó la capacidad de reservas por franja",
        before: currentSnap.exists ? currentSnap.data() || {} : {},
        after: settings,
      })
    );
  });

  return { ok: true, settings };
});

export const createReservation = onCall(RESERVATION_CALLABLE_OPTIONS, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "No autenticado");

  const input = request.data as Record<string, unknown>;
  const restaurantId =
    typeof input.restaurantId === "string" ? input.restaurantId.trim() : "";
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const phone = typeof input.phone === "string" ? input.phone.trim() : "";
  const phoneNormalized = normalizeReservationPhone(phone);
  const email =
    typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const date = typeof input.date === "string" ? input.date.trim() : "";
  const time = typeof input.time === "string" ? input.time.trim() : "";
  const notes = typeof input.notes === "string" ? input.notes.trim() : "";
  const partySize = Number(input.partySize);
  const mesa = input.mesa ? Number(input.mesa) : null;

  if (
    !restaurantId ||
    !name ||
    !phoneNormalized ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !isValidReservationDate(date) ||
    parseTimeToMinutes(time) === null ||
    !Number.isInteger(partySize) ||
    partySize < 1 ||
    partySize > 100 ||
    (mesa !== null && (!Number.isInteger(mesa) || mesa < 1))
  ) {
    throw new HttpsError("invalid-argument", "Datos de reserva inválidos");
  }
  if ((getReservationTimeMs(date, time) || 0) <= Date.now()) {
    throw new HttpsError(
      "failed-precondition",
      "La reserva debe programarse para un horario futuro"
    );
  }

  const staff = await requireRestaurantAdmin(restaurantId, request.auth.uid);
  const db = admin.firestore();
  const settingsRef = db.doc(
    `restaurants/${restaurantId}/reservationSettings/main`
  );
  const reservationRef = db
    .collection(`restaurants/${restaurantId}/reservations`)
    .doc();
  const reservationSecretRef = db.doc(
    `restaurants/${restaurantId}/reservationSecrets/${reservationRef.id}`
  );
  const auditRef = db.collection(`restaurants/${restaurantId}/auditLogs`).doc();
  const cancellationToken = crypto.randomBytes(32).toString("hex");

  await db.runTransaction(async (transaction) => {
    const settingsSnap = await transaction.get(settingsRef);
    const settings = settingsSnap.exists
      ? normalizeReservationSettings(settingsSnap.data())
      : DEFAULT_RESERVATION_SETTINGS;
    const slot = getReservationSlot(time, settings);
    const slotRef = db.doc(
      `restaurants/${restaurantId}/reservationSlots/${date}_${slot.replace(":", "-")}`
    );
    const slotSnap = await transaction.get(slotRef);
    const tableSlotRef =
      mesa === null
        ? null
        : await requireAvailableReservationTable({
            transaction,
            db,
            restaurantId,
            reservationId: reservationRef.id,
            date,
            slot,
            mesa,
          });
    let reservedPersons = Number(slotSnap.data()?.reservedPersons || 0);

    if (!slotSnap.exists) {
      const existingReservations = await transaction.get(
        db
          .collection(`restaurants/${restaurantId}/reservations`)
          .where("date", "==", date)
      );
      reservedPersons = existingReservations.docs.reduce((total, document) => {
        const existing = document.data();
        return OCCUPYING_RESERVATION_STATUSES.has(existing.status) &&
          (existing.slot || existing.time) === slot
          ? total + Number(existing.partySize || 0)
          : total;
      }, 0);
    }

    if (reservedPersons + partySize > settings.capacityPerSlot) {
      throw new HttpsError(
        "resource-exhausted",
        `La franja de ${slot} no tiene capacidad suficiente`
      );
    }

    transaction.set(slotRef, {
      restaurantId,
      date,
      slot,
      capacity: settings.capacityPerSlot,
      reservedPersons: reservedPersons + partySize,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    transaction.set(reservationRef, {
      restaurantId,
      name,
      phone,
      phoneNormalized,
      email,
      date,
      time: slot,
      slot,
      partySize,
      mesa,
      notes: notes || null,
      status: "confirmed",
      confirmation: {
        channel: "email",
        status: "pending",
        sentAt: null,
        error: null,
      },
      reminder: {
        channel: "email",
        status: "pending",
        sentAt: null,
        error: null,
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      statusChangedAt: admin.firestore.FieldValue.serverTimestamp(),
      confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    transaction.set(reservationSecretRef, {
      cancellationToken,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    if (tableSlotRef && mesa !== null) {
      transaction.set(
        tableSlotRef,
        reservationTableSlotData({
          restaurantId,
          reservationId: reservationRef.id,
          date,
          slot,
          mesa,
        })
      );
    }
    transaction.set(
      auditRef,
      reservationAuditData({
        restaurantId,
        action: "reserva_creada",
        actorUid: request.auth!.uid,
        actorEmail: staff.email || request.auth!.token.email || null,
        entityId: reservationRef.id,
        mesa,
        description: `Se creó reserva para ${name}`,
        before: { exists: false },
        after: { date, time: slot, partySize, status: "confirmed" },
      })
    );
  });

  return { ok: true, reservationId: reservationRef.id };
});

export const getReservationHistoryByPhone = onCall(
  RESERVATION_CALLABLE_OPTIONS,
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "No autenticado");

    const data = request.data as {
      restaurantId?: unknown;
      phone?: unknown;
    };
    const restaurantId =
      typeof data.restaurantId === "string" ? data.restaurantId.trim() : "";
    const phoneNormalized = normalizeReservationPhone(data.phone);

    if (!restaurantId || !phoneNormalized) {
      throw new HttpsError(
        "invalid-argument",
        "Ingresá un número telefónico válido"
      );
    }

    await requireRestaurantAdmin(restaurantId, request.auth.uid);
    const reservationsSnap = await admin
      .firestore()
      .collection(`restaurants/${restaurantId}/reservations`)
      .get();

    const matchingReservations = reservationsSnap.docs
      .filter((document) => {
        const reservation = document.data();
        return (
          normalizeReservationPhone(
            reservation.phoneNormalized || reservation.phone
          ) === phoneNormalized
        );
      })
      .map((document) => {
        const reservation = document.data();
        return {
          id: document.id,
          name: reservation.name || "",
          phone: reservation.phone || "",
          email: reservation.email || "",
          date: reservation.date || "",
          time: reservation.time || "",
          partySize: Number(reservation.partySize || 0),
          mesa: Number.isInteger(reservation.mesa) ? reservation.mesa : null,
          status: reservation.status || "pending",
          notes: reservation.notes || null,
          rescheduleCount: Array.isArray(reservation.rescheduleHistory)
            ? reservation.rescheduleHistory.length
            : 0,
        };
      })
      .sort((left, right) =>
        `${right.date}T${right.time}`.localeCompare(`${left.date}T${left.time}`)
      );
    const reservations = matchingReservations.slice(0, 50);

    return {
      phoneNormalized,
      total: matchingReservations.length,
      completed: matchingReservations.filter(
        (reservation) => reservation.status === "completed"
      ).length,
      cancelled: matchingReservations.filter(
        (reservation) => reservation.status === "cancelled"
      ).length,
      noShows: matchingReservations.filter(
        (reservation) => reservation.status === "no_show"
      ).length,
      reservations,
    };
  }
);

export const getReservationMetrics = onCall(RESERVATION_CALLABLE_OPTIONS, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "No autenticado");

  const data = request.data as {
    restaurantId?: unknown;
    days?: unknown;
  };
  const restaurantId =
    typeof data.restaurantId === "string" ? data.restaurantId.trim() : "";
  const days = Number(data.days);

  if (!restaurantId || ![7, 30, 90].includes(days)) {
    throw new HttpsError(
      "invalid-argument",
      "Seleccioná un rango válido para las métricas"
    );
  }

  await requireRestaurantAdmin(restaurantId, request.auth.uid);

  const endDate = getDateInBuenosAires();
  const startDate = getDateInBuenosAires(-(days - 1));
  const reservationsSnap = await admin
    .firestore()
    .collection(`restaurants/${restaurantId}/reservations`)
    .where("date", ">=", startDate)
    .where("date", "<=", endDate)
    .get();

  const daily = Array.from({ length: days }, (_, index) => {
    const date = getDateInBuenosAires(index - (days - 1));
    const [, month, day] = date.split("-");
    return {
      date,
      label: `${day}/${month}`,
      total: 0,
      completed: 0,
      cancelled: 0,
      noShows: 0,
    };
  });
  const dailyByDate = new Map(daily.map((day) => [day.date, day]));
  let total = 0;
  let completed = 0;
  let cancelled = 0;
  let noShows = 0;
  let active = 0;

  reservationsSnap.docs.forEach((document) => {
    const reservation = document.data();
    const day = dailyByDate.get(reservation.date);
    if (!day) return;

    total += 1;
    day.total += 1;

    if (reservation.status === "completed") {
      completed += 1;
      day.completed += 1;
    } else if (reservation.status === "cancelled") {
      cancelled += 1;
      day.cancelled += 1;
    } else if (reservation.status === "no_show") {
      noShows += 1;
      day.noShows += 1;
    } else if (
      reservation.status === "pending" ||
      reservation.status === "confirmed" ||
      reservation.status === "seated"
    ) {
      active += 1;
    }
  });

  const percentage = (value: number, base: number) =>
    base > 0 ? Math.round((value / base) * 1000) / 10 : 0;
  const attendanceBase = completed + noShows;

  return {
    days,
    startDate,
    endDate,
    total,
    completed,
    cancelled,
    noShows,
    active,
    cancellationRate: percentage(cancelled, total),
    noShowRate: percentage(noShows, total),
    attendanceRate: percentage(completed, attendanceBase),
    daily,
  };
});

export const updateReservationStatus = onCall(RESERVATION_CALLABLE_OPTIONS, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "No autenticado");

  const data = request.data as {
    restaurantId?: unknown;
    reservationId?: unknown;
    status?: unknown;
  };
  const restaurantId =
    typeof data.restaurantId === "string" ? data.restaurantId.trim() : "";
  const reservationId =
    typeof data.reservationId === "string" ? data.reservationId.trim() : "";
  const status = data.status;

  if (
    !restaurantId ||
    !isValidReservationDocumentId(reservationId) ||
    typeof status !== "string" ||
    !RESERVATION_STATUSES.includes(status as ReservationStatus)
  ) {
    throw new HttpsError("invalid-argument", "Estado de reserva inválido");
  }
  const nextStatus = status as ReservationStatus;

  const staff = await requireRestaurantAdmin(restaurantId, request.auth.uid);
  const db = admin.firestore();
  const reservationRef = db.doc(
    `restaurants/${restaurantId}/reservations/${reservationId}`
  );
  const settingsRef = db.doc(
    `restaurants/${restaurantId}/reservationSettings/main`
  );
  const auditRef = db.collection(`restaurants/${restaurantId}/auditLogs`).doc();

  await db.runTransaction(async (transaction) => {
    const [reservationSnap, settingsSnap] = await Promise.all([
      transaction.get(reservationRef),
      transaction.get(settingsRef),
    ]);
    if (!reservationSnap.exists) {
      throw new HttpsError("not-found", "Reserva inexistente");
    }

    const reservation = reservationSnap.data() || {};
    const currentStatus = reservation.status as ReservationStatus;
    if (!RESERVATION_STATUSES.includes(currentStatus)) {
      throw new HttpsError(
        "failed-precondition",
        "La reserva tiene un estado inválido"
      );
    }
    if (currentStatus === nextStatus) return;
    if (!RESERVATION_STATUS_TRANSITIONS[currentStatus].includes(nextStatus)) {
      throw new HttpsError(
        "failed-precondition",
        `No se puede pasar una reserva de ${currentStatus} a ${nextStatus}`
      );
    }

    const settings = settingsSnap.exists
      ? normalizeReservationSettings(settingsSnap.data())
      : DEFAULT_RESERVATION_SETTINGS;
    const rawSlot = String(reservation.slot || reservation.time || "");
    const reservationTimeMs = getReservationTimeMs(
      reservation.date,
      rawSlot
    );
    if (
      nextStatus === "no_show" &&
      (reservationTimeMs === null || reservationTimeMs > Date.now())
    ) {
      throw new HttpsError(
        "failed-precondition",
        "No se puede marcar ausencia antes del horario reservado"
      );
    }
    const currentOccupies =
      OCCUPYING_RESERVATION_STATUSES.has(currentStatus);
    const nextOccupies = OCCUPYING_RESERVATION_STATUSES.has(nextStatus);
    const mesa = Number.isInteger(reservation.mesa)
      ? Number(reservation.mesa)
      : null;
    let slot = rawSlot;
    let slotRef: FirebaseFirestore.DocumentReference | null = null;
    let nextReservedPersons: number | null = null;

    if (currentOccupies !== nextOccupies) {
      slot = nextOccupies ? getReservationSlot(rawSlot, settings) : rawSlot;
      if (!/^\d{2}:\d{2}$/.test(slot)) {
        throw new HttpsError(
          "failed-precondition",
          "Horario de reserva inválido"
        );
      }
      slotRef = db.doc(
        `restaurants/${restaurantId}/reservationSlots/${reservation.date}_${slot.replace(":", "-")}`
      );
      const slotSnap = await transaction.get(slotRef);
      let reservedPersons = Number(slotSnap.data()?.reservedPersons || 0);

      if (!slotSnap.exists) {
        const existingReservations = await transaction.get(
          db
            .collection(`restaurants/${restaurantId}/reservations`)
            .where("date", "==", reservation.date)
        );
        reservedPersons = existingReservations.docs.reduce((total, document) => {
          const existing = document.data();
          return OCCUPYING_RESERVATION_STATUSES.has(existing.status) &&
            (existing.slot || existing.time) === slot
            ? total + Number(existing.partySize || 0)
            : total;
        }, 0);
      }

      const partySize = Number(reservation.partySize || 0);
      nextReservedPersons = nextOccupies
        ? reservedPersons + partySize
        : Math.max(0, reservedPersons - partySize);

      if (nextOccupies && nextReservedPersons > settings.capacityPerSlot) {
        throw new HttpsError(
          "resource-exhausted",
          `La franja de ${slot} no tiene capacidad suficiente`
        );
      }
    }

    let tableSlotRef: FirebaseFirestore.DocumentReference | null = null;
    let shouldSetTableSlot = false;
    let shouldDeleteTableSlot = false;
    if (mesa !== null && currentOccupies !== nextOccupies) {
      tableSlotRef = reservationTableSlotRef(
        db,
        restaurantId,
        String(reservation.date),
        slot,
        mesa
      );
      if (nextOccupies) {
        tableSlotRef = await requireAvailableReservationTable({
          transaction,
          db,
          restaurantId,
          reservationId,
          date: String(reservation.date),
          slot,
          mesa,
        });
        shouldSetTableSlot = true;
      } else {
        const tableSlotSnap = await transaction.get(tableSlotRef);
        shouldDeleteTableSlot =
          tableSlotSnap.exists &&
          tableSlotSnap.data()?.reservationId === reservationId;
      }
    }

    if (slotRef && nextReservedPersons !== null) {
      transaction.set(
        slotRef,
        {
          restaurantId,
          date: reservation.date,
          slot,
          capacity: settings.capacityPerSlot,
          reservedPersons: nextReservedPersons,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
    if (tableSlotRef && mesa !== null && shouldSetTableSlot) {
      transaction.set(
        tableSlotRef,
        reservationTableSlotData({
          restaurantId,
          reservationId,
          date: String(reservation.date),
          slot,
          mesa,
        })
      );
    } else if (tableSlotRef && shouldDeleteTableSlot) {
      transaction.delete(tableSlotRef);
    }
    const reservationUpdate: Record<string, unknown> = {
      status: nextStatus,
      slot,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      statusChangedAt: admin.firestore.FieldValue.serverTimestamp(),
      [RESERVATION_STATUS_TIMESTAMP_FIELDS[nextStatus]]:
        admin.firestore.FieldValue.serverTimestamp(),
    };
    if (
      nextStatus !== "confirmed" &&
      reservation.reminder?.status === "sending"
    ) {
      reservationUpdate["reminder.status"] = "pending";
      reservationUpdate["reminder.sendingAt"] = null;
      reservationUpdate["reminder.attemptId"] = null;
    }
    transaction.update(reservationRef, reservationUpdate);
    transaction.set(
      auditRef,
      reservationAuditData({
        restaurantId,
        action: "reserva_estado_actualizado",
        actorUid: request.auth!.uid,
        actorEmail: staff.email || request.auth!.token.email || null,
        entityId: reservationId,
        mesa: reservation.mesa || null,
        description: `Se actualizó reserva ${reservationId} a ${nextStatus}`,
        before: { status: currentStatus },
        after: { status: nextStatus },
      })
    );
  });

  return { ok: true };
});

export const rescheduleReservation = onCall(RESERVATION_CALLABLE_OPTIONS, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "No autenticado");

  const data = request.data as {
    restaurantId?: unknown;
    reservationId?: unknown;
    date?: unknown;
    time?: unknown;
  };
  const restaurantId =
    typeof data.restaurantId === "string" ? data.restaurantId.trim() : "";
  const reservationId =
    typeof data.reservationId === "string" ? data.reservationId.trim() : "";
  const date = typeof data.date === "string" ? data.date.trim() : "";
  const time = typeof data.time === "string" ? data.time.trim() : "";

  if (
    !restaurantId ||
    !isValidReservationDocumentId(reservationId) ||
    !isValidReservationDate(date) ||
    parseTimeToMinutes(time) === null
  ) {
    throw new HttpsError("invalid-argument", "Nueva fecha u horario inválido");
  }
  if ((getReservationTimeMs(date, time) || 0) <= Date.now()) {
    throw new HttpsError(
      "failed-precondition",
      "La reserva debe reprogramarse para un horario futuro"
    );
  }

  const staff = await requireRestaurantAdmin(restaurantId, request.auth.uid);
  const db = admin.firestore();
  const reservationRef = db.doc(
    `restaurants/${restaurantId}/reservations/${reservationId}`
  );
  const settingsRef = db.doc(
    `restaurants/${restaurantId}/reservationSettings/main`
  );
  const auditRef = db.collection(`restaurants/${restaurantId}/auditLogs`).doc();

  await db.runTransaction(async (transaction) => {
    const [reservationSnap, settingsSnap] = await Promise.all([
      transaction.get(reservationRef),
      transaction.get(settingsRef),
    ]);
    if (!reservationSnap.exists) {
      throw new HttpsError("not-found", "Reserva inexistente");
    }

    const reservation = reservationSnap.data() || {};
    const status = reservation.status as ReservationStatus;
    if (status !== "pending" && status !== "confirmed") {
      throw new HttpsError(
        "failed-precondition",
        "Solo se pueden reprogramar reservas pendientes o confirmadas"
      );
    }

    const settings = settingsSnap.exists
      ? normalizeReservationSettings(settingsSnap.data())
      : DEFAULT_RESERVATION_SETTINGS;
    const nextSlot = getReservationSlot(time, settings);
    const previousDate = String(reservation.date || "");
    const previousSlot = String(reservation.slot || reservation.time || "");

    if (date === previousDate && nextSlot === previousSlot) {
      throw new HttpsError(
        "failed-precondition",
        "Elegí una fecha u horario diferente"
      );
    }
    if (
      !isValidReservationDate(previousDate) ||
      parseTimeToMinutes(previousSlot) === null
    ) {
      throw new HttpsError(
        "failed-precondition",
        "La reserva actual no tiene una fecha u horario válido"
      );
    }

    if (status === "confirmed") {
      const previousSlotRef = db.doc(
        `restaurants/${restaurantId}/reservationSlots/${previousDate}_${previousSlot.replace(":", "-")}`
      );
      const nextSlotRef = db.doc(
        `restaurants/${restaurantId}/reservationSlots/${date}_${nextSlot.replace(":", "-")}`
      );
      const [previousSlotSnap, nextSlotSnap] = await Promise.all([
        transaction.get(previousSlotRef),
        transaction.get(nextSlotRef),
      ]);
      const missingDates = Array.from(
        new Set([
          ...(!previousSlotSnap.exists ? [previousDate] : []),
          ...(!nextSlotSnap.exists ? [date] : []),
        ])
      );
      const reservationsByDate = new Map<
        string,
        FirebaseFirestore.QuerySnapshot
      >();

      await Promise.all(
        missingDates.map(async (reservationDate) => {
          const snapshot = await transaction.get(
            db
              .collection(`restaurants/${restaurantId}/reservations`)
              .where("date", "==", reservationDate)
          );
          reservationsByDate.set(reservationDate, snapshot);
        })
      );

      const calculateReservedPersons = (
        reservationDate: string,
        slot: string
      ) =>
        reservationsByDate
          .get(reservationDate)
          ?.docs.reduce((total, document) => {
            const existing = document.data();
            return OCCUPYING_RESERVATION_STATUSES.has(existing.status) &&
              (existing.slot || existing.time) === slot
              ? total + Number(existing.partySize || 0)
              : total;
          }, 0) || 0;

      const previousReservedPersons = previousSlotSnap.exists
        ? Number(previousSlotSnap.data()?.reservedPersons || 0)
        : calculateReservedPersons(previousDate, previousSlot);
      const nextReservedPersons = nextSlotSnap.exists
        ? Number(nextSlotSnap.data()?.reservedPersons || 0)
        : calculateReservedPersons(date, nextSlot);
      const partySize = Number(reservation.partySize || 0);
      const mesa = Number.isInteger(reservation.mesa)
        ? Number(reservation.mesa)
        : null;

      if (nextReservedPersons + partySize > settings.capacityPerSlot) {
        throw new HttpsError(
          "resource-exhausted",
          `La franja de ${nextSlot} no tiene capacidad suficiente`
        );
      }

      let previousTableSlotRef: FirebaseFirestore.DocumentReference | null =
        null;
      let shouldDeletePreviousTableSlot = false;
      let nextTableSlotRef: FirebaseFirestore.DocumentReference | null = null;
      if (mesa !== null) {
        previousTableSlotRef = reservationTableSlotRef(
          db,
          restaurantId,
          previousDate,
          previousSlot,
          mesa
        );
        const previousTableSlotSnap = await transaction.get(
          previousTableSlotRef
        );
        shouldDeletePreviousTableSlot =
          previousTableSlotSnap.exists &&
          previousTableSlotSnap.data()?.reservationId === reservationId;
        nextTableSlotRef = await requireAvailableReservationTable({
          transaction,
          db,
          restaurantId,
          reservationId,
          date,
          slot: nextSlot,
          mesa,
        });
      }

      transaction.set(
        previousSlotRef,
        {
          restaurantId,
          date: previousDate,
          slot: previousSlot,
          capacity: settings.capacityPerSlot,
          reservedPersons: Math.max(0, previousReservedPersons - partySize),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      transaction.set(
        nextSlotRef,
        {
          restaurantId,
          date,
          slot: nextSlot,
          capacity: settings.capacityPerSlot,
          reservedPersons: nextReservedPersons + partySize,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      if (previousTableSlotRef && shouldDeletePreviousTableSlot) {
        transaction.delete(previousTableSlotRef);
      }
      if (nextTableSlotRef && mesa !== null) {
        transaction.set(
          nextTableSlotRef,
          reservationTableSlotData({
            restaurantId,
            reservationId,
            date,
            slot: nextSlot,
            mesa,
          })
        );
      }
    }

    const changedAt = admin.firestore.Timestamp.now();
    const historyEntry = {
      from: { date: previousDate, time: previousSlot },
      to: { date, time: nextSlot },
      changedAt,
      actorUid: request.auth!.uid,
      actorEmail: staff.email || request.auth!.token.email || null,
    };

    transaction.update(reservationRef, {
      date,
      time: nextSlot,
      slot: nextSlot,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      rescheduledAt: changedAt,
      rescheduleHistory: admin.firestore.FieldValue.arrayUnion(historyEntry),
      "reminder.status": "pending",
      "reminder.sentAt": null,
      "reminder.sendingAt": null,
      "reminder.attemptId": null,
      "reminder.error": null,
      "reminder.updatedAt": admin.firestore.FieldValue.serverTimestamp(),
    });
    transaction.set(
      auditRef,
      reservationAuditData({
        restaurantId,
        action: "reserva_reprogramada",
        actorUid: request.auth!.uid,
        actorEmail: staff.email || request.auth!.token.email || null,
        entityId: reservationId,
        mesa: reservation.mesa || null,
        description: `Se reprogramó reserva ${reservationId}`,
        before: { date: previousDate, time: previousSlot, status },
        after: { date, time: nextSlot, status },
      })
    );
  });

  return { ok: true };
});

export const getReservationForCancellation = onCall(
  RESERVATION_CALLABLE_OPTIONS,
  async (request) => {
    const data = request.data as {
      restaurantId?: unknown;
      reservationId?: unknown;
      token?: unknown;
    };
    const restaurantId =
      typeof data.restaurantId === "string" ? data.restaurantId.trim() : "";
    const reservationId =
      typeof data.reservationId === "string" ? data.reservationId.trim() : "";
    const token = data.token;

    if (
      !/^[A-Za-z0-9_-]{1,128}$/.test(restaurantId) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(reservationId) ||
      !isValidReservationCancellationToken(token)
    ) {
      throw new HttpsError("invalid-argument", "Enlace de cancelación inválido");
    }

    const db = admin.firestore();
    const [reservationSnap, secretSnap, restaurantSnap] = await Promise.all([
      db.doc(`restaurants/${restaurantId}/reservations/${reservationId}`).get(),
      db
        .doc(`restaurants/${restaurantId}/reservationSecrets/${reservationId}`)
        .get(),
      db.doc(`restaurants/${restaurantId}`).get(),
    ]);

    if (
      !reservationSnap.exists ||
      !tokensMatch(token, secretSnap.data()?.cancellationToken)
    ) {
      throw new HttpsError("permission-denied", "Enlace de cancelación inválido");
    }

    const reservation = reservationSnap.data() || {};
    const restaurant = restaurantSnap.data() || {};
    return {
      restaurantName:
        typeof restaurant.name === "string" ? restaurant.name : "Restaurante",
      name: reservation.name,
      date: reservation.date,
      time: reservation.time,
      partySize: reservation.partySize,
      status: reservation.status,
      canCancel:
        (reservation.status === "pending" ||
          reservation.status === "confirmed") &&
        (getReservationTimeMs(reservation.date, reservation.time) || 0) >
          Date.now(),
    };
  }
);

export const cancelReservationByCustomer = onCall(
  RESERVATION_CALLABLE_OPTIONS,
  async (request) => {
    const data = request.data as {
      restaurantId?: unknown;
      reservationId?: unknown;
      token?: unknown;
    };
    const restaurantId =
      typeof data.restaurantId === "string" ? data.restaurantId.trim() : "";
    const reservationId =
      typeof data.reservationId === "string" ? data.reservationId.trim() : "";
    const token = data.token;

    if (
      !/^[A-Za-z0-9_-]{1,128}$/.test(restaurantId) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(reservationId) ||
      !isValidReservationCancellationToken(token)
    ) {
      throw new HttpsError("invalid-argument", "Enlace de cancelación inválido");
    }

    const db = admin.firestore();
    const reservationRef = db.doc(
      `restaurants/${restaurantId}/reservations/${reservationId}`
    );
    const secretRef = db.doc(
      `restaurants/${restaurantId}/reservationSecrets/${reservationId}`
    );
    const auditRef = db.collection(`restaurants/${restaurantId}/auditLogs`).doc();

    const result = await db.runTransaction(async (transaction) => {
      const [reservationSnap, secretSnap] = await Promise.all([
        transaction.get(reservationRef),
        transaction.get(secretRef),
      ]);
      if (
        !reservationSnap.exists ||
        !tokensMatch(token, secretSnap.data()?.cancellationToken)
      ) {
        throw new HttpsError(
          "permission-denied",
          "Enlace de cancelación inválido"
        );
      }

      const reservation = reservationSnap.data() || {};
      const currentStatus = reservation.status as ReservationStatus;
      if (currentStatus === "cancelled") {
        return { alreadyCancelled: true };
      }
      if (currentStatus !== "pending" && currentStatus !== "confirmed") {
        throw new HttpsError(
          "failed-precondition",
          "Esta reserva ya no puede ser cancelada por el cliente"
        );
      }

      const slot = String(reservation.slot || reservation.time || "");
      const reservationTimeMs = getReservationTimeMs(reservation.date, slot);
      if (reservationTimeMs === null || reservationTimeMs <= Date.now()) {
        throw new HttpsError(
          "failed-precondition",
          "El horario de esta reserva ya pasó"
        );
      }
      if (currentStatus === "confirmed") {
        if (!/^\d{2}:\d{2}$/.test(slot)) {
          throw new HttpsError(
            "failed-precondition",
            "La reserva no tiene una franja válida"
          );
        }
        const slotRef = db.doc(
          `restaurants/${restaurantId}/reservationSlots/${reservation.date}_${slot.replace(":", "-")}`
        );
        const slotSnap = await transaction.get(slotRef);
        let reservedPersons = Number(slotSnap.data()?.reservedPersons || 0);

        if (!slotSnap.exists) {
          const existingReservations = await transaction.get(
            db
              .collection(`restaurants/${restaurantId}/reservations`)
              .where("date", "==", reservation.date)
          );
          reservedPersons = existingReservations.docs.reduce((total, document) => {
            const existing = document.data();
            return OCCUPYING_RESERVATION_STATUSES.has(existing.status) &&
              (existing.slot || existing.time) === slot
              ? total + Number(existing.partySize || 0)
              : total;
          }, 0);
        }
        const mesa = Number.isInteger(reservation.mesa)
          ? Number(reservation.mesa)
          : null;
        const tableSlotRef =
          mesa === null
            ? null
            : reservationTableSlotRef(
                db,
                restaurantId,
                String(reservation.date),
                slot,
                mesa
              );
        const tableSlotSnap = tableSlotRef
          ? await transaction.get(tableSlotRef)
          : null;

        transaction.set(
          slotRef,
          {
            restaurantId,
            date: reservation.date,
            slot,
            reservedPersons: Math.max(
              0,
              reservedPersons - Number(reservation.partySize || 0)
            ),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        if (
          tableSlotRef &&
          tableSlotSnap?.exists &&
          tableSlotSnap.data()?.reservationId === reservationId
        ) {
          transaction.delete(tableSlotRef);
        }
      }

      const customerEmail =
        typeof reservation.email === "string"
          ? reservation.email.trim().toLowerCase()
          : "";
      const actorUid = `customer:${crypto
        .createHash("sha256")
        .update(customerEmail || reservationId)
        .digest("hex")
        .slice(0, 24)}`;

      const cancellationUpdate: Record<string, unknown> = {
        status: "cancelled",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        statusChangedAt: admin.firestore.FieldValue.serverTimestamp(),
        cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
        customerCancellation: {
          source: "email_link",
          requestedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      };
      if (reservation.reminder?.status === "sending") {
        cancellationUpdate["reminder.status"] = "pending";
        cancellationUpdate["reminder.sendingAt"] = null;
        cancellationUpdate["reminder.attemptId"] = null;
      }
      transaction.update(reservationRef, cancellationUpdate);
      transaction.set(
        auditRef,
        reservationAuditData({
          restaurantId,
          action: "reserva_cancelada_cliente",
          actorUid,
          actorEmail: customerEmail || null,
          actorRole: "customer",
          entityId: reservationId,
          mesa: reservation.mesa || null,
          description: `El cliente canceló la reserva ${reservationId}`,
          before: { status: currentStatus },
          after: { status: "cancelled", source: "email_link" },
        })
      );
      return { alreadyCancelled: false };
    });

    return { ok: true, ...result };
  }
);

export const sendReservationConfirmation = onDocumentCreated(
  {
    document: "restaurants/{restaurantId}/reservations/{reservationId}",
    secrets: [RESEND_API_KEY],
  },
  async (event) => {
    const createdReservationSnap = event.data;
    if (!createdReservationSnap) return;

    const reservationSnap = await createdReservationSnap.ref.get();
    if (!reservationSnap.exists) return;

    const reservation = reservationSnap.data() || {};
    if (reservation.confirmation?.status === "sent") return;
    if (reservation.status !== "pending" && reservation.status !== "confirmed") {
      await reservationSnap.ref.update({
        "confirmation.status": "failed",
        "confirmation.error": "La reserva ya no está activa",
        "confirmation.updatedAt": admin.firestore.FieldValue.serverTimestamp(),
      });
      return;
    }

    const email =
      typeof reservation.email === "string"
        ? reservation.email.trim().toLowerCase()
        : "";

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      await reservationSnap.ref.update({
        "confirmation.status": "failed",
        "confirmation.error": "Email inválido o ausente",
        "confirmation.updatedAt": admin.firestore.FieldValue.serverTimestamp(),
      });
      return;
    }

    try {
      const restaurantSnap = await admin
        .firestore()
        .doc(`restaurants/${event.params.restaurantId}`)
        .get();
      const restaurantName =
        typeof restaurantSnap.data()?.name === "string"
          ? restaurantSnap.data()?.name
          : "el restaurante";
      const cancellationToken = await getOrCreateReservationCancellationToken(
        event.params.restaurantId,
        event.params.reservationId
      );
      const cancellationUrl = reservationCancellationUrl(
        event.params.restaurantId,
        event.params.reservationId,
        cancellationToken
      );
      const mesa =
        Number.isInteger(reservation.mesa) && reservation.mesa > 0
          ? `<tr><td style="padding:8px 0;color:#71717a">Mesa</td><td style="padding:8px 0;text-align:right;font-weight:700">${escapeHtml(reservation.mesa)}</td></tr>`
          : "";

      const sent = await sendEmail(
        RESEND_API_KEY.value(),
        email,
        `Reserva confirmada — ${restaurantName}`,
        emailWrapper(
          "Tu reserva está confirmada",
          `<p style="margin:0 0 16px;font-size:15px;color:#3f3f46;line-height:1.6">Hola <strong>${escapeHtml(reservation.name)}</strong>, tu reserva en <strong>${escapeHtml(restaurantName)}</strong> fue confirmada.</p>
           <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border-collapse:collapse">
             <tr><td style="padding:8px 0;border-bottom:1px solid #f4f4f5;color:#71717a">Fecha</td><td style="padding:8px 0;border-bottom:1px solid #f4f4f5;text-align:right;font-weight:700">${escapeHtml(reservation.date)}</td></tr>
             <tr><td style="padding:8px 0;border-bottom:1px solid #f4f4f5;color:#71717a">Hora</td><td style="padding:8px 0;border-bottom:1px solid #f4f4f5;text-align:right;font-weight:700">${escapeHtml(reservation.time)}</td></tr>
             <tr><td style="padding:8px 0;border-bottom:1px solid #f4f4f5;color:#71717a">Personas</td><td style="padding:8px 0;border-bottom:1px solid #f4f4f5;text-align:right;font-weight:700">${escapeHtml(reservation.partySize)}</td></tr>
             ${mesa}
           </table>
           <p style="margin:24px 0"><a href="${escapeHtml(cancellationUrl)}" style="background:#dc2626;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700">Cancelar mi reserva</a></p>
           <p style="margin:0;font-size:13px;color:#71717a">Usá este enlace únicamente si necesitás cancelar. La cancelación libera tu lugar inmediatamente.</p>`
        ),
        undefined,
        `reservation-confirmation-${crypto
          .createHash("sha256")
          .update(reservationSnap.ref.path)
          .digest("hex")}`
      );

      if (!sent) {
        throw new Error("Resend rechazó la confirmación de reserva");
      }

      await reservationSnap.ref.update({
        "confirmation.status": "sent",
        "confirmation.sentAt": admin.firestore.FieldValue.serverTimestamp(),
        "confirmation.updatedAt": admin.firestore.FieldValue.serverTimestamp(),
        "confirmation.error": null,
      });
    } catch (error) {
      console.error("sendReservationConfirmation error:", error);
      Sentry.captureException(error, {
        extra: {
          restaurantId: event.params.restaurantId,
          reservationId: event.params.reservationId,
        },
      });
      await admin.firestore().runTransaction(async (transaction) => {
        const currentSnap = await transaction.get(reservationSnap.ref);
        if (
          !currentSnap.exists ||
          currentSnap.data()?.confirmation?.status === "sent"
        ) {
          return;
        }
        transaction.update(reservationSnap.ref, {
          "confirmation.status": "failed",
          "confirmation.error": "No se pudo enviar el email",
          "confirmation.updatedAt":
            admin.firestore.FieldValue.serverTimestamp(),
        });
      });
    }
  }
);

const RESERVATION_REMINDER_MINUTES = 120;
const RESERVATION_REMINDER_LOCK_MINUTES = 30;

function getDateInBuenosAires(offsetDays = 0): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000));
}

export const sendReservationReminders = onSchedule(
  {
    schedule: "every 15 minutes",
    timeZone: "America/Argentina/Buenos_Aires",
    secrets: [RESEND_API_KEY],
  },
  async () => {
    const db = admin.firestore();
    const nowMs = Date.now();
    const candidateDates = [
      getDateInBuenosAires(),
      getDateInBuenosAires(1),
    ];
    const restaurantsSnap = await db.collection("restaurants").get();
    const snapshots = await Promise.all(
      restaurantsSnap.docs.map((restaurantDoc) =>
        restaurantDoc.ref
          .collection("reservations")
          .where("date", "in", candidateDates)
          .get()
      )
    );
    const restaurantNames = new Map<string, string>();

    for (const reservationSnap of snapshots.flatMap((snapshot) => snapshot.docs)) {
      const candidate = reservationSnap.data();
      const candidateTimeMs = getReservationTimeMs(
        candidate.date,
        candidate.time
      );
      const minutesUntilReservation =
        candidateTimeMs === null
          ? null
          : (candidateTimeMs - nowMs) / (60 * 1000);

      if (
        candidate.status !== "confirmed" ||
        minutesUntilReservation === null ||
        minutesUntilReservation <= 0 ||
        minutesUntilReservation > RESERVATION_REMINDER_MINUTES ||
        candidate.reminder?.status === "sent"
      ) {
        continue;
      }

      const attemptId = crypto.randomUUID();
      const claimed = await db.runTransaction(async (transaction) => {
        const currentSnap = await transaction.get(reservationSnap.ref);
        if (!currentSnap.exists) return null;

        const current = currentSnap.data() || {};
        const currentTimeMs = getReservationTimeMs(current.date, current.time);
        const claimNowMs = Date.now();
        const currentMinutesUntilReservation =
          currentTimeMs === null
            ? null
            : (currentTimeMs - claimNowMs) / (60 * 1000);
        const sendingAtMs =
          typeof current.reminder?.sendingAt?.toMillis === "function"
            ? current.reminder.sendingAt.toMillis()
            : 0;
        const hasActiveSendingLock =
          current.reminder?.status === "sending" &&
          claimNowMs - sendingAtMs <
            RESERVATION_REMINDER_LOCK_MINUTES * 60 * 1000;
        if (
          current.status !== "confirmed" ||
          currentMinutesUntilReservation === null ||
          currentMinutesUntilReservation <= 0 ||
          currentMinutesUntilReservation > RESERVATION_REMINDER_MINUTES ||
          current.reminder?.status === "sent" ||
          hasActiveSendingLock
        ) {
          return null;
        }

        transaction.update(reservationSnap.ref, {
          "reminder.channel": "email",
          "reminder.status": "sending",
          "reminder.sendingAt": admin.firestore.FieldValue.serverTimestamp(),
          "reminder.attemptId": attemptId,
          "reminder.error": null,
          "reminder.updatedAt": admin.firestore.FieldValue.serverTimestamp(),
        });
        return current;
      });

      if (!claimed) continue;

      try {
        const email =
          typeof claimed.email === "string"
            ? claimed.email.trim().toLowerCase()
            : "";
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          throw new Error("Email inválido o ausente");
        }

        const restaurantRef = reservationSnap.ref.parent.parent;
        if (!restaurantRef) throw new Error("Restaurante inválido");

        let restaurantName = restaurantNames.get(restaurantRef.id);
        if (!restaurantName) {
          const restaurantSnap = await restaurantRef.get();
          const restaurantData = restaurantSnap.data();
          restaurantName =
            typeof restaurantData?.name === "string"
              ? restaurantData.name
              : "el restaurante";
          restaurantNames.set(restaurantRef.id, restaurantName);
        }
        const cancellationToken = await getOrCreateReservationCancellationToken(
          restaurantRef.id,
          reservationSnap.id
        );
        const cancellationUrl = reservationCancellationUrl(
          restaurantRef.id,
          reservationSnap.id,
          cancellationToken
        );
        const currentBeforeSend = await reservationSnap.ref.get();
        const currentBeforeSendData = currentBeforeSend.data() || {};
        if (
          !currentBeforeSend.exists ||
          currentBeforeSendData.status !== "confirmed" ||
          currentBeforeSendData.date !== claimed.date ||
          currentBeforeSendData.time !== claimed.time ||
          currentBeforeSendData.reminder?.attemptId !== attemptId
        ) {
          continue;
        }

        const sent = await sendEmail(
          RESEND_API_KEY.value(),
          email,
          `Recordatorio de reserva — ${restaurantName}`,
          emailWrapper(
            "Tu reserva es dentro de 2 horas",
            `<p style="margin:0 0 16px;font-size:15px;color:#3f3f46;line-height:1.6">Hola <strong>${escapeHtml(claimed.name)}</strong>, te recordamos que tu reserva en <strong>${escapeHtml(restaurantName)}</strong> es el <strong>${escapeHtml(claimed.date)}</strong> a las <strong>${escapeHtml(claimed.time)}</strong>.</p>
             <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border-collapse:collapse">
               <tr><td style="padding:8px 0;border-bottom:1px solid #f4f4f5;color:#71717a">Personas</td><td style="padding:8px 0;border-bottom:1px solid #f4f4f5;text-align:right;font-weight:700">${escapeHtml(claimed.partySize)}</td></tr>
               ${Number.isInteger(claimed.mesa) && claimed.mesa > 0 ? `<tr><td style="padding:8px 0;color:#71717a">Mesa</td><td style="padding:8px 0;text-align:right;font-weight:700">${escapeHtml(claimed.mesa)}</td></tr>` : ""}
             </table>
             <p style="margin:24px 0"><a href="${escapeHtml(cancellationUrl)}" style="background:#dc2626;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700">Cancelar mi reserva</a></p>
             <p style="margin:0;font-size:13px;color:#71717a">Si no podés asistir, cancelá desde este enlace para liberar tu lugar.</p>`
          ),
          undefined,
          `reservation-reminder-${crypto
            .createHash("sha256")
            .update(
              `${reservationSnap.ref.path}:${claimed.date}:${claimed.time}`
            )
            .digest("hex")}`
        );

        if (!sent) throw new Error("Resend rechazó el recordatorio");

        await db.runTransaction(async (transaction) => {
          const currentSnap = await transaction.get(reservationSnap.ref);
          const current = currentSnap.data() || {};
          if (
            !currentSnap.exists ||
            current.status !== "confirmed" ||
            current.date !== claimed.date ||
            current.time !== claimed.time ||
            current.reminder?.attemptId !== attemptId
          ) {
            return;
          }
          transaction.update(reservationSnap.ref, {
            "reminder.status": "sent",
            "reminder.sentAt": admin.firestore.FieldValue.serverTimestamp(),
            "reminder.sendingAt": null,
            "reminder.attemptId": null,
            "reminder.updatedAt": admin.firestore.FieldValue.serverTimestamp(),
            "reminder.error": null,
          });
        });
      } catch (error) {
        console.error("sendReservationReminders error:", error);
        Sentry.captureException(error, {
          extra: { reservationId: reservationSnap.id },
        });
        await db.runTransaction(async (transaction) => {
          const currentSnap = await transaction.get(reservationSnap.ref);
          const current = currentSnap.data() || {};
          if (
            !currentSnap.exists ||
            current.date !== claimed.date ||
            current.time !== claimed.time ||
            current.reminder?.attemptId !== attemptId
          ) {
            return;
          }
          transaction.update(reservationSnap.ref, {
            "reminder.status": "failed",
            "reminder.sendingAt": null,
            "reminder.attemptId": null,
            "reminder.error": "No se pudo enviar el recordatorio",
            "reminder.updatedAt": admin.firestore.FieldValue.serverTimestamp(),
          });
        });
      }
    }
  }
);

export const markWaitlistEntryNotified = onCall(
  WAITLIST_ASSIGN_CALLABLE_OPTIONS,
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "No autenticado");

    const data = request.data as {
      restaurantId?: unknown;
      entryId?: unknown;
    };
    const restaurantId =
      typeof data.restaurantId === "string" ? data.restaurantId.trim() : "";
    const entryId =
      typeof data.entryId === "string" ? data.entryId.trim() : "";

    if (
      !isValidReservationDocumentId(restaurantId) ||
      !isValidReservationDocumentId(entryId)
    ) {
      throw new HttpsError("invalid-argument", "Entrada de espera inválida");
    }

    const staff = await requireRestaurantWaitlistStaff(
      restaurantId,
      request.auth.uid
    );
    const db = admin.firestore();
    const entryRef = db.doc(
      `restaurants/${restaurantId}/waitlist/${entryId}`
    );
    const auditRef = db
      .collection(`restaurants/${restaurantId}/auditLogs`)
      .doc();
    const now = admin.firestore.FieldValue.serverTimestamp();

    await db.runTransaction(async (transaction) => {
      const entrySnap = await transaction.get(entryRef);
      if (!entrySnap.exists) {
        throw new HttpsError("not-found", "Entrada de espera inexistente");
      }

      const entry = entrySnap.data() || {};
      if (entry.restaurantId !== restaurantId) {
        throw new HttpsError(
          "failed-precondition",
          "La entrada de espera no pertenece al restaurante"
        );
      }
      if (entry.status !== "waiting") {
        throw new HttpsError(
          "failed-precondition",
          "La entrada ya fue avisada o cerrada"
        );
      }
      if (!normalizeWaitlistWhatsAppPhone(entry.phone)) {
        throw new HttpsError(
          "failed-precondition",
          "El teléfono del cliente no es válido para WhatsApp"
        );
      }

      transaction.update(entryRef, {
        status: "notified",
        notifiedAt: now,
        updatedAt: now,
        notification: {
          status: "manual",
          channel: "whatsapp",
          markedByUid: request.auth!.uid,
          markedAt: now,
        },
      });
      transaction.set(auditRef, {
        restaurantId,
        action: "waitlist_cliente_avisado",
        actorUid: request.auth!.uid,
        actorEmail: staff.email || request.auth!.token.email || null,
        actorRole: staff.role,
        userUid: request.auth!.uid,
        userEmail: staff.email || request.auth!.token.email || null,
        userRole: staff.role,
        mesa: null,
        pedidoId: null,
        cuentaId: null,
        sessionId: null,
        entityType: "waitlist",
        entityId: entryId,
        description: `Se marcó a ${entry.name || "cliente"} como avisado por WhatsApp manual`,
        reason: null,
        changes: {
          before: { status: entry.status },
          after: { status: "notified", channel: "whatsapp", mode: "manual" },
        },
        metadata: { mode: "manual_whatsapp" },
        createdAt: now,
      });
    });

    return { ok: true };
  }
);

export const createWaitlistEntry = onCall(
  WAITLIST_ASSIGN_CALLABLE_OPTIONS,
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "No autenticado");

    const data = request.data as {
      restaurantId?: unknown;
      name?: unknown;
      partySize?: unknown;
      phone?: unknown;
    };
    const restaurantId =
      typeof data.restaurantId === "string" ? data.restaurantId.trim() : "";
    const name = typeof data.name === "string" ? data.name.trim() : "";
    const partySize = Number(data.partySize);
    const phone = typeof data.phone === "string" ? data.phone.trim() : "";

    if (
      !isValidReservationDocumentId(restaurantId) ||
      !name ||
      name.length > 120 ||
      !Number.isInteger(partySize) ||
      partySize < 1 ||
      partySize > 30 ||
      phone.length > 40
    ) {
      throw new HttpsError("invalid-argument", "Entrada de espera inválida");
    }

    const staff = await requireRestaurantWaitlistStaff(
      restaurantId,
      request.auth.uid
    );
    const db = admin.firestore();
    const entryRef = db.collection(`restaurants/${restaurantId}/waitlist`).doc();
    const auditRef = db
      .collection(`restaurants/${restaurantId}/auditLogs`)
      .doc();
    const now = admin.firestore.FieldValue.serverTimestamp();
    const batch = db.batch();

    batch.set(entryRef, {
      restaurantId,
      name,
      partySize,
      phone: phone || null,
      status: "waiting",
      arrivedAt: now,
      updatedAt: now,
    });
    batch.set(auditRef, {
      restaurantId,
      action: "waitlist_creada",
      actorUid: request.auth.uid,
      actorEmail: staff.email || request.auth.token.email || null,
      actorRole: staff.role,
      userUid: request.auth.uid,
      userEmail: staff.email || request.auth.token.email || null,
      userRole: staff.role,
      mesa: null,
      pedidoId: null,
      cuentaId: null,
      sessionId: null,
      entityType: "waitlist",
      entityId: entryRef.id,
      description: `Se agregó ${name} a lista de espera`,
      reason: null,
      changes: {
        before: { exists: false },
        after: { partySize, status: "waiting" },
      },
      metadata: {},
      createdAt: now,
    });
    await batch.commit();

    return { ok: true, entryId: entryRef.id };
  }
);

export const assignWaitlistEntryToTable = onCall(
  WAITLIST_ASSIGN_CALLABLE_OPTIONS,
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "No autenticado");

    const data = request.data as {
      restaurantId?: unknown;
      entryId?: unknown;
      mesa?: unknown;
    };
    const restaurantId =
      typeof data.restaurantId === "string" ? data.restaurantId.trim() : "";
    const entryId =
      typeof data.entryId === "string" ? data.entryId.trim() : "";
    const mesa = Number(data.mesa);

    if (
      !isValidReservationDocumentId(restaurantId) ||
      !isValidReservationDocumentId(entryId) ||
      !Number.isInteger(mesa) ||
      mesa < 1 ||
      mesa > 500
    ) {
      throw new HttpsError("invalid-argument", "Asignacion de mesa invalida");
    }

    const staff = await requireRestaurantWaitlistStaff(
      restaurantId,
      request.auth.uid
    );
    const db = admin.firestore();
    const entryRef = db.doc(
      `restaurants/${restaurantId}/waitlist/${entryId}`
    );
    const mesaRef = db.doc(`restaurants/${restaurantId}/mesas/${mesa}`);
    const sessionRef = db
      .collection(`restaurants/${restaurantId}/sessions`)
      .doc(crypto.randomUUID());
    const auditRef = db
      .collection(`restaurants/${restaurantId}/auditLogs`)
      .doc();
    const now = admin.firestore.FieldValue.serverTimestamp();

    try {
      await db.runTransaction(async (transaction) => {
        const [entrySnap, mesaSnap] = await Promise.all([
          transaction.get(entryRef),
          transaction.get(mesaRef),
        ]);

        if (!entrySnap.exists) {
          throw new HttpsError("not-found", "Entrada de espera inexistente");
        }
        if (!mesaSnap.exists) {
          throw new HttpsError("not-found", "Mesa inexistente");
        }

        const entry = entrySnap.data() || {};
        const mesaData = mesaSnap.data() || {};

        if (entry.restaurantId !== restaurantId) {
          throw new HttpsError(
            "failed-precondition",
            "La entrada de espera no pertenece al restaurante"
          );
        }
        if (!isOpenWaitlistStatus(entry.status)) {
          throw new HttpsError(
            "failed-precondition",
            "La entrada de espera ya fue cerrada"
          );
        }
        if (!isWaitlistTableAvailable(mesaData, restaurantId, mesa)) {
          throw new HttpsError(
            "failed-precondition",
            "La mesa seleccionada ya no esta disponible"
          );
        }

        transaction.create(sessionRef, {
          restaurantId,
          tableNumber: mesa,
          status: "active",
          billRequested: false,
          ordersLocked: false,
          lockedReason: null,
          openedAt: now,
          closedAt: null,
          cleanedAt: null,
          closedReason: null,
          createdAt: now,
          updatedAt: now,
        });
        transaction.update(mesaRef, {
          estado: "occupied",
          activeSessionId: sessionRef.id,
          lastSessionId: null,
          cleanedAt: null,
          updatedAt: now,
        });
        transaction.update(entryRef, {
          status: "seated",
          assignedAt: now,
          seatedAt: now,
          closedAt: now,
          updatedAt: now,
          assignment: {
            mesa,
            sessionId: sessionRef.id,
            actorUid: request.auth!.uid,
            assignedAt: now,
          },
        });
        transaction.set(auditRef, {
          restaurantId,
          action: "waitlist_mesa_asignada",
          actorUid: request.auth!.uid,
          actorEmail: staff.email || request.auth!.token.email || null,
          actorRole: staff.role,
          userUid: request.auth!.uid,
          userEmail: staff.email || request.auth!.token.email || null,
          userRole: staff.role,
          mesa,
          pedidoId: null,
          cuentaId: null,
          sessionId: sessionRef.id,
          entityType: "waitlist",
          entityId: entryId,
          description: `Se asigno ${entry.name || entryId} a mesa ${mesa}`,
          reason: null,
          changes: {
            before: { status: entry.status, mesa: null, sessionId: null },
            after: {
              status: "seated",
              mesa,
              sessionId: sessionRef.id,
            },
          },
          metadata: {},
          createdAt: now,
        });
      });

      return { ok: true, mesa, sessionId: sessionRef.id };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      console.error("assignWaitlistEntryToTable error:", error);
      Sentry.captureException(error, { extra: { restaurantId, entryId, mesa } });
      throw new HttpsError("internal", "No se pudo asignar la mesa");
    }
  }
);

export const closeWaitlistEntry = onCall(
  WAITLIST_ASSIGN_CALLABLE_OPTIONS,
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "No autenticado");

    const data = request.data as {
      restaurantId?: unknown;
      entryId?: unknown;
      status?: unknown;
    };
    const restaurantId =
      typeof data.restaurantId === "string" ? data.restaurantId.trim() : "";
    const entryId =
      typeof data.entryId === "string" ? data.entryId.trim() : "";
    const status = data.status;
    const closedAtFieldByStatus: Record<
      "cancelled" | "abandoned" | "no_response",
      string
    > = {
      cancelled: "cancelledAt",
      abandoned: "abandonedAt",
      no_response: "noResponseAt",
    };

    if (
      !isValidReservationDocumentId(restaurantId) ||
      !isValidReservationDocumentId(entryId) ||
      !isWaitlistClosureStatus(status)
    ) {
      throw new HttpsError("invalid-argument", "Cierre de espera inválido");
    }

    const staff = await requireRestaurantWaitlistStaff(
      restaurantId,
      request.auth.uid
    );
    const db = admin.firestore();
    const entryRef = db.doc(
      `restaurants/${restaurantId}/waitlist/${entryId}`
    );
    const auditRef = db
      .collection(`restaurants/${restaurantId}/auditLogs`)
      .doc();
    const now = admin.firestore.FieldValue.serverTimestamp();

    try {
      await db.runTransaction(async (transaction) => {
        const entrySnap = await transaction.get(entryRef);
        if (!entrySnap.exists) {
          throw new HttpsError("not-found", "Entrada de espera inexistente");
        }

        const entry = entrySnap.data() || {};
        if (entry.restaurantId !== restaurantId) {
          throw new HttpsError(
            "failed-precondition",
            "La entrada de espera no pertenece al restaurante"
          );
        }
        if (!isOpenWaitlistStatus(entry.status)) {
          throw new HttpsError(
            "failed-precondition",
            "La entrada de espera ya fue cerrada"
          );
        }
        if (status === "no_response" && entry.status !== "notified") {
          throw new HttpsError(
            "failed-precondition",
            "Sólo se puede marcar sin respuesta después de enviar el aviso"
          );
        }
        transaction.update(entryRef, {
          status,
          closedAt: now,
          updatedAt: now,
          [closedAtFieldByStatus[status]]: now,
        });
        transaction.set(auditRef, {
          restaurantId,
          action: "waitlist_estado_actualizado",
          actorUid: request.auth!.uid,
          actorEmail: staff.email || request.auth!.token.email || null,
          actorRole: staff.role,
          userUid: request.auth!.uid,
          userEmail: staff.email || request.auth!.token.email || null,
          userRole: staff.role,
          mesa: null,
          pedidoId: null,
          cuentaId: null,
          sessionId: null,
          entityType: "waitlist",
          entityId: entryId,
          description: `Se actualizó entrada ${entryId} a ${status}`,
          reason: null,
          changes: {
            before: { status: entry.status },
            after: { status },
          },
          metadata: {},
          createdAt: now,
        });
      });

      return { ok: true, status };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      console.error("closeWaitlistEntry error:", error);
      Sentry.captureException(error, {
        extra: { restaurantId, entryId, status },
      });
      throw new HttpsError("internal", "No se pudo cerrar la entrada de espera");
    }
  }
);

const MP_PLANS: Record<string, string> = {
  starter: "ec0431741ea24561a858ae740135a58c",
  pro: "3d8e990cc99a4c20baeac76f027b4c0d",
  premium: "21d0a8de8a194d269d0f7e38272145d3",
};

// ─── Verificación de firma de Mercado Pago ───────────────────────────────────
// Referencia: https://www.mercadopago.com.ar/developers/es/docs/your-integrations/notifications/webhooks

/**
 * Verifica el header x-signature que MP incluye en cada webhook.
 *
 * Formato del header: "ts=<unix_seconds>,v1=<hmac_sha256_hex>"
 * Mensaje firmado:    "id:[data.id];request-date:[x-request-id];updated-id:[data.id];"
 *
 * Usa comparación en tiempo constante (timingSafeEqual) para evitar timing attacks.
 * Rechaza timestamps con más de 5 minutos de antigüedad para prevenir replay attacks.
 */
function verifyMpWebhookSignature(
  xSignature: string | string[] | undefined,
  xRequestId: string | string[] | undefined,
  dataId: string,
  secret: string
): boolean {
  if (!xSignature || typeof xSignature !== "string") return false;

  const ts = xSignature.match(/ts=([^,]+)/)?.[1] ?? "";
  const v1 = xSignature.match(/v1=([^,]+)/)?.[1] ?? "";

  if (!ts || !v1) return false;

  const tsNum = parseInt(ts, 10);
  if (isNaN(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 300) return false;

  const requestId = typeof xRequestId === "string" ? xRequestId : "";
  const signedMessage = `id:${dataId};request-date:${requestId};updated-id:${dataId};`;

  const computed = crypto
    .createHmac("sha256", secret)
    .update(signedMessage)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(v1, "hex"),
      Buffer.from(computed, "hex")
    );
  } catch {
    return false;
  }
}

// ─── 1. Crear suscripción ────────────────────────────────────────────────────

export const createSubscription = onCall(
  { secrets: [MP_ACCESS_TOKEN], cors: true },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "No autenticado");
    }

    const { restaurantId, plan, payerEmail } = request.data as {
      restaurantId: string;
      plan: "starter" | "pro" | "premium";
      payerEmail: string;
    };

    if (!restaurantId || !plan || !payerEmail) {
      throw new HttpsError("invalid-argument", "Faltan datos requeridos");
    }

    if (!MP_PLANS[plan]) {
      throw new HttpsError("invalid-argument", "Plan inválido");
    }

    // Verificar que el usuario es admin del restaurante
    const staffDoc = await admin
      .firestore()
      .collection("restaurants")
      .doc(restaurantId)
      .collection("staff")
      .doc(request.auth.uid)
      .get();

    if (!staffDoc.exists || staffDoc.data()?.role !== "admin") {
      throw new HttpsError("permission-denied", "No tenés permisos");
    }

    // Prevenir doble pago
    const restaurantSnap = await admin
      .firestore()
      .collection("restaurants")
      .doc(restaurantId)
      .get();

    const restaurantSnap2Data = restaurantSnap.data();
    const currentBilling = restaurantSnap2Data?.billing;
    const currentPlan = restaurantSnap2Data?.plan;

    // Caso 1: ya tienen suscripción activa con el mismo plan → bloquear
    if (
      currentBilling?.status === "active" &&
      currentBilling?.subscriptionId &&
      currentPlan === plan
    ) {
      throw new HttpsError(
        "already-exists",
        "Ya tenés una suscripción activa con este plan."
      );
    }

    // Caso 2: hay un checkout en curso hace menos de 10 minutos → bloquear
    if (currentBilling?.status === "pending" && currentBilling?.updatedAt) {
      const updatedAt: Date =
        typeof currentBilling.updatedAt.toDate === "function"
          ? currentBilling.updatedAt.toDate()
          : new Date(currentBilling.updatedAt);
      const minutesElapsed = (Date.now() - updatedAt.getTime()) / 60000;
      if (minutesElapsed < 10) {
        throw new HttpsError(
          "already-exists",
          "Ya hay un proceso de pago en curso. Esperá unos minutos antes de intentar de nuevo."
        );
      }
    }

    const payerEmailResolved = payerEmail || request.auth.token.email || "";

    await admin
      .firestore()
      .collection("restaurants")
      .doc(restaurantId)
      .update({
        "billing.pendingPlan": plan,
        "billing.payerEmail": payerEmailResolved,
        "billing.status": "pending",
        "billing.provider": "mercadopago",
        "billing.updatedAt": admin.firestore.FieldValue.serverTimestamp(),
      });

    // Crear suscripción vía API de MP para poder incluir back_url de retorno a la app
    const appUrl = process.env.APP_URL || "https://want-livid.vercel.app";
    const token = MP_ACCESS_TOKEN.value();

    const mpRes = await fetch("https://api.mercadopago.com/preapproval", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        preapproval_plan_id: MP_PLANS[plan],
        payer_email: payerEmailResolved,
        back_url: `${appUrl}/payment-required?restaurantId=${restaurantId}`,
        external_reference: restaurantId,
      }),
    });

    if (!mpRes.ok) {
      const errorText = await mpRes.text();
      console.error("MP API error al crear suscripción:", mpRes.status, errorText);
      throw new HttpsError("internal", "No se pudo iniciar el checkout con Mercado Pago");
    }

    const mpData = await mpRes.json() as { id: string; init_point: string };

    return {
      subscriptionId: mpData.id ?? null,
      initPoint: mpData.init_point,
    };
  }
);

// ─── 2. Webhook de Mercado Pago ──────────────────────────────────────────────

export const mpWebhook = onRequest(
  { secrets: [MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET, RESEND_API_KEY] },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method not allowed");
      return;
    }

    // Verificar firma antes de cualquier procesamiento.
    // Si el secret está configurado (producción), la firma es obligatoria.
    // Si está vacío (entorno local sin secret provisionado), se omite.
    const webhookSecret = MP_WEBHOOK_SECRET.value();
    if (webhookSecret) {
      const dataId = String(req.body?.data?.id ?? req.query.id ?? "");
      const valid = verifyMpWebhookSignature(
        req.headers["x-signature"],
        req.headers["x-request-id"],
        dataId,
        webhookSecret
      );
      if (!valid) {
        console.warn("mpWebhook: x-signature inválida — request rechazado");
        res.status(401).send("Unauthorized");
        return;
      }
    }

    const topic = req.query.topic || req.body?.type;
    const resourceId =
      req.query.id ||
      req.body?.data?.id ||
      req.body?.resource?.split("/").pop();

    if (!topic || !resourceId) {
      res.status(200).send("OK");
      return;
    }

    if (topic !== "preapproval" && topic !== "subscription_preapproval") {
      res.status(200).send("OK");
      return;
    }

    try {
      const token = MP_ACCESS_TOKEN.value();

      // Buscar la suscripción en MP
      const mpRes = await fetch(
        `https://api.mercadopago.com/preapproval/${resourceId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      const subscription = await mpRes.json() as {
        id: string;
        status: string;
        preapproval_plan_id: string;
        payer_email: string;
        payer_id: number;
        next_payment_date: string;
      };

      if (!subscription.id) {
        res.status(200).send("OK");
        return;
      }  
      
      // Buscar por email del pagador (guardado al iniciar el flujo)
      let restaurantsSnap = await admin
        .firestore()
        .collection("restaurants")
        .where("billing.payerEmail", "==", subscription.payer_email)
        .limit(1)
        .get();

      // Fallback: buscar por subscriptionId (para suscripciones ya existentes)
      if (restaurantsSnap.empty) {
        restaurantsSnap = await admin
          .firestore()
          .collection("restaurants")
          .where("billing.subscriptionId", "==", subscription.id)
          .limit(1)
          .get();
      }

      if (restaurantsSnap.empty) {
        console.log("No se encontró restaurante para subscription ID:", subscription.id);
        res.status(200).send("OK");
        return;
      }

      const restaurantDoc = restaurantsSnap.docs[0];
      const restaurantId = restaurantDoc.id;
      const restaurantData = restaurantDoc.data();

      // Determinar plan por planId de MP
      const planEntry = Object.entries(MP_PLANS).find(
        ([, planId]) => planId === subscription.preapproval_plan_id
      );
      const plan = planEntry ? planEntry[0] : "starter";

      // Mapear status de MP a nuestro modelo
      const statusMap: Record<string, string> = {
        authorized: "active",
        paused: "past_due",
        cancelled: "canceled",
        pending: "pending",
      };

      const billingStatus = statusMap[subscription.status] ?? "pending";

      const nextBillingDate = subscription.next_payment_date
        ? admin.firestore.Timestamp.fromDate(new Date(subscription.next_payment_date))
        : null;

      // Mapear billingStatus a subscriptionStatus (campo que usan los guards de acceso)
      const subscriptionStatusMap: Record<string, string> = {
        active: "active",
        past_due: "past_due",
        canceled: "blocked",
      };
      const newSubscriptionStatus = subscriptionStatusMap[billingStatus];

      await admin
        .firestore()
        .collection("restaurants")
        .doc(restaurantId)
        .update({
          plan: billingStatus === "active" ? plan : "starter",
          ...(newSubscriptionStatus && { subscriptionStatus: newSubscriptionStatus }),
          ...(billingStatus === "active" && nextBillingDate && { nextBillingDate }),
          "billing.status": billingStatus,
          "billing.subscriptionId": subscription.id,
          "billing.provider": "mercadopago",
          "billing.currentPeriodEnd": nextBillingDate,
          "billing.lastWebhookAt": admin.firestore.FieldValue.serverTimestamp(),
          "billing.updatedAt": admin.firestore.FieldValue.serverTimestamp(),
        });

      // Guardar evento en billingEvents
      await admin
        .firestore()
        .collection("restaurants")
        .doc(restaurantId)
        .collection("billingEvents")
        .add({
          type: `mp_${subscription.status}`,
          subscriptionId: subscription.id,
          plan,
          billingStatus,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

      // Si hay una suscripción anterior distinta, cancelarla en MP automáticamente
      if (billingStatus === "active") {
        const prevSubscriptionId = restaurantData?.billing?.subscriptionId;
        if (prevSubscriptionId && prevSubscriptionId !== subscription.id) {
          await fetch(`https://api.mercadopago.com/preapproval/${prevSubscriptionId}`, {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ status: "cancelled" }),
          }).catch((err) => console.warn("No se pudo cancelar suscripción anterior:", err));
        }
      }

      // Registrar pago en payments para que aparezca en el Super Admin
      if (billingStatus === "active") {
        const monthlyPrice = Number(restaurantData?.monthlyPrice ?? 0);
        await admin
          .firestore()
          .collection("restaurants")
          .doc(restaurantId)
          .collection("payments")
          .add({
            restaurantId,
            type: "monthly",
            amount: monthlyPrice,
            plan,
            notes: "Pago automático vía Mercado Pago",
            subscriptionId: subscription.id,
            paidAt: admin.firestore.FieldValue.serverTimestamp(),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });

        // Email de pago confirmado
        const ownerEmail = restaurantData?.ownerEmail ?? subscription.payer_email;
        if (ownerEmail) {
          const planLabel = PLAN_LABELS[plan] ?? plan;
          await sendEmail(
            RESEND_API_KEY.value(),
            ownerEmail,
            `✅ Pago confirmado — WANT ${planLabel}`,
            emailWrapper(
              `¡Tu pago fue confirmado!`,
              `<p style="color:#52525b;line-height:1.6">Tu suscripción al plan <strong>${planLabel}</strong> está activa. Ya podés acceder a tu panel administrativo y operar con normalidad.</p>
               <p style="color:#52525b;line-height:1.6">Gracias por confiar en WANT.</p>`
            )
          );
        }
      }

      res.status(200).send("OK");
    } catch (error) {
      console.error("mpWebhook error:", error);
      Sentry.captureException(error, {
        extra: {
          topic: String(topic ?? ""),
          resourceId: String(resourceId ?? ""),
        },
      });
      await Sentry.flush(2000);
      res.status(200).send("OK"); // Siempre 200 a MP para evitar reintentos
    }
  }
);

// ─── 3. Cancelar suscripción ─────────────────────────────────────────────────

export const cancelSubscription = onCall(
  { secrets: [MP_ACCESS_TOKEN, RESEND_API_KEY], cors: true },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "No autenticado");
    }

    const { restaurantId } = request.data as { restaurantId: string };

    if (!restaurantId) {
      throw new HttpsError("invalid-argument", "Falta restaurantId");
    }

    const staffDoc = await admin
      .firestore()
      .collection("restaurants")
      .doc(restaurantId)
      .collection("staff")
      .doc(request.auth.uid)
      .get();

    if (!staffDoc.exists || staffDoc.data()?.role !== "admin") {
      throw new HttpsError("permission-denied", "No tenés permisos");
    }

    const restaurantDoc = await admin
      .firestore()
      .collection("restaurants")
      .doc(restaurantId)
      .get();

    const subscriptionId = restaurantDoc.data()?.billing?.subscriptionId;

    if (!subscriptionId) {
      throw new HttpsError("not-found", "No hay suscripción activa");
    }

    const token = MP_ACCESS_TOKEN.value();

    const response = await fetch(
      `https://api.mercadopago.com/preapproval/${subscriptionId}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "cancelled" }),
      }
    );

    const data = await response.json() as { status: string };

    if (data.status !== "cancelled") {
      throw new HttpsError("internal", "No se pudo cancelar en MP");
    }

    await admin
      .firestore()
      .collection("restaurants")
      .doc(restaurantId)
      .update({
        plan: "starter",
        subscriptionStatus: "blocked",
        "billing.status": "canceled",
        "billing.updatedAt": admin.firestore.FieldValue.serverTimestamp(),
      });

    // Email de cancelación
    const ownerEmail = restaurantDoc.data()?.ownerEmail;
    if (ownerEmail) {
      await sendEmail(
        RESEND_API_KEY.value(),
        ownerEmail,
        "Tu suscripción de WANT fue cancelada",
        emailWrapper(
          "Suscripción cancelada",
          `<p style="color:#52525b;line-height:1.6">Tu suscripción fue cancelada correctamente. Tu restaurante quedará con acceso restringido.</p>
           <p style="color:#52525b;line-height:1.6">Si fue un error o querés reactivarla, contactanos por WhatsApp y te ayudamos.</p>`
        )
      );
    }

    return { success: true };
  }
);

// ─── 4. Sync diario de billing ───────────────────────────────────────────────

export const dailyBillingSync = onSchedule(
  {
    schedule: "0 3 * * *",
    timeZone: "America/Argentina/Buenos_Aires",
    secrets: [RESEND_API_KEY],
  },
  async () => {
    const now = admin.firestore.Timestamp.now();
    const in6Days = admin.firestore.Timestamp.fromDate(
      new Date(Date.now() + 6 * 24 * 60 * 60 * 1000)
    );
    const db = admin.firestore();
    const batch = db.batch();
    let updates = 0;

    try {
      // ── Trials vencidos → past_due + email ──────────────────────────────
      const expiredTrials = await db
        .collection("restaurants")
        .where("subscriptionStatus", "==", "trial")
        .where("trialEndsAt", "<", now)
        .get();

      for (const doc of expiredTrials.docs) {
        batch.update(doc.ref, {
          subscriptionStatus: "past_due",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        updates++;

        const ownerEmail = doc.data().ownerEmail;
        const name = doc.data().name ?? "tu restaurante";
        if (ownerEmail) {
          await sendEmail(
            RESEND_API_KEY.value(),
            ownerEmail,
            "Tu prueba gratuita de WANT terminó",
            emailWrapper(
              "Tu trial venció",
              `<p style="color:#52525b;line-height:1.6">El período de prueba de <strong>${name}</strong> terminó. Para seguir usando WANT, elegí un plan y activá tu cuenta.</p>
               <p style="margin:24px 0"><a href="https://want-livid.vercel.app/payment-required?restaurantId=${doc.id}" style="background:#0a0a0a;color:#fff;padding:12px 24px;border-radius:12px;text-decoration:none;font-weight:700">Activar mi cuenta</a></p>`
            )
          );
        }
      }

      // ── Aviso 5 días antes del vencimiento del trial ────────────────────
      const trialWarnings = await db
        .collection("restaurants")
        .where("subscriptionStatus", "==", "trial")
        .where("trialEndsAt", ">", now)
        .where("trialEndsAt", "<", in6Days)
        .get();

      for (const doc of trialWarnings.docs) {
        const trialEndsAt = doc.data().trialEndsAt?.toDate?.();
        if (!trialEndsAt) continue;

        const daysLeft = Math.ceil((trialEndsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        if (daysLeft > 5) continue;

        // Solo mandar si no se mandó ya hoy
        if (doc.data().billing?.trialWarningSentAt) continue;

        const ownerEmail = doc.data().ownerEmail;
        const name = doc.data().name ?? "tu restaurante";
        if (ownerEmail) {
          await sendEmail(
            RESEND_API_KEY.value(),
            ownerEmail,
            `Te quedan ${daysLeft} días de prueba en WANT`,
            emailWrapper(
              `Quedan ${daysLeft} días de trial`,
              `<p style="color:#52525b;line-height:1.6">Tu período de prueba de <strong>${name}</strong> vence en <strong>${daysLeft} días</strong>. Para no perder el acceso, activá tu cuenta antes de que expire.</p>
               <p style="margin:24px 0"><a href="https://want-livid.vercel.app/payment-required?restaurantId=${doc.id}" style="background:#0a0a0a;color:#fff;padding:12px 24px;border-radius:12px;text-decoration:none;font-weight:700">Ver planes y activar</a></p>`
            )
          );

          await doc.ref.update({
            "billing.trialWarningSentAt": admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      }

      // ── Suscripciones activas vencidas → past_due ────────────────────────
      const expiredActive = await db
        .collection("restaurants")
        .where("subscriptionStatus", "==", "active")
        .where("nextBillingDate", "<", now)
        .get();

      expiredActive.docs.forEach((doc) => {
        batch.update(doc.ref, {
          subscriptionStatus: "past_due",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        updates++;
      });

      if (updates > 0) {
        await batch.commit();
      }

      console.log(`dailyBillingSync: ${updates} restaurante(s) actualizados`);
    } catch (error) {
      console.error("dailyBillingSync error:", error);
      Sentry.captureException(error);
      await Sentry.flush(2000);
    }
  }
);

// ─── AFIP: Generar CSR ────────────────────────────────────────────────────────

export const afipGenerateCsr = onCall(
  { secrets: [AFIP_MASTER_KEY], cors: true },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "No autenticado");

    const { restaurantId, cuit, puntoVenta, fiscalCondition, ivaRate, env: reqEnv } = request.data as {
      restaurantId: string;
      cuit: string;
      puntoVenta: number;
      fiscalCondition: "monotributista" | "responsable_inscripto";
      ivaRate: number;
      env?: string;
    };

    if (!restaurantId || !cuit || !puntoVenta || !fiscalCondition) {
      throw new HttpsError("invalid-argument", "Faltan datos fiscales");
    }

    const resolvedEnv: "homologacion" | "produccion" | "simulacion" =
      reqEnv === "homologacion" ? "homologacion"
      : reqEnv === "simulacion" ? "simulacion"
      : (AFIP_ENV ?? "produccion");

    const staffDoc = await admin.firestore()
      .collection("restaurants").doc(restaurantId)
      .collection("staff").doc(request.auth.uid).get();
    if (!staffDoc.exists || staffDoc.data()?.role !== "admin") {
      throw new HttpsError("permission-denied", "No tenés permisos");
    }

    // ── Modo simulación: activa directamente sin claves ni certificado real ──
    if (resolvedEnv === "simulacion") {
      await admin.firestore()
        .collection("restaurants").doc(restaurantId)
        .collection("afipConfig").doc("main")
        .set({
          cuit: cuit.replace(/\D/g, "").replace(/^(\d{2})(\d{8})(\d)$/, "$1-$2-$3"),
          puntoVenta,
          fiscalCondition,
          ivaRate: ivaRate ?? 21,
          privateKeyEncrypted: "",
          privateKeyIv: "",
          csrPem: "",
          certificate: "SIMULACION",
          status: "active",
          env: "simulacion",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      return { csrPem: "" };
    }

    // ── Entorno real: generar par de claves + CSR ────────────────────────────
    const restaurantDoc = await admin.firestore()
      .collection("restaurants").doc(restaurantId).get();
    const restaurantName = restaurantDoc.data()?.name ?? "Restaurante";

    const { privateKeyPem, csrPem } = generateKeyPairAndCsr(restaurantName, cuit);

    const masterKey = AFIP_MASTER_KEY.value();
    const { encrypted, iv } = encryptPrivateKey(privateKeyPem, masterKey);

    await admin.firestore()
      .collection("restaurants").doc(restaurantId)
      .collection("afipConfig").doc("main")
      .set({
        cuit: cuit.replace(/\D/g, "").replace(/^(\d{2})(\d{8})(\d)$/, "$1-$2-$3"),
        puntoVenta,
        fiscalCondition,
        ivaRate: ivaRate ?? 21,
        privateKeyEncrypted: encrypted,
        privateKeyIv: iv,
        csrPem,
        certificate: "",
        status: "pending_certificate",
        env: resolvedEnv,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

    return { csrPem };
  }
);

// ─── AFIP: Guardar certificado ────────────────────────────────────────────────

export const afipSaveCertificate = onCall(
  { cors: true },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "No autenticado");

    const { restaurantId, certificatePem } = request.data as {
      restaurantId: string;
      certificatePem: string;
    };

    if (!restaurantId || !certificatePem?.includes("BEGIN CERTIFICATE")) {
      throw new HttpsError("invalid-argument", "Certificado inválido — debe ser un archivo .crt en formato PEM");
    }

    const staffDoc = await admin.firestore()
      .collection("restaurants").doc(restaurantId)
      .collection("staff").doc(request.auth.uid).get();
    if (!staffDoc.exists || staffDoc.data()?.role !== "admin") {
      throw new HttpsError("permission-denied", "No tenés permisos");
    }

    const configRef = admin.firestore()
      .collection("restaurants").doc(restaurantId)
      .collection("afipConfig").doc("main");

    const config = await configRef.get();
    if (!config.exists || config.data()?.status !== "pending_certificate") {
      throw new HttpsError("failed-precondition", "Primero generá el CSR desde el panel de configuración");
    }

    await configRef.update({
      certificate: certificatePem.trim(),
      status: "active",
      activatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { success: true };
  }
);

// ─── PDF helper ───────────────────────────────────────────────────────────────

type PdfItem = { description: string; quantity: number; unitPrice: number };

function generateInvoicePdf(
  result: AfipInvoiceResult,
  req: InvoiceRequest & { invoiceType: "A" | "B" | "C" },
  config: AfipConfig & { ivaRate?: number },
  restaurantName: string,
  items: PdfItem[] = []
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const pageHeight = Math.max(640, 340 + items.length * 16);
    const doc = new PDFDocument({ size: [340, pageHeight], margin: 24, compress: true });
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const W = 340 - 48;
    const fmt = (n: number) =>
      new Intl.NumberFormat("es-AR", {
        style: "currency", currency: "ARS", minimumFractionDigits: 2,
      }).format(n);
    const today = new Date();
    const dateStr = `${String(today.getDate()).padStart(2, "0")}/${String(today.getMonth() + 1).padStart(2, "0")}/${today.getFullYear()}`;
    const ptoStr = String(result.puntoVenta).padStart(4, "0");
    const nroStr = String(result.invoiceNumber).padStart(8, "0");
    const fiscalLabel: Record<string, string> = {
      responsable_inscripto: "Responsable Inscripto",
      monotributista: "Monotributista",
    };

    // ── Header ──
    doc.font("Helvetica-Bold").fontSize(13).text(restaurantName, { align: "center" });
    doc.font("Helvetica").fontSize(8).text(`CUIT: ${result.cuit}`, { align: "center" });
    doc.text(fiscalLabel[config.fiscalCondition] ?? config.fiscalCondition, { align: "center" });
    doc.moveDown(0.6);
    doc.moveTo(24, doc.y).lineTo(316, doc.y).dash(3, { space: 3 }).stroke("#aaa").undash();
    doc.moveDown(0.6);

    // ── Tipo de comprobante ──
    const boxY = doc.y;
    doc.rect(130, boxY, 80, 38).stroke("#111");
    doc.font("Helvetica-Bold").fontSize(22).text(result.invoiceType, 130, boxY + 8, { width: 80, align: "center" });
    doc.y = boxY + 46;
    doc.font("Helvetica-Bold").fontSize(8).text(`Pto. Vta: ${ptoStr}   Nro: ${nroStr}`, { align: "center" });
    doc.font("Helvetica").fontSize(8).text(`Fecha: ${dateStr}`, { align: "center" });
    doc.moveDown(0.6);
    doc.moveTo(24, doc.y).lineTo(316, doc.y).dash(3, { space: 3 }).stroke("#aaa").undash();
    doc.moveDown(0.6);

    // ── Receptor ──
    doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#888").text("RECEPTOR");
    doc.fillColor("#000").font("Helvetica-Bold").fontSize(9).text(req.customerName);
    if (req.customerDocType !== "consumidor_final" && req.customerDocNumber) {
      doc.font("Helvetica").fontSize(8).text(`${req.customerDocType}: ${req.customerDocNumber}`);
    }
    doc.moveDown(0.6);
    doc.moveTo(24, doc.y).lineTo(316, doc.y).dash(3, { space: 3 }).stroke("#aaa").undash();
    doc.moveDown(0.6);

    // ── Detalle ──
    doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#888").text("DETALLE");
    doc.fillColor("#000");
    if (items.length > 0) {
      for (const item of items) {
        const lineY = doc.y;
        const desc = item.quantity > 1 ? `${item.quantity}x ${item.description}` : item.description;
        doc.font("Helvetica").fontSize(8.5).text(desc, 24, lineY, { width: W - 70 });
        doc.font("Helvetica").fontSize(8.5).text(fmt(item.quantity * item.unitPrice), 24, lineY, { width: W, align: "right" });
        doc.moveDown(0.25);
      }
    } else {
      const detY = doc.y;
      doc.font("Helvetica").fontSize(9).text("Consumo en restaurante", 24, detY, { width: W - 70 });
      doc.font("Helvetica-Bold").fontSize(9).text(fmt(req.total), 24, detY, { width: W, align: "right" });
    }
    doc.moveDown(0.4);
    doc.moveTo(24, doc.y).lineTo(316, doc.y).stroke("#111");
    doc.moveDown(0.3);

    // ── Total ──
    const totY = doc.y;
    doc.font("Helvetica-Bold").fontSize(11).text("TOTAL", 24, totY, { width: W - 70 });
    doc.text(fmt(req.total), 24, totY, { width: W, align: "right" });
    doc.moveDown(0.6);
    doc.moveTo(24, doc.y).lineTo(316, doc.y).dash(3, { space: 3 }).stroke("#aaa").undash();
    doc.moveDown(0.6);

    // ── CAE ──
    doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#888").text("CAE");
    doc.fillColor("#000").font("Courier").fontSize(8.5).text(result.cae);
    doc.font("Helvetica").fontSize(7.5).text(`Vto. CAE: ${result.caeExpiry}`);
    doc.moveDown(0.8);
    doc.font("Helvetica").fontSize(6.5).fillColor("#aaa")
      .text("Emitido con WANT · want.com.ar", { align: "center" });

    doc.end();
  });
}

// ─── AFIP: Emitir comprobante ─────────────────────────────────────────────────

export const afipIssueInvoice = onCall(
  { secrets: [AFIP_MASTER_KEY], cors: true, timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "No autenticado");

    const invoiceReq = request.data as InvoiceRequest;

    if (!invoiceReq.restaurantId || !invoiceReq.cuentaId) {
      throw new HttpsError("invalid-argument", "Faltan datos de la cuenta");
    }

    const staffDoc = await admin.firestore()
      .collection("restaurants").doc(invoiceReq.restaurantId)
      .collection("staff").doc(request.auth.uid).get();
    if (!staffDoc.exists) throw new HttpsError("permission-denied", "No tenés permisos");

    const configSnap = await admin.firestore()
      .collection("restaurants").doc(invoiceReq.restaurantId)
      .collection("afipConfig").doc("main").get();

    if (!configSnap.exists) {
      throw new HttpsError("failed-precondition", "El restaurante no tiene AFIP configurado");
    }

    const config = configSnap.data() as AfipConfig & { env?: string };
    if (config.status !== "active") {
      throw new HttpsError("failed-precondition", "La configuración ARCA no está activa. Completá el wizard de configuración.");
    }

    const env = (config.env ?? AFIP_ENV) as "homologacion" | "produccion" | "simulacion";

    // ── Modo simulación: devuelve datos fake sin llamar a ARCA ───────────────
    if (env === "simulacion") {
      const fakeInvoiceType: "A" | "B" | "C" =
        invoiceReq.invoiceType ?? (config.fiscalCondition === "monotributista" ? "C" : "B");
      const fakeCae = Array.from({ length: 14 }, () => Math.floor(Math.random() * 10)).join("");
      const today = new Date();
      const expDate = new Date(today.getTime() + 10 * 24 * 60 * 60 * 1000);
      const fmtDate = (d: Date) =>
        `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
      const fakeResult = {
        cae: fakeCae,
        caeExpiry: fmtDate(expDate),
        invoiceNumber: Math.floor(Math.random() * 900) + 1,
        invoiceType: fakeInvoiceType,
        puntoVenta: config.puntoVenta,
        cuit: config.cuit?.replace(/-/g, "") ?? "0",
      };
      await admin.firestore()
        .collection("restaurants").doc(invoiceReq.restaurantId)
        .collection("cuentas").doc(invoiceReq.cuentaId)
        .update({
          "invoice.status": "issued",
          "invoice.cae": fakeResult.cae,
          "invoice.caeExpiry": fakeResult.caeExpiry,
          "invoice.invoiceNumber": fakeResult.invoiceNumber,
          "invoice.invoiceType": fakeResult.invoiceType,
          "invoice.puntoVenta": fakeResult.puntoVenta,
          "invoice.issuedAt": admin.firestore.FieldValue.serverTimestamp(),
          "invoice.simulation": true,
        });
      return fakeResult;
    }

    // ── Entorno real: autenticación y emisión en ARCA ────────────────────────
    const cuentaRef = admin.firestore()
      .collection("restaurants").doc(invoiceReq.restaurantId)
      .collection("cuentas").doc(invoiceReq.cuentaId);

    const invoiceType: "A" | "B" | "C" = invoiceReq.invoiceType ??
      (config.fiscalCondition === "monotributista" ? "C" : "B");

    const cbteTypeCode = INVOICE_TYPE_CODES[invoiceType];
    if (!cbteTypeCode) throw new HttpsError("invalid-argument", "Tipo de comprobante inválido");

    const ivaRate: number = (config as AfipConfig & { ivaRate?: number }).ivaRate ?? 21;

    // ── Lock anti-race condition ────────────────────────────────────────────────
    const lockRef = admin.firestore()
      .collection("afipLocks")
      .doc(`${invoiceReq.restaurantId}-${config.puntoVenta}-${cbteTypeCode}`);

    await admin.firestore().runTransaction(async (tx) => {
      const lockSnap = await tx.get(lockRef);
      if (lockSnap.exists) {
        const lockedAt: number = lockSnap.data()?.lockedAt?.toMillis?.() ?? 0;
        if (Date.now() - lockedAt < 60_000) {
          throw new HttpsError(
            "resource-exhausted",
            "Hay una emisión en curso para este comprobante. Reintentá en unos segundos."
          );
        }
      }
      tx.set(lockRef, {
        lockedAt: admin.firestore.FieldValue.serverTimestamp(),
        lockedBy: invoiceReq.cuentaId,
      });
    });

    try {
      const masterKey = AFIP_MASTER_KEY.value();
      const privateKeyPem = decryptPrivateKey(
        config.privateKeyEncrypted,
        config.privateKeyIv,
        masterKey
      );

      const { token, sign } = await getAfipToken(
        invoiceReq.restaurantId,
        privateKeyPem,
        config.certificate,
        env as "homologacion" | "produccion"
      );

      const lastNumber = await getLastInvoiceNumber(
        token, sign, config.cuit, config.puntoVenta, cbteTypeCode, env
      );

      const result = await issueFECAE(
        token, sign, config.cuit, config.puntoVenta, lastNumber + 1,
        { ...invoiceReq, invoiceType },
        env,
        ivaRate
      );

      await cuentaRef.update({
        "invoice.status": "issued",
        "invoice.cae": result.cae,
        "invoice.caeExpiry": result.caeExpiry,
        "invoice.invoiceNumber": result.invoiceNumber,
        "invoice.invoiceType": result.invoiceType,
        "invoice.puntoVenta": result.puntoVenta,
        "invoice.issuedAt": admin.firestore.FieldValue.serverTimestamp(),
        "invoice.failureReason": admin.firestore.FieldValue.delete(),
      });

      // PDF generation — best-effort, no bloquea si falla
      try {
        const [restaurantSnap, pedidosSnap] = await Promise.all([
          admin.firestore().collection("restaurants").doc(invoiceReq.restaurantId).get(),
          admin.firestore()
            .collection("restaurants").doc(invoiceReq.restaurantId)
            .collection("pedidos")
            .where("sessionId", "==", invoiceReq.cuentaId)
            .get(),
        ]);
        const restaurantName = (restaurantSnap.data()?.name as string | undefined) ?? invoiceReq.restaurantId;

        // Agregar ítems de todos los pedidos no cancelados
        const itemMap = new Map<string, { quantity: number; unitPrice: number }>();
        for (const pedidoDoc of pedidosSnap.docs) {
          const pedido = pedidoDoc.data();
          if (pedido.cancelado) continue;
          for (const item of (pedido.items as Array<{ nombre?: string; name?: string; cantidad?: number; quantity?: number; precio?: number; price?: number }> | undefined ?? [])) {
            const name = (item.nombre || item.name || "Ítem").trim();
            const qty = item.cantidad ?? item.quantity ?? 1;
            const price = item.precio ?? item.price ?? 0;
            const existing = itemMap.get(name);
            if (existing) { existing.quantity += qty; }
            else { itemMap.set(name, { quantity: qty, unitPrice: price }); }
          }
        }
        const invoiceItems: PdfItem[] = Array.from(itemMap.entries()).map(
          ([description, { quantity, unitPrice }]) => ({ description, quantity, unitPrice })
        );

        const pdfBuffer = await generateInvoicePdf(
          result,
          { ...invoiceReq, invoiceType },
          config,
          restaurantName,
          invoiceItems
        );

        const bucket = admin.storage().bucket();
        const filePath = `facturas/${invoiceReq.restaurantId}/${result.invoiceType}${String(result.puntoVenta).padStart(4, "0")}-${String(result.invoiceNumber).padStart(8, "0")}.pdf`;
        const file = bucket.file(filePath);
        await file.save(pdfBuffer, {
          contentType: "application/pdf",
          public: true,
          metadata: { cacheControl: "public, max-age=31536000" },
        });
        await cuentaRef.update({ "invoice.invoiceUrl": file.publicUrl() });

        // Envío de email con PDF adjunto
        if (invoiceReq.email) {
          const resendKey = RESEND_API_KEY.value();
          const nroComprobante = `${String(result.puntoVenta).padStart(4, "0")}-${String(result.invoiceNumber).padStart(8, "0")}`;
          await sendEmail(
            resendKey,
            invoiceReq.email,
            `Factura ${result.invoiceType} N° ${nroComprobante} — ${restaurantName}`,
            emailWrapper(
              `Tu factura de ${restaurantName}`,
              `<p style="margin:0 0 12px;font-size:15px;color:#3f3f46">Hola <strong>${invoiceReq.customerName}</strong>,</p>
               <p style="margin:0 0 12px;font-size:15px;color:#3f3f46">Te adjuntamos tu comprobante fiscal.</p>
               <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px">
                 <tr><td style="padding:6px 0;border-bottom:1px solid #f4f4f5;font-size:13px;color:#71717a">Tipo</td><td style="padding:6px 0;border-bottom:1px solid #f4f4f5;font-size:13px;font-weight:700;text-align:right">Factura ${result.invoiceType}</td></tr>
                 <tr><td style="padding:6px 0;border-bottom:1px solid #f4f4f5;font-size:13px;color:#71717a">Número</td><td style="padding:6px 0;border-bottom:1px solid #f4f4f5;font-size:13px;font-weight:700;text-align:right">${nroComprobante}</td></tr>
                 <tr><td style="padding:6px 0;border-bottom:1px solid #f4f4f5;font-size:13px;color:#71717a">CAE</td><td style="padding:6px 0;border-bottom:1px solid #f4f4f5;font-size:13px;font-weight:700;font-family:monospace;text-align:right">${result.cae}</td></tr>
                 <tr><td style="padding:6px 0;font-size:13px;color:#71717a">Vto. CAE</td><td style="padding:6px 0;font-size:13px;font-weight:700;text-align:right">${result.caeExpiry}</td></tr>
               </table>
               <p style="margin:0;font-size:13px;color:#71717a">El PDF de la factura está adjunto a este email.</p>`
            ),
            [{ filename: `factura-${nroComprobante}.pdf`, content: pdfBuffer }]
          );
        }
      } catch (pdfErr) {
        console.error("PDF generation failed (non-blocking):", pdfErr);
        Sentry.captureException(pdfErr);
      }

      return result;
    } catch (err) {
      // Marcar la factura como fallida con el motivo exacto
      const reason = err instanceof Error ? err.message : "Error desconocido al emitir en ARCA";
      await cuentaRef.update({
        "invoice.status": "failed",
        "invoice.failureReason": reason,
        "invoice.failedAt": admin.firestore.FieldValue.serverTimestamp(),
      }).catch(() => {}); // best-effort: no ocultar el error original
      throw err;
    } finally {
      // Liberar lock siempre, independientemente del resultado
      await lockRef.delete().catch(() => {});
    }
  }
);

// ─── Alerta mensual: certificado AFIP por vencer ──────────────────────────────

export const monthlyAfipCertCheck = onSchedule(
  {
    schedule: "0 9 1 * *",
    timeZone: "America/Argentina/Buenos_Aires",
    secrets: [RESEND_API_KEY],
  },
  async () => {
    const db = admin.firestore();
    try {
      const restaurantsSnap = await db.collection("restaurants").get();

      for (const restaurantDoc of restaurantsSnap.docs) {
        try {
          const configSnap = await db
            .collection("restaurants").doc(restaurantDoc.id)
            .collection("afipConfig").doc("main").get();

          if (!configSnap.exists) continue;
          const config = configSnap.data() as AfipConfig & { env?: string };

          if (config.status !== "active") continue;
          if (!config.certificate || config.certificate === "SIMULACION") continue;
          if (config.env === "simulacion") continue;

          let notAfter: Date;
          try {
            const cert = forge.pki.certificateFromPem(config.certificate);
            notAfter = cert.validity.notAfter;
          } catch {
            continue;
          }

          const daysLeft = Math.ceil((notAfter.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
          if (daysLeft > 30) continue;

          const ownerEmail = restaurantDoc.data().ownerEmail as string | undefined;
          const restaurantName = (restaurantDoc.data().name as string | undefined) ?? restaurantDoc.id;
          if (!ownerEmail) continue;

          const expiryStr = notAfter.toLocaleDateString("es-AR", {
            day: "2-digit", month: "2-digit", year: "numeric",
          });

          await sendEmail(
            RESEND_API_KEY.value(),
            ownerEmail,
            `Tu certificado AFIP vence en ${daysLeft} días — ${restaurantName}`,
            emailWrapper(
              "Certificado AFIP por vencer",
              `<p style="color:#52525b;line-height:1.6">El certificado digital de <strong>${restaurantName}</strong> para emitir facturas electrónicas vence el <strong>${expiryStr}</strong> (en ${daysLeft} días).</p>
               <p style="color:#52525b;line-height:1.6">Cuando venza, el sistema <strong>no podrá emitir facturas</strong> hasta que lo renueves.</p>
               <p style="color:#52525b;line-height:1.6">Para renovarlo:</p>
               <ol style="color:#52525b;line-height:2;padding-left:20px">
                 <li>Entrá al panel de WANT → Admin → Configuración ARCA</li>
                 <li>Hacé clic en <strong>"Reconfigurar"</strong></li>
                 <li>Seguí los pasos para generar y subir el nuevo certificado</li>
               </ol>
               <p style="margin:24px 0"><a href="https://want-livid.vercel.app" style="background:#0a0a0a;color:#fff;padding:12px 24px;border-radius:12px;text-decoration:none;font-weight:700">Ir a WANT →</a></p>`
            )
          );

          console.log(`monthlyAfipCertCheck: aviso enviado a ${ownerEmail} — ${restaurantName} — ${daysLeft} días`);
        } catch (err) {
          console.error(`monthlyAfipCertCheck: error en restaurante ${restaurantDoc.id}:`, err);
        }
      }
    } catch (error) {
      console.error("monthlyAfipCertCheck error:", error);
      Sentry.captureException(error);
      await Sentry.flush(2000);
    }
  }
);
