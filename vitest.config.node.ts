import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["test/**/*.node.test.ts"],
    environment: "node",
  },
});
