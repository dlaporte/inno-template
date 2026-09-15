# Innovation Platform App Template (function type)

This template guides you to build a secure app as a Cloudflare Worker on the Innovation Platform.

## Innovation Platform App

This is a function-type application: your app is its OWN Cloudflare Worker running behind the platform's gateway. The gateway handles identity verification and request routing; your Worker receives already-authenticated requests. There is no container and no Dockerfile — CI skips the image gates for function-type apps.

- **Gateway**: platform-owned, injected at deploy time — never edit or vendor it.
- **Your Worker**: `app/index.ts`, a standard Worker module (`export default { fetch }`). Deployed with `workers_dev: false` and no route — only the gateway can reach it.
- **Storage**: your app's own D1 and R2 arrive as bindings (`env.DATA`, `env.FILES`).

Your code and its dependencies live entirely under `app/`. If you need npm packages, add `app/package.json`, run `npm install` inside `app/`, and commit the generated `app/package-lock.json` with it: the release deploy runs `npm ci` and fails without a committed lockfile that matches `app/package.json` (a push to main does not catch this). Declare every package you import in `app/package.json` itself; nothing is installed at the repo root. A ROOT package.json is rejected by CI; the platform injects the root build inputs.

## Identity (do not build auth)

**Do not build authentication, sessions, or password storage.**

The gateway has already verified the user and injects spoof-proof headers:

- `X-Forwarded-User`: the user's email (e.g. `alice@example.com`)
- `X-Forwarded-Groups`: comma-separated, and only this app's own groups: `inno-<app>-users` when the caller is a member, `inno-<app>-open` while the app is open to everyone. Nothing else (no admin group, no other app's groups), so finer roles need your own store keyed on `X-Forwarded-User`.
- `X-Forwarded-Host`, `X-Forwarded-Proto` and `X-Forwarded-For` are also gateway-set; every other header (including `X-Real-IP`) is caller-controlled.

```ts
const user = request.headers.get("X-Forwarded-User");
```

## Persistence (use your bindings)

Function-type apps use their provisioned storage directly as bindings — not the container path's `http://storage.internal` client:

- `env.DATA` — your D1 (SQLite) database: `await env.DATA.prepare("SELECT ...").bind(x).all()`
- `env.FILES` — your R2 bucket: `await env.FILES.put(key, body)` / `await env.FILES.get(key)`

Create tables at first use (D1 is empty on provision). Keep `/healthz` storage-independent.

## Function contract

- `app/index.ts` exports a standard Worker module: `export default { fetch(request, env, ctx) }`.
- `GET /healthz` must return 200 without touching storage — the platform probes it after deploy and on schedule.
- Never interpolate user data into hand-built HTML — even escaped; the SAST gate blocks it. Return dynamic data as JSON (like the scaffold's /me) or render through an auto-escaping template library; keep hand-written HTML fully static.
- Do not add: anything under a root `src/` (the platform owns that directory), a root `package.json`, `package-lock.json` or `tsconfig.json`, any `wrangler.*` config or `.wrangler/` directory, root `.env` files, root package manager config (`.yarnrc`, `.yarnrc.yml`, `.pnpmfile.cjs`, `pnpm-workspace.yaml`, `bunfig.toml`), or a `.npmrc` anywhere, `app/.npmrc` included. The platform injects all deploy configuration from the promoted gateway ref, and CI rejects shadow copies.

## What CI enforces

Every push to main runs the platform's safety gates (your preflight); tagging a `v*` release deploys. Gates: gitleaks (secrets), semgrep OWASP (SAST, over the whole repository except the platform-owned root `src/`, so `.github/workflows/deploy.yml` is scanned too), dependency audits (`app/package.json` if present), config-integrity (this file's headers, no shadow configs), and release-age cooldown. Function-type apps skip the Docker build/Trivy/healthz-smoke image gates (there is no image). The release deploy additionally requires a committed `app/package-lock.json` whenever `app/package.json` exists.
