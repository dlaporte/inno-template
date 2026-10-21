// REFERENCE IMPLEMENTATION (TypeScript Worker). Your whole app lives in app/;
// this file is the module the platform deploys. The platform's front door
// decides who reaches the app and tells you who the caller is, in the identity
// headers; never build auth here.
//
// Contract highlights (see CLAUDE.md for the full version):
//   - export default { fetch }                    (standard Worker module)
//   - GET /healthz -> 200, storage-independent    (platform probes it)
//   - identity arrives as spoof-proof request headers (set by the front door)
//   - persistence: env.DATA (your D1) and env.FILES (your R2) bindings
//
// Rendering note: the SAST gate (semgrep OWASP) blocks user data interpolated
// into hand-built HTML, even escaped. Return JSON for dynamic data (as /me
// does below), or render through an auto-escaping template library; keep any
// hand-written HTML fully static.

import { currentUser } from "./identity";

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
<p>Build your app in <code>app/index.ts</code>. Who the front door says you are is
at <a href="/me"><code>/me</code></a>.</p>`;

// The sign-out link (contract R4), added only when currentUser returns a user.
// Both strings are fully static: no caller data ever reaches the HTML.
const SIGN_OUT = `
<footer><a href="/_auth/signout">Sign out</a></footer>`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") return Response.json({ status: "ok" });

    // Identity demo: the front door injects spoof-proof headers. Dynamic data is
    // returned as JSON, never interpolated into HTML (see rendering note).
    if (url.pathname === "/me") {
      const caller = currentUser(request.headers);
      if (!caller) return Response.json({ signedIn: false });
      return Response.json({ signedIn: true, user: caller.email, groups: caller.groups, member: caller.member, subject: caller.subject });
    }

    // Persistence examples, keyed on the caller's identity provider ID:
    //   const caller = currentUser(request.headers);
    //   if (!caller || !caller.subject) return new Response("no signed-in user", { status: 403 });
    //   await env.DATA.prepare("SELECT * FROM notes WHERE owner = ?").bind(caller.subject).all();
    //   await env.FILES.put(`uploads/${caller.subject}/name.txt`, request.body);
    const page = currentUser(request.headers) ? PAGE + SIGN_OUT : PAGE;
    return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  },
};
