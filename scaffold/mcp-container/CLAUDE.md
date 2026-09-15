# Innovation Platform App Template (mcp-container type)

This template guides you to build a secure MCP server in a container on the Innovation Platform.

## Innovation Platform App

This is an mcp-container-type application: your app is a container that speaks the
Model Context Protocol (MCP), reached by MCP clients (Claude Code, claude.ai) over
OAuth instead of a browser login. The platform's gateway sits in front as an OAuth
2.1 Resource Server: it verifies the caller's platform-issued bearer token (minted
by the platform's Authorization Server, audience-bound to THIS app) and forwards
the request to your container with spoof-proof identity headers.

- **Gateway**: platform-owned, injected at deploy time; never edit or vendor it.
  It is the OAuth boundary; your container never sees or parses a token.
- **Your container**: built from `Dockerfile`, serving port 8080. The reference
  server is `app/main.py`, a Python FastMCP server answering `POST /mcp`.
- **Storage**: your app's own D1 and R2, reached through `app/storage.py`.

`app/` and `Dockerfile` are a Python REFERENCE IMPLEMENTATION; any stack meeting the
contract works (`get_app_contract` serves it, with current base images).
`app/requirements.txt` caps `mcp` below 2 (mcp 2 renamed the `FastMCP` API used here).

## Identity (do not build auth)

**Do not build authentication, sessions, OAuth, or token parsing.**

The gateway has already verified the caller's OAuth bearer token (the
`Authorization` header never reaches your container) and injects spoof-proof
headers on every forwarded request:

- `X-Forwarded-User`: the user's email (e.g. `alice@example.com`)
- `X-Forwarded-Groups`: comma-separated, and only this app's own groups:
  `inno-<app>-users` for a member, `inno-<app>-open` while the app is open to
  everyone. It never names the admin group or another app's groups. On an open
  app it can be empty for a non-member who was just admitted: treat that as
  "not a member".

In a tool, take `ctx: Context` and call `current_user(ctx.request_context.request)`
from `storage.py`, as `whoami` does. Authorize by user, or by membership versus
open access; a finer role needs your own store keyed on `X-Forwarded-User`. Never
trust what the client claims about itself. No sign-out link (no browser session).

## Persistence (use the storage client)

Container disk and memory are lost on restart or idle sleep: never persist to local
files or SQLite. Use `Storage` from `storage.py`; its default `http://storage.internal`
is routed by the gateway to your D1 and R2 (leave `INNO_STORAGE_BASE` unset):

```python
rows = await Storage().query("SELECT * FROM notes WHERE owner = ?", [email])
```

Create tables at first use (D1 is empty on provision). **Connections** (per-user
backend credentials, contract §2.2, set up by the owner with `set_app_connection`)
are live for this type: pass the inbound `X-Caller-Assertion` through, never decoded.

```python
try:
    cred = await Connections().get("servicenow", ctx.request_context.request.headers.get("x-caller-assertion"))
except ConnectionLocked:  # catch first (a NotConnected subclass): reconnect the MCP client
    ...
except NotConnected as e:  # relay e.connect_url to the user verbatim
    ...
```

## Container contract

- Listen on `0.0.0.0:8080` with `EXPOSE 8080`, and run as a non-root `USER`
  (APP-CONTRACT R1: a plain uid from 1 to 2147483647, or a portable name on one
  clean `/etc/passwd` line with such a uid, as the reference `useradd -m appuser`
  writes). The `Dockerfile` serves `main:app`. Handle SIGTERM cleanly. After a deploy,
  a running instance keeps the old image until it sleeps or you run `restart_app`.
  An idle container sleeps (`container.sleep_after`, default 10 minutes) and wakes
  on the next request, so the first call after idle is slower.
- `GET /healthz` must return 200 without touching storage (R2): CI's smoke gate
  wants it within 90s of `docker run`, and the platform probes it after deploy and daily.
- `POST /mcp` is your MCP endpoint. **Stateless only** (`stateless_http=True`).
  This is a platform requirement, not a preference: there is no session store, so
  **server-initiated** MCP features do not work: no notifications, sampling,
  elicitation, long-lived subscriptions, or SSE resumability. If your app genuinely
  needs those, it does not fit this type today. `app/main.py` answers GET and DELETE
  on `/mcp` with 405: an open GET stream would only hold the container awake.
- Keep `transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False)`
  on `FastMCP(...)`: by default FastMCP accepts only localhost `Host` headers, and
  every request the gateway proxies fails with `421 Invalid Host header`.
- Do not implement or route `/.well-known/oauth-protected-resource` (or its
  path-inserted `.../mcp` variant): the gateway serves that RFC 9728 metadata.
- Register tools with `@mcp.tool()`; the signature is the input schema (see `echo`).
- Do not add: anything under a root `src/`, a root `package.json`,
  `package-lock.json` or `tsconfig.json`, any `wrangler.*` config or `.wrangler/`
  directory, root `.env` files or package manager config, or a `.npmrc` anywhere.
  The platform injects all deploy configuration, and CI rejects shadow copies.

## What CI enforces

Every push to main runs the platform's safety gates (your preflight); tagging a
`v*` release deploys. Gates: gitleaks (secrets), semgrep OWASP (SAST, over the
whole repository except the platform-owned root `src/` and semgrep's
default-ignored directories: `test/`, `tests/`, `build/`, `dist/`, `vendor/`,
`node_modules/`, at any depth; `.semgrepignore` and `# nosemgrep` are not honored),
pip-audit (`app/requirements.txt`), the container gates (`EXPOSE 8080`, non-root
`USER`, `/healthz` smoke test, Trivy HIGH/CRITICAL on the image that deploys),
config-integrity (this file's headers, no shadow configs), and release-age cooldown.
Deploys are skipped while `app/.needs-build` exists: delete it once real code lands.
