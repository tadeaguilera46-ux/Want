import {
  getDownloadURL,
  ref,
  uploadBytes,
  deleteObject,
} from "firebase/storage";
import { getStorageService } from "./firebase";

export type BrandingAssetType = "logo" | "banner";

const storage = getStorageService();

const MAX_IMAGE_SIZE_MB = 8;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

const sanitizeFileName = (fileName: string) => {
  return fileName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9.-]/g, "");
};

const assertValidImageFile = (file: File) => {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw new Error("Formato inválido. Usá JPG, PNG o WEBP.");
  }

  const maxBytes = MAX_IMAGE_SIZE_MB * 1024 * 1024;

  if (file.size > maxBytes) {
    throw new Error(`La imagen no puede superar ${MAX_IMAGE_SIZE_MB}MB.`);
  }
};

export const uploadRestaurantBrandingImage = async ({
  restaurantId,
  file,
  type,
}: {
  restaurantId: string;
  file: File;
  type: BrandingAssetType;
}) => {
  if (!restaurantId.trim()) {
    throw new Error("restaurantId inválido.");
  }

  assertValidImageFile(file);

  const extension = sanitizeFileName(file.name).split(".").pop() || "webp";
  const storageRef = ref(
    storage,
    `restaurants/${restaurantId}/branding/${type}.${extension}`
  );

  await uploadBytes(storageRef, file, {
    contentType: file.type,
    customMetadata: {
      restaurantId,
      type,
    },
  });

  return getDownloadURL(storageRef);
};

export const uploadMenuItemImage = async ({
  restaurantId,
  itemId,
  file,
}: {
  restaurantId: string;
  itemId: string;
  file: File;
}) => {
  if (!restaurantId.trim()) {
    throw new Error("restaurantId inválido.");
  }

  if (!itemId.trim()) {
    throw new Error("itemId inválido.");
  }

  assertValidImageFile(file);

  const extension = sanitizeFileName(file.name).split(".").pop() || "webp";
  const storageRef = ref(
    storage,
    `restaurants/${restaurantId}/menu/${itemId}/image.${extension}`
  );

  await uploadBytes(storageRef, file, {
    contentType: file.type,
    customMetadata: {
      restaurantId,
      itemId,
    },
  });

  return getDownloadURL(storageRef);
};

export const deleteStorageFileByUrl = async (url: string) => {
  if (!url.trim()) return;

  const storageRef = ref(storage, url);
  await deleteObject(storageRef);
};