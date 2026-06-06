import { useState } from "react";

type Props = {
  src?: string;
  alt: string;
};

const MenuImageFallback = ({ name }: { name: string }) => {
  return (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-100 to-zinc-200 px-6 text-center">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-400">
          WANT
        </p>

        <p className="mt-2 text-sm font-bold text-zinc-600">
          {name}
        </p>
      </div>
    </div>
  );
};

export default function MenuImage({ src, alt }: Props) {
  const [hasError, setHasError] = useState(false);

  if (!src || hasError) {
    return <MenuImageFallback name={alt} />;
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setHasError(true)}
      className="h-full w-full object-cover transition-transform duration-500 hover:scale-[1.03]"
    />
  );
}