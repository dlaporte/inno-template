import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    globals: true,
    exclude: ["test/**/*.node.test.ts", "node_modules"],
    poolOptions: { workers: { wrangler: { configPath: "./wrangler.jsonc" } } },
  },
});
