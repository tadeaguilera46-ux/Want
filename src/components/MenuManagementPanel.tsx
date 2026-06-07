import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import {
  getDownloadURL,
  ref,
  uploadBytesResumable,
} from "firebase/storage";
import {
  Image,
  Plus,
  Trash2,
  Utensils,
  Pencil,
  Save,
  X,
  Upload,
  Loader2,
  Boxes,
  AlertTriangle,
} from "lucide-react";
import { getDb, getStorageService } from "../lib/firebase";
import {
  createMenuItem,
  deleteMenuItem,
  updateMenuItem,
  type MenuItem,
  type MenuType,
} from "../lib/menu";
import type { MenuIngredient, RecipeUnit } from "../lib/store";
import type { StockItem } from "../types/stock";
import { toast } from "sonner";
import { useAuth } from "../lib/auth-context";

const db = getDb();
const storage = getStorageService();

const MAX_MENU_IMAGE_SIZE_MB = 5;

const units: RecipeUnit[] = ["kg", "g", "l", "ml", "unit"];

const formatPriceARS = (value: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value || 0);

type DraftItem = {
  name: string;
  price: string;
  type: MenuType;
  category: string;
  description: string;
  image: string;
  ingredients: MenuIngredient[];
  availableFrom?: string;
  availableTo?: string;
  availableDays?: number[];
  allergens?: string[];
  comboItems?: string[];
  modifierGroups?: { name: string; required: boolean; options: { name: string; priceAdd: number }[] }[];
};

type IngredientFormState = {
  stockItemId: string;
  quantity: string;
  unit: RecipeUnit;
  essential: boolean;
};

const emptyIngredientForm: IngredientFormState = {
  stockItemId: "",
  quantity: "",
  unit: "unit",
  essential: true,
};

const getItemType = (item: MenuItem): MenuType => {
  if (item.type === "food" || item.type === "drinks" || item.type === "combo") return item.type;
  if (item.category === "drinks") return "drinks";
  return "food";
};

const getDisplayCategory = (item: MenuItem) => {
  if (item.type && item.category) return item.category;
  if (item.category === "food") return "Comida";
  if (item.category === "drinks") return "Bebidas";
  return item.category || "General";
};

const getFileExtension = (file: File) => {
  const parts = file.name.split(".");
  return parts.length > 1 ? parts.pop()?.toLowerCase() || "jpg" : "jpg";
};

const validateImageFile = (file: File) => {
  if (!file.type.startsWith("image/")) {
    return "El archivo debe ser una imagen.";
  }

  const maxBytes = MAX_MENU_IMAGE_SIZE_MB * 1024 * 1024;

  if (file.size > maxBytes) {
    return `La imagen no puede superar los ${MAX_MENU_IMAGE_SIZE_MB}MB.`;
  }

  return "";
};

const buildIngredient = (
  stockItems: StockItem[],
  form: IngredientFormState
): MenuIngredient | null => {
  const stockItem = stockItems.find((item) => item.id === form.stockItemId);
  const quantity = Number(form.quantity);

  if (!stockItem) return null;
  if (!Number.isFinite(quantity) || quantity <= 0) return null;

  return {
    stockItemId: stockItem.id,
    stockItemName: stockItem.name,
    quantity,
    unit: form.unit,
    essential: form.essential,
  };
};

