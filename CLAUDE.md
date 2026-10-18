# Innovation Platform App Template

This template guides you to build a secure, stateless container app on the Innovation Platform.

## Innovation Platform App

This is a template for a container-based application that runs on the Innovation Platform. The app container is paired with a Cloudflare Workers gateway that handles identity verification, proxies requests to the container, and provides access to shared storage.

- **Gateway**: Runs on Cloudflare Workers; handles JWT verification and request routing. Platform-owned; never edit it.
- **Container**: Runs your application on port 8080, behind the gateway. The gateway decides who reaches the app and tells you who the caller is, in the identity headers.
- **Storage**: The app's own R2 (object storage) and D1 (SQLite database), accessed over HTTP via the storage gateway.

**`app/` and `Dockerfile` are a REFERENCE IMPLEMENTATION**, written in
Python/Starlette: the platform's *tested stack*, which should work for most
implementations. Alternative stacks are equally fine: the platform's contract
is HTTP on port 8080, not a language. Keep the reference app as your starting
point, or replace `app/` and the `Dockerfile` wholesale with Node, Go, Ruby,
or anything else that meets the contract. Fetch the **`get_app_contract`**
MCP tool for the full contract, the deployment patterns, and the current
digest-pinned recommended base images (never hard-code a digest).

Read `app/main.py` to see the reference implementation. The container is built from `Dockerfile` and deployed as a Durable Object.

## Identity (do not build auth)

**Do not build authentication, sessions, or password storage.**

The gateway decides who reaches the app and tells you who the caller is, in the identity headers:

- `X-Forwarded-User`: the caller's email (e.g., `alice@example.com`), empty when the caller has no identity
- `X-Forwarded-Groups`: this app's own groups and nothing else, comma-separated. It carries your app's members group (`get_platform_status` names it under App groups) when the caller is a member, and its open group while the app is open to everyone. It never names the platform admin group or any other app's groups, so a finer in-app role needs your own role store keyed on `X-Forwarded-User`. This narrowing reaches a `container` app with its next deploy on the platform v0.14.3 gateway (one deployed earlier still receives its other groups until then) and applies to an `mcp-container` app already. Admission is decided before the header is written, not from it, and every person an app admits carries at least one of the two. On a `container` app on the platform's gateway from v0.16.5, which it runs from its first deploy after a platform admin adopts it, they come from the platform's answer at each request, held for at most 10 seconds, so a grant, a revoke or a change to open access reaches the header, and the caller's access, within that window; a caller the platform refuses gets a "No access" page and never reaches the app. On an older gateway they come from the caller's Access token, which records the groups the caller held when they signed in, and a change reaches an SSO caller at their next sign-in: until their Access session ends, they keep both the groups they signed in with and the access those groups gave them. On an `mcp-container` app both are decided at each request, from the platform's member list for the app and the app's open flag, so a grant, a revoke or a change to open access reaches the header within the gateway's introspection cache (60 seconds at most).

The gateway also sets `X-Forwarded-Host` (the hostname the request arrived on), `X-Forwarded-Proto` (always `https`) and `X-Forwarded-For` (the client address from Cloudflare's edge, absent when unknown), deletes `Forwarded`, and drops the Cloudflare Access cookies. Every other header, including `X-Real-IP`, `True-Client-IP` and `X-Forwarded-Port`, is whatever the client sent: never use one for identity or an access decision.

Each request's caller is one of three: a member (`X-Forwarded-Groups` includes the app's `-users` group), signed in but not a member (an identity without that group), or anonymous (empty identity headers). The platform decides who reaches the app; the app decides, per request, what each caller may see and do, and never assumes a caller is a member. Per-person data and roles exist only for an identified caller; a caller with no identity gets only what is meant for anyone.

Read the caller in your routes with the `current_user(request)` helper from `storage.py` (`currentUser(headers)` in `lib/storage.js`). It returns `None` (`null` in JavaScript) when the request carries no identity, otherwise the email, the groups and `member`, true when the caller holds the app's members group. Handle no user first, before any per-person read or write: refuse, or answer with what is meant for anyone (contract §3). Never default the absence back into a value (`or ""`, `?.email`, `?? ""`, `"unknown"`): a placeholder bound into `WHERE owner = ?` is one key that every caller with no identity shares.

