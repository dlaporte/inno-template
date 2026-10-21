# Innovation Platform App Template (function type, anonymous)

This template guides you to build a secure app as a Cloudflare Worker on the Innovation Platform that is never told who its callers are.

## Innovation Platform App

This is a function-type application: your app is its OWN Cloudflare Worker running behind the platform's front door, which signs people in (unless the app is public) and routes each request to it. The front door decides who reaches the app and never tells the app who the caller is: this app is anonymous. There is no container and no Dockerfile; CI skips the image gates for function-type apps.

- **Front door**: platform-owned and never part of this repo; it signs people in (unless the app is public) and routes each request to your Worker.
- **Your Worker**: `app/index.ts`, a standard Worker module (`export default { fetch }`). Deployed with no public address of its own; only the front door can reach it.
- **Storage**: your app's own D1 and R2 arrive as bindings (`env.DATA`, `env.FILES`).

Your code and its dependencies live entirely under `app/`. If you need npm packages, add `app/package.json`, run `npm install` inside `app/`, and commit the generated `app/package-lock.json` with it: CI's `app-build` job installs from that lockfile with `npm ci --ignore-scripts --omit=dev` and bundles your Worker on every push to your default branch, holding no credential, so a missing lockfile, or one that does not match `app/package.json`, fails the push, not only the release, and so does an import nothing declares. Declare every package your Worker imports at runtime under `dependencies` in `app/package.json` itself: `devDependencies` are neither installed nor audited, and nothing is installed at the repo root. A ROOT package.json is rejected by CI; the platform injects the root build inputs.

## Identity (do not build auth)

**Do not build authentication, sessions, or password storage.**

This app is anonymous, which was fixed when it was registered: an app that needs to know who its callers are is a different, identity-aware app. The front door decides who reaches the app, by its audience (members-only, internal or public), and never tells the app who the caller is, at any audience: the four identity headers (`X-Forwarded-User`, `X-Forwarded-Email`, `X-Forwarded-Groups` and `X-Forwarded-Subject`) arrive present and empty on every request, and no `X-Caller-Assertion` arrives. Write no code that reads them, and put no sign-out link in the app: it never shows who is signed in, so contract R4 asks for none. The reference `app/index.ts` reads none of them and has no `/me` route or sign-out footer, and the scaffold commit removes the identity helper (`app/identity.ts`) the identity-aware function scaffold carries.

`X-Forwarded-Host`, `X-Forwarded-Proto` and `X-Forwarded-For` are also set by the front door; every other header (including `X-Real-IP`) is caller-controlled.

The contract's rule for an anonymous app, R10: No accounts, no per-person views, no keys or limits taken from a person. What a visitor submits is stored and never rendered. Per-visitor state (a cart, a multi-step form, a vote already cast) lives in the app's own cookie or under a random cookie key, is never an identity, and follows APP-SECURITY's forged-request rules. The app may be public.

**Cookies.** Every cookie the app sets, its per-visitor state among them, carries the `__Host-` prefix (so `Secure`, `Path=/` and no `Domain`) and is `HttpOnly` unless the app's own script must read it: every app shares one site, and a page on another app's host can shadow any other cookie. Accept a state change only from the app's own pages (APP-SECURITY §12).

**What the platform still knows.** While the app is members-only or internal, the platform still knows who signed in to reach it (its admins and its audit log do), though the owner's panel shows sign-in counts, not people; once the app is public, nobody signs in to reach it. **Where the promise ends:** the platform does not tell the app who the caller is, and it does not make visits unlinkable against an owner who tries. The app still sees each caller's address (`X-Forwarded-For` and `CF-Connecting-IP`) and the timing of each request, small counts can single a person out, and an identity-aware app of the same owner on the site can link a visit to a person.

An anonymous app has no Connections (per-user credentials for an external backend, contract §2.2): there is no user to hold one, and `set_app_connection` refuses an anonymous app with `app_anonymous`.

## Persistence (use your bindings)

Function-type apps use their provisioned storage directly as bindings, not the container path's `http://storage.internal` client:

- `env.DATA`: your D1 (SQLite) database, e.g. `await env.DATA.prepare("SELECT ...").bind(x).all()`
- `env.FILES`: your R2 bucket: `await env.FILES.put(key, body)` / `await env.FILES.get(key)`

Create tables at first use (D1 is empty on provision). Keep `/healthz` storage-independent.

A source app linked to this one (`link_app_data`, contract §2.1) arrives as two more bindings at this app's next deploy: `env.LINKED_<SOURCE>` (its D1) and `env.LINK_FILES_<SOURCE>` (its R2 bucket), `<SOURCE>` being its name upper-cased with each `-` as `_`. The grant is read-write, over the source's database and every one of its files.

**Files someone uploaded.** Serve one back only as a download, with three headers: `Content-Disposition: attachment; filename="<name>"`, every character of the name outside `[A-Za-z0-9._-]` replaced by `_`, then `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox`. The rule holds from any host (APP-SECURITY §3), this one included: for a visitor's submission, for a file an editor app put here (a visitor's upload republished by an editor among them), and for every file read from `env.LINK_FILES_<SOURCE>`. Every app shares one site, so an uploaded HTML or SVG file shown inline could run script beside every other app.

## Function contract

- `app/index.ts` exports a standard Worker module: `export default { fetch(request, env, ctx) }`.
- `GET /healthz` must return 200 without touching storage; the platform probes it after deploy and on schedule.
- Never interpolate user data into hand-built HTML, even escaped; the SAST gate blocks it. Return dynamic data as JSON or render through an auto-escaping template library; keep hand-written HTML fully static.
- Do not add: anything under a root `src/` (the platform owns that directory), a root `package.json`, `package-lock.json` or `tsconfig.json`, any `wrangler.*` config or `.wrangler/` directory, root `.env` files, root package manager config (`.yarnrc`, `.yarnrc.yml`, `.pnpmfile.cjs`, `pnpm-workspace.yaml`, `bunfig.toml`), or a `.npmrc` anywhere, `app/.npmrc` included. The platform injects all deploy configuration, and CI rejects shadow copies.

## What CI enforces

Every push to the default branch runs the platform's safety gates (your preflight); tagging a `v*` release deploys. Gates: gitleaks (secrets), semgrep OWASP (SAST, over the whole repository except the platform-owned root `src/` and semgrep's default-ignored directories (`test/`, `tests/`, `build/`, `dist/`, `vendor/`, `node_modules/`, at any depth), so `.github/workflows/deploy.yml` is scanned too), dependency audits (`app/package.json` if present), config-integrity (this file's headers, no shadow configs), and release-age cooldown. Function-type apps skip the Docker build/Trivy/healthz-smoke image gates (there is no image). Whenever `app/package.json` exists, every push also needs a committed `app/package-lock.json` that matches it: the `app-build` job installs from it and fails without it.
