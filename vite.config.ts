import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { catalogApiPlugin } from "./vite.catalog-api";

export default defineConfig({
  plugins: [react(), catalogApiPlugin()],
  server: {
    port: 5173,
  },
  // Prevent duplicate React instances in production builds
  // This is critical when using @cesdk/cesdk-js which bundles React components
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  // Keep CE.SDK out of Vite's prebundle so WASM/worker URLs resolve correctly
  optimizeDeps: {
    exclude: ["@cesdk/cesdk-js", "@cesdk/engine"],
  },
});
