import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Routes } from "react-router-dom";
import { CartProvider } from "@/lib/CartContext";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
// Guards
import SubscriptionGuard from "@/components/guards/SubscriptionGuard";
import AppErrorBoundary from "@/components/AppErrorBoundary";


// Cliente
const Index = lazy(() => import("./pages/Index"));
const Welcome = lazy(() => import("./pages/Welcome"));
const Menu = lazy(() => import("./pages/Menu"));
const Cart = lazy(() => import("./pages/Cart"));
const OrderConfirmed = lazy(() => import("./pages/OrderConfirmed"));
const RequestBill = lazy(() => import("./pages/RequestBill"));
const BillConfirmed = lazy(() => import("./pages/BillConfirmed"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const QrEntry = lazy(() => import("./pages/QrEntry"));

// Staff
const Kitchen = lazy(() => import("./pages/Kitchen"));
const Bar = lazy(() => import("./pages/Bar"));
const Runner = lazy(() => import("./pages/Runner"));
const Admin = lazy(() => import("./pages/Admin"));
const StaffLogin = lazy(() => import("./pages/StaffLogin"));
const StaffRoute = lazy(() => import("./components/StaffRoute"));
const AdminAnalytics = lazy(() => import("./pages/AdminAnalytics"));
const Cashier = lazy(() => import("./pages/Cashier"));
const CashierInvoices = lazy(() => import("./pages/CashierInvoices"));

// Super Admin
const SuperAdmin = lazy(() => import("./pages/SuperAdmin"));

// Billing
const PaymentRequired = lazy(() => import("./pages/PaymentRequired"));

// Otros
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

function AppLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-slate-900" />
        <p className="text-sm font-medium text-slate-600">
          Cargando sistema...
        </p>
      </div>
    </div>
  );
}

function ClientApp({ children }: { children: React.ReactNode }) {
  return <CartProvider>{children}</CartProvider>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner position="top-center" richColors closeButton />
      <AppErrorBoundary>
      <Suspense fallback={<AppLoader />}>
        <Routes>
          {/* =========================
              CLIENTE
          ========================= */}

          <Route
            path="/"
            element={
              <ClientApp>
                <Index />
              </ClientApp>
            }
          />

          <Route
            path="/welcome"
            element={
              <ClientApp>
                <Welcome />
              </ClientApp>
            }
          />

          <Route
            path="/menu"
            element={
              <ClientApp>
                <Menu />
              </ClientApp>
            }
          />

          <Route
            path="/cart"
            element={
              <ClientApp>
                <Cart />
              </ClientApp>
            }
          />

          <Route
            path="/qr"
            element={
              <ClientApp>
                <QrEntry />
              </ClientApp>
            }
          />

          <Route
            path="/order-confirmed"
            element={
              <ClientApp>
                <OrderConfirmed />
              </ClientApp>
            }
          />

          <Route
            path="/bill"
            element={
              <ClientApp>
                <RequestBill />
              </ClientApp>
            }
          />

          <Route
            path="/bill-confirmed"
            element={
              <ClientApp>
                <BillConfirmed />
              </ClientApp>
            }
          />

          {/* =========================
              SUPER ADMIN
          ========================= */}

          <Route path="/super-admin" element={<SuperAdmin />} />

          {/* =========================
              BILLING
          ========================= */}

          <Route
            path="/payment-required"
            element={<PaymentRequired />}
          />

          {/* =========================
              STAFF LOGIN
          ========================= */}

          <Route path="/staff/login" element={<StaffLogin />} />

          {/* =========================
              KITCHEN
          ========================= */}

          <Route
            path="/staff/kitchen"
            element={
              <SubscriptionGuard>
                <StaffRoute allowedRoles={["kitchen", "admin"]}>
                  <Kitchen />
                </StaffRoute>
              </SubscriptionGuard>
            }
          />

          <Route
            path="/staff/cashier"
            element={
              <SubscriptionGuard>
                <StaffRoute allowedRoles={["cashier", "admin"]}>
                  <Cashier />
                </StaffRoute>
              </SubscriptionGuard>
            }
          />
          <Route
            path="/staff/cashier/invoices"
            element={
              <SubscriptionGuard>
                <StaffRoute allowedRoles={["cashier", "admin"]}>
                  <CashierInvoices />
                </StaffRoute>
              </SubscriptionGuard>
            }
          />

          {/* =========================
              BAR
          ========================= */}

          <Route
            path="/staff/bar"
            element={
              <SubscriptionGuard>
                <StaffRoute allowedRoles={["bar", "admin"]}>
                  <Bar />
                </StaffRoute>
              </SubscriptionGuard>
            }
          />

          {/* =========================
              RUNNER
          ========================= */}

          <Route
            path="/staff/runner"
            element={
              <SubscriptionGuard>
                <StaffRoute allowedRoles={["runner", "admin"]}>
                  <Runner />
                </StaffRoute>
              </SubscriptionGuard>
            }
          />

          {/* =========================
              ADMIN
          ========================= */}

          <Route
            path="/staff/admin"
            element={
              <SubscriptionGuard>
                <StaffRoute allowedRoles={["admin"]}>
                  <Admin />
                </StaffRoute>
              </SubscriptionGuard>
            }
          />

          {/* =========================
              ANALYTICS
          ========================= */}

          <Route
            path="/staff/admin/analytics"
            element={
              <SubscriptionGuard>
                <StaffRoute allowedRoles={["admin"]}>
                  <AdminAnalytics />
                </StaffRoute>
              </SubscriptionGuard>
            }
          />
          <Route 
            path="/onboarding"  
            element={<Onboarding />
            } 
          />
          {/* =========================
              404
          ========================= */}

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
      </AppErrorBoundary>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;