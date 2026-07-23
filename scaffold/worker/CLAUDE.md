# Innovation Platform App Template (worker type)

This template guides you to build a secure app as a Cloudflare Worker on the Innovation Platform.

## Innovation Platform App

This is a worker-type application: your app is its OWN Cloudflare Worker running behind the platform's gateway. The gateway handles identity verification and request routing; your Worker receives already-authenticated requests. There is no container and no Dockerfile — CI skips the image gates for worker-type apps.

- **Gateway**: platform-owned, injected at deploy time — never edit or vendor it.
- **Your Worker**: `app/index.ts`, a standard Worker module (`export default { fetch }`). Deployed with `workers_dev: false` and no route — only the gateway can reach it.
- **Storage**: your app's own D1 and R2 arrive as bindings (`env.DATA`, `env.FILES`).

Your code and its dependencies live entirely under `app/`. If you need npm packages, add `app/package.json` (a ROOT package.json is rejected by CI — the platform injects the root build inputs).

## Identity (do not build auth)

**Do not build authentication, sessions, or password storage.**

The gateway has already verified the user and injects spoof-proof headers:

- `X-Forwarded-User`: the user's email (e.g. `alice@example.com`)
- `X-Forwarded-Groups`: comma-separated group list

```ts
const user = request.headers.get("X-Forwarded-User");
```

## Persistence (use your bindings)

Worker-type apps use their provisioned storage directly as bindings — not the container path's `http://storage.internal` client:

- `env.DATA` — your D1 (SQLite) database: `await env.DATA.prepare("SELECT ...").bind(x).all()`
- `env.FILES` — your R2 bucket: `await env.FILES.put(key, body)` / `await env.FILES.get(key)`

Create tables at first use (D1 is empty on provision). Keep `/healthz` storage-independent.

## Worker contract

- `app/index.ts` exports a standard Worker module: `export default { fetch(request, env, ctx) }`.
- `GET /healthz` must return 200 without touching storage — the platform probes it after deploy and on schedule.
- Never build HTML by string concatenation with untrusted input; escape at every sink (the SAST gate rejects string-built HTML).
- Do not add: a root `package.json`, any `wrangler.*` config, `.env` files, or `src/gateway/` — the platform injects all deploy configuration from the promoted gateway ref, and CI rejects shadow copies.

## What CI enforces

Every push to main runs the platform's safety gates (your preflight); tagging a `v*` release deploys. Gates: gitleaks (secrets), semgrep OWASP (SAST, on `app/`), dependency audits (`app/package.json` if present), config-integrity (this file's headers, no shadow configs), and release-age cooldown. Worker-type apps skip the Docker build/Trivy/healthz-smoke image gates — there is no image.
