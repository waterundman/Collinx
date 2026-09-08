import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    watch: false,
    cache: {
      dir: join(tmpdir(), "collinx-vitest-cache", "ui"),
    },
  },
});
