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
      output: {
        // v1.18.0 Stage 1: split the oversized main chunk (2.04 MB in
        // v1.16-v1.17 builds) into stable vendor buckets. Workspace packages
        // resolve to their real source paths (packages/<name>, no
        // "node_modules" in the id), so they are matched before the generic
        // node_modules branches.
        manualChunks(id) {
          // Application code stays in the default index chunk.
          // NOTE: workspace packages appear under BOTH path forms depending
          // on symlink resolution: real path "packages/<name>/..." and
          // symlink path "node_modules/@collinx/<name>/...". Match both.
          if (!id.includes("node_modules")) {
            if (/[\\/]packages[\\/]core[\\/]/.test(id)) return "vendor-core";
            if (/[\\/]packages[\\/]agent[\\/]/.test(id)) return "vendor-agent";
            return undefined;
          }
          if (/[\\/]node_modules[\\/]@collinx[\\/](core|agent)[\\/]/.test(id)) {
            return /[\\/]@collinx[\\/]core[\\/]/.test(id) ? "vendor-core" : "vendor-agent";
          }
          // Heavy dynamically-imported libs (vexflow renderers, pdfkit
          // standalone with all standard fonts inlined) must keep their own
          // async chunks — bucketing them into a static vendor chunk would
          // pull ~1 MB+ back into the initial load.
          if (/[\\/]node_modules[\\/](vexflow|pdfkit)[\\/]/.test(id)) {
            return undefined;
          }
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
            return "vendor-react";
          }
          return "vendor";
        },
      },
    },
  },
});
