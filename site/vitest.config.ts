import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"],
    server: {
      deps: {
        // Mock server-only so it is a no-op in the test environment
        // (it throws in non-Next.js runtimes by design)
        inline: ["server-only"],
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      // server-only is a no-op in tests — it only guards against client bundling
      "server-only": resolve(__dirname, "./src/__tests__/__mocks__/server-only.ts"),
    },
  },
});
