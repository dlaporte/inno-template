# Innovation Platform App Template (mcp-function type)

This template guides you to build a secure MCP server on the Innovation Platform.

## Innovation Platform App

This is an mcp-function-type application: your app is a Cloudflare Worker that speaks the
Model Context Protocol (MCP), reached by MCP clients (Claude Code, claude.ai) over
OAuth instead of a browser login. The platform's gateway sits in front as an OAuth
2.1 Resource Server: it verifies the caller's platform-issued bearer token (minted
by the platform's Authorization Server, audience-bound to THIS app) and forwards
the request to your Worker with spoof-proof identity headers. There is no container
and no Dockerfile; CI skips the image gates for mcp-function-type apps.

- **Gateway**: platform-owned, injected at deploy time; never edit or vendor it.
  It is the OAuth boundary; your Worker never sees or parses a token.
- **Your Worker**: `app/index.ts`, a standard Worker module (`export default { fetch }`)
  serving `POST /mcp`. Deployed with `workers_dev: false` and no route; only the
  gateway can reach it.
- **Storage**: your app's own D1 and R2 arrive as bindings (`env.DATA`, `env.FILES`).

Your code and its dependencies live entirely under `app/`. MCP servers need npm
packages, so this scaffold ships an `app/package.json` (the MCP SDK + zod) AND an
`app/package-lock.json`. Add packages with `npm install <pkg>` inside `app/` and
commit both files together: CI's `app-deps` job installs from the lockfile with
`npm ci --ignore-scripts --omit=dev` on every push to your default branch, so a
missing or stale lockfile fails the push, not only the release. The lockfile is
also what lets the release-age gate date your dependencies. Declare every package
your Worker imports at runtime under `dependencies`: `devDependencies` are neither
installed nor audited, and nothing is installed at the repo root. A ROOT
package.json is rejected by CI; the platform injects the root build inputs.

## Identity (do not build auth)

**Do not build authentication, sessions, OAuth, or token parsing.**

The gateway decides who reaches the app and tells you who the caller is, in the
identity headers. It checks the caller's OAuth bearer token and sets these
spoof-proof headers on every forwarded request:

- `X-Forwarded-User`: the caller's email (e.g. `alice@example.com`), empty when
  the caller has no identity
- `X-Forwarded-Groups`: comma-separated, and only this app's own groups:
  your app's members group (`get_platform_status` names it under App
  groups) for a member, its open group while the app is open to
  everyone. It never names the admin group or another app's groups, and that
  holds for every MCP app already, whatever gateway it last deployed on.
  Admission is decided before the header is written, not from it, and every
  person an app admits carries at least one of the two. Both are decided at
  each request, from the platform's member list for the app and the app's
  open flag, so a grant, a revoke or a change to open access reaches the
  header within the gateway's introspection cache (60 seconds at most).

Each request's caller is one of three: a member (`X-Forwarded-Groups` includes the app's `-users` group), signed in but not a member (an identity without that group), or anonymous (empty identity headers). The platform decides who reaches the app; the app decides, per request, what each caller may see and do, and never assumes a caller is a member. Per-person data and roles exist only for an identified caller; a caller with no identity gets only what is meant for anyone.

Read the caller with the helper in `app/identity.ts`:

```ts
import { currentUser } from "./identity";

const caller = currentUser(request.headers); // { email, groups, member }, or null with no identity
```

Close `caller` over your MCP server (as `app/index.ts` does) so each tool decides
what that caller may do. A tool handles no user first, before any per-user read
or write: refuse, or answer with what is meant for anyone (contract §3), and
never default the absence back into a value (`?.email`, `?? ""`, `"unknown"`).
Then authorize by user (`caller.email`, never an id the model supplied), or by
membership versus open access (`caller.member`); a finer role needs your own
store keyed on `X-Forwarded-User`. Never trust anything the client claims about
its own identity. Refuse inside MCP, never with an HTTP status (contract §1.2, a
MUST): return a tool result marked `isError: true` (or a JSON-RPC error), as
this tool handler does:

```ts
// in a tool handler inside buildServer, over the caller's own notes
if (!caller) return { content: [{ type: "text", text: "no signed-in user" }], isError: true };
const { results } = await env.DATA.prepare("SELECT * FROM notes WHERE owner = ?").bind(caller.email).all();
```

## Persistence (use your bindings)

Mcp-function-type apps use their provisioned storage directly as bindings, not the
container path's `http://storage.internal` client:

- `env.DATA`: your D1 (SQLite) database, e.g. `await env.DATA.prepare("SELECT ...").bind(x).all()`
- `env.FILES`: your R2 bucket: `await env.FILES.put(key, body)` / `await env.FILES.get(key)`

Create tables at first use (D1 is empty on provision). Keep `/healthz` storage-independent.

Connections (per-user backend credentials, contract §2.2) are not available to
this type: an mcp-function app has no `storage.internal`, so it cannot reach the
Connections seam. An MCP server that needs them must be the mcp-container type.

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
  path-inserted `…/mcp` variant); the platform's gateway serves both, and they
  are part of the OAuth boundary you must not touch.
- Register tools with `server.registerTool(name, { title, description, inputSchema }, handler)`;
  declare tool inputs as a zod raw shape (see `echo` in `app/index.ts`). Return
  results as MCP content (`{ content: [{ type: "text", text }] }`), not HTML.
- Do not add: anything under a root `src/` (the platform owns that directory), a
  root `package.json`, `package-lock.json` or `tsconfig.json`, any `wrangler.*`
  config or `.wrangler/` directory, root `.env` files, root package manager config
  (`.yarnrc`, `.yarnrc.yml`, `.pnpmfile.cjs`, `pnpm-workspace.yaml`,
  `bunfig.toml`), or a `.npmrc` anywhere, `app/.npmrc` included. The platform
  injects all deploy configuration from the promoted gateway ref, and CI rejects
  shadow copies.

## What CI enforces

Every push to main runs the platform's safety gates (your preflight); tagging a
`v*` release deploys. Gates: gitleaks (secrets), semgrep OWASP (SAST, over the
whole repository except the platform-owned root `src/` and semgrep's
default-ignored directories: `test/`, `tests/`, `build/`, `dist/`, `vendor/`,
`node_modules/`, at any depth), dependency audits
(`app/package.json`), config-integrity (this file's headers, no shadow configs),
and release-age cooldown. Mcp-function-type apps skip the Docker
build/Trivy/healthz-smoke image gates (there is no image).
