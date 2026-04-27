import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The LLM server runs locally on a known host:port. We proxy /v1/* through
// Vite so the browser never has to deal with CORS, and we can keep the
// frontend identical between dev and production builds (just point a static
// host at the same proxy or run `npm run preview`).
const LLM_TARGET = process.env.LLM_SERVER_URL ?? "http://127.0.0.1:8080";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/v1": {
        target: LLM_TARGET,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 5173,
    proxy: {
      "/v1": {
        target: LLM_TARGET,
        changeOrigin: true,
      },
    },
  },
});
