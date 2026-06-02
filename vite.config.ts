import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";
import { sentryVitePlugin } from "@sentry/vite-plugin";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["LogoWant.png"],
      manifest: {
        name: "Want App",
        short_name: "Want App",
        description: "Sistema inteligente para restaurantes",
        theme_color: "#000000",
        background_color: "#ffffff",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/",
        icons: [
          {
            src: "/LogoWant.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/LogoWant.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/LogoWant.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webp}"],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === "document",
            handler: "NetworkFirst",
            options: {
              cacheName: "want-pages",
              networkTimeoutSeconds: 3,
            },
          },
          {
            urlPattern: ({ request }) =>
              request.destination === "script" ||
              request.destination === "style",
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "want-assets",
            },
          },
          {
            urlPattern: ({ url }) =>
              url.origin.includes("firebasestorage.googleapis.com"),
            handler: "CacheFirst",
            options: {
              cacheName: "want-firebase-images",
              expiration: {
                maxEntries: 120,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
    // Solo sube source maps a Sentry cuando SENTRY_AUTH_TOKEN está configurado.
    // En CI/Vercel: agregar SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT como env vars.
    ...(process.env.SENTRY_AUTH_TOKEN
      ? [
          sentryVitePlugin({
            org: process.env.SENTRY_ORG,
            project: process.env.SENTRY_PROJECT,
            // Borra los source maps del bundle después de subirlos a Sentry
            sourcemaps: { filesToDeleteAfterUpload: ["./dist/**/*.map"] },
          }),
        ]
      : []),
  ],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  build: {
    chunkSizeWarningLimit: 1200,
    // Source maps requeridos para stack traces legibles en Sentry.
    // El plugin los sube y los borra del bundle final — no llegan al cliente.
    sourcemap: true,
  },
});
