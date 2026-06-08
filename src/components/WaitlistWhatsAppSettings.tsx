import { useEffect, useState } from "react";
import {
  doc,
  onSnapshot,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { MessageCircle, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../lib/auth-context";
import { writeAuditLog } from "../lib/audit-logs";
import { getDb } from "../lib/firebase";
import {
  DEFAULT_WAITLIST_WHATSAPP_MESSAGE,
  WAITLIST_WHATSAPP_VARIABLES,
  normalizeWhatsAppPhone,
} from "../lib/waitlist-whatsapp";

const db = getDb();

type WaitlistWhatsAppSettings = {
  restaurantPhone: string;
  messageTemplate: string;
};

const DEFAULT_SETTINGS: WaitlistWhatsAppSettings = {
  restaurantPhone: "",
  messageTemplate: DEFAULT_WAITLIST_WHATSAPP_MESSAGE,
};

export function WaitlistWhatsAppSettings({
  restaurantId,
}: {
  restaurantId: string;
}) {
  const { user } = useAuth();
  const [settings, setSettings] =
    useState<WaitlistWhatsAppSettings>(DEFAULT_SETTINGS);
  const [savedSettings, setSavedSettings] =
    useState<WaitlistWhatsAppSettings>(DEFAULT_SETTINGS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    return onSnapshot(doc(db, "restaurants", restaurantId), (snapshot) => {
      const raw = snapshot.data()?.waitlistWhatsApp;
      const next = {
        restaurantPhone:
          typeof raw?.restaurantPhone === "string" ? raw.restaurantPhone : "",
        messageTemplate:
          typeof raw?.messageTemplate === "string" && raw.messageTemplate.trim()
            ? raw.messageTemplate
            : DEFAULT_WAITLIST_WHATSAPP_MESSAGE,
      };
      setSettings(next);
      setSavedSettings(next);
    });
  }, [restaurantId]);

  const save = async () => {
    if (!user) return;

    const restaurantPhone = settings.restaurantPhone.trim();
    if (restaurantPhone && !normalizeWhatsAppPhone(restaurantPhone)) {
      toast.error(
        "El WhatsApp del restaurante no es valido. Usa codigo de pais o un numero argentino completo."
      );
      return;
    }

    const next = {
      restaurantPhone,
      messageTemplate:
        settings.messageTemplate.trim() || DEFAULT_WAITLIST_WHATSAPP_MESSAGE,
    };

    try {
      setSaving(true);
      const batch = writeBatch(db);
      batch.set(
        doc(db, "restaurants", restaurantId),
        { waitlistWhatsApp: next, updatedAt: serverTimestamp() },
        { merge: true }
      );
      writeAuditLog(batch, {
        restaurantId,
        action: "waitlist_whatsapp_config_actualizada",
        actorUid: user.uid,
        actorEmail: user.email,
        actorRole: "admin",
        entityType: "waitlistSettings",
        entityId: "whatsapp",
        description: "Admin actualizo la configuracion manual de WhatsApp",
        changes: { before: savedSettings, after: next },
      });
      await batch.commit();
      toast.success("Configuracion de WhatsApp guardada.");
    } catch (error) {
      console.error("Error guardando configuracion de WhatsApp:", error);
      toast.error("No se pudo guardar la configuracion de WhatsApp.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mb-6 rounded-xl border border-zinc-200 bg-white p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white">
          <MessageCircle size={19} />
        </div>
        <div>
          <h2 className="font-bold text-zinc-950">WhatsApp manual</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Configura el mensaje que el equipo abrira en WhatsApp. WANT no lo
            envia automaticamente.
          </p>
        </div>
      </div>

      <div className="grid gap-3">
        <label className="grid gap-1.5">
          <span className="text-sm font-semibold text-zinc-700">
            WhatsApp del restaurante
          </span>
          <input
            value={settings.restaurantPhone}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                restaurantPhone: event.target.value,
              }))
            }
            placeholder="+54 9 11 1234 5678"
            className="h-11 rounded-lg border border-zinc-200 px-3 outline-none focus:ring-2 focus:ring-black/10"
          />
          <span className="text-xs text-zinc-500">
            Queda guardado para futuras funciones. El aviso se abre hacia el
            numero del cliente.
          </span>
        </label>

        <label className="grid gap-1.5">
          <span className="text-sm font-semibold text-zinc-700">
            Mensaje preestablecido
          </span>
          <textarea
            rows={4}
            maxLength={1000}
            value={settings.messageTemplate}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                messageTemplate: event.target.value,
              }))
            }
            className="rounded-lg border border-zinc-200 px-3 py-3 outline-none focus:ring-2 focus:ring-black/10"
          />
          <span className="text-xs text-zinc-500">
            Variables disponibles: {WAITLIST_WHATSAPP_VARIABLES.join(", ")}
          </span>
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              setSettings((current) => ({
                ...current,
                messageTemplate: DEFAULT_WAITLIST_WHATSAPP_MESSAGE,
              }))
            }
            className="flex h-10 items-center gap-2 rounded-lg border border-zinc-200 px-3 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
          >
            <RotateCcw size={15} />
            Restaurar mensaje default
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="flex h-10 items-center gap-2 rounded-lg bg-zinc-950 px-4 text-sm font-bold text-white disabled:opacity-50"
          >
            <Save size={15} />
            {saving ? "Guardando..." : "Guardar configuracion"}
          </button>
        </div>
      </div>
    </section>
  );
}
