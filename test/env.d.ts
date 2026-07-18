import type { Env } from "../src/gateway/env";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}
