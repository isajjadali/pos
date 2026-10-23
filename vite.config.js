import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

/** Vite dev server → local zebra-bridge → Browser Print :9100 */
const zebraBrowserPrintProxy = {
  "/zebra-browser-print": {
    target: "http://127.0.0.1:9288",
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/zebra-browser-print/, ""),
  },
};

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.js",
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Discount World POS",
        short_name: "DW POS",
        description: "Discount World point of sale — works offline for sales",
        theme_color: "#111827",
        background_color: "#f9fafb",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/favicon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,ico,woff2,png,webp}"],
      },
      // Do not runtime-cache Supabase API — outbox + localStorage own that path
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: zebraBrowserPrintProxy,
  },
  preview: {
    host: "127.0.0.1",
    port: 5173,
    proxy: zebraBrowserPrintProxy,
  },
});


