import { useEffect, useState } from "react";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { Image, Paintbrush, Save } from "lucide-react";
import { getDb } from "../lib/firebase";
import { useRestaurantConfig } from "../lib/restaurant-config";

const db = getDb();

export function RestaurantBrandingPanel({
  restaurantId,
}: {
  restaurantId: string;
}) {
  const { config } = useRestaurantConfig(restaurantId);

  const [name, setName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#000000");
  const [secondaryColor, setSecondaryColor] = useState("#FFFFFF");
  const [welcomeMessage, setWelcomeMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!restaurantId) return;

    const unsub = onSnapshot(doc(db, "restaurants", restaurantId), (snap) => {
      const data = snap.data();

      setName(String(data?.name || ""));
      setLogoUrl(String(data?.logoUrl || ""));
      setCoverUrl(String(data?.coverUrl || ""));
      setPrimaryColor(String(data?.primaryColor || "#000000"));
      setSecondaryColor(String(data?.secondaryColor || "#FFFFFF"));
      setWelcomeMessage(String(data?.welcomeMessage || ""));
    });

    return () => unsub();
  }, [restaurantId]);

  const handleSave = async () => {
    try {
      setSaving(true);
      setMessage("");

      await setDoc(
        doc(db, "restaurants", restaurantId),
        {
          name: name.trim(),
          logoUrl: logoUrl.trim(),
          coverUrl: coverUrl.trim(),
          primaryColor,
          secondaryColor,
          welcomeMessage: welcomeMessage.trim(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setMessage("Branding guardado correctamente.");
    } catch (error) {
      console.error("Error guardando branding:", error);
      setMessage("No se pudo guardar el branding.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mb-6 rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-zinc-950 text-white">
          <Paintbrush size={20} />
        </div>

        <div>
          <h2 className="text-xl font-black text-zinc-950">
            Branding del restaurante
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Personalizá cómo se ve el menú del cliente.
          </p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="grid gap-3">
          <input
            placeholder="Nombre del restaurante"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-11 rounded-2xl border border-zinc-200 px-3 outline-none focus:ring-2 focus:ring-black/10"
          />

          <input
            placeholder="URL del logo"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            className="h-11 rounded-2xl border border-zinc-200 px-3 outline-none focus:ring-2 focus:ring-black/10"
          />

          <input
            placeholder="URL de portada"
            value={coverUrl}
            onChange={(e) => setCoverUrl(e.target.value)}
            className="h-11 rounded-2xl border border-zinc-200 px-3 outline-none focus:ring-2 focus:ring-black/10"
          />

          <textarea
            placeholder="Mensaje de bienvenida"
            value={welcomeMessage}
            onChange={(e) => setWelcomeMessage(e.target.value)}
            rows={3}
            className="rounded-2xl border border-zinc-200 px-3 py-3 outline-none focus:ring-2 focus:ring-black/10"
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="rounded-2xl border border-zinc-200 p-3">
              <p className="mb-2 text-sm font-semibold text-zinc-700">
                Color principal
              </p>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="h-10 w-14 rounded-xl"
                />
                <input
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="h-10 flex-1 rounded-xl border border-zinc-200 px-3"
                />
              </div>
            </label>

            <label className="rounded-2xl border border-zinc-200 p-3">
              <p className="mb-2 text-sm font-semibold text-zinc-700">
                Color fondo
              </p>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={secondaryColor}
                  onChange={(e) => setSecondaryColor(e.target.value)}
                  className="h-10 w-14 rounded-xl"
                />
                <input
                  value={secondaryColor}
                  onChange={(e) => setSecondaryColor(e.target.value)}
                  className="h-10 flex-1 rounded-xl border border-zinc-200 px-3"
                />
              </div>
            </label>
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex h-11 items-center justify-center gap-2 rounded-2xl bg-zinc-950 px-5 font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
          >
            <Save size={16} />
            {saving ? "Guardando..." : "Guardar branding"}
          </button>

          {message && (
            <p className="text-sm font-medium text-zinc-700">{message}</p>
          )}
        </div>

        <div
          className="overflow-hidden rounded-3xl border border-zinc-200 shadow-sm"
          style={{ backgroundColor: secondaryColor }}
        >
          {coverUrl ? (
            <div className="aspect-[16/6] overflow-hidden bg-zinc-100">
              <img
                src={coverUrl}
                alt={name}
                className="h-full w-full object-cover"
              />
            </div>
          ) : (
            <div className="flex aspect-[16/6] items-center justify-center bg-zinc-100 text-zinc-400">
              <Image size={24} />
            </div>
          )}

          <div className="p-4">
            <div className="mb-4 flex items-center gap-3">
              {logoUrl ? (
                <div className="h-14 w-14 overflow-hidden rounded-2xl bg-white">
                  <img
                    src={logoUrl}
                    alt={name}
                    className="h-full w-full object-cover"
                  />
                </div>
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-zinc-400">
                  <Image size={20} />
                </div>
              )}

              <div className="min-w-0">
                <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-zinc-500">
                  Menú digital
                </p>
                <h3 className="truncate text-xl font-black text-zinc-950">
                  {name || config.name || "Restaurante"}
                </h3>
              </div>
            </div>

            <p className="text-sm text-zinc-600">
              {welcomeMessage || "Elegí productos y agregalos a tu pedido."}
            </p>

            <button
              className="mt-4 h-10 rounded-2xl px-4 text-sm font-bold text-white"
              style={{ backgroundColor: primaryColor }}
            >
              Vista previa
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}