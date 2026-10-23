import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { canonicalData } from "./plugins/canonical-data.ts";

export default defineConfig({
  plugins: [react(), canonicalData()],
  server: { port: 5190, strictPort: true },
  preview: { port: 5191, strictPort: true },
});
