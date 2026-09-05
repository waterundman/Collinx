import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // v1.16.0 Stage 1: pdfkit's Node entry (js/pdfkit.js) reads its standard
      // font AFM metrics via fs.readFileSync, which does not exist in the
      // browser. The self-contained standalone bundle (js/pdfkit.standalone.js,
      // UMD with all standard fonts inlined) is pdfkit's official browser
      // build — alias to it so the PDF exporter can be bundled for the UI.
      // Exact-match regex avoids recursive aliasing of the replacement path.
      {
        find: /^pdfkit$/,
        replacement: "pdfkit/js/pdfkit.standalone.js",
      },
    ],
  },
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
