import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    rollupOptions: {
      onwarn(warning, warn) {
        if (
          warning.code === "INVALID_ANNOTATION" &&
          warning.id?.includes("node_modules")
        )
          return;
        warn(warning);
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:5120",
      "/hubs": {
        target: "http://localhost:5120",
        ws: true,
      },
    },
  },
});
