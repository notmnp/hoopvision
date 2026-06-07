import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

// Standalone test config (mirrors the @ alias from vite.config). jsdom env so we
// can render React components; setup stubs browser APIs jsdom lacks.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
})
