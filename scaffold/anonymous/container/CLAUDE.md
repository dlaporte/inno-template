# Innovation Platform App Template (anonymous)

This template guides you to build a secure, stateless container app on the Innovation Platform that is never told who its callers are.

## Innovation Platform App

This is a template for a container-based application that runs on the Innovation Platform. The platform's front door decides who may reach the app and routes each request to it, and a platform host runs the app container and gives it access to shared storage.

- **Front door**: Platform-owned; signs people in (unless the app is public) and routes each request. Nothing of it lives in this repo.
- **Host**: Platform-owned; runs your container and serves its storage. Nothing of it lives in this repo.
- **Container**: Runs your application on port 8080, behind the front door. The front door decides who reaches the app and never tells the app who the caller is: this app is anonymous.
- **Storage**: The app's own R2 (object storage) and D1 (SQLite database), accessed over HTTP at `http://storage.internal`, which the platform's host serves.

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

This app is anonymous, which was fixed when it was registered: an app that needs to know who its callers are is a different, identity-aware app. The front door decides who reaches the app, by its audience (members-only, internal or public), and never tells the app who the caller is, at any audience: the four identity headers (`X-Forwarded-User`, `X-Forwarded-Email`, `X-Forwarded-Groups` and `X-Forwarded-Subject`) arrive present and empty on every request, and no `X-Caller-Assertion` arrives. Write no code that reads them, and put no sign-out link in the app: it never shows who is signed in, so contract R4 asks for none. The reference code in `app/` reads none of them and links no sign-out; `app/storage.py` still carries the shared client's `current_user` helper, which an anonymous app never calls.

