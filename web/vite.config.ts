import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { canonicalData } from "./plugins/canonical-data.ts";

export default defineConfig({
  plugins: [react(), canonicalData()],
  server: { host: "127.0.0.1", port: 5190, strictPort: true },
  preview: { host: "127.0.0.1", port: 5191, strictPort: true },
});
