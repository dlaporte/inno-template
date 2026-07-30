// REFERENCE IMPLEMENTATION (TypeScript Worker). Your whole app lives in app/;
// this file is the module the platform deploys. The gateway in front has
// already Access-verified the user — never build auth here.
//
// Contract highlights (see CLAUDE.md for the full version):
//   - export default { fetch }                    (standard Worker module)
//   - GET /healthz -> 200, storage-independent    (platform probes it)
//   - identity arrives as spoof-proof request headers (gateway-injected)
//   - persistence: env.DATA (your D1) and env.FILES (your R2) bindings
//
// Rendering note: the SAST gate (semgrep OWASP) blocks user data interpolated
// into hand-built HTML — even escaped. Return JSON for dynamic data (as /me
// does below), or render through an auto-escaping template library; keep any
// hand-written HTML fully static.

interface Env {
  DATA: D1Database;   // the app's own D1 database
  FILES: R2Bucket;    // the app's own R2 bucket
  ENVIRONMENT: string;
}

const PAGE = `<!doctype html>
<meta charset="utf-8">
<title>Function scaffold</title>
<h1>Function-type scaffold</h1>
<p>Build your app in <code>app/index.ts</code>. Your identity (verified by the
gateway) is at <a href="/me"><code>/me</code></a>.</p>`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") return Response.json({ status: "ok" });

    // Identity demo: the gateway injects spoof-proof headers. Dynamic data is
    // returned as JSON — never interpolated into HTML (see rendering note).
    if (url.pathname === "/me") {
      return Response.json({
        user: request.headers.get("X-Forwarded-User"),
        groups: (request.headers.get("X-Forwarded-Groups") ?? "").split(",").filter(Boolean),
      });
    }

    // Persistence examples:
    //   await env.DATA.prepare("SELECT * FROM notes WHERE owner = ?").bind(user).all();
    //   await env.FILES.put(`uploads/${user}/name.txt`, request.body);
    return new Response(PAGE, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  },
};
