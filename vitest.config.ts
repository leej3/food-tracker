import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: "./tests/setup/vitest.setup.ts",
    css: true,
    restoreMocks: true,
    clearMocks: true,
  },
});
