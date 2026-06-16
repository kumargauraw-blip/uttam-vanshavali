import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5373,
    strictPort: false,
    hmr: {
      port: 24773
    }
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true
  }
});
