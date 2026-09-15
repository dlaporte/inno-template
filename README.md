# inno-template

A template for building container-based applications on the Innovation Platform.

## Creating an App from This Template

1. Click **"Use this template"** on GitHub to create a new repository — any
   account or org, public or private; you own the repo, and the platform never
   hosts your source.
2. Register it: call the **`register_app`** MCP tool. The first call returns
   a proof-of-control file (a path under `.inno-platform/` and its exact
   contents) and the platform GitHub App install link. Commit that file on
   your repository's default branch and push it, install the App on the
   repository (repo-only access is fine; if the App is already installed with
   access to it, skip the link), then call `register_app` again with the same
   arguments to finish. The second call refuses with `repo_control_unproven`
   until the file is on the default branch. Registration prunes the template
   to your chosen deployment type and provisions the app (Okta group, Access,
   D1, R2). (The `register_app` / `get_app_contract` / `get_platform_status`
   tools come from the platform's `innovation-platform` plugin; see the
   `inno-platform` repo's USER-GUIDE for setup.)
3. Pull (or clone) your repository after the second call, which pushes the
   scaffold commit, and build your app: for the container type, start in
   `app/main.py` and the Dockerfile.
4. Read `CLAUDE.md` for the platform's constraints (identity, persistence, container contract).

## Running Locally

There is no local Wrangler dev flow for the Worker side: the gateway
(`src/gateway/`) and its build inputs (`package.json`, `package-lock.json`,
`tsconfig.json`) aren't in this repo at all — the platform injects them at
build time from the promoted `gateway.ref` (see "What's in This Template"
below). `npx wrangler dev` has nothing to build against here; don't try.

What you *can* run locally is the container in isolation:

```bash
docker build -t inno-app .
docker run -p 8080:8080 inno-app
curl http://localhost:8080/healthz
```

This exercises `app/` and the `Dockerfile` exactly as CI's container gate
does, but without the gateway in front — so there's no Access identity and no
`/_storage/*` proxy. Because nothing strips spoofed headers locally, you can
mock identity by passing the `X-Forwarded-*` headers yourself:

```bash
curl -H 'X-Forwarded-User: alice@example.com' \
     -H 'X-Forwarded-Groups: inno-myapp-users' \
     http://localhost:8080/
```

To exercise the real gateway and storage, push to `main`: CI runs the full
gate suite as your safety preflight before any tag deploys. See `CLAUDE.md`
for details on identity, storage, and the container contract.

## Deploying

Deploys are RELEASE-driven: pushing to main runs the safety checks only;
tagging a `v*` release is what deploys.

1. **Push to main** — CI (the platform's reusable workflow) runs the safety
   gates (config-integrity, secrets, SAST, deps, dep-age, container). Nothing deploys:
   this is your safety preflight, and you can push work-in-progress freely.
2. **Tag a release** (`git tag v1.0.0 && git push origin v1.0.0`, or just run
   `/inno-ship`) — the gates run again on the tagged commit, then CI exchanges
   a GitHub OIDC token with the platform's deploy broker for a short-lived
   Cloudflare token, pushes the exact container image the gates just scanned
   (pinned by digest), and deploys the gateway Worker in front of it.
3. The broker attaches your `inno-{app}` domain, records the release, and
   marks the app live.

Your D1/R2 storage was provisioned at `register_app` time and is wired via the
gateway's storage endpoint. (`/healthz` is enforced twice: CI's container gate
smoke-tests it — the built image must answer 200 within 90s of `docker run` —
and the platform probes it after each green deploy and then daily.)

## What's in This Template

- `app/` — Your Python application (Starlette reference implementation; any
  stack that meets the contract works — see CLAUDE.md. FastAPI is allowed, but
  check your lockfile resolves a CVE-clean Starlette first).
- `app/storage.py` — Python client for platform storage, cross-app data
  links, and connections.
- `lib/` — the same client for JS/TS container apps (`storage.js` +
  `storage.d.ts`).
- `Dockerfile` — Container image definition.
- `CLAUDE.md` — Platform constraints and best practices (its five `##`
  section headers are CI-enforced — rewrite the body, keep the headers).
- `.github/workflows/deploy.yml` — thin caller of the platform's reusable CI
  workflow; all gates and the deploy step live platform-side.
- `LICENSE` — MIT-0: template code is meant to be embedded in generated
  apps, attribution-free.

Not in this repo, by design: anything under a root `src/` (the gateway is
injected at build time and the platform owns that directory) and
`wrangler.jsonc` (plus the root worker build inputs
`package.json`/`package-lock.json`/`tsconfig.json`), all supplied at build
time from the platform's promoted `gateway.ref`. Committing your own copies,
or any file under `src/`, fails the config-integrity gate.

## Deployment-type scaffolds

This template carries every deployment type: the container scaffold at the
root (`Dockerfile`, `app/`, `lib/`, where the `container` preset starts) and one
overlay for each other preset. The function-shaped overlays,
`scaffold/function/` and `scaffold/mcp-function/`, replace the container files
with a Worker; `scaffold/mcp-container/` keeps the container shape (the root
`Dockerfile`, `lib/` and `app/storage.py`) and swaps in a FastMCP server. When
the platform generates an app repo it prunes to exactly one, driven by the
app's type: an overlay's files replace their root namesakes, and its
`.scaffold-remove` lists what that variant deletes outright. Generated repos
never contain `scaffold/`: CI rejects it as a leftover.

## Maintainer notes

Five files here are byte-mirrored into `inno-platform`'s CI fixtures
(`ci/fixtures/template/`): `CLAUDE.md`, `Dockerfile`, `lib/storage.js`,
`lib/storage.d.ts`, and `scaffold/function/CLAUDE.md`. The platform's
`template-drift` CI job diffs the fixtures against this repo's `main` in
**both directions** on every push and nightly — changing one side alone turns
platform CI red. Land changes to these files in both repos together.
`CLAUDE.md` has a third copy: a platform unit test pins
`ci/fixtures/good-app/CLAUDE.md` byte-identical to the template fixture, so a
`CLAUDE.md` change touches three files.

Platform internals — the gateway source, deploy broker, Cloudflare/Okta/
GitHub-App setup, and the OPERATIONS runbook that documents how to rebuild
the whole environment from scratch — live in the `inno-platform` repo. The
public reusable CI workflow apps call is mirrored to `inno-platform-ci`.
