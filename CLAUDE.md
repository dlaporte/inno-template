# Innovation Platform App Template

This template guides you to build a secure, stateless container app on the Innovation Platform.

## Innovation Platform App

This is a template for a container-based application that runs on the Innovation Platform. The app container is paired with a Cloudflare Workers gateway that handles identity verification, proxies requests to the container, and provides access to shared storage.

- **Gateway**: Runs on Cloudflare Workers; handles JWT verification and request routing. Platform-owned — never edit it.
- **Container**: Runs your application on port 8080; receives authenticated requests from the gateway.
- **Storage**: The app's own R2 (object storage) and D1 (SQLite database), accessed over HTTP via the storage gateway.

**`app/` and `Dockerfile` are a REFERENCE IMPLEMENTATION**, written in
Python/Starlette — the platform's *tested stack*, which should work for most
implementations. Alternative stacks are equally fine: the platform's contract
is HTTP on port 8080, not a language. Keep the reference app as your starting
point, or replace `app/` and the `Dockerfile` wholesale with Node, Go, Ruby,
or anything else that meets the contract. Fetch the **`get_app_contract`**
MCP tool for the full contract, the deployment patterns, and the current
digest-pinned recommended base images (never hard-code a digest).

Read `app/main.py` to see the reference implementation. The container is built from `Dockerfile` and deployed as a Durable Object.

## Identity (do not build auth)

**Do not build authentication, sessions, or password storage.**

The gateway has already verified the user. The container receives authenticated requests with the user's identity in headers:

- `X-Forwarded-User`: User's email (e.g., `alice@example.com`)
- `X-Forwarded-Groups`: Comma-separated group list (e.g., `inno-app-name-users,other-group`)

Extract identity in your routes using the `current_user(request)` helper from `storage.py`:

```python
from starlette.requests import Request
from starlette.responses import JSONResponse
from storage import current_user

async def me(request: Request) -> JSONResponse:
    user = current_user(request)  # {"email": "alice@example.com", "groups": [...]}
    return JSONResponse(user)

# then add to your routes list: Route("/me", me)
```

(The reference app uses Starlette. Any framework works the same way — read
the two headers, never build your own login/sessions. One known trap if you
choose FastAPI: older releases pin a CVE-bearing Starlette line that fails
the platform's dependency/image gates — check your lockfile resolves a clean
version before committing to it.)

**Sign out** is one link — no session code. Include it in your layout (footer is fine), targeting the platform-wide Cloudflare Access logout:

```html
<a href="https://{ACCESS_TEAM_DOMAIN}/cdn-cgi/access/logout">Sign out</a>
```

Replace `{ACCESS_TEAM_DOMAIN}` with the team domain emitted by the platform MCP's `get_platform_status` tool ("Sign-out URL"). It also appears in the platform-injected `wrangler.jsonc` at build time — that file is not in this repo — but don't invent or hard-code a domain from anywhere else. It must be the *team* domain: the app-hostname variant (`/cdn-cgi/access/logout` on this app) clears only one app's cookie, which the live global Access session silently re-issues. The team-domain logout ends the Access session for all platform apps; if the user's Okta session is still alive they can sign back in without a prompt — that's expected, not a bug.

In local dev there is no gateway in front of the container (see the README's "Running Locally"), so nothing strips identity headers — mock a user by passing them directly to your app:
- Pass `-H 'X-Forwarded-User: alice@example.com'` to set the user.
- Pass `-H 'X-Forwarded-Groups: inno-<app>-users'` to set groups.

## Persistence (use the storage client)

**Do not persist state to local files or SQLite databases on the container.**

The container disk is ephemeral — writes will be lost when the container restarts. Use the `Storage` client to persist data:

```python
from storage import Storage

storage = Storage()

# Query the database
results = await storage.query("SELECT * FROM users WHERE email = ?", [email])

# Execute mutations (INSERT, UPDATE, DELETE)
await storage.execute("INSERT INTO users (email, name) VALUES (?, ?)", [email, name])

# Store and retrieve files
await storage.put_file("profile/alice.json", b'{"name": "Alice"}')
content = await storage.get_file("profile/alice.json")
```

The storage client communicates with the platform's shared storage via the gateway. `Storage()` defaults its base URL to `http://storage.internal`, which the gateway intercepts (via the container's outbound handler) and routes to the shared R2/D1 backends. **Leave `INNO_STORAGE_BASE` unset in normal use** — both locally and in production, the default `http://storage.internal` is correct. Only override `INNO_STORAGE_BASE` if you run the app process *outside* the container/gateway (an unusual setup). Do not point it at the gateway's public port — that proxies `/_storage` back to the container and loops.

`app/storage.py` is the Python client; `lib/storage.js` (with types in
`lib/storage.d.ts`) is the same client for a JS/TS container app. Any other
stack calls the same HTTP endpoints directly (they are plain JSON/bytes over
HTTP): `POST /_storage/sql/query` and `/_storage/sql/execute`
(`{sql, params}`), `PUT/GET/DELETE /_storage/files/{key}`,
`GET /_storage/files`. Whatever the stack: durable state lives HERE, never on
the container's disk.

### Cross-app data links