```python
from starlette.requests import Request
from starlette.responses import JSONResponse
from storage import current_user

async def me(request: Request) -> JSONResponse:
    user = current_user(request)  # {"email": "alice@example.com", "groups": [...], "member": True}, or None
    if user is None:
        return JSONResponse({"signed_in": False})
    return JSONResponse({"signed_in": True, **user})

# then add to your routes list: Route("/me", me)
```

(The reference app uses Starlette. Any framework works the same way: read
the two headers, never build your own login/sessions. One known trap if you
choose FastAPI: older releases pin a CVE-bearing Starlette line that fails
the platform's dependency/image gates; check your lockfile resolves a clean
version before committing to it.)

**Sign out** is one link, no session code. Include it in your layout (footer is fine), targeting the platform-wide Cloudflare Access logout:

```html
<a href="https://{ACCESS_TEAM_DOMAIN}/cdn-cgi/access/logout">Sign out</a>
```

Replace `{ACCESS_TEAM_DOMAIN}` with the team domain emitted by the platform MCP's `get_platform_status` tool ("Sign-out URL"). It also appears in the platform-injected `wrangler.jsonc` at build time (that file is not in this repo), but don't invent or hard-code a domain from anywhere else. It must be the *team* domain: the app-hostname variant (`/cdn-cgi/access/logout` on this app) clears only one app's cookie, which the live global Access session silently re-issues. The team-domain logout ends the Access session for all platform apps; if the user's Okta session is still alive they can sign back in without a prompt; that's expected, not a bug.

In local dev there is no gateway in front of the container (see the README's "Running Locally"), so nothing strips identity headers; mock each of the three callers by passing the headers directly to your app, here against the `/me` route above:

```bash
curl -H 'X-Forwarded-User: alice@example.com' -H 'X-Forwarded-Groups: <members group>' http://localhost:8080/me  # a member
curl -H 'X-Forwarded-User: bob@example.com' -H 'X-Forwarded-Groups: <open group>' http://localhost:8080/me  # signed in, not a member
curl -H 'X-Forwarded-User;' -H 'X-Forwarded-Groups;' http://localhost:8080/me  # no identity: both headers present and empty
```

`<members group>` and `<open group>` are your app's two groups (`get_platform_status` names them under App groups). The third call sends the headers as the gateway does for a caller with no identity: curl's `-H 'Name;'` sends a header with an empty value.

## Persistence (use the storage client)

**Do not persist state to local files or SQLite databases on the container.**

The container disk is ephemeral: writes will be lost when the container restarts. Use the `Storage` client to persist data:

```python
from starlette.responses import PlainTextResponse
from storage import Storage, current_user

storage = Storage()

# In a route that reads or writes the caller's own data, handle no user first
user = current_user(request)
if user is None:
    return PlainTextResponse("no signed-in user", status_code=403)
owner = user["email"]

# Query the database
notes = await storage.query("SELECT * FROM notes WHERE owner = ?", [owner])

# Execute mutations (INSERT, UPDATE, DELETE)
await storage.execute("INSERT INTO notes (owner, body) VALUES (?, ?)", [owner, body])

# Store and retrieve files
await storage.put_file(f"notes/{owner}/draft.txt", body.encode())
content = await storage.get_file(f"notes/{owner}/draft.txt")
```

The storage client communicates with the platform's shared storage via the gateway. `Storage()` defaults its base URL to `http://storage.internal`, which the gateway intercepts (via the container's outbound handler) and routes to the shared R2/D1 backends. **Leave `INNO_STORAGE_BASE` unset in production**: there the default `http://storage.internal` is correct. A local `docker run` has no gateway in front of it, so it has no storage either: storage calls fail there unless you point `INNO_STORAGE_BASE` at a local stand-in that serves the same endpoints. Do not point it at the gateway's public port: that proxies `/_storage` back to the container and loops.

`app/storage.py` is the Python client; `lib/storage.js` (with types in
`lib/storage.d.ts`) is the same client for a JS/TS container app. Any other
stack calls the same HTTP endpoints directly (they are plain JSON/bytes over
HTTP): `POST /_storage/sql/query` and `/_storage/sql/execute`
(`{sql, params}`), `PUT/GET/DELETE /_storage/files/{key}`,
`GET /_storage/files`. The listing call (`list_files()`, or `listFiles()` in
JS) returns the list of keys, which also carries `truncated`: true when the
gateway stopped listing at its cap, so the keys are only part of the bucket;
track keys in D1 rather than walk a bucket that size. Whatever the stack:
durable state lives HERE, never on the container's disk.

