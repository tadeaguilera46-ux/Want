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
    <aside className="sticky top-0 hidden h-screen w-[300px] shrink-0 overflow-hidden border-r border-white/60 bg-zinc-950 p-4 text-white shadow-2xl lg:flex lg:flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pr-1 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.25)_transparent]">
        <div className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-4 shadow-inner">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-zinc-950 shadow-sm">
            <LayoutDashboard size={22} />
          </div>

          <h2 className="mt-4 text-2xl font-black tracking-tight">WANT</h2>

          <p className="mt-1 text-xs font-medium leading-relaxed text-white/50">
            Panel de administración premium para operación gastronómica.
          </p>

          {userEmail && (
            <p className="mt-3 truncate rounded-full border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-bold text-white/70">
              {userEmail}
            </p>
          )}
        </div>

        <nav className="mt-5 space-y-1.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;

            return (
              <button
                key={item.id}
                onClick={() => onSectionChange(item.id)}
                className={`group flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-all duration-200 ${
                  active
                    ? "bg-white text-zinc-950 shadow-lg shadow-black/20"
                    : "text-white/70 hover:bg-white/[0.08] hover:text-white"
                }`}
              >
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition ${
                    active ? "bg-zinc-950 text-white" : "bg-white/10 text-white"
                  }`}
                >
                  <Icon size={18} />
                </div>

                <div className="min-w-0">
                  <p className="text-sm font-black">{item.label}</p>
                  <p
                    className={`text-xs ${
                      active ? "text-zinc-500" : "text-white/40"
                    }`}
                  >
                    {item.description}
                  </p>
                </div>
              </button>
            );
          })}
        </nav>

        <div className="mt-auto space-y-2 border-t border-white/10 pt-4">
          <button
            onClick={onAnalytics}
            className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-white/70 transition hover:bg-white/[0.08] hover:text-white"
          >
            <BarChart3 size={18} />
            <span className="text-sm font-bold">Analytics</span>
          </button>

          <button
            onClick={onInvoices}
            className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition ${
              invoicesEnabled
                ? "text-white/70 hover:bg-white/[0.08] hover:text-white"
                : "text-amber-300/80 hover:bg-amber-400/10"
            }`}
          >
            <ReceiptText size={18} />
            <span className="text-sm font-bold">
              Facturación {!invoicesEnabled && "· Pro"}
            </span>
          </button>

          <button
            onClick={onAuditLogs}
            className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition ${
              auditLogsEnabled
                ? "text-white/70 hover:bg-white/[0.08] hover:text-white"
                : "text-amber-300/80 hover:bg-amber-400/10"
            }`}
          >
            <Activity size={18} />
            <span className="text-sm font-bold">
              Auditoría {!auditLogsEnabled && "· Pro"}
            </span>
          </button>

          <button
            onClick={onLogout}
            disabled={loggingOut}
            className="flex w-full items-center gap-3 rounded-2xl border border-red-400/20 bg-red-500/10 px-3 py-3 text-left text-red-200 transition hover:bg-red-500/20 disabled:opacity-50"
          >
            <LogOut size={18} />
            <span className="text-sm font-black">
              {loggingOut ? "Cerrando..." : "Cerrar sesión"}
            </span>
          </button>
        </div>
      </div>
    </aside>
  );
}