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
  {
    id: "dashboard",
    label: "Panel",
    description: "Mesas y operación",
    icon: LayoutDashboard,
  },
  {
    id: "branding",
    label: "Branding",
    description: "Identidad visual",
    icon: Brush,
  },
  {
    id: "staff",
    label: "Empleados",
    description: "Roles y accesos",
    icon: Users,
  },
  {
    id: "menu",
    label: "Menú",
    description: "Platos y precios",
    icon: ChefHat,
  },
  {
    id: "stock",
    label: "Stock",
    description: "Inventario",
    icon: Boxes,
  },
  {
    id: "billing",
    label: "Suscripción",
    description: "Plan y pagos",
    icon: CreditCard,
  },
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
    <aside className="sticky top-0 hidden h-screen w-[260px] shrink-0 overflow-hidden border-r border-zinc-800 bg-zinc-900 p-4 text-white lg:flex lg:flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pr-1 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.12)_transparent]">
        <div className="px-2 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <LayoutDashboard size={16} />
          </div>

          <h2 className="mt-4 text-lg font-bold tracking-tight">WANT</h2>

          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Panel de administración para operación gastronómica.
          </p>

          {userEmail && (
            <p className="mt-3 truncate rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-muted-foreground">
              {userEmail}
            </p>
          )}
        </div>

        <nav className="mt-4 space-y-0.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;

            return (
              <button
                key={item.id}
                onClick={() => onSectionChange(item.id)}
                className={`group flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors duration-150 ${
                  active
                    ? "bg-white/10 text-white"
                    : "text-muted-foreground hover:bg-white/[0.05] hover:text-zinc-100"
                }`}
              >
                <div
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-sm transition-colors ${
                    active ? "text-white" : "text-muted-foreground group-hover:text-zinc-300"
                  }`}
                >
                  <Icon size={16} />
                </div>

                <div className="min-w-0">
                  <p className={`text-sm font-medium ${active ? "text-white" : ""}`}>{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                </div>

                {active && (
                  <div className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
                )}
              </button>
            );
          })}
        </nav>

        <div className="mt-auto space-y-0.5 border-t border-zinc-800 pt-3">
          <button
            onClick={onAnalytics}
            className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-muted-foreground transition-colors hover:bg-white/[0.05] hover:text-zinc-100"
          >
            <BarChart3 size={16} />
            <span className="text-sm font-medium">Analytics</span>
          </button>

          <button
            onClick={onInvoices}
            className={`flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors ${
              invoicesEnabled
                ? "text-muted-foreground hover:bg-white/[0.05] hover:text-zinc-100"
                : "text-violet-400/80 hover:bg-violet-500/10"
            }`}
          >
            <ReceiptText size={16} />
            <span className="text-sm font-medium">
              Facturación {!invoicesEnabled && <span className="text-xs text-violet-500">· Pro</span>}
            </span>
          </button>

          <button
            onClick={onAuditLogs}
            className={`flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors ${
              auditLogsEnabled
                ? "text-muted-foreground hover:bg-white/[0.05] hover:text-zinc-100"
                : "text-violet-400/80 hover:bg-violet-500/10"
            }`}
          >
            <Activity size={16} />
            <span className="text-sm font-medium">
              Auditoría {!auditLogsEnabled && <span className="text-xs text-violet-500">· Pro</span>}
            </span>
          </button>

          <button
            onClick={onLogout}
            disabled={loggingOut}
            className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
          >
            <LogOut size={16} />
            <span className="text-sm font-medium">
              {loggingOut ? "Cerrando..." : "Cerrar sesión"}
            </span>
          </button>
        </div>
      </div>
    </aside>
  );
}