If this app's owner has linked another of their own apps' data to it
(`link_app_data` — contract §2.1), a container app reaches the linked D1 via
`storage.query_linked("<source-app>", sql, params)` and
`execute_linked(...)`, which wrap
`POST /_storage/linked/{source-app}/sql/query` and `/execute`. The grant is
full read-write, and the route exists only after the platform templates it in
at deploy time — an app cannot conjure one.

### Connections (per-user credentials for an external backend)

If your app fronts an external backend (ServiceNow, a SaaS API) on behalf of
the signed-in user, never run your own OAuth flow or collect tokens in-app —
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
    pass  # relay e.connect_url to the user verbatim — a one-time linking step
```

Connections are configured by the app's owner with the `set_app_connection`
MCP tool (or the panel's Connections tab). Availability today (contract
§2.2): the seam is live for **mcp-container** apps; the sso-`container`
gateway does not carry it yet (the call answers 501), and function-shaped
apps have no `storage.internal` at all. The helper ships in both clients now
so container apps are ready as availability widens.

## Container contract

The container must adhere to these requirements:

1. **Listen on port 8080** — The gateway forwards all traffic to this port.
2. **Serve `/healthz` endpoint** — Return HTTP 200 if healthy, cheap and storage-independent. Two platform checks bind to it (contract R2): CI's smoke gate (the built image must answer within 90s of `docker run`) and the runtime health probe, fired after each green deploy and then daily — failures notify the owner and surface in the panel's Health column.
3. **Run as non-root** — The Dockerfile must create a non-root user and switch to it before running your app. The reference Dockerfile uses `useradd -m appuser && USER appuser`.
4. **Graceful shutdown** — The container will receive SIGTERM; handle it cleanly.

Violating these contracts will cause deployment failures and health check timeouts.

### If your app is the `mcp-container` type

The container contract above applies in full, plus the MCP deltas (contract
§1.3): serve the **Streamable HTTP** MCP transport at `POST /mcp`,
**stateless only** — no session correlation across requests, so
server-initiated MCP features (notifications, sampling, elicitation,
subscriptions) are unavailable. Identity still arrives only as the
`X-Forwarded-*` headers — the gateway is the OAuth boundary and the
`Authorization` header never reaches you — and the sign-out link does not
apply (there is no browser session). Python gotcha: FastMCP silently enables
localhost-only DNS-rebinding protection when its `host` *setting* is left at
the default, rejecting every proxied `/mcp` request with `421 Invalid Host
header` — pass
`transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False)`
to the `FastMCP(...)` constructor.

## What CI enforces

Every deploy runs the platform's gate suite — all hard-failing, each with its own job:

1. **No committed secrets** (`gitleaks`) — credentials or API keys anywhere in the working tree fail the build. App secrets are provisioned as environment variables through the platform's Variables facility (the app page's Variables tab, or set_app_variable), never committed.
2. **No vulnerable dependencies** (`deps` + `trivy`) — pip-audit scans Python manifests; the Trivy image scan covers everything the container actually ships (OS packages and language packages, any stack), HIGH/CRITICAL severity.
3. **Container contract** (`container`) — the built image must `EXPOSE 8080`, run as a non-root `USER`, and answer `GET /healthz` with 200 within 90s of `docker run` (the smoke gate).
4. **No platform-owned files in the repo** (`config-integrity`) — `wrangler.jsonc` must NOT exist here (nor any other wrangler config or a `.wrangler/` cache dir): the platform injects it at build time from the promoted `gateway.ref` and templates the per-app values. The injected config guarantees `ENVIRONMENT = "production"` (the `"dev"` value would flip the gateway into mock-identity auth bypass) and the resource limits — platform-owned facts an app repo cannot influence. The same must-not-exist rule covers the repo-root worker build inputs `package.json`/`package-lock.json`/`tsconfig.json` (your app's own build files under `app/` are fine) and root `.env*`/`.npmrc`/`.yarnrc*` files (deploy-build hygiene).
5. **No vendored gateway** (`config-integrity`) — the gateway Worker is a platform-pinned build input, not app code: the platform's reusable workflow injects the promoted gateway (config `gateway.ref`) into `src/gateway/` at build time. Your repo must not contain `src/gateway/` at all — don't create it locally; it's gitignored and CI fails a repo that carries it ("delete `src/gateway/` — the platform injects the gateway at build time"). The injected `wrangler.jsonc`'s `main` names `src/gateway/index.ts` — that's the injected path, not a file you author.
6. **This file's headers** (`config-integrity`) — the five `##` section headers in this CLAUDE.md are required and checked; the body is yours to rewrite, the headers are not.
7. **SAST** (`semgrep`) — OWASP-top-ten patterns on `app/` (string-built HTML, raw SQL formatting, etc.).
8. **Dependency release-age cooldown** (off by default) — when a platform/app admin sets `safety.min_release_age_days`, an exactly-pinned dependency published more recently than that fails the deploy.

Two more deploy-time checks to know about: a generated repo must not contain
`scaffold/` (a template leftover — CI rejects it), and deploys are skipped
while `app/.needs-build` exists (delete it when real app code lands).

The full application contract — everything above plus the runtime requirements and deployment patterns — is served by the `get_app_contract` MCP tool. Respect these constraints to ensure your app can be deployed and operated safely.
