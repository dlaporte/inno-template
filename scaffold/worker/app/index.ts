// REFERENCE IMPLEMENTATION (TypeScript Worker). Your whole app lives in app/;
// this file is the module the platform deploys. The gateway in front has
// already Access-verified the user — never build auth here.
//
// Contract highlights (see CLAUDE.md for the full version):
//   - export default { fetch }                    (standard Worker module)
//   - GET /healthz -> 200, storage-independent    (platform probes it)
//   - identity arrives as spoof-proof request headers (gateway-injected)
//   - persistence: env.DATA (your D1) and env.FILES (your R2) bindings

interface Env {
  DATA: D1Database;   // the app's own D1 database
  FILES: R2Bucket;    // the app's own R2 bucket
  ENVIRONMENT: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") return Response.json({ status: "ok" });

    const user = request.headers.get("X-Forwarded-User") ?? "unknown";
    // Persistence examples:
    //   await env.DATA.prepare("SELECT * FROM notes WHERE owner = ?").bind(user).all();
    //   await env.FILES.put(`uploads/${user}/name.txt`, request.body);
    return new Response(
      `<!doctype html><meta charset="utf-8"><h1>Hello, ${escapeHtml(user)}</h1>` +
      `<p>This is the worker-type scaffold. Build your app in <code>app/index.ts</code>.</p>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  },
};

// Never interpolate untrusted values into HTML unescaped (the SAST gate
// rejects string-built HTML in most forms; keep escaping at every sink).
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
