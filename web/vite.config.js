import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

/** Vite dev server → local zebra-bridge → Browser Print :9100 */
const zebraBrowserPrintProxy = {
  "/zebra-browser-print": {
    target: "http://127.0.0.1:9288",
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/zebra-browser-print/, ""),
  },
};

export default defineConfig({
  plugins: [vue()],
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

