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
  if (item.type === "food" || item.type === "drinks") return item.type;
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
    <div className="rounded-lg border border-border bg-secondary p-3">
      <div className="mb-3 flex items-start gap-2">
        <Boxes size={17} className="mt-0.5 text-foreground" />
        <div>
          <p className="text-sm font-bold text-foreground">
            Ingredientes / receta
          </p>
          <p className="text-xs text-muted-foreground">
            Los esenciales ocultan el plato si no hay stock. Los secundarios
            generan aviso al cliente.
          </p>
        </div>
      </div>

      {stockItems.length === 0 ? (
        <div className="rounded-lg border border-amber-800/50 bg-amber-950/30 p-3 text-sm text-amber-400">
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
            className="h-10 rounded-xl border border-border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
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
            className="h-10 rounded-xl border border-border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
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
            className="h-10 rounded-xl border border-border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
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
            className="h-10 rounded-xl border border-border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
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
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-dashed border-zinc-300 bg-card p-3 text-xs text-muted-foreground">
          <AlertTriangle size={15} className="shrink-0" />
          Este producto no tiene receta cargada. En Premium seguirá siendo
          vendible, pero no descontará stock automáticamente.
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {ingredients.map((ingredient) => (
            <div
              key={ingredient.stockItemId}
              className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground"
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
                    ? "bg-red-100 text-red-400"
                    : "bg-amber-100 text-amber-400"
                }`}
              >
                {ingredient.essential ? "Esencial" : "Secundario"}
              </button>

              <button
                type="button"
                disabled={disabled}
                onClick={() => removeIngredient(ingredient.stockItemId)}
                className="text-muted-foreground transition hover:text-red-400 disabled:opacity-50"
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
        comboItems: [],
      });

      setName("");
      setPrice("");
      setType("food");
      setCategory("");
      setDescription("");
      setImage("");
      setIngredients([]);
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
    });
  };

  const cancelEditing = () => {
    setEditingId(null);
    setDraft(null);
  };

  const saveEditing = async (item: MenuItem) => {
    if (!draft) return;

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
    try {
      setSavingId(item.id);

      await updateMenuItem(restaurantId, item.id, {
        active: !item.active,
      });
    } catch (error) {
      console.error("Error pausando/activando producto:", error);
      toast.error("No se pudo actualizar el producto");
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = async (item: MenuItem) => {
    const ok = window.confirm(
      `¿Seguro que querés eliminar "${item.name}" del menú?`
    );

    if (!ok) return;

    try {
      setSavingId(item.id);
      await deleteMenuItem(restaurantId, item.id);
    } catch (error) {
      console.error("Error eliminando producto:", error);
      toast.error("No se pudo eliminar el producto");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <section className="mb-6 rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-zinc-950 text-white">
          <Utensils size={20} />
        </div>

        <div>
          <h2 className="text-xl font-bold text-foreground">Menú editable</h2>
          <p className="mt-1 text-sm text-muted-foreground">
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
          className="h-11 rounded-lg border border-border px-3 outline-none focus:ring-2 focus:ring-ring/40"
        />

        <input
          placeholder="Precio"
          type="number"
          min={0}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="h-11 rounded-lg border border-border px-3 outline-none focus:ring-2 focus:ring-ring/40"
        />

        <select
          value={type}
          onChange={(e) => setType(e.target.value as MenuType)}
          className="h-11 rounded-lg border border-border px-3 outline-none focus:ring-2 focus:ring-ring/40"
        >
          <option value="food">Sale a cocina</option>
          <option value="drinks">Sale a barra</option>
        </select>

        <input
          placeholder="Categoría: Pizzas"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="h-11 rounded-lg border border-border px-3 outline-none focus:ring-2 focus:ring-ring/40"
        />

        <textarea
          placeholder="Descripción del producto"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="rounded-lg border border-border px-3 py-3 outline-none focus:ring-2 focus:ring-ring/40 lg:col-span-3"
        />

        <div className="space-y-2">
          <label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-300 bg-secondary px-3 text-sm font-semibold text-foreground transition hover:bg-background">
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
            <div className="h-24 overflow-hidden rounded-lg border border-border bg-background">
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
        <div className="rounded-lg border border-border bg-secondary p-4 text-sm text-muted-foreground">
          Cargando menú...
        </div>
      ) : sortedItems.length === 0 ? (
        <div className="rounded-lg border border-border bg-secondary p-4 text-sm text-muted-foreground">
          Todavía no hay productos cargados.
        </div>
      ) : (
        <div className="max-h-[640px] overflow-y-auto rounded-lg border border-border p-3">
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
                  className="grid gap-3 rounded-lg border border-border bg-card p-3 md:grid-cols-[120px_1fr_auto]"
                >
                  <div className="h-28 overflow-hidden rounded-lg bg-background">
                    {(isEditing ? draft?.image : item.image) ? (
                      <img
                        src={isEditing ? draft?.image : item.image}
                        alt={item.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                        <Image size={24} />
                      </div>
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${
                          item.active
                            ? "border border-emerald-800/50 bg-emerald-100 text-emerald-400"
                            : "border border-red-800/50 bg-red-100 text-red-400"
                        }`}
                      >
                        {item.active ? "Activo" : "Pausado"}
                      </span>

                      <span className="rounded-full border border-border bg-background px-3 py-1 text-xs font-bold uppercase tracking-wide text-foreground">
                        {itemType === "food" ? "Cocina" : "Barra"}
                      </span>

                      <span className="rounded-full border border-border bg-secondary px-3 py-1 text-xs font-bold uppercase tracking-wide text-foreground">
                        {itemCategory}
                      </span>

                      <span
                        className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${
                          itemIngredients.length > 0
                            ? "border border-blue-800/50 bg-blue-100 text-blue-400"
                            : "border border-amber-800/50 bg-amber-100 text-amber-400"
                        }`}
                      >
                        {itemIngredients.length > 0
                          ? `${itemIngredients.length} ingrediente(s)`
                          : "Sin receta"}
                      </span>
                    </div>

                    {!isEditing ? (
                      <>
                        <h3 className="text-lg font-bold text-foreground">
                          {item.name}
                        </h3>

                        <p className="mt-1 text-sm text-muted-foreground">
                          {item.description || "Sin descripción"}
                        </p>

                        <p className="mt-2 text-sm font-bold text-foreground">
                          {formatPriceARS(item.price)}
                        </p>

                        {itemIngredients.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {itemIngredients.map((ingredient) => (
                              <span
                                key={ingredient.stockItemId}
                                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                                  ingredient.essential
                                    ? "bg-red-950/30 text-red-400"
                                    : "bg-amber-950/30 text-amber-400"
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
                          className="mb-2 h-10 w-full rounded-xl border border-border px-3 font-bold outline-none focus:ring-2 focus:ring-ring/40"
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
                            className="h-10 rounded-xl border border-border px-3 outline-none focus:ring-2 focus:ring-ring/40"
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
                            className="h-10 rounded-xl border border-border px-3 outline-none focus:ring-2 focus:ring-ring/40"
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
                            className="h-10 rounded-xl border border-border px-3 outline-none focus:ring-2 focus:ring-ring/40"
                          />
                        </div>

                        <div className="mb-2 grid gap-2 sm:grid-cols-[180px_1fr]">
                          <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 bg-secondary px-3 text-sm font-semibold text-foreground transition hover:bg-background">
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
                            className="h-10 rounded-xl border border-border bg-card px-3 text-sm font-semibold text-foreground transition hover:bg-secondary disabled:opacity-60"
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
                          className="mb-3 w-full rounded-xl border border-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
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
                      </>
                    )}
                  </div>

                  <div className="flex gap-2 md:flex-col md:items-end">
                    {!isEditing ? (
                      <button
                        onClick={() => startEditing(item)}
                        disabled={isSaving}
                        className="flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 font-semibold text-foreground transition hover:bg-secondary disabled:opacity-60"
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
                          className="flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 font-semibold text-foreground transition hover:bg-secondary disabled:opacity-60"
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