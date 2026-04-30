import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Routes } from "react-router-dom";
import { CartProvider } from "@/lib/CartContext";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

// Cliente
const Index = lazy(() => import("./pages/Index"));
const Welcome = lazy(() => import("./pages/Welcome"));
const Menu = lazy(() => import("./pages/Menu"));
const Cart = lazy(() => import("./pages/Cart"));
const OrderConfirmed = lazy(() => import("./pages/OrderConfirmed"));
const RequestBill = lazy(() => import("./pages/RequestBill"));
const BillConfirmed = lazy(() => import("./pages/BillConfirmed"));

// Staff
const Kitchen = lazy(() => import("./pages/Kitchen"));
const Bar = lazy(() => import("./pages/Bar"));
const Runner = lazy(() => import("./pages/Runner"));
const Admin = lazy(() => import("./pages/Admin"));
const StaffLogin = lazy(() => import("./pages/StaffLogin"));
const StaffRoute = lazy(() => import("./components/StaffRoute"));
const AdminAnalytics = lazy(() => import("./pages/AdminAnalytics"));

// Otros
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

function AppLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-slate-900" />
        <p className="text-sm font-medium text-slate-600">Cargando sistema...</p>
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
      <Sonner />
      <Suspense fallback={<AppLoader />}>
        <Routes>
          {/* Cliente */}
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

          {/* Staff */}
          <Route path="/staff/login" element={<StaffLogin />} />

          <Route
            path="/staff/kitchen"
            element={
              <StaffRoute allowedRoles={["kitchen", "admin"]}>
                <Kitchen />
              </StaffRoute>
            }
          />

          <Route
            path="/staff/bar"
            element={
              <StaffRoute allowedRoles={["bar", "admin"]}>
                <Bar />
              </StaffRoute>
            }
          />

          <Route
            path="/staff/runner"
            element={
              <StaffRoute allowedRoles={["runner", "admin"]}>
                <Runner />
              </StaffRoute>
            }
          />

          <Route
            path="/staff/admin"
            element={
              <StaffRoute allowedRoles={["admin"]}>
                <Admin />
              </StaffRoute>
            }
          />

          <Route
            path="/staff/admin/analytics"
            element={
              <StaffRoute allowedRoles={["admin"]}>
                <AdminAnalytics />
              </StaffRoute>
            }
          />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;