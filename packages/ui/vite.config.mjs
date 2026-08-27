import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
  },
  cacheDir: join(tmpdir(), "collinx-vite-cache", "ui"),
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      external: ["fflate", "fs", "fs/promises", "path"],
    },
  },
});