The front door also sets `X-Forwarded-Host` (the hostname the request arrived on), `X-Forwarded-Proto` (always `https`) and `X-Forwarded-For` (the client address from Cloudflare's edge, absent when unknown), deletes `Forwarded`, and keeps the platform's own cookies and its `/_auth/` paths from the app. Every other header, including `X-Real-IP`, `True-Client-IP` and `X-Forwarded-Port`, is whatever the client sent: never use one for an access decision.

The contract's rule for an anonymous app, R10: No accounts, no per-person views, no keys or limits taken from a person. What a visitor submits is stored and never rendered. Per-visitor state (a cart, a multi-step form, a vote already cast) lives in the app's own cookie or under a random cookie key, is never an identity, and follows APP-SECURITY's forged-request rules. The app may be public.

**Cookies.** Every cookie the app sets, its per-visitor state among them, carries the `__Host-` prefix (so `Secure`, `Path=/` and no `Domain`) and is `HttpOnly` unless the app's own script must read it: every app shares one site, and a page on another app's host can shadow any other cookie. Accept a state change only from the app's own pages (APP-SECURITY §12).

**What the platform still knows.** While the app is members-only or internal, the platform still knows who signed in to reach it (its admins and its audit log do), though the owner's panel shows sign-in counts, not people; once the app is public, nobody signs in to reach it. **Where the promise ends:** the platform does not tell the app who the caller is, and it does not make visits unlinkable against an owner who tries. The app still sees each caller's address (`X-Forwarded-For` and `CF-Connecting-IP`) and the timing of each request, small counts can single a person out, and an identity-aware app of the same owner on the site can link a visit to a person.

## Persistence (use the storage client)

**Do not persist state to local files or SQLite databases on the container.**

The container disk is ephemeral: writes will be lost when the container restarts. Use the `Storage` client to persist data:

```python
from uuid import uuid4

from storage import Storage

storage = Storage()

# What is published, meant for anyone
pages = await storage.query("SELECT slug, title, body FROM pages WHERE published = 1")

# What a visitor submits: stored, and never rendered back (R10)
await storage.execute("INSERT INTO submissions (id, body) VALUES (?, ?)", [uuid4().hex, body])

# Store and retrieve files, under names you generate
await storage.put_file(f"submissions/{uuid4().hex}", data)
logo = await storage.get_file("site/logo.png")
```

The storage client communicates with the platform's shared storage through the platform's host. `Storage()` defaults its base URL to `http://storage.internal`, which the host intercepts (via the container's outbound handler) and routes to the shared R2/D1 backends. **Leave `INNO_STORAGE_BASE` unset in production**: there the default `http://storage.internal` is correct. A local `docker run` has no host around it, so it has no storage either: storage calls fail there unless you point `INNO_STORAGE_BASE` at a local stand-in that serves the same endpoints. Do not point it at the app's public address: storage is reached only through `http://storage.internal`.

`app/storage.py` is the Python client; `lib/storage.js` (with types in
`lib/storage.d.ts`) is the same client for a JS/TS container app. Any other
stack calls the same HTTP endpoints directly (they are plain JSON/bytes over
HTTP): `POST /_storage/sql/query` and `/_storage/sql/execute`
(`{sql, params}`), `PUT/GET/DELETE /_storage/files/{key}`,
`GET /_storage/files`. The listing call (`list_files()`, or `listFiles()` in
JS) returns the list of keys, which also carries `truncated`: true when the
platform stopped listing at its cap, so the keys are only part of the bucket;
track keys in D1 rather than walk a bucket that size. Whatever the stack:
durable state lives HERE, never on the container's disk.

**Files someone uploaded.** Serve one back only as a download, with the headers
`file_download_headers(filename)` returns (`fileDownloadHeaders(filename)` in
JS): `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` and
`Content-Security-Policy: sandbox`. The rule holds from any host (APP-SECURITY §3),
this one included: for a visitor's submission, for a file an editor app put here
(a visitor's upload republished by an editor among them), and for every file read
from a linked source with `get_linked_file`. Every app shares one site, so an
uploaded HTML or SVG file shown inline could run script beside every other app.

### Cross-app data links

If this app's owner has linked another of their own apps' data to it
(`link_app_data`, contract §2.1), a container app reaches the linked D1 via
`storage.query_linked("<source-app>", sql, params)` and
`execute_linked(...)`, which wrap
`POST /_storage/linked/{source-app}/sql/query` and `/execute`, and the
linked files via `put_linked_file("<source-app>", key, data)`,
`get_linked_file`, `list_linked_files` and `delete_linked_file`
(`putLinkedFile` and its siblings in JS), which wrap
`PUT/GET/DELETE /_storage/linked/{source-app}/files/{key}` and
`GET /_storage/linked/{source-app}/files`. The grant is full read-write, over
the source's database and every one of its files, and the platform binds it
to this app at its next deploy or restart (a platform release binds it too);
an app cannot conjure one.

### Connections (per-user credentials for an external backend)

An anonymous app has no Connections. A Connection is a credential the platform
holds for one user (contract §2.2), and this app is never told who its user is:
`set_app_connection` refuses an anonymous app with `app_anonymous`, and the front
door sends it no `X-Caller-Assertion` to echo. An app that must reach a backend as
each of its users is an identity-aware app; a key the app holds for itself is an
app variable (`set_app_variable`).

## Container contract

The container must adhere to these requirements:

1. **Listen on port 8080**: the platform's host forwards all traffic to this port.
2. **Serve `/healthz` endpoint.** Return HTTP 200 if healthy, cheap and storage-independent. Two platform checks bind to it (contract R2): CI's smoke gate (the built image must answer within 90s of `docker run`) and the runtime health probe, which allows one 45 second attempt and one retry 5 seconds later, so size the boot for the first attempt (a boot of 50 to 90 seconds passes CI and then fails every probe). The probe fires after each green deploy and then every `health.probe_interval_hours` hours (24 by default): failures notify the owner and surface in the panel's Health column.
3. **Run as non-root**: the Dockerfile must create a non-root user and switch to it before running your app. The reference Dockerfile uses `useradd -m appuser && USER appuser`.
4. **Graceful shutdown**: the container will receive SIGTERM; handle it cleanly.

Violating these contracts will cause deployment failures and health check timeouts.

## What CI enforces

Every push to the default branch and every `v*` release tag runs the platform's gate suite, each with its own job. Items 1 to 8 are gates that fail the build; item 9's reports are advisory unless policy makes one a gate:

1. **No committed secrets** (`gitleaks`): credentials or API keys anywhere in the working tree fail the build. App secrets are provisioned as environment variables through the platform's Variables facility (the app page's Variables tab, or set_app_variable), never committed.
2. **No vulnerable dependencies** (`deps` + `trivy`): pip-audit scans `app/requirements.txt` and npm audit scans `app/package.json`; the Trivy image scan covers everything the container actually ships (OS packages and language packages, any stack), HIGH/CRITICAL severity with a fix available (an unfixed CVE never fails the gate).
3. **Container contract** (`container`): the built image must `EXPOSE 8080`, run as a non-root `USER`, and answer `GET /healthz` with 200 within 90s of `docker run` (the smoke gate). From platform v0.14.4 (APP-CONTRACT R1) the non-root check accepts only a plain uid from 1 to 2147483647, or a portable name (`[A-Za-z0-9._-]`, not starting with `-`) on exactly one clean line of the image's own `/etc/passwd` with a uid in that range; everything else is refused. The image the gates scan on a release tag is the exact image that deploys, pushed by digest; the deploy never rebuilds your Dockerfile.
4. **No platform-owned files in the repo** (`config-integrity`): `wrangler.jsonc` must NOT exist here (nor any other wrangler config or a `.wrangler/` cache dir): the platform supplies all deploy configuration itself, including the resource limits, platform-owned facts an app repo cannot influence. The same must-not-exist rule covers the repo-root worker build inputs `package.json`/`package-lock.json`/`tsconfig.json` (your app's own build files under `app/` are fine), root `.env*` files, and every package manager's config at the root (`.npmrc`, `.yarnrc`, `.yarnrc.yml`, `.pnpmfile.cjs`, `pnpm-workspace.yaml`, `bunfig.toml`). A `.npmrc` is rejected at any depth, `app/.npmrc` included.
5. **No files under `src/`** (`config-integrity`): the platform owns the whole root `src/` directory. Your repo must not contain `src/` at all, not even a file of your own, so CI fails a repo that carries it (the message starts "delete src/"). Keep your code under `app/`; an `app/src/` directory is yours.
6. **This file's headers** (`config-integrity`): the five `##` section headers in this CLAUDE.md are required and checked; the body is yours to rewrite, the headers are not.
7. **SAST** (`semgrep`): OWASP-top-ten patterns across the whole repository except the platform-owned root `src/` and semgrep's default-ignored directories (`test/`, `tests/`, `build/`, `dist/`, `vendor/`, `node_modules/`, at any depth), so `app/`, `lib/`, this repo's `Dockerfile`, `.github/workflows/deploy.yml` and any root-level script are all scanned (string-built HTML, raw SQL formatting, a workflow that passes `secrets: inherit`, etc.). The gate does not honor the repo's own suppressions: it deletes every committed `.semgrepignore` before the scan and reports findings on lines marked `# nosemgrep`, so a false positive is ignored centrally by a platform admin.
8. **Dependency release-age cooldown** (off by default): when a platform/app admin sets `safety.min_release_age_days`, an exactly-pinned dependency published more recently than that fails the deploy.
9. **Reports** (`container`, after the smoke test): for a `container` app, an accessibility report (axe-core against the built image, on `/` plus the routes listed in `app/inno-a11y.json`) that also reports the page's response headers; for every container app, `mcp-container` included, a Dockerfile misconfiguration report (`trivy config`). They live in your GitHub Actions run (step summary and annotations) and never fail the build, except the accessibility report while the setting `safety.a11y.mode` is `enforce` for the app (the `get_app_accessibility` MCP tool says what that blocks).

Two more deploy-time checks to know about: a generated repo must not contain
`scaffold/` (a template leftover: CI rejects it once `app/.needs-build` is
gone, and tolerates it while that marker is still present), and deploys are
skipped while `app/.needs-build` exists (delete it when real app code lands).

The full application contract (everything above plus the runtime requirements and deployment patterns) is served by the `get_app_contract` MCP tool. Respect these constraints to ensure your app can be deployed and operated safely.
