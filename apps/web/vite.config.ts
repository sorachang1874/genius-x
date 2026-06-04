import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0", // Allow access from network (for mobile/iPad testing)
    proxy: {
      // Proxy WebSocket and API requests to backend
      "/socket.io": {
        target: "http://localhost:3000",
        ws: true,
      },
      "/session": {
        target: "http://localhost:3000",
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
