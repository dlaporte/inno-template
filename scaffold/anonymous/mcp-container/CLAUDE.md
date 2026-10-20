# Innovation Platform App Template (mcp-container type, anonymous)

This template guides you to build a secure MCP server in a container on the Innovation Platform that is never told who its callers are.

## Innovation Platform App

This is an mcp-container-type application: your app is a container that speaks the
Model Context Protocol (MCP), reached by MCP clients (Claude Code, claude.ai). The
platform's front door sits in front. While the app is members-only or internal, it is
an OAuth 2.1 Resource Server: it verifies the caller's platform-issued bearer token
(minted by the platform's Authorization Server, audience-bound to THIS app). Once the
app is public, it asks for no token. Either way it forwards the request to your
container with the identity headers empty: this app is anonymous.

- **Front door**: platform-owned and never part of this repo.
  It is the OAuth boundary; your container never sees or parses a token.
- **Host**: platform-owned and never part of this repo; it runs your container
  and serves its storage.
- **Your container**: built from `Dockerfile`, serving port 8080. The reference
  server is `app/main.py`, a Python FastMCP server answering `POST /mcp`.
- **Storage**: your app's own D1 and R2, reached through `app/storage.py`.

`app/` and `Dockerfile` are a Python REFERENCE IMPLEMENTATION; any stack meeting the
contract works (`get_app_contract` serves it, with current base images).
`app/requirements.txt` caps `mcp` below 2 (mcp 2 renamed the `FastMCP` API used here).

## Identity (do not build auth)

**Do not build authentication, sessions, OAuth, or token parsing.**

This app is anonymous, which was fixed when it was registered: an app that needs to
know who its callers are is a different, identity-aware app. The front door decides
who reaches the app, by its audience (members-only, internal or public), and never
tells the app who the caller is, at any audience: the four identity headers
(`X-Forwarded-User`, `X-Forwarded-Email`, `X-Forwarded-Groups` and
`X-Forwarded-Subject`) arrive present and empty on every request, the
`Authorization` header never reaches your container, and no `X-Caller-Assertion`
arrives. Write no code that reads them, and put no sign-out link in the app (an MCP
server has no browser session anyway). The reference `app/main.py` came from the
identity-aware scaffold, and its `current_user` call answers no user on every
request here: remove it, and the `whoami` tool that reports it, as you build. Never
trust what the client claims about itself. A tool that refuses (bad input, a limit
reached) refuses inside MCP, never with an HTTP status (contract §1.3, a MUST):
raise from the tool, and FastMCP answers with a tool result marked as an error, as
the example below does.

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

## Persistence (use the storage client)

Container disk and memory are lost on restart or idle sleep: never persist to local
files or SQLite. Use `Storage` from `storage.py`; its default `http://storage.internal`
is routed by the platform's host to your D1 and R2 (leave `INNO_STORAGE_BASE` unset):

```python
from mcp.server.fastmcp.exceptions import ToolError

# in a tool: what is published, meant for anyone
rows = await Storage().query("SELECT slug, title, body FROM pages WHERE published = 1")
if not rows:
    raise ToolError("nothing published yet")  # a tool result marked as an error, never an HTTP status
```

Create tables at first use (D1 is empty on provision). `Storage().list_files()`
returns the list of keys with a `truncated` attribute, true when the platform
stopped listing at its cap. A source app linked to this one (`link_app_data`,
contract §2.1) is reached with `query_linked` and `execute_linked` for its
database, and `put_linked_file`, `get_linked_file`, `list_linked_files` and
`delete_linked_file` for its files: the grant is read-write, over the source's
database and every one of its files.

**Files someone uploaded.** If the server hands a stored file to a browser, it
serves it only as a download, with the headers `file_download_headers(filename)`
returns (`fileDownloadHeaders(filename)` in JS): `Content-Disposition: attachment`,
`X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox`. The rule
holds from any host (APP-SECURITY §3), this one included: for a visitor's
submission, for a file an editor app put here (a visitor's upload republished by an
editor among them), and for every file read from a linked source with
`get_linked_file`. Every app shares one site, so an uploaded HTML or SVG file shown
inline could run script beside every other app.

An anonymous app has no Connections (per-user backend credentials, contract §2.2):
there is no user to hold one, so `set_app_connection` refuses an anonymous app with
`app_anonymous`, and the front door sends it no `X-Caller-Assertion` to pass on.

## Container contract

- Listen on `0.0.0.0:8080` with `EXPOSE 8080`, and run as a non-root `USER`
  (APP-CONTRACT R1: a plain uid from 1 to 2147483647, or a portable name on one
  clean `/etc/passwd` line with such a uid, as the reference `useradd -m appuser`
  writes). The `Dockerfile` serves `main:app`. Handle SIGTERM cleanly. Any change
  to the app's code, its values or the platform's host starts a new container
  instance on the next request. An idle container sleeps (`container.sleep_after`, default 10 minutes) and wakes
  on the next request, so the first call after idle is slower.
- `GET /healthz` must return 200 without touching storage (R2): CI's smoke gate
  wants it within 90s of `docker run`, and the platform probes it after each green
  deploy and then every `health.probe_interval_hours` hours (24 by default).
- `POST /mcp` is your MCP endpoint. **Stateless only** (`stateless_http=True`).
  This is a platform requirement, not a preference: there is no session store, so
  **server-initiated** MCP features do not work: no notifications, sampling,
  elicitation, long-lived subscriptions, or SSE resumability. If your app genuinely
  needs those, it does not fit this type today. `app/main.py` answers GET and DELETE
  on `/mcp` with 405: an open GET stream would only hold the container awake.
- Keep `transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False)`
  on `FastMCP(...)`: by default FastMCP accepts only localhost `Host` headers, and
  every proxied request fails with `421 Invalid Host header`.
- Do not implement or route `/.well-known/oauth-protected-resource` (or its
  path-inserted `.../mcp` variant): the front door answers both (with that RFC
  9728 metadata, or a `404` once the app is public).
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
`USER`, `/healthz` smoke test, Trivy HIGH/CRITICAL with a fix available on the
image that deploys), config-integrity (this file's headers, no shadow configs), and
release-age cooldown. The container job also writes an advisory Dockerfile
misconfiguration report (`trivy config`) to the Actions run; it never fails the build.
Deploys are skipped while `app/.needs-build` exists: delete it once real code lands.
