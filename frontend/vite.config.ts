import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    proxy: {
      "/api": {
        target: "http://api:8000",
      },
      "/auth": {
        target: "http://api:8000",
      },
      "/health": {
        target: "http://api:8000",
      },
      "/metrics": {
        target: "http://api:8000",
      },
      "/openapi.json": {
        target: "http://api:8000",
      },
      "/docs": {
        target: "http://api:8000",
      },
      "/redoc": {
        target: "http://api:8000",
      },
      "/ws": {
        target: "ws://api:8000",
        ws: true,
      },
    },
  },
});
