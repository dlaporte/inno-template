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

Replace `{ACCESS_TEAM_DOMAIN}` with the `ACCESS_TEAM_DOMAIN` value from this repo's `wrangler.jsonc` (also emitted by the platform MCP's `get_platform_status` tool) — don't invent or hard-code a domain from anywhere else. It must be the *team* domain: the app-hostname variant (`/cdn-cgi/access/logout` on this app) clears only one app's cookie, which the live global Access session silently re-issues. The team-domain logout ends the Access session for all platform apps; if the user's Okta session is still alive they can sign back in without a prompt — that's expected, not a bug.

In local dev (ENVIRONMENT=dev), the gateway accepts mocked identity via request headers:
- Pass `-H 'X-Mock-User: alice@example.com'` to set the user.
- Pass `-H 'X-Mock-Groups: inno-<app>-users'` to set groups.

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

The storage client communicates with the platform's shared storage via the gateway. `Storage()` defaults its base URL to `http://storage.internal`, which the gateway intercepts (via the container's outbound handler) and routes to the shared R2/D1 backends. **Leave `INNO_STORAGE_BASE` unset in normal use** — both locally (`npm run dev` / `./scripts/dev.sh`) and in production, the default `http://storage.internal` is correct. Only override `INNO_STORAGE_BASE` if you run the app process *outside* the container/gateway (an unusual setup). Do not point it at the gateway's public port — that proxies `/_storage` back to the container and loops.

`app/storage.py` is the Python client; a non-Python app calls the same HTTP
endpoints directly (they are plain JSON/bytes over HTTP): `POST
/_storage/sql/query` and `/_storage/sql/execute` (`{sql, params}`),
`PUT/GET/DELETE /_storage/files/{key}`, `GET /_storage/files`. Whatever the
stack: durable state lives HERE, never on the container's disk.

## Container contract

The container must adhere to these requirements:

1. **Listen on port 8080** — The gateway forwards all traffic to this port.
2. **Serve `/healthz` endpoint** — Return HTTP 200 if healthy. The production runtime uses this to monitor the container (CI does not probe it).
3. **Run as non-root** — The Dockerfile must create a non-root user and switch to it before running your app. The reference Dockerfile uses `useradd -m appuser && USER appuser`.
4. **Graceful shutdown** — The container will receive SIGTERM; handle it cleanly.

Violating these contracts will cause deployment failures and health check timeouts.

## What CI enforces

Every deploy runs the platform's gate suite — all hard-failing, each with its own job:

1. **No committed secrets** (`gitleaks`) — credentials or API keys anywhere in the working tree fail the build. App secrets are provisioned as container environment variables by a platform admin, never committed.
2. **No vulnerable dependencies** (`deps` + `trivy`) — pip-audit scans Python manifests; the Trivy image scan covers everything the container actually ships (OS packages and language packages, any stack), HIGH/CRITICAL severity.
3. **Container contract** (`container`) — the built image must `EXPOSE 8080` and run as a non-root `USER`; `/healthz` is a runtime contract the gateway depends on (not CI-checked).
4. **No manual edits to wrangler resource limits** (`config-integrity`) — the platform manages R2 buckets, D1 databases, and Durable Object limits via orchestration; hand-edits to `wrangler.jsonc` for these are rejected.
5. **No edits to the gateway** (`config-integrity`) — `src/gateway/` must be byte-identical to the template, along with `package.json`, the lockfile, and `tsconfig.json`. Read it freely; never modify it.
6. **`ENVIRONMENT` must stay `"production"`** (`config-integrity`) — setting it to `"dev"` enables mock-identity mode (the gateway trusts `X-Mock-User`/`X-Mock-Groups` and skips Access JWT verification) — an authentication bypass. The `"dev"` value is only for local Wrangler dev.
7. **SAST** (`semgrep`) — OWASP-top-ten patterns on `app/` (string-built HTML, raw SQL formatting, etc.).

The full application contract — everything above plus the runtime requirements and deployment patterns — is served by the `get_app_contract` MCP tool. Respect these constraints to ensure your app can be deployed and operated safely.
