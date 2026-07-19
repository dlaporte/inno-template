# Innovation Platform App Template

This template guides you to build a secure, stateless container app on the Innovation Platform.

## Innovation Platform App

This is a template for a container-based application that runs on the Innovation Platform. The app container is paired with a Cloudflare Workers gateway that handles identity verification, proxies requests to the container, and provides access to shared storage.

- **Gateway**: Runs on Cloudflare Workers; handles JWT verification and request routing.
- **Container**: Runs your Python application on port 8080; receives authenticated requests from the gateway.
- **Storage**: Shared R2 (object storage) and D1 (SQLite database) accessed via the storage client.

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

(The stack is **Starlette — not FastAPI**. FastAPI is deliberately banned: it
pins a vulnerable starlette 0.46 line; the platform requires `starlette>=1.3.1`.)

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

## Container contract

The container must adhere to these requirements:

1. **Listen on port 8080** — The gateway forwards all traffic to this port.
2. **Serve `/healthz` endpoint** — Return HTTP 200 if healthy. CI and production use this to monitor the container.
3. **Run as non-root** — The Dockerfile must create a non-root user and switch to it before running your app. The reference Dockerfile uses `useradd -m appuser && USER appuser`.
4. **Graceful shutdown** — The container will receive SIGTERM; handle it cleanly.

Violating these contracts will cause deployment failures and health check timeouts.

## What CI enforces

Plan 3's CI gate (`config-integrity`) enforces these constraints on the template and deployed apps:

1. **No hardcoded secrets** — Reject commits with credentials, API keys, or sensitive data in code or config.
2. **No vulnerable dependencies** — Run dependency scanning; reject packages with known CVEs.
3. **No privileged Dockerfile** — The Dockerfile must run as non-root; `USER` must be set before `CMD`.
4. **No manual edits to wrangler resource limits** — The platform manages R2 buckets, D1 databases, and Durable Object limits via orchestration; hand-edits to `wrangler.jsonc` for these are rejected.
5. **No edits to the gateway** — The gateway (`src/gateway/`) is templated by the platform. User apps must not modify it (except for reference/learning in local dev).
6. **`ENVIRONMENT` must stay `"production"`** — The deployed app must keep `vars.ENVIRONMENT: "production"` in `wrangler.jsonc`. Setting it to `"dev"` enables mock-identity mode (the gateway trusts `X-Mock-User`/`X-Mock-Groups` headers and skips Access JWT verification) — an authentication bypass. CI rejects any deployed app whose `ENVIRONMENT` is not `production`. The `"dev"` value is only for local Wrangler dev.

Respect these constraints to ensure your app can be deployed and operated safely.
