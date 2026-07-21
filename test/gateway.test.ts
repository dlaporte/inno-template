import { env } from "cloudflare:test";
import { SignJWT, generateKeyPair, createLocalJWKSet, exportJWK } from "jose";
import { makeApp } from "../src/gateway/index";

const TEAM = "davidlaporte.cloudflareaccess.com";
let jwks: any, privateKey: CryptoKey;
beforeAll(async () => {
  const kp = await generateKeyPair("RS256"); privateKey = kp.privateKey as CryptoKey;
  const jwk = await exportJWK(kp.publicKey); jwk.kid = "k1"; jwk.alg = "RS256";
  jwks = createLocalJWKSet({ keys: [jwk] });
});
async function jwt(claims: Record<string, unknown>, aud = "test-aud") {
  return new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(`https://${TEAM}`).setAudience(aud).setIssuedAt().setExpirationTime("1h").sign(privateKey);
}
// fake container echoes the identity headers it received
const deps = { jwks: () => jwks, forwardToContainer: async (_e: any, req: Request) =>
  new Response(JSON.stringify({ user: req.headers.get("X-Forwarded-User"), groups: req.headers.get("X-Forwarded-Groups"), path: new URL(req.url).pathname }), { status: 200 }) };
const prodEnv = { ...env, ENVIRONMENT: "production", ACCESS_AUD: "test-aud", ACCESS_TEAM_DOMAIN: TEAM };

it("rejects missing JWT in production", async () => {
  const res = await makeApp(deps as any).fetch(new Request("https://x/page"), prodEnv);
  expect(res.status).toBe(401);
});

it("passes verified identity to the container, stripping spoofed headers", async () => {
  const token = await jwt({ email: "real@x.org", groups: ["inno-demo-users", "nope"] });
  const res = await makeApp(deps as any).fetch(
    new Request("https://x/page", { headers: { "cf-access-jwt-assertion": token, "X-Forwarded-User": "attacker@evil.com" } }), prodEnv);
  const body = await res.json() as any;
  expect(body.user).toBe("real@x.org");
  expect(body.groups).toBe("inno-demo-users");
});

it("dev mode synthesizes mock identity without a JWT", async () => {
  const devEnv = { ...prodEnv, ENVIRONMENT: "dev" };
  const res = await makeApp(deps as any).fetch(
    new Request("https://x/page", { headers: { "X-Mock-User": "tester@x.org", "X-Mock-Groups": "inno-demo-users" } }), devEnv);
  expect((await res.json() as any).user).toBe("tester@x.org");
});

// Service-token JWTs (no email; common_name = the token's client id) are the
// platform health probe's credential. Accepted for GET /healthz ONLY — any
// other path/method stays a hard 401.
it("accepts a service-token JWT for GET /healthz only", async () => {
  const svc = await jwt({ common_name: "probe-client-id.access" });
  // /healthz: allowed through, with EMPTY identity headers.
  const ok = await makeApp(deps as any).fetch(
    new Request("https://x/healthz", { headers: { "cf-access-jwt-assertion": svc } }), prodEnv);
  expect(ok.status).toBe(200);
  const body = await ok.json() as any;
  expect(body.path).toBe("/healthz");
  expect(body.user).toBe("");
  // Any other path: rejected.
  expect((await makeApp(deps as any).fetch(
    new Request("https://x/page", { headers: { "cf-access-jwt-assertion": svc } }), prodEnv)).status).toBe(401);
  // Non-GET /healthz: rejected.
  expect((await makeApp(deps as any).fetch(
    new Request("https://x/healthz", { method: "POST", headers: { "cf-access-jwt-assertion": svc } }), prodEnv)).status).toBe(401);
  // A REAL user's JWT still reaches /healthz like any path.
  const user = await jwt({ email: "real@x.org", groups: ["inno-demo-users"] });
  const asUser = await makeApp(deps as any).fetch(
    new Request("https://x/healthz", { headers: { "cf-access-jwt-assertion": user } }), prodEnv);
  expect(((await asUser.json()) as any).user).toBe("real@x.org");
});

// CRITICAL INVARIANT: the public fetch handler must never route /_storage/* to
// handleStorage directly. handleStorage is reachable ONLY as the container's
// outboundByHost["storage.internal"] handler, never from the public internet.
// A public request — even one carrying a valid Access JWT — must be proxied to
// the container like any other path, not answered by the storage handler.
it("does not route public /_storage requests to the storage handler directly", async () => {
  const token = await jwt({ email: "real@x.org", groups: ["inno-demo-users"] });
  const res = await makeApp(deps as any).fetch(
    new Request("https://x/_storage/sql/query", {
      method: "POST",
      headers: { "cf-access-jwt-assertion": token, "content-type": "application/json" },
      body: JSON.stringify({ sql: "SELECT 1" }),
    }),
    prodEnv,
  );
  expect(res.status).toBe(200);
  const body = await res.json() as any;
  // The fake container marker proves the request reached forwardToContainer,
  // not handleStorage (which would have returned a D1 { results: [...] } shape).
  expect(body.path).toBe("/_storage/sql/query");
  expect(body.user).toBe("real@x.org");
  expect(body.results).toBeUndefined();
});