### Cross-app data links

If this app's owner has linked another of their own apps' data to it
(`link_app_data`, contract §2.1), a container app reaches the linked D1 via
`storage.query_linked("<source-app>", sql, params)` and
`execute_linked(...)`, which wrap
`POST /_storage/linked/{source-app}/sql/query` and `/execute`. The grant is
full read-write, and the route exists only after the platform templates it in
at deploy time; an app cannot conjure one.

### Connections (per-user credentials for an external backend)

If your app fronts an external backend (ServiceNow, a SaaS API) on behalf of
the signed-in user, never run your own OAuth flow or collect tokens in-app:
the platform brokers a per-user credential (contract §2.2). The gateway
injects an `X-Caller-Assertion` header alongside `X-Forwarded-User`; the app
echoes it, unmodified and never decoded, when fetching the credential:

```python
from storage import Connections, NotConnected

conns = Connections()
try:
    cred = await conns.get("servicenow", request.headers.get("x-caller-assertion"))
    # cred["access_token"] or cred["header"] ({"name": ..., "value": ...});
    # cache in memory only, and only until cred["expires_at"]
except NotConnected as e:
    pass  # relay e.connect_url to the user verbatim; a one-time linking step
```

Connections are configured by the app's owner with the `set_app_connection`
MCP tool (or the panel's Connections tab). Availability today (contract
§2.2): the seam is live for **mcp-container** apps; a `container` (sso) app's
gateway reaches the seam too but carries no caller assertion, so the platform
answers 400 `bad_request` (503 `connections_disabled` on a platform without
its gateway key or its assertion key, which issues no assertion to any app;
a 501 comes only from a gateway deployed from an old config), and
function-shaped apps have no `storage.internal` at all. The helper ships in
both clients now so container apps are ready as availability widens. A
failed seam call raises `ConnectionsError` carrying the HTTP `status` and the
answer's `error` code as `code` (in Python it is also an
`httpx.HTTPStatusError`): contract §2.2 says which codes are the app's to fix and which
mean retry later or a platform admin.
A failed seam call's error message is `connections_error:<status>`, so read the error's `status` and `code` fields.

## Container contract

The container must adhere to these requirements:

1. **Listen on port 8080**: the gateway forwards all traffic to this port.
2. **Serve `/healthz` endpoint.** Return HTTP 200 if healthy, cheap and storage-independent. Two platform checks bind to it (contract R2): CI's smoke gate (the built image must answer within 90s of `docker run`) and the runtime health probe, fired after each green deploy and then every `health.probe_interval_hours` hours (24 by default): failures notify the owner and surface in the panel's Health column.
3. **Run as non-root**: the Dockerfile must create a non-root user and switch to it before running your app. The reference Dockerfile uses `useradd -m appuser && USER appuser`.
4. **Graceful shutdown**: the container will receive SIGTERM; handle it cleanly.

Violating these contracts will cause deployment failures and health check timeouts.

### If your app is the `mcp-container` type

The container contract above applies in full, plus the MCP deltas (contract
§1.3): serve the **Streamable HTTP** MCP transport at `POST /mcp`,
**stateless only**: no session correlation across requests, so
server-initiated MCP features (notifications, sampling, elicitation,
subscriptions) are unavailable. Identity still arrives only as the
`X-Forwarded-*` headers: the gateway is the OAuth boundary and the
`Authorization` header never reaches you, and the sign-out link does not
apply (there is no browser session). Python gotcha: FastMCP silently enables
localhost-only DNS-rebinding protection when its `host` *setting* is left at
the default, rejecting every proxied `/mcp` request with `421 Invalid Host
header`: pass
`transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False)`
to the `FastMCP(...)` constructor.

## What CI enforces

Every push to main and every `v*` release tag runs the platform's gate suite, each with its own job. Items 1 to 8 are gates that fail the build; item 9's reports are advisory unless policy makes one a gate:

