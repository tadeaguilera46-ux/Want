import * as Sentry from "@sentry/react";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { RestaurantProvider } from "./lib/restaurant-context";
import { AuthProvider } from "./lib/auth-context";
import "./index.css";

// LOG TEMPORAL — remover después de confirmar que Sentry funciona
console.info("[Sentry]", {
  hasDsn: Boolean(import.meta.env.VITE_SENTRY_DSN),
  mode: import.meta.env.MODE,
  isProd: import.meta.env.PROD,
});

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN as string | undefined,
  environment: import.meta.env.MODE,
  release: import.meta.env.VITE_APP_VERSION as string | undefined,
  // Solo activo en producción y si el DSN está configurado
  enabled: import.meta.env.PROD && !!import.meta.env.VITE_SENTRY_DSN,
  integrations: [Sentry.browserTracingIntegration()],
  // 10% de transacciones para performance — ajustar cuando haya más volumen
  tracesSampleRate: 0.1,
  // Sin Session Replay por ahora
  beforeSend(event) {
    // Asegurar que no viaje ningún campo de pago ni email de cliente
    if (event.request?.data) {
      delete event.request.data;
    }
    return event;
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <RestaurantProvider>
          <App />
        </RestaurantProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
