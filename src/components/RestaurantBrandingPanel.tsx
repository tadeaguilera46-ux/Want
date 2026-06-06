import { ChangeEvent, useEffect, useState } from "react";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import {
  getDownloadURL,
  getStorage,
  ref,
  uploadBytesResumable,
} from "firebase/storage";
import { Image, Loader2, Paintbrush, Save, Upload } from "lucide-react";
import { getDb, getStorageService } from "../lib/firebase";
import { useRestaurantConfig } from "../lib/restaurant-config";

const db = getDb();
const storage = getStorageService();

type UploadTarget = "logo" | "cover";

const MAX_LOGO_SIZE_MB = 3;
const MAX_COVER_SIZE_MB = 5;

function getFileExtension(file: File) {
  const parts = file.name.split(".");
  return parts.length > 1 ? parts.pop()?.toLowerCase() || "jpg" : "jpg";
}

function validateImageFile(file: File, maxSizeMb: number) {
  if (!file.type.startsWith("image/")) {
    return "El archivo debe ser una imagen.";
  }

  const maxBytes = maxSizeMb * 1024 * 1024;

  if (file.size > maxBytes) {
    return `La imagen no puede superar los ${maxSizeMb}MB.`;
  }

  return "";
}

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
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [logoProgress, setLogoProgress] = useState(0);
  const [coverProgress, setCoverProgress] = useState(0);
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

  const handleImageUpload = async (
    event: ChangeEvent<HTMLInputElement>,
    target: UploadTarget
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file || !restaurantId) return;

    const maxSize = target === "logo" ? MAX_LOGO_SIZE_MB : MAX_COVER_SIZE_MB;
    const validationError = validateImageFile(file, maxSize);

    if (validationError) {
      setMessage(validationError);
      return;
    }

    try {
      setMessage("");

      if (target === "logo") {
        setUploadingLogo(true);
        setLogoProgress(0);
      } else {
        setUploadingCover(true);
        setCoverProgress(0);
      }

      const extension = getFileExtension(file);
      const fileName = `${target}-${Date.now()}.${extension}`;
      const storagePath = `restaurants/${restaurantId}/branding/${fileName}`;
      const imageRef = ref(storage, storagePath);

      const uploadTask = uploadBytesResumable(imageRef, file, {
        contentType: file.type,
        customMetadata: {
          restaurantId,
          type: target,
        },
      });

      const downloadUrl = await new Promise<string>((resolve, reject) => {
        uploadTask.on(
          "state_changed",
          (snapshot) => {
            const progress = Math.round(
              (snapshot.bytesTransferred / snapshot.totalBytes) * 100
            );

            if (target === "logo") {
              setLogoProgress(progress);
            } else {
              setCoverProgress(progress);
            }
          },
          reject,
          async () => {
            const url = await getDownloadURL(uploadTask.snapshot.ref);
            resolve(url);
          }
        );
      });

      if (target === "logo") {
        setLogoUrl(downloadUrl);
      } else {
        setCoverUrl(downloadUrl);
      }

      const brandingField = target === "logo" ? "logoUrl" : "coverUrl";

      await setDoc(
        doc(db, "restaurants", restaurantId),
        { [brandingField]: downloadUrl, updatedAt: serverTimestamp() },
        { merge: true }
      );

      // Mantener public/branding sincronizado con el doc raíz.
      await setDoc(
        doc(db, "restaurants", restaurantId, "public", "branding"),
        { [brandingField]: downloadUrl },
        { merge: true }
      );

      setMessage(
        target === "logo"
          ? "Logo subido correctamente."
          : "Portada subida correctamente."
      );
    } catch (error) {
      console.error("Error subiendo imagen:", error);
      setMessage("No se pudo subir la imagen.");
    } finally {
      if (target === "logo") {
        setUploadingLogo(false);
        setLogoProgress(0);
      } else {
        setUploadingCover(false);
        setCoverProgress(0);
      }
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setMessage("");

      const brandingData = {
        name: name.trim(),
        logoUrl: logoUrl.trim(),
        coverUrl: coverUrl.trim(),
        primaryColor,
        secondaryColor,
        welcomeMessage: welcomeMessage.trim(),
      };

      await setDoc(
        doc(db, "restaurants", restaurantId),
        { ...brandingData, updatedAt: serverTimestamp() },
        { merge: true }
      );

      // Mantener public/branding sincronizado con el doc raíz.
      await setDoc(
        doc(db, "restaurants", restaurantId, "public", "branding"),
        brandingData,
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

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="cursor-pointer rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-4 transition hover:bg-zinc-100">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploadingLogo}
                onChange={(event) => handleImageUpload(event, "logo")}
              />

              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-zinc-700 shadow-sm">
                  {uploadingLogo ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <Upload size={18} />
                  )}
                </div>

                <div>
                  <p className="text-sm font-bold text-zinc-950">
                    Subir logo
                  </p>
                  <p className="text-xs text-zinc-500">
                    PNG, JPG o WEBP · máx. {MAX_LOGO_SIZE_MB}MB
                  </p>
                </div>
              </div>

              {uploadingLogo && (
                <p className="mt-3 text-xs font-semibold text-zinc-600">
                  Subiendo {logoProgress}%
                </p>
              )}
            </label>

            <label className="cursor-pointer rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-4 transition hover:bg-zinc-100">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploadingCover}
                onChange={(event) => handleImageUpload(event, "cover")}
              />

              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-zinc-700 shadow-sm">
                  {uploadingCover ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <Upload size={18} />
                  )}
                </div>

                <div>
                  <p className="text-sm font-bold text-zinc-950">
                    Subir portada
                  </p>
                  <p className="text-xs text-zinc-500">
                    PNG, JPG o WEBP · máx. {MAX_COVER_SIZE_MB}MB
                  </p>
                </div>
              </div>

              {uploadingCover && (
                <p className="mt-3 text-xs font-semibold text-zinc-600">
                  Subiendo {coverProgress}%
                </p>
              )}
            </label>
          </div>

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
              {!/^#[0-9A-Fa-f]{6}$/.test(primaryColor) && (
                <p className="mt-1.5 text-xs text-red-500">
                  Formato inválido: el código debe comenzar con un #
                </p>
              )}
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
              {!/^#[0-9A-Fa-f]{6}$/.test(secondaryColor) && (
                <p className="mt-1.5 text-xs text-red-500">
                  Formato inválido: el código debe comenzar con un #
                </p>
              )}
            </label>
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving || uploadingLogo || uploadingCover}
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
                alt={name || "Portada del restaurante"}
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
                    alt={name || "Logo del restaurante"}
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