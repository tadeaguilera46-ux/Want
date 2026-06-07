import { memo } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  MessageSquareText,
  PauseCircle,
  Plus,
  XCircle,
} from "lucide-react";
import MenuImage from "./MenuImage";
import type { MenuIngredient } from "@/lib/store";

type MenuType = "food" | "drinks" | "combo";

type MenuCardItem = {
  id: string;
  name: string;
  price: number;
  description?: string;
  type?: MenuType;
  category: string;
  active: boolean;
  image?: string;
  ingredients?: MenuIngredient[];
  allergens?: string[];
  modifierGroups?: { name: string; required: boolean; options: { name: string; priceAdd: number }[] }[];
};

type MenuItemAvailability = {
  lowStock: boolean;
  status?: "available" | "sold_out" | "paused";
  message?: string | null;
};

type Props = {
  item: MenuCardItem;
  quantity: number;
  tags: string[];
  availability: MenuItemAvailability;
  primaryColor: string;
  formatPrice: (value: number) => string;
  onAdd: (item: MenuCardItem) => void;
  onNote: (item: MenuCardItem) => void;
  originalPrice?: number;
  twoForOne?: boolean;
};

function MenuItemCard({
  item,
  quantity,
  tags,
  availability,
  primaryColor,
  formatPrice,
  onAdd,
  onNote,
  originalPrice,
  twoForOne,
}: Props) {
  const isUnavailable =
    availability.status === "sold_out" || availability.status === "paused";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4, boxShadow: "0 20px 40px -16px rgba(0,0,0,0.28)" }}
      whileTap={{ scale: 0.985 }}
      transition={{ duration: 0.22 }}
      className={`overflow-hidden rounded-[30px] border border-black/5 bg-white shadow-[0_12px_30px_-16px_rgba(0,0,0,0.22)] ${
        isUnavailable ? "opacity-75" : ""
      }`}
    >
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-zinc-100">
        <div className={`h-full w-full ${isUnavailable ? "grayscale" : ""}`}>
          <MenuImage src={item.image} alt={item.name} />
        </div>

        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />

        <div className="absolute left-4 right-4 top-4 flex items-start justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-zinc-800 backdrop-blur"
              >
                {tag}
              </span>
            ))}

            {availability.lowStock && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-800 backdrop-blur">
                <AlertTriangle size={12} />
                Quedan pocas unidades
              </span>
            )}

            {availability.status === "sold_out" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2.5 py-1 text-[11px] font-bold text-white shadow-sm">
                <XCircle size={12} />
                Agotado
              </span>
            )}

            {availability.status === "paused" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-zinc-700 px-2.5 py-1 text-[11px] font-bold text-white shadow-sm">
                <PauseCircle size={12} />
                Pausado
              </span>
            )}

            {twoForOne && (
              <span className="rounded-full bg-amber-500 px-2.5 py-1 text-[11px] font-black text-white shadow-sm">
                2×1
              </span>
            )}
          </div>

          {originalPrice !== undefined ? (
            <div className="flex flex-col items-end gap-0.5 rounded-xl bg-white/95 px-2.5 py-1.5 shadow-sm backdrop-blur">
              <span className="text-[10px] font-medium leading-none text-zinc-400 line-through">
                {formatPrice(originalPrice)}
              </span>
              <span className="text-sm font-bold leading-none text-emerald-600">
                {formatPrice(item.price)}
              </span>
            </div>
          ) : (
            <div className="shrink-0 rounded-full bg-white/95 px-3 py-1.5 text-sm font-semibold text-zinc-950 shadow-sm backdrop-blur">
              {formatPrice(item.price)}
            </div>
          )}
        </div>

        <div className="absolute bottom-0 left-0 right-0 p-4">
          <h3 className="text-xl font-bold leading-tight text-white drop-shadow-sm">
            {item.name}
          </h3>
        </div>
      </div>

      <div className="p-4">
        <p className="text-sm leading-relaxed text-zinc-600">
          {item.description || "Sin descripción"}
        </p>

        {isUnavailable && (
          <p className="mt-2 text-sm font-semibold text-zinc-700">
            {availability.message ||
              (availability.status === "sold_out"
                ? "Temporalmente agotado"
                : "Temporalmente pausado")}
          </p>
        )}

        {item.allergens && item.allergens.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {item.allergens.map((a) => (
              <span key={a} className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                {a}
              </span>
            ))}
          </div>
        )}

        {item.modifierGroups && item.modifierGroups.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {item.modifierGroups.map((g) => (
              <span key={g.name} className={`rounded-full px-2 py-0.5 text-xs font-semibold ${g.required ? "border border-zinc-300 bg-zinc-100 text-zinc-700" : "border border-zinc-200 bg-white text-zinc-500"}`}>
                {g.name}{g.required ? " *" : ""}
              </span>
            ))}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            onClick={() => onNote(item)}
            disabled={isUnavailable}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-black/10 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <MessageSquareText size={14} />
            Agregar nota
          </button>

          <div className="flex items-center gap-3">
            {quantity > 0 && (
              <span className="min-w-[24px] text-center text-sm font-bold text-zinc-700">
                {quantity}
              </span>
            )}

            <motion.button
              whileTap={{ scale: 0.92 }}
              onClick={() => onAdd(item)}
              disabled={isUnavailable}
              className="flex h-11 w-11 items-center justify-center rounded-full text-white shadow-want disabled:cursor-not-allowed disabled:opacity-40"
              style={{ backgroundColor: primaryColor }}
            >
              <Plus size={18} />
            </motion.button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export default memo(MenuItemCard);
