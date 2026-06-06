import type { ReactNode } from "react";

type Props = {
  title: string;
  description: string;
  children: ReactNode;
};

export function AdminSectionShell({ title, description, children }: Props) {
  return (
    <section className="animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="mb-6 rounded-[2rem] border border-border/80 bg-white/90 p-6 shadow-sm backdrop-blur">
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-muted-foreground">
          WANT Admin
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground md:text-4xl">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>

      <div className="space-y-6">{children}</div>
    </section>
  );
}