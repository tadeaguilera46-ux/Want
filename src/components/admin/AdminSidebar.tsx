import {
  Activity,
  BarChart3,
  Brush,
  Boxes,
  ChefHat,
  CreditCard,
  LayoutDashboard,
  LogOut,
  ReceiptText,
  Users,
} from "lucide-react";
import type { ElementType } from "react";
import type { AdminSection } from "../../types/admin";

type Props = {
  activeSection: AdminSection;
  onSectionChange: (section: AdminSection) => void;
  onAnalytics: () => void;
  onInvoices: () => void;
  onAuditLogs: () => void;
  onLogout: () => void;
  loggingOut: boolean;
  userEmail?: string | null;
  auditLogsEnabled: boolean;
  invoicesEnabled: boolean;
};

const navItems: {
  id: AdminSection;
  label: string;
  description: string;
  icon: ElementType;
}[] = [
  { id: "dashboard", label: "Panel", description: "Mesas y operación", icon: LayoutDashboard },
  { id: "branding", label: "Branding", description: "Identidad visual", icon: Brush },
  { id: "staff", label: "Empleados", description: "Roles y accesos", icon: Users },
  { id: "menu", label: "Menú", description: "Platos y precios", icon: ChefHat },
  { id: "stock", label: "Stock", description: "Inventario", icon: Boxes },
  { id: "billing", label: "Suscripción", description: "Plan y pagos", icon: CreditCard },
];

export function AdminSidebar({
  activeSection,
  onSectionChange,
  onAnalytics,
  onInvoices,
  onAuditLogs,
  onLogout,
  loggingOut,
  userEmail,
  auditLogsEnabled,
  invoicesEnabled,
}: Props) {
  return (
    <aside className="sticky top-0 hidden h-screen w-[240px] shrink-0 flex-col overflow-hidden bg-[#141412] p-3 text-[#F9F8F6] lg:flex">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-width:thin] [scrollbar-color:rgba(249,248,246,0.15)_transparent]">

        {/* Logo */}
        <div className="flex items-center gap-2.5 border-b border-white/[0.08] px-2 pb-4 pt-1">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] bg-[#F9F8F6]">
            <LayoutDashboard size={14} className="text-[#141412]" />
          </div>
          <span className="font-display text-base font-bold tracking-tight">WANT</span>
        </div>

        {/* Nav */}
        <nav className="mt-3 space-y-0.5">
          <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/40">
            Operación
          </p>
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSectionChange(item.id)}
                className={`flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-left text-sm font-medium transition-colors duration-100 ${
                  active
                    ? "border-white/[0.08] bg-white/[0.1] text-[#F9F8F6]"
                    : "border-transparent text-white/50 hover:bg-white/[0.06] hover:text-white/80"
                }`}
              >
                <Icon size={15} className="shrink-0 opacity-80" />
                <span className="flex-1">{item.label}</span>
                {active && (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                )}
              </button>
            );
          })}

          <p className="mb-1.5 mt-4 px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/40">
            Cuenta
          </p>

          <button
            onClick={onAnalytics}
            className="flex w-full items-center gap-2.5 rounded-md border border-transparent px-2.5 py-2 text-left text-sm font-medium text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white/80"
          >
            <BarChart3 size={15} className="shrink-0 opacity-80" />
            <span>Analytics</span>
          </button>

          <button
            onClick={onInvoices}
            className={`flex w-full items-center gap-2.5 rounded-md border border-transparent px-2.5 py-2 text-left text-sm font-medium transition-colors ${
              invoicesEnabled
                ? "text-white/50 hover:bg-white/[0.06] hover:text-white/80"
                : "text-accent/80 hover:bg-accent/10"
            }`}
          >
            <ReceiptText size={15} className="shrink-0 opacity-80" />
            <span className="flex-1">Facturación</span>
            {!invoicesEnabled && (
              <span className="rounded-full border border-accent/30 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                Pro
              </span>
            )}
          </button>

          <button
            onClick={onAuditLogs}
            className={`flex w-full items-center gap-2.5 rounded-md border border-transparent px-2.5 py-2 text-left text-sm font-medium transition-colors ${
              auditLogsEnabled
                ? "text-white/50 hover:bg-white/[0.06] hover:text-white/80"
                : "text-accent/80 hover:bg-accent/10"
            }`}
          >
            <Activity size={15} className="shrink-0 opacity-80" />
            <span className="flex-1">Auditoría</span>
            {!auditLogsEnabled && (
              <span className="rounded-full border border-accent/30 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                Pro
              </span>
            )}
          </button>
        </nav>

        {/* Footer */}
        <div className="mt-auto border-t border-white/[0.08] pt-3">
          {userEmail && (
            <div className="mb-2 flex items-center gap-2 rounded-md border border-white/[0.08] bg-white/[0.06] px-2.5 py-2">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-white">
                {userEmail.charAt(0).toUpperCase()}
              </div>
              <p className="min-w-0 truncate text-xs font-medium text-white/70">{userEmail}</p>
            </div>
          )}

          <button
            onClick={onLogout}
            disabled={loggingOut}
            className="flex w-full items-center gap-2.5 rounded-md border border-transparent px-2.5 py-2 text-left text-sm font-medium text-white/40 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
          >
            <LogOut size={15} className="shrink-0" />
            <span>{loggingOut ? "Cerrando..." : "Cerrar sesión"}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
