// REFERENCE IMPLEMENTATION (TypeScript Worker) for an anonymous function-type
// app. Your whole app lives in app/; this file is the module the platform
// deploys. The platform's front door decides who reaches the app, by its
// audience, and never tells the app who the caller is: this app reads no
// identity and builds no auth.
//
// Contract highlights (see CLAUDE.md for the full version):
//   - export default { fetch }                    (standard Worker module)
//   - GET /healthz -> 200, storage-independent    (platform probes it)
//   - persistence: env.DATA (your D1) and env.FILES (your R2) bindings
//
// Rendering note: the SAST gate (semgrep OWASP) blocks user data interpolated
// into hand-built HTML, even escaped. Return JSON for dynamic data, or render
// through an auto-escaping template library; keep any hand-written HTML fully
// static.

interface Env {
  DATA: D1Database;   // the app's own D1 database
  FILES: R2Bucket;    // the app's own R2 bucket
  ENVIRONMENT: string;
}

const PAGE = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Function scaffold</title>
<h1>Function-type scaffold</h1>
<p>Build your app in <code>app/index.ts</code>. This app is anonymous: it is never
told who is asking, so every request is answered the same way.</p>`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") return Response.json({ status: "ok" });

    // Persistence examples, over what is meant for anyone:
    //   const { results } = await env.DATA.prepare("SELECT slug, title FROM pages WHERE published = 1").all();
    //   await env.FILES.put(`uploads/${crypto.randomUUID()}`, request.body);
    return new Response(PAGE, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  },
};
