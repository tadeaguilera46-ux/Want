import { memo } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, MessageSquareText, Plus } from "lucide-react";
import MenuImage from "./MenuImage";
import type { MenuIngredient } from "@/lib/store";

type MenuType = "food" | "drinks";

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
};

type MenuItemAvailability = {
  lowStock: boolean;
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
}: Props) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4, boxShadow: "0 20px 40px -16px rgba(0,0,0,0.28)" }}
      whileTap={{ scale: 0.985 }}
      transition={{ duration: 0.22 }}
      className="overflow-hidden rounded-[30px] border border-border bg-card shadow-[0_12px_30px_-16px_rgba(0,0,0,0.22)]"
    >
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-background">
        <MenuImage src={item.image} alt={item.name} />

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
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-400 backdrop-blur">
                <AlertTriangle size={12} />
                Quedan pocas unidades
              </span>
            )}
          </div>

          <div className="shrink-0 rounded-full bg-white/95 px-3 py-1.5 text-sm font-semibold text-foreground shadow-sm backdrop-blur">
            {formatPrice(item.price)}
          </div>
        </div>

        <div className="absolute bottom-0 left-0 right-0 p-4">
          <h3 className="text-xl font-bold leading-tight text-white drop-shadow-sm">
            {item.name}
          </h3>
        </div>
      </div>

      <div className="p-4">
        <p className="text-sm leading-relaxed text-muted-foreground">
          {item.description || "Sin descripción"}
        </p>

        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            onClick={() => onNote(item)}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground transition hover:bg-secondary"
          >
            <MessageSquareText size={14} />
            Agregar nota
          </button>

          <div className="flex items-center gap-3">
            {quantity > 0 && (
              <span className="min-w-[24px] text-center text-sm font-bold text-foreground">
                {quantity}
              </span>
            )}

            <motion.button
              whileTap={{ scale: 0.92 }}
              onClick={() => onAdd(item)}
              className="flex h-11 w-11 items-center justify-center rounded-full text-white shadow-want"
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