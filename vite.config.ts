import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget = env.VITE_SUPABASE_URL;

  return {
    plugins: [react()],
    server: proxyTarget
      ? {
          proxy: {
            "/api/food-analyze": {
              target: proxyTarget,
              changeOrigin: true,
              rewrite: () => "/functions/v1/food-analyze",
            },
          },
        }
      : undefined,
  };
});