1. **No committed secrets** (`gitleaks`): credentials or API keys anywhere in the working tree fail the build. App secrets are provisioned as environment variables through the platform's Variables facility (the app page's Variables tab, or set_app_variable), never committed.
2. **No vulnerable dependencies** (`deps` + `trivy`): pip-audit scans `app/requirements.txt` and npm audit scans `app/package.json`; the Trivy image scan covers everything the container actually ships (OS packages and language packages, any stack), HIGH/CRITICAL severity with a fix available (an unfixed CVE never fails the gate).
3. **Container contract** (`container`): the built image must `EXPOSE 8080`, run as a non-root `USER`, and answer `GET /healthz` with 200 within 90s of `docker run` (the smoke gate). From platform v0.14.4 (APP-CONTRACT R1) the non-root check accepts only a plain uid from 1 to 2147483647, or a portable name (`[A-Za-z0-9._-]`, not starting with `-`) on exactly one clean line of the image's own `/etc/passwd` with a uid in that range; everything else is refused. The image the gates scan on a release tag is the exact image that deploys, pushed by digest; the deploy never rebuilds your Dockerfile.
4. **No platform-owned files in the repo** (`config-integrity`): `wrangler.jsonc` must NOT exist here (nor any other wrangler config or a `.wrangler/` cache dir): the platform injects it at build time from the promoted `gateway.ref` and templates the per-app values. The injected config guarantees `ENVIRONMENT = "production"` (the gateway's mock-identity mode needs a `"dev"` value plus a local-only switch, and the deploy refuses a config that sets either) and the resource limits, platform-owned facts an app repo cannot influence. The same must-not-exist rule covers the repo-root worker build inputs `package.json`/`package-lock.json`/`tsconfig.json` (your app's own build files under `app/` are fine), root `.env*` files, and every package manager's config at the root (`.npmrc`, `.yarnrc`, `.yarnrc.yml`, `.pnpmfile.cjs`, `pnpm-workspace.yaml`, `bunfig.toml`). A `.npmrc` is rejected at any depth, `app/.npmrc` included.
5. **No files under `src/`** (`config-integrity`): the gateway Worker is a platform-pinned build input, not app code, and the platform owns the whole root `src/` directory. Your repo must not contain `src/` at all, not `src/gateway/` and not any file of your own: anything there could shadow the gateway's dependencies or compiler settings, so CI fails a repo that carries it (the message starts "delete src/"). Keep your code under `app/`; an `app/src/` directory is yours.
6. **This file's headers** (`config-integrity`): the five `##` section headers in this CLAUDE.md are required and checked; the body is yours to rewrite, the headers are not.
7. **SAST** (`semgrep`): OWASP-top-ten patterns across the whole repository except the platform-owned root `src/` and semgrep's default-ignored directories (`test/`, `tests/`, `build/`, `dist/`, `vendor/`, `node_modules/`, at any depth), so `app/`, `lib/`, this repo's `Dockerfile`, `.github/workflows/deploy.yml` and any root-level script are all scanned (string-built HTML, raw SQL formatting, a workflow that passes `secrets: inherit`, etc.). The gate does not honor the repo's own suppressions: it deletes every committed `.semgrepignore` before the scan and reports findings on lines marked `# nosemgrep`, so a false positive is ignored centrally by a platform admin.
8. **Dependency release-age cooldown** (off by default): when a platform/app admin sets `safety.min_release_age_days`, an exactly-pinned dependency published more recently than that fails the deploy.
9. **Reports** (`container`, after the smoke test): for a `container` app, an accessibility report (axe-core against the built image, on `/` plus the routes listed in `app/inno-a11y.json`) that also reports the page's response headers; for every container app, `mcp-container` included, a Dockerfile misconfiguration report (`trivy config`). They live in your GitHub Actions run (step summary and annotations) and never fail the build, except the accessibility report while the setting `safety.a11y.mode` is `enforce` for the app (the `get_app_accessibility` MCP tool says what that blocks).

Two more deploy-time checks to know about: a generated repo must not contain
`scaffold/` (a template leftover: CI rejects it once `app/.needs-build` is
gone, and tolerates it while that marker is still present), and deploys are
skipped while `app/.needs-build` exists (delete it when real app code lands).

The full application contract (everything above plus the runtime requirements and deployment patterns) is served by the `get_app_contract` MCP tool. Respect these constraints to ensure your app can be deployed and operated safely.
