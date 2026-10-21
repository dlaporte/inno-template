# Innovation Platform App Template (mcp-function type, anonymous)

This template guides you to build a secure MCP server on the Innovation Platform that is never told who its callers are.

## Innovation Platform App

This is an mcp-function-type application: your app is a Cloudflare Worker that speaks the
Model Context Protocol (MCP), reached by MCP clients (Claude Code, claude.ai). The
platform's front door sits in front. While the app is members-only or internal, it is
an OAuth 2.1 Resource Server: it verifies the caller's platform-issued bearer token
(minted by the platform's Authorization Server, audience-bound to THIS app). Once the
app is public, it asks for no token. Either way it forwards the request to your
Worker with the identity headers empty: this app is anonymous. There is no container
and no Dockerfile; CI skips the image gates for mcp-function-type apps.

- **Front door**: platform-owned and never part of this repo.
  It is the OAuth boundary; your Worker never sees or parses a token.
- **Your Worker**: `app/index.ts`, a standard Worker module (`export default { fetch }`)
  serving `POST /mcp`. Deployed with no public address of its own; only the
  front door can reach it.
- **Storage**: your app's own D1 and R2 arrive as bindings (`env.DATA`, `env.FILES`).

Your code and its dependencies live entirely under `app/`. MCP servers need npm
packages, so this scaffold ships an `app/package.json` (the MCP SDK + zod) AND an
`app/package-lock.json`. Add packages with `npm install <pkg>` inside `app/` and
commit both files together: CI's `app-build` job installs from the lockfile with
`npm ci --ignore-scripts --omit=dev` and bundles your Worker on every push to your
default branch, so a missing or stale lockfile fails the push, not only the release. The lockfile is
also what lets the release-age gate date your dependencies. Declare every package
your Worker imports at runtime under `dependencies`: `devDependencies` are neither
installed nor audited, and nothing is installed at the repo root. A ROOT
package.json is rejected by CI; the platform injects the root build inputs.

## Identity (do not build auth)

**Do not build authentication, sessions, OAuth, or token parsing.**

This app is anonymous, which was fixed when it was registered: an app that needs to
know who its callers are is a different, identity-aware app. The front door decides
who reaches the app, by its audience (members-only, internal or public), and never
tells the app who the caller is, at any audience: the four identity headers
(`X-Forwarded-User`, `X-Forwarded-Email`, `X-Forwarded-Groups` and
`X-Forwarded-Subject`) arrive present and empty on every request, and no
`X-Caller-Assertion` arrives. Write no code that reads them, and put no sign-out
link in the app (an MCP server has no browser session anyway). The reference
`app/index.ts` reads none of them and has no `whoami` tool, and the scaffold commit
removes the identity helper (`app/identity.ts`) the identity-aware MCP scaffold
carries. Never trust anything the client claims
about its own identity. A tool that refuses (bad input, a limit reached) refuses
inside MCP, never with an HTTP status (contract §1.2, a MUST): return a tool result
marked `isError: true` (or a JSON-RPC error).

The contract's rule for an anonymous app, R10: No accounts, no per-person views, no
keys or limits taken from a person. What a visitor submits is stored and never
rendered. Per-visitor state (a cart, a multi-step form, a vote already cast) lives
in the app's own cookie or under a random cookie key, is never an identity, and
follows APP-SECURITY's forged-request rules. The app may be public.

**Cookies.** Every cookie the app sets, its per-visitor state among them, carries
the `__Host-` prefix (so `Secure`, `Path=/` and no `Domain`) and is `HttpOnly`
unless the app's own script must read it: every app shares one site, and a page on
another app's host can shadow any other cookie. Accept a state change only from the
app's own pages (APP-SECURITY §12).

**What the platform still knows.** While the app is members-only or internal, the
platform still knows who signed in to reach it (its admins and its audit log do),
though the owner's panel shows sign-in counts, not people; once the app is public,
nobody signs in to reach it. **Where the promise ends:** the platform does not tell
the app who the caller is, and it does not make visits unlinkable against an owner
who tries. The app still sees each caller's address (`X-Forwarded-For` and
`CF-Connecting-IP`) and the timing of each request, small counts can single a
person out, and an identity-aware app of the same owner on the site can link a
visit to a person.

