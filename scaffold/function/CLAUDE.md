# Innovation Platform App Template (function type)

This template guides you to build a secure app as a Cloudflare Worker on the Innovation Platform.

## Innovation Platform App

This is a function-type application: your app is its OWN Cloudflare Worker running behind the platform's gateway, which routes each request to it. The gateway decides who reaches the app and tells you who the caller is, in the identity headers. There is no container and no Dockerfile; CI skips the image gates for function-type apps.

- **Gateway**: platform-owned, injected at deploy time; never edit or vendor it.
- **Your Worker**: `app/index.ts`, a standard Worker module (`export default { fetch }`). Deployed with `workers_dev: false` and no route; only the gateway can reach it.
- **Storage**: your app's own D1 and R2 arrive as bindings (`env.DATA`, `env.FILES`).

Your code and its dependencies live entirely under `app/`. If you need npm packages, add `app/package.json`, run `npm install` inside `app/`, and commit the generated `app/package-lock.json` with it: CI's `app-deps` job installs from that lockfile with `npm ci --ignore-scripts --omit=dev` on every push to your default branch, so a missing lockfile, or one that does not match `app/package.json`, fails the push, not only the release. Declare every package your Worker imports at runtime under `dependencies` in `app/package.json` itself: `devDependencies` are neither installed nor audited, and nothing is installed at the repo root. A ROOT package.json is rejected by CI; the platform injects the root build inputs.

## Identity (do not build auth)

**Do not build authentication, sessions, or password storage.**

The gateway decides who reaches the app and tells you who the caller is, in the identity headers. It sets these spoof-proof headers:

- `X-Forwarded-User`: the caller's email (e.g. `alice@example.com`), empty when the caller has no identity
- `X-Forwarded-Groups`: comma-separated, and only this app's own groups: your app's members group (`get_platform_status` names it under App groups) when the caller is a member, its open group while the app is open to everyone. Nothing else (no admin group, no other app's groups), so finer roles need your own store keyed on `X-Forwarded-User`. An app last deployed before the platform v0.14.3 gateway still receives its other groups until its next deploy.
- `X-Forwarded-Host`, `X-Forwarded-Proto` and `X-Forwarded-For` are also gateway-set; every other header (including `X-Real-IP`) is caller-controlled.

Each request's caller is one of three: a member (`X-Forwarded-Groups` includes the app's `-users` group), signed in but not a member (an identity without that group), or anonymous (empty identity headers). The platform decides who reaches the app; the app decides, per request, what each caller may see and do, and never assumes a caller is a member. Per-person data and roles exist only for an identified caller; a caller with no identity gets only what is meant for anyone.

Read the caller with the helper in `app/identity.ts`:

```ts
import { currentUser } from "./identity";

const caller = currentUser(request.headers); // { email, groups, member }, or null with no identity
if (!caller) return new Response("no signed-in user", { status: 403 }); // a route that needs a person
```

`currentUser` returns `null` when the request carries no identity; `member` is true when the caller holds the app's members group. Handle no user first, before any per-person read or write: refuse in one line, as above, or answer with what is meant for anyone, as the scaffold's `/me` does (contract §3). Never default the absence back into a value (`?.email`, `?? ""`, `"unknown"`): a placeholder bound into `WHERE owner = ?` is one key that every caller with no identity shares.

**Sign out** is one link, with no session code: put `<a href="https://{ACCESS_TEAM_DOMAIN}/cdn-cgi/access/logout">Sign out</a>` in your layout (a footer is fine), with `{ACCESS_TEAM_DOMAIN}` replaced by the team domain in the "Sign-out URL" line of the platform MCP's `get_platform_status`. It must be the *team* domain: `/cdn-cgi/access/logout` on this app's own hostname clears only one app's cookie, which the live Access session silently re-issues. The team-domain logout ends the Access session for every platform app.

## Persistence (use your bindings)

Function-type apps use their provisioned storage directly as bindings, not the container path's `http://storage.internal` client:

- `env.DATA`: your D1 (SQLite) database, e.g. `await env.DATA.prepare("SELECT ...").bind(x).all()`
- `env.FILES`: your R2 bucket: `await env.FILES.put(key, body)` / `await env.FILES.get(key)`

Create tables at first use (D1 is empty on provision). Keep `/healthz` storage-independent.

## Function contract

- `app/index.ts` exports a standard Worker module: `export default { fetch(request, env, ctx) }`.
- `GET /healthz` must return 200 without touching storage; the platform probes it after deploy and on schedule.
- Never interpolate user data into hand-built HTML, even escaped; the SAST gate blocks it. Return dynamic data as JSON (like the scaffold's /me) or render through an auto-escaping template library; keep hand-written HTML fully static.
- Do not add: anything under a root `src/` (the platform owns that directory), a root `package.json`, `package-lock.json` or `tsconfig.json`, any `wrangler.*` config or `.wrangler/` directory, root `.env` files, root package manager config (`.yarnrc`, `.yarnrc.yml`, `.pnpmfile.cjs`, `pnpm-workspace.yaml`, `bunfig.toml`), or a `.npmrc` anywhere, `app/.npmrc` included. The platform injects all deploy configuration from the promoted gateway ref, and CI rejects shadow copies.

## What CI enforces

Every push to main runs the platform's safety gates (your preflight); tagging a `v*` release deploys. Gates: gitleaks (secrets), semgrep OWASP (SAST, over the whole repository except the platform-owned root `src/` and semgrep's default-ignored directories (`test/`, `tests/`, `build/`, `dist/`, `vendor/`, `node_modules/`, at any depth), so `.github/workflows/deploy.yml` is scanned too), dependency audits (`app/package.json` if present), config-integrity (this file's headers, no shadow configs), and release-age cooldown. Function-type apps skip the Docker build/Trivy/healthz-smoke image gates (there is no image). Whenever `app/package.json` exists, every push also needs a committed `app/package-lock.json` that matches it: the `app-deps` job installs from it and fails without it.
