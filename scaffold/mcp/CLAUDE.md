# Innovation Platform App Template (mcp type)

This template guides you to build a secure MCP server on the Innovation Platform.

## Innovation Platform App

This is an mcp-type application: your app is a Cloudflare Worker that speaks the
Model Context Protocol (MCP), reached by MCP clients (Claude Code, claude.ai) over
OAuth instead of a browser login. The platform's gateway sits in front as an OAuth
2.1 Resource Server: it verifies the caller's platform-issued bearer token (minted
by the platform's Authorization Server, audience-bound to THIS app) and forwards
the request to your Worker with spoof-proof identity headers. There is no container
and no Dockerfile — CI skips the image gates for mcp-type apps.

- **Gateway**: platform-owned, injected at deploy time — never edit or vendor it.
  It is the OAuth boundary; your Worker never sees or parses a token.
- **Your Worker**: `app/index.ts`, a standard Worker module (`export default { fetch }`)
  serving `POST /mcp`. Deployed with `workers_dev: false` and no route — only the
  gateway can reach it.
- **Storage**: your app's own D1 and R2 arrive as bindings (`env.DATA`, `env.FILES`).

Your code and its dependencies live entirely under `app/`. MCP servers need npm
packages, so this scaffold ships an `app/package.json` (the MCP SDK + zod); add
more there. A ROOT package.json is rejected by CI — the platform injects the root
build inputs.

## Identity (do not build auth)

**Do not build authentication, sessions, OAuth, or token parsing.**

The gateway has already verified the caller's OAuth bearer token and injects
spoof-proof headers on every forwarded request:

- `X-Forwarded-User`: the user's email (e.g. `alice@example.com`)
- `X-Forwarded-Groups`: comma-separated group list

```ts
const user = request.headers.get("X-Forwarded-User");
```

Close these over your MCP server (as `app/index.ts` does) so tools can authorize
by user or group. Never trust anything the client claims about its own identity.

## Persistence (use your bindings)

Mcp-type apps use their provisioned storage directly as bindings — not the
container path's `http://storage.internal` client:

- `env.DATA` — your D1 (SQLite) database: `await env.DATA.prepare("SELECT ...").bind(x).all()`
- `env.FILES` — your R2 bucket: `await env.FILES.put(key, body)` / `await env.FILES.get(key)`

Create tables at first use (D1 is empty on provision). Keep `/healthz` storage-independent.

## Worker contract

- `app/index.ts` exports a standard Worker module: `export default { fetch(request, env, ctx) }`.
- `POST /mcp` is your MCP endpoint. This scaffold uses a STATELESS Streamable-HTTP
  server (a fresh transport + `McpServer` per request, no `sessionIdGenerator`) —
  the right default on Workers and compatible with every MCP client.
- `GET /healthz` must return 200 without touching storage — the platform probes it
  after deploy and on schedule.
- Register tools with `server.registerTool(name, { title, description, inputSchema }, handler)`;
  declare tool inputs as a zod raw shape (see `echo` in `app/index.ts`). Return
  results as MCP content (`{ content: [{ type: "text", text }] }`) — not HTML.
- Do not add: a root `package.json`, any `wrangler.*` config, `.env` files, or
  `src/gateway/` — the platform injects all deploy configuration from the promoted
  gateway ref, and CI rejects shadow copies.

## What CI enforces

Every push to main runs the platform's safety gates (your preflight); tagging a
`v*` release deploys. Gates: gitleaks (secrets), semgrep OWASP (SAST, on `app/`),
dependency audits (`app/package.json`), config-integrity (this file's headers, no
shadow configs), and release-age cooldown. Mcp-type apps skip the Docker
build/Trivy/healthz-smoke image gates — there is no image.
