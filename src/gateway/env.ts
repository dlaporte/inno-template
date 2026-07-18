import type { AppContainer } from "./index";

export type Env = {
  DB: D1Database; FILES: R2Bucket; APP: DurableObjectNamespace<AppContainer>;
  ACCESS_AUD: string; ACCESS_TEAM_DOMAIN: string; ENVIRONMENT: string;
};
