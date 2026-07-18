import { Hono } from "hono";
import { Container, getContainer } from "@cloudflare/containers";
import { createRemoteJWKSet } from "jose";
import type { Env } from "./env";
import { verifyAccessJwt, ACCESS_JWT_HEADER, type AccessIdentity } from "./access";
import { sanitizeAndInject } from "./identity";
import { handleStorage } from "./storage";

// The @cloudflare/containers runtime routes container calls through an internal
// `ContainerProxy` Durable Object that it looks up via `ctx.exports.ContainerProxy`.
// It only lands on `ctx.exports` if the Worker entrypoint re-exports it — without
// this, container startup fails with "ctx.exports.ContainerProxy is undefined".
export { ContainerProxy } from "@cloudflare/containers";

export class AppContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "10m";
  // NOTE: the installed @cloudflare/containers (0.2.x) exposes `outboundByHost`
  // as a static accessor on Container, not an instance field as the brief's
  // snippet shows — so this is declared `static` to match that API.
  static outboundByHost = { "storage.internal": (req: Request, env: Env) => handleStorage(req, env) };
}

type Deps = {
  jwks: (env: Env) => ReturnType<typeof createRemoteJWKSet>;
  forwardToContainer: (env: Env, req: Request) => Promise<Response>;
};

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export const realDeps: Deps = {
  jwks: (env) => {
    const url = `https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`;
    let j = jwksCache.get(url);
    if (!j) { j = createRemoteJWKSet(new URL(url)); jwksCache.set(url, j); }
    return j;
  },
  forwardToContainer: (env, req) => getContainer(env.APP).fetch(req),
};

function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.get("cookie") ?? "";
  return raw.split(";").map((s) => s.trim()).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);
}

export function makeApp(deps: Deps = realDeps) {
  const app = new Hono<{ Bindings: Env }>();
  app.all("*", async (c) => {
    const env = c.env;
    let identity: AccessIdentity;
    if (env.ENVIRONMENT === "dev") {
      identity = {
        email: c.req.header("X-Mock-User") ?? "dev@davidlaporte.org",
        groups: (c.req.header("X-Mock-Groups") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      };
    } else {
      const token = c.req.header(ACCESS_JWT_HEADER) ?? readCookie(c.req.raw, "CF_Authorization");
      if (!token) return c.text("unauthorized", 401);
      try {
        identity = await verifyAccessJwt(token, { jwks: deps.jwks(env), aud: env.ACCESS_AUD, teamDomain: env.ACCESS_TEAM_DOMAIN });
      } catch {
        return c.text("unauthorized", 401);
      }
    }
    // NOTE: this handler proxies ALL paths (including /_storage/*) to the
    // container via forwardToContainer. handleStorage is never called here —
    // it is wired only as AppContainer's outboundByHost["storage.internal"]
    // handler above, reachable solely by the app's own container in-runtime.
    // Do not add a /_storage route here: that would let the public internet
    // reach handleStorage's arbitrary SQL/R2 access directly.
    const proxied = sanitizeAndInject(c.req.raw, identity);
    return deps.forwardToContainer(env, proxied);
  });
  return app;
}

export default makeApp();