## Persistence (use your bindings)

Mcp-function-type apps use their provisioned storage directly as bindings, not the
container path's `http://storage.internal` client:

- `env.DATA`: your D1 (SQLite) database, e.g. `await env.DATA.prepare("SELECT ...").bind(x).all()`
- `env.FILES`: your R2 bucket: `await env.FILES.put(key, body)` / `await env.FILES.get(key)`

Create tables at first use (D1 is empty on provision). Keep `/healthz` storage-independent.

A source app linked to this one (`link_app_data`, contract §2.1) arrives as two more
bindings at this app's next deploy: `env.LINKED_<SOURCE>` (its D1) and
`env.LINK_FILES_<SOURCE>` (its R2 bucket), `<SOURCE>` being its name upper-cased
with each `-` as `_`. The grant is read-write, over the source's database and every
one of its files.

**Files someone uploaded.** If the Worker hands a stored file to a browser, it
serves it only as a download, with three headers:
`Content-Disposition: attachment; filename="<name>"`, every character of the name
outside `[A-Za-z0-9._-]` replaced by `_`, then `X-Content-Type-Options: nosniff`
and `Content-Security-Policy: sandbox`. The rule holds from any host (APP-SECURITY §3),
this one included: for a visitor's submission, for a file an editor app put here
(a visitor's upload republished by an editor among them), and for every file read
from `env.LINK_FILES_<SOURCE>`. Every app shares one site, so an uploaded HTML or
SVG file shown inline could run script beside every other app.

An anonymous app has no Connections (per-user backend credentials, contract §2.2):
there is no user to hold one, and `set_app_connection` refuses an anonymous app
with `app_anonymous`. (An mcp-function app could not reach the Connections seam
anyway: it has no `storage.internal`.)

## Function contract

- `app/index.ts` exports a standard Worker module: `export default { fetch(request, env, ctx) }`.
- `POST /mcp` is your MCP endpoint. **Stateless only**: construct the transport
  WITHOUT a `sessionIdGenerator` (a fresh transport + `McpServer` per request, as
  the scaffold does). This is a platform requirement, not a preference: there is
  no session store, so **server-initiated** MCP features do not work: no
  notifications, sampling, elicitation, long-lived subscriptions, or SSE
  resumability. If your app genuinely needs those, it does not fit this type
  today. Non-POST methods on `/mcp` get a 405 (a stateless server has nothing to
  stream on GET and no session for DELETE to end).
- `GET /healthz` must return 200 without touching storage; the platform probes it
  after deploy and on schedule.
- Do not implement or route `/.well-known/oauth-protected-resource` (or its
  path-inserted `…/mcp` variant); the platform's front door answers both (a `404`
  once the app is public), and they are part of the OAuth boundary you must not
  touch.
- Register tools with `server.registerTool(name, { title, description, inputSchema }, handler)`;
  declare tool inputs as a zod raw shape (see `echo` in `app/index.ts`). Return
  results as MCP content (`{ content: [{ type: "text", text }] }`), not HTML.
- Do not add: anything under a root `src/` (the platform owns that directory), a
  root `package.json`, `package-lock.json` or `tsconfig.json`, any `wrangler.*`
  config or `.wrangler/` directory, root `.env` files, root package manager config
  (`.yarnrc`, `.yarnrc.yml`, `.pnpmfile.cjs`, `pnpm-workspace.yaml`,
  `bunfig.toml`), or a `.npmrc` anywhere, `app/.npmrc` included. The platform
  injects all deploy configuration, and CI rejects shadow copies.

## What CI enforces

Every push to the default branch runs the platform's safety gates (your preflight); tagging a
`v*` release deploys. Gates: gitleaks (secrets), semgrep OWASP (SAST, over the
whole repository except the platform-owned root `src/` and semgrep's
default-ignored directories: `test/`, `tests/`, `build/`, `dist/`, `vendor/`,
`node_modules/`, at any depth), dependency audits
(`app/package.json`), config-integrity (this file's headers, no shadow configs),
and release-age cooldown. Mcp-function-type apps skip the Docker
build/Trivy/healthz-smoke image gates (there is no image).
