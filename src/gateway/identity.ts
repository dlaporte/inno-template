import type { AccessIdentity } from "./access";

const STRIP = ["x-forwarded-user", "x-forwarded-groups", "x-forwarded-email"];

export function sanitizeAndInject(req: Request, identity: AccessIdentity): Request {
  const headers = new Headers(req.headers);
  for (const h of STRIP) headers.delete(h);
  headers.set("X-Forwarded-User", identity.email);
  headers.set("X-Forwarded-Email", identity.email);
  headers.set("X-Forwarded-Groups", identity.groups.join(","));
  return new Request(req, { headers });
}