const IngredientsEditor = ({
  stockItems,
  ingredients,
  onChange,
  disabled,
}: {
  stockItems: StockItem[];
  ingredients: MenuIngredient[];
  onChange: (ingredients: MenuIngredient[]) => void;
  disabled?: boolean;
}) => {
  const [form, setForm] = useState<IngredientFormState>(emptyIngredientForm);

  const selectedStockItem = stockItems.find(
    (item) => item.id === form.stockItemId
  );

  useEffect(() => {
    if (selectedStockItem) {
      setForm((prev) => ({
        ...prev,
        unit: selectedStockItem.unit,
      }));
    }
  }, [selectedStockItem]);

  const handleAddIngredient = () => {
    const ingredient = buildIngredient(stockItems, form);

    if (!ingredient) {
      toast.success("Seleccioná un insumo y una cantidad válida.");
      return;
    }

    const alreadyExists = ingredients.some(
      (item) => item.stockItemId === ingredient.stockItemId
    );

    if (alreadyExists) {
      toast.warning("Ese insumo ya está cargado en este producto.");
      return;
    }

    onChange([...ingredients, ingredient]);
    setForm(emptyIngredientForm);
  };

  const removeIngredient = (stockItemId: string) => {
    onChange(
      ingredients.filter((ingredient) => ingredient.stockItemId !== stockItemId)
    );
  };

  const toggleEssential = (stockItemId: string) => {
    onChange(
      ingredients.map((ingredient) =>
        ingredient.stockItemId === stockItemId
          ? { ...ingredient, essential: !ingredient.essential }
          : ingredient
      )
    );
  };

  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      <div className="mb-3 flex items-start gap-2">
        <Boxes size={17} className="mt-0.5 text-zinc-700" />
        <div>
          <p className="text-sm font-bold text-zinc-950">
            Ingredientes / receta
          </p>
          <p className="text-xs text-zinc-500">
            Los esenciales ocultan el plato si no hay stock. Los secundarios
            generan aviso al cliente.
          </p>
        </div>
      </div>

      {stockItems.length === 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Primero cargá insumos en Control de stock para poder armar recetas.
        </div>
      ) : (
        <div className="grid gap-2 lg:grid-cols-[1fr_110px_110px_150px_auto]">
          <select
            value={form.stockItemId}
            disabled={disabled}
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                stockItemId: e.target.value,
              }))
            }
            className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-black/10"
          >
            <option value="">Seleccionar insumo</option>
            {stockItems.map((stockItem) => (
              <option key={stockItem.id} value={stockItem.id}>
                {stockItem.name}
              </option>
            ))}
          </select>

          <input
            type="number"
            min={0}
            step="any"
            value={form.quantity}
            disabled={disabled}
            placeholder="Cantidad"
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                quantity: e.target.value,
              }))
            }
            className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-black/10"
          />

          <select
            value={form.unit}
            disabled={disabled}
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                unit: e.target.value as RecipeUnit,
              }))
            }
            className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-black/10"
          >
            {units.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>

          <select
            value={form.essential ? "essential" : "optional"}
            disabled={disabled}
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                essential: e.target.value === "essential",
              }))
            }
            className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-black/10"
          >
            <option value="essential">Esencial</option>
            <option value="optional">Secundario</option>
          </select>

          <button
            type="button"
            disabled={disabled}
            onClick={handleAddIngredient}
            className="h-10 rounded-xl bg-zinc-950 px-4 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-60"
          >
            Agregar
          </button>
        </div>
      )}

      {ingredients.length === 0 ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-dashed border-zinc-300 bg-white p-3 text-xs text-zinc-500">
          <AlertTriangle size={15} className="shrink-0" />
          Este producto no tiene receta cargada. En Premium seguirá siendo
          vendible, pero no descontará stock automáticamente.
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {ingredients.map((ingredient) => (
            <div
              key={ingredient.stockItemId}
              className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700"
            >
              <span>
                {ingredient.stockItemName}: {ingredient.quantity}{" "}
                {ingredient.unit}
              </span>

              <button
                type="button"
                disabled={disabled}
                onClick={() => toggleEssential(ingredient.stockItemId)}
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                  ingredient.essential
                    ? "bg-red-100 text-red-700"
                    : "bg-amber-100 text-amber-700"
                }`}
              >
                {ingredient.essential ? "Esencial" : "Secundario"}
              </button>

              <button
                type="button"
                disabled={disabled}
                onClick={() => removeIngredient(ingredient.stockItemId)}
                className="text-zinc-400 transition hover:text-red-600 disabled:opacity-50"
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export function MenuManagementPanel({ restaurantId }: { restaurantId: string }) {
  const { user } = useAuth();
  const [items, setItems] = useState<MenuItem[]>([]);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingStock, setLoadingStock] = useState(true);

  const [savingId, setSavingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftItem | null>(null);

  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [type, setType] = useState<MenuType>("food");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState("");
  const [ingredients, setIngredients] = useState<MenuIngredient[]>([]);
  const [comboItemIds, setComboItemIds] = useState<string[]>([]);

  const [uploadingCreateImage, setUploadingCreateImage] = useState(false);
  const [uploadingEditImageId, setUploadingEditImageId] = useState<
    string | null
  >(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  useEffect(() => {
    if (!restaurantId) return;

    setLoading(true);

    const unsub = onSnapshot(
      collection(db, "restaurants", restaurantId, "menu"),
      (snap) => {
        const data = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as MenuItem[];

        setItems(data);
        setLoading(false);
      },
      (error) => {
        console.error("Error cargando menú:", error);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [restaurantId]);

  useEffect(() => {
    if (!restaurantId) return;

    setLoadingStock(true);

    const q = query(
      collection(db, "restaurants", restaurantId, "stock"),
      orderBy("name")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const data = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as StockItem[];

        setStockItems(data);
        setLoadingStock(false);
      },
      (error) => {
        console.error("Error cargando stock:", error);
        setLoadingStock(false);
      }
    );

    return () => unsub();
  }, [restaurantId]);

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;

      const aCategory = getDisplayCategory(a);
      const bCategory = getDisplayCategory(b);

      if (aCategory !== bCategory) return aCategory.localeCompare(bCategory);

      return a.name.localeCompare(b.name);
    });
  }, [items]);

  const uploadMenuImage = async (file: File) => {
    const validationError = validateImageFile(file);

    if (validationError) {
      alert(validationError);
      return "";
    }

    const extension = getFileExtension(file);
    const fileName = `menu-${Date.now()}-${crypto.randomUUID()}.${extension}`;
    const storagePath = `restaurants/${restaurantId}/menu/${fileName}`;
    const imageRef = ref(storage, storagePath);

    const uploadTask = uploadBytesResumable(imageRef, file, {
      contentType: file.type,
      customMetadata: {
        restaurantId,
        type: "menu",
      },
    });

    const downloadUrl = await new Promise<string>((resolve, reject) => {
      uploadTask.on(
        "state_changed",
        (snapshot) => {
          const progress = Math.round(
            (snapshot.bytesTransferred / snapshot.totalBytes) * 100
          );

          setUploadProgress(progress);
        },
        reject,
        async () => {
          const url = await getDownloadURL(uploadTask.snapshot.ref);
          resolve(url);
        }
      );
    });

    return downloadUrl;
  };

  const handleCreateImageUpload = async (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    try {
      setUploadingCreateImage(true);
      setUploadProgress(0);

      const url = await uploadMenuImage(file);

      if (url) {
        setImage(url);
      }
    } catch (error) {
      console.error("Error subiendo imagen del producto:", error);
      toast.error("No se pudo subir la imagen.");
    } finally {
      setUploadingCreateImage(false);
      setUploadProgress(0);
    }
  };

  const handleEditImageUpload = async (
    event: ChangeEvent<HTMLInputElement>,
    itemId: string
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    try {
      setUploadingEditImageId(itemId);
      setUploadProgress(0);

      const url = await uploadMenuImage(file);

      if (url) {
        setDraft((prev) => (prev ? { ...prev, image: url } : prev));
      }
    } catch (error) {
      console.error("Error subiendo imagen del producto:", error);
      toast.error("No se pudo subir la imagen.");
    } finally {
      setUploadingEditImageId(null);
      setUploadProgress(0);
    }
  };

  const handleCreate = async () => {
    if (!user) return;
    const normalizedName = name.trim();
    const normalizedPrice = Number(price);
    const normalizedCategory =
      category.trim() || (type === "food" ? "Comida" : "Bebidas");

    if (!normalizedName) {
      toast.error("Ingresá el nombre del producto");
      return;
    }

    if (!Number.isFinite(normalizedPrice) || normalizedPrice <= 0) {
      toast.error("Ingresá un precio válido");
      return;
    }

    try {
      await createMenuItem(restaurantId, {
        name: normalizedName,
        price: normalizedPrice,
        type,
        category: normalizedCategory,
        description: description.trim(),
        image: image.trim(),
        active: true,
        ingredients,
        variants: [],
        comboItems: type === "combo" ? comboItemIds : [],
      }, {
        actorUid: user.uid,
        actorEmail: user.email,
        actorRole: "admin",
      });

      setName("");
      setPrice("");
      setType("food");
      setCategory("");
      setDescription("");
      setImage("");
      setIngredients([]);
      setComboItemIds([]);
    } catch (error) {
      console.error("Error creando producto:", error);
     toast.error("No se pudo crear el producto");
    }
  };

  const startEditing = (item: MenuItem) => {
    setEditingId(item.id);
    setDraft({
      name: item.name,
      price: String(item.price),
      type: getItemType(item),
      category: getDisplayCategory(item),
      description: item.description || "",
      image: item.image || "",
      ingredients: item.ingredients || [],
      availableFrom: item.availableFrom || "",
      availableTo: item.availableTo || "",
      availableDays: item.availableDays || [],
      allergens: item.allergens || [],
      modifierGroups: item.modifierGroups || [],
      comboItems: item.comboItems || [],
    });
  };

  const cancelEditing = () => {
    setEditingId(null);
    setDraft(null);
  };

  const saveEditing = async (item: MenuItem) => {
    if (!draft || !user) return;

    const normalizedName = draft.name.trim();
    const normalizedPrice = Number(draft.price);
    const normalizedCategory =
      draft.category.trim() || (draft.type === "food" ? "Comida" : "Bebidas");

    if (!normalizedName) {
      toast.error("El nombre no puede estar vacío");
      return;
    }

    if (!Number.isFinite(normalizedPrice) || normalizedPrice <= 0) {
      toast.error("Ingresá un precio válido");
      return;
    }

    try {
      setSavingId(item.id);

      await updateMenuItem(restaurantId, item.id, {
        name: normalizedName,
        price: normalizedPrice,
        type: draft.type,
        category: normalizedCategory,
        description: draft.description.trim(),
        image: draft.image.trim(),
        ingredients: draft.ingredients,
        availableFrom: draft.availableFrom?.trim() || undefined,
        availableTo: draft.availableTo?.trim() || undefined,
        availableDays: draft.availableDays?.length ? draft.availableDays : undefined,
        allergens: draft.allergens?.length ? draft.allergens : undefined,
        modifierGroups: draft.modifierGroups?.length ? draft.modifierGroups : undefined,
        comboItems: draft.type === "combo" ? (draft.comboItems || []) : [],
      }, {
        actorUid: user.uid,
        actorEmail: user.email,
        actorRole: "admin",
      });

      cancelEditing();
    } catch (error) {
      console.error("Error guardando producto:", error);
      toast.error("No se pudo guardar el producto");
    } finally {
      setSavingId(null);
    }
  };

  const toggleActive = async (item: MenuItem) => {
    if (!user) return;
    try {
      setSavingId(item.id);

      await updateMenuItem(restaurantId, item.id, {
        active: !item.active,
      }, {
        actorUid: user.uid,
        actorEmail: user.email,
        actorRole: "admin",
      });
    } catch (error) {
      console.error("Error pausando/activando producto:", error);
      toast.error("No se pudo actualizar el producto");
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = async (item: MenuItem) => {
    if (!user) return;
    const ok = window.confirm(
      `¿Seguro que querés eliminar "${item.name}" del menú?`
    );

    if (!ok) return;

    try {
      setSavingId(item.id);
      await deleteMenuItem(restaurantId, item, {
        actorUid: user.uid,
        actorEmail: user.email,
        actorRole: "admin",
      });
    } catch (error) {
      console.error("Error eliminando producto:", error);
      toast.error("No se pudo eliminar el producto");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <section className="mb-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-zinc-950 text-white">
          <Utensils size={20} />
        </div>

        <div>
          <h2 className="text-xl font-bold text-zinc-950">Menú editable</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Creá productos y conectalos con stock usando ingredientes
            esenciales o secundarios.
          </p>
        </div>
      </div>

      <div className="mb-5 grid gap-3 lg:grid-cols-[1fr_140px_150px_180px]">
        <input
          placeholder="Nombre del producto"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-11 rounded-lg border border-zinc-200 px-3 outline-none focus:ring-2 focus:ring-black/10"
        />

        <input
          placeholder="Precio"
          type="number"
          min={0}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="h-11 rounded-lg border border-zinc-200 px-3 outline-none focus:ring-2 focus:ring-black/10"
        />

        <select
          value={type}
          onChange={(e) => setType(e.target.value as MenuType)}
          className="h-11 rounded-lg border border-zinc-200 px-3 outline-none focus:ring-2 focus:ring-black/10"
        >
          <option value="food">Sale a cocina</option>
          <option value="drinks">Sale a barra</option>
          <option value="combo">Combo</option>
        </select>

        <input
          placeholder="Categoría: Pizzas"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="h-11 rounded-lg border border-zinc-200 px-3 outline-none focus:ring-2 focus:ring-black/10"
        />

        <textarea
          placeholder="Descripción del producto"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="rounded-lg border border-zinc-200 px-3 py-3 outline-none focus:ring-2 focus:ring-black/10 lg:col-span-3"
        />

        {/* F-017: Selector de sub-ítems para combo */}
        {type === "combo" && (
          <div className="lg:col-span-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
            <p className="mb-2 text-xs font-bold text-zinc-600">Ítems que componen este combo</p>
            <div className="flex flex-wrap gap-1.5">
              {items.filter(i => i.active && i.type !== "combo").map((i) => (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => setComboItemIds(prev => prev.includes(i.id) ? prev.filter(x => x !== i.id) : [...prev, i.id])}
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${comboItemIds.includes(i.id) ? "bg-zinc-900 text-white" : "border border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400"}`}
                >
                  {i.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploadingCreateImage}
              onChange={handleCreateImageUpload}
            />

            {uploadingCreateImage ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Subiendo {uploadProgress}%
              </>
            ) : (
              <>
                <Upload size={16} />
                Subir imagen
              </>
            )}
          </label>

          {image && (
            <div className="h-24 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100">
              <img
                src={image}
                alt="Preview producto"
                className="h-full w-full object-cover"
              />
            </div>
          )}
        </div>

        <div className="lg:col-span-4">
          <IngredientsEditor
            stockItems={stockItems}
            ingredients={ingredients}
            onChange={setIngredients}
            disabled={loadingStock}
          />
        </div>

        <button
          type="button"
          onClick={handleCreate}
          disabled={uploadingCreateImage}
          className="flex h-11 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-4 font-semibold text-white transition hover:opacity-90 disabled:opacity-60 lg:col-span-4"
        >
          <Plus size={16} />
          Agregar producto
        </button>
      </div>

      {loading ? (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500">
          Cargando menú...
        </div>
      ) : sortedItems.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500">
          Todavía no hay productos cargados.
        </div>
      ) : (
        <div className="max-h-[640px] overflow-y-auto rounded-lg border border-zinc-200 p-3">
          <div className="grid gap-3">
            {sortedItems.map((item) => {
              const isSaving = savingId === item.id;
              const isEditing = editingId === item.id;
              const isUploadingEditImage = uploadingEditImageId === item.id;
              const itemType = getItemType(item);
              const itemCategory = getDisplayCategory(item);
              const itemIngredients = item.ingredients || [];

              return (
                <div
                  key={item.id}
                  className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-3 md:grid-cols-[120px_1fr_auto]"
                >
                  <div className="h-28 overflow-hidden rounded-lg bg-zinc-100">
                    {(isEditing ? draft?.image : item.image) ? (
                      <img
                        src={isEditing ? draft?.image : item.image}
                        alt={item.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-zinc-400">
                        <Image size={24} />
                      </div>
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${
                          item.active
                            ? "border border-emerald-200 bg-emerald-100 text-emerald-700"
                            : "border border-red-200 bg-red-100 text-red-700"
                        }`}
                      >
                        {item.active ? "Activo" : "Pausado"}
                      </span>

                      <span className="rounded-full border border-zinc-200 bg-zinc-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-zinc-700">
                        {itemType === "food" ? "Cocina" : "Barra"}
                      </span>

                      <span className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-zinc-700">
                        {itemCategory}
                      </span>

                      <span
                        className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${
                          itemIngredients.length > 0
                            ? "border border-blue-200 bg-blue-100 text-blue-700"
                            : "border border-amber-200 bg-amber-100 text-amber-800"
                        }`}
                      >
                        {itemIngredients.length > 0
                          ? `${itemIngredients.length} ingrediente(s)`
                          : "Sin receta"}
                      </span>
                    </div>

                    {!isEditing ? (
                      <>
                        <h3 className="text-lg font-bold text-zinc-950">
                          {item.name}
                        </h3>

                        <p className="mt-1 text-sm text-zinc-500">
                          {item.description || "Sin descripción"}
                        </p>

                        <p className="mt-2 text-sm font-bold text-zinc-700">
                          {formatPriceARS(item.price)}
                          {(() => {
                            const cost = (item.ingredients || []).reduce((sum, ing) => {
                              const si = stockItems.find(s => s.id === ing.stockItemId);
                              return sum + (si?.costPerUnit ?? 0) * (ing.quantity ?? 0);
                            }, 0);
                            if (cost <= 0) return null;
                            const margin = ((item.price - cost) / item.price) * 100;
                            return (
                              <span className={`ml-2 text-xs font-semibold ${margin >= 60 ? "text-emerald-600" : margin >= 30 ? "text-amber-600" : "text-red-500"}`}>
                                Costo {formatPriceARS(cost)} · Margen {margin.toFixed(0)}%
                              </span>
                            );
                          })()}
                        </p>

                        {itemIngredients.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {itemIngredients.map((ingredient) => (
                              <span
                                key={ingredient.stockItemId}
                                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                                  ingredient.essential
                                    ? "bg-red-50 text-red-700"
                                    : "bg-amber-50 text-amber-700"
                                }`}
                              >
                                {ingredient.stockItemName} ·{" "}
                                {ingredient.quantity} {ingredient.unit} ·{" "}
                                {ingredient.essential
                                  ? "esencial"
                                  : "secundario"}
                              </span>
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <input
                          value={draft?.name || ""}
                          disabled={isSaving}
                          onChange={(e) =>
                            setDraft((prev) =>
                              prev ? { ...prev, name: e.target.value } : prev
                            )
                          }
                          className="mb-2 h-10 w-full rounded-xl border border-zinc-200 px-3 font-bold outline-none focus:ring-2 focus:ring-black/10"
                        />

                        <div className="mb-2 grid gap-2 sm:grid-cols-[130px_160px_1fr]">
                          <input
                            value={draft?.price || ""}
                            type="number"
                            disabled={isSaving}
                            onChange={(e) =>
                              setDraft((prev) =>
                                prev ? { ...prev, price: e.target.value } : prev
                              )
                            }
                            className="h-10 rounded-xl border border-zinc-200 px-3 outline-none focus:ring-2 focus:ring-black/10"
                          />

                          <select
                            value={draft?.type || "food"}
                            disabled={isSaving}
                            onChange={(e) =>
                              setDraft((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      type: e.target.value as MenuType,
                                    }
                                  : prev
                              )
                            }
                            className="h-10 rounded-xl border border-zinc-200 px-3 outline-none focus:ring-2 focus:ring-black/10"
                          >
                            <option value="food">Cocina</option>
                            <option value="drinks">Barra</option>
                          </select>

                          <input
                            value={draft?.category || ""}
                            placeholder="Categoría"
                            disabled={isSaving}
                            onChange={(e) =>
                              setDraft((prev) =>
                                prev
                                  ? { ...prev, category: e.target.value }
                                  : prev
                              )
                            }
                            className="h-10 rounded-xl border border-zinc-200 px-3 outline-none focus:ring-2 focus:ring-black/10"
                          />
                        </div>

                        <div className="mb-2 grid gap-2 sm:grid-cols-[180px_1fr]">
                          <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100">
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              disabled={isSaving || isUploadingEditImage}
                              onChange={(event) =>
                                handleEditImageUpload(event, item.id)
                              }
                            />

                            {isUploadingEditImage ? (
                              <>
                                <Loader2 size={15} className="animate-spin" />
                                {uploadProgress}%
                              </>
                            ) : (
                              <>
                                <Upload size={15} />
                                Cambiar imagen
                              </>
                            )}
                          </label>

                          <button
                            type="button"
                            disabled={isSaving || isUploadingEditImage}
                            onClick={() =>
                              setDraft((prev) =>
                                prev ? { ...prev, image: "" } : prev
                              )
                            }
                            className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-60"
                          >
                            Quitar imagen
                          </button>
                        </div>

                        <textarea
                          value={draft?.description || ""}
                          placeholder="Descripción"
                          disabled={isSaving}
                          rows={2}
                          onChange={(e) =>
                            setDraft((prev) =>
                              prev
                                ? { ...prev, description: e.target.value }
                                : prev
                            )
                          }
                          className="mb-3 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/10"
                        />

                        {draft && (
                          <IngredientsEditor
                            stockItems={stockItems}
                            ingredients={draft.ingredients}
                            disabled={isSaving || loadingStock}
                            onChange={(nextIngredients) =>
                              setDraft((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      ingredients: nextIngredients,
                                    }
                                  : prev
                              )
                            }
                          />
                        )}

                        {/* F-014: Horario de disponibilidad */}
                        {draft && (
                          <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                            <p className="mb-2 text-xs font-bold text-zinc-600">Horario de disponibilidad (opcional)</p>
                            <div className="flex flex-wrap items-center gap-3 mb-2">
                              <div className="flex items-center gap-1">
                                <label className="text-xs text-zinc-500">Desde</label>
                                <input
                                  type="time"
                                  value={draft.availableFrom || ""}
                                  onChange={(e) => setDraft((prev) => prev ? { ...prev, availableFrom: e.target.value } : prev)}
                                  className="h-8 rounded border border-zinc-200 px-2 text-xs"
                                />
                              </div>
                              <div className="flex items-center gap-1">
                                <label className="text-xs text-zinc-500">Hasta</label>
                                <input
                                  type="time"
                                  value={draft.availableTo || ""}
                                  onChange={(e) => setDraft((prev) => prev ? { ...prev, availableTo: e.target.value } : prev)}
                                  className="h-8 rounded border border-zinc-200 px-2 text-xs"
                                />
                              </div>
                              {(draft.availableFrom || draft.availableTo) && (
                                <button
                                  type="button"
                                  onClick={() => setDraft((prev) => prev ? { ...prev, availableFrom: "", availableTo: "", availableDays: [] } : prev)}
                                  className="text-xs text-red-500 hover:underline"
                                >
                                  Quitar horario
                                </button>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {["D","L","M","X","J","V","S"].map((label, idx) => (
                                <button
                                  key={idx}
                                  type="button"
                                  onClick={() => setDraft((prev) => {
                                    if (!prev) return prev;
                                    const days = prev.availableDays || [];
                                    return { ...prev, availableDays: days.includes(idx) ? days.filter(d => d !== idx) : [...days, idx] };
                                  })}
                                  className={`h-7 w-7 rounded-full text-xs font-bold transition ${(draft.availableDays || []).includes(idx) ? "bg-zinc-900 text-white" : "border border-zinc-200 bg-white text-zinc-500"}`}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                            <p className="mt-1 text-xs text-zinc-400">Sin horario = disponible siempre. Sin días = disponible todos los días.</p>
                          </div>
                        )}

                        {/* F-004: Modificadores */}
                        {draft && (
                          <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                            <div className="mb-2 flex items-center justify-between">
                              <p className="text-xs font-bold text-zinc-600">Grupos de modificadores</p>
                              <button
                                type="button"
                                onClick={() => setDraft((prev) => prev ? {
                                  ...prev,
                                  modifierGroups: [...(prev.modifierGroups || []), { name: "Opción", required: false, options: [{ name: "Variante", priceAdd: 0 }] }]
                                } : prev)}
                                className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-xs font-bold text-zinc-600 hover:bg-zinc-100"
                              >
                                + Agregar grupo
                              </button>
                            </div>
                            {(draft.modifierGroups || []).map((group, gi) => (
                              <div key={gi} className="mb-2 rounded border border-zinc-200 bg-white p-2">
                                <div className="mb-1.5 flex items-center gap-2">
                                  <input
                                    value={group.name}
                                    onChange={(e) => setDraft((prev) => {
                                      if (!prev) return prev;
                                      const gs = [...(prev.modifierGroups || [])];
                                      gs[gi] = { ...gs[gi], name: e.target.value };
                                      return { ...prev, modifierGroups: gs };
                                    })}
                                    className="h-7 flex-1 rounded border border-zinc-200 px-2 text-xs"
                                    placeholder="Nombre del grupo"
                                  />
                                  <label className="flex items-center gap-1 text-xs text-zinc-500">
                                    <input type="checkbox" checked={group.required} onChange={(e) => setDraft((prev) => {
                                      if (!prev) return prev;
                                      const gs = [...(prev.modifierGroups || [])];
                                      gs[gi] = { ...gs[gi], required: e.target.checked };
                                      return { ...prev, modifierGroups: gs };
                                    })} /> Obligatorio
                                  </label>
                                  <button type="button" onClick={() => setDraft((prev) => {
                                    if (!prev) return prev;
                                    return { ...prev, modifierGroups: (prev.modifierGroups || []).filter((_, i) => i !== gi) };
                                  })} className="text-red-400 hover:text-red-600 text-xs">✕</button>
                                </div>
                                {group.options.map((opt, oi) => (
                                  <div key={oi} className="mb-1 flex items-center gap-1.5">
                                    <input
                                      value={opt.name}
                                      onChange={(e) => setDraft((prev) => {
                                        if (!prev) return prev;
                                        const gs = [...(prev.modifierGroups || [])];
                                        const opts = [...gs[gi].options];
                                        opts[oi] = { ...opts[oi], name: e.target.value };
                                        gs[gi] = { ...gs[gi], options: opts };
                                        return { ...prev, modifierGroups: gs };
                                      })}
                                      className="h-7 flex-1 rounded border border-zinc-200 px-2 text-xs"
                                      placeholder="Opción"
                                    />
                                    <input
                                      type="number" min={0}
                                      value={opt.priceAdd}
                                      onChange={(e) => setDraft((prev) => {
                                        if (!prev) return prev;
                                        const gs = [...(prev.modifierGroups || [])];
                                        const opts = [...gs[gi].options];
                                        opts[oi] = { ...opts[oi], priceAdd: Number(e.target.value) };
                                        gs[gi] = { ...gs[gi], options: opts };
                                        return { ...prev, modifierGroups: gs };
                                      })}
                                      className="h-7 w-20 rounded border border-zinc-200 px-2 text-xs"
                                      placeholder="+$"
                                    />
                                    <button type="button" onClick={() => setDraft((prev) => {
                                      if (!prev) return prev;
                                      const gs = [...(prev.modifierGroups || [])];
                                      gs[gi] = { ...gs[gi], options: gs[gi].options.filter((_, i) => i !== oi) };
                                      return { ...prev, modifierGroups: gs };
                                    })} className="text-red-400 hover:text-red-600 text-xs">✕</button>
                                  </div>
                                ))}
                                <button type="button" onClick={() => setDraft((prev) => {
                                  if (!prev) return prev;
                                  const gs = [...(prev.modifierGroups || [])];
                                  gs[gi] = { ...gs[gi], options: [...gs[gi].options, { name: "", priceAdd: 0 }] };
                                  return { ...prev, modifierGroups: gs };
                                })} className="mt-1 text-xs font-semibold text-zinc-500 hover:text-zinc-800">
                                  + opción
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* F-017: Editar sub-ítems del combo */}
                        {draft && draft.type === "combo" && (
                          <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50 p-3">
                            <p className="mb-2 text-xs font-bold text-violet-700">Sub-ítems del combo</p>
                            <div className="flex flex-wrap gap-1.5">
                              {items.filter(i => i.active && i.type !== "combo" && i.id !== item.id).map((i) => (
                                <button
                                  key={i.id}
                                  type="button"
                                  onClick={() => setDraft((prev) => {
                                    if (!prev) return prev;
                                    const list = prev.comboItems || [];
                                    return { ...prev, comboItems: list.includes(i.id) ? list.filter(x => x !== i.id) : [...list, i.id] };
                                  })}
                                  className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${(draft.comboItems || []).includes(i.id) ? "bg-zinc-900 text-white" : "border border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400"}`}
                                >
                                  {i.name}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* F-033: Alérgenos */}
                        {draft && (
                          <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                            <p className="mb-2 text-xs font-bold text-zinc-600">Alérgenos</p>
                            <div className="flex flex-wrap gap-1.5">
                              {["TACC","Mariscos","Lácteos","Maní","Huevo","Soja","Frutos secos","Mostaza","Apio","Sésamo"].map((a) => (
                                <button
                                  key={a}
                                  type="button"
                                  onClick={() => setDraft((prev) => {
                                    if (!prev) return prev;
                                    const list = prev.allergens || [];
                                    return { ...prev, allergens: list.includes(a) ? list.filter(x => x !== a) : [...list, a] };
                                  })}
                                  className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${(draft.allergens || []).includes(a) ? "bg-amber-500 text-white" : "border border-zinc-200 bg-white text-zinc-600 hover:border-amber-300"}`}
                                >
                                  {a}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* F-017: Mostrar sub-ítems del combo */}
                        {item.type === "combo" && item.comboItems && item.comboItems.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-bold text-violet-700">COMBO</span>
                            {item.comboItems.map((cid) => {
                              const sub = items.find(i => i.id === cid);
                              return sub ? (
                                <span key={cid} className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-0.5 text-xs font-semibold text-zinc-600">
                                  {sub.name}
                                </span>
                              ) : null;
                            })}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  <div className="flex gap-2 md:flex-col md:items-end">
                    {!isEditing ? (
                      <button
                        onClick={() => startEditing(item)}
                        disabled={isSaving}
                        className="flex h-10 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 font-semibold text-zinc-900 transition hover:bg-zinc-50 disabled:opacity-60"
                      >
                        <Pencil size={15} />
                        Editar
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => saveEditing(item)}
                          disabled={isSaving || isUploadingEditImage}
                          className="flex h-10 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-4 font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
                        >
                          <Save size={15} />
                          Guardar
                        </button>

                        <button
                          onClick={cancelEditing}
                          disabled={isSaving || isUploadingEditImage}
                          className="flex h-10 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 font-semibold text-zinc-900 transition hover:bg-zinc-50 disabled:opacity-60"
                        >
                          <X size={15} />
                          Cancelar
                        </button>
                      </>
                    )}

                    <button
                      onClick={() => toggleActive(item)}
                      disabled={isSaving}
                      className={`h-10 rounded-lg px-4 font-semibold text-white transition hover:opacity-90 disabled:opacity-60 ${
                        item.active ? "bg-orange-500" : "bg-emerald-600"
                      }`}
                    >
                      {item.active ? "Pausar" : "Activar"}
                    </button>

                    <button
                      onClick={() => handleDelete(item)}
                      disabled={isSaving}
                      className="flex h-10 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
                    >
                      <Trash2 size={15} />
                      Eliminar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
