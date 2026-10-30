# inno-template

A template for building container-based applications on the Innovation Platform.

## Creating an App from This Template

1. Click **"Use this template"** on GitHub to create a new repository in any
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
   to your chosen deployment type and provisions the app: its member list, D1
   and R2. It also fixes the app's identity for life: identity-aware (the app
   is told who each caller is) or anonymous (it never is, and only an
   anonymous app can be made public), whose own guide replaces `CLAUDE.md`.
   The browser types (`container`, `function`) sign people in through the
   platform's own sign-in; the MCP types authenticate OAuth bearer tokens
   instead; a public app signs no one in. (The `register_app` / `get_app_contract` /
   `get_platform_status` tools come from the platform's `innovation-platform`
   plugin; see the `inno-platform` repo's USER-GUIDE for setup.)
3. Pull (or clone) your repository after the second call, which pushes the
   scaffold commit, and build your app: for the container type, start in
   `app/main.py` and the Dockerfile.
4. Read `CLAUDE.md` for the platform's constraints (identity, persistence, container contract).

## Running Locally

There is no local Wrangler dev flow: the platform's front door and the host
that runs your container aren't in this repo at all; the platform runs them
(see "What's in This Template" below). `npx wrangler dev` has nothing to
build against here; don't try.

What you *can* run locally is the container in isolation:

```bash
docker build -t inno-app .
docker run -p 8080:8080 inno-app
curl http://localhost:8080/healthz
```

This exercises `app/` and the `Dockerfile` exactly as CI's container gate
does, but without the platform's front door and host around it, so there's
no sign-in and no `/_storage/*` proxy. Because nothing strips spoofed headers
locally, you can mock each of the three kinds of caller `CLAUDE.md` describes
by passing the `X-Forwarded-*` headers yourself (the reference `/` only shows
or hides its sign-out link: add `CLAUDE.md`'s `/me` example and point these at
it to see the three differ):

```bash
# A member
curl -H 'X-Forwarded-User: alice@example.com' \
     -H 'X-Forwarded-Subject: alice-id' \
     -H 'X-Forwarded-Groups: <members group>' \
     http://localhost:8080/
# Signed in, not a member: no group
curl -H 'X-Forwarded-User: bob@example.com' \
     -H 'X-Forwarded-Subject: bob-id' \
     -H 'X-Forwarded-Groups;' \
     http://localhost:8080/
# No identity: both headers present and empty
curl -H 'X-Forwarded-User;' -H 'X-Forwarded-Groups;' http://localhost:8080/
```

`<members group>` is your app's one group (`get_platform_status` names it under App groups); a signed-in caller who is not a member arrives with `X-Forwarded-Groups` empty. An anonymous app is never told who the caller is, so every request it gets looks like the third.

To exercise the real sign-in and storage, push to your default branch: CI runs the full
gate suite as your safety preflight before any tag deploys. See `CLAUDE.md`
for details on identity, storage, and the container contract.

## Deploying

Deploys are RELEASE-driven: pushing to the default branch runs the safety checks only;
tagging a `v*` release is what deploys.

1. **Push to the default branch**: CI (the platform's reusable workflow) runs the safety
   gates (config-integrity, secrets, SAST, deps, dep-age, container). Nothing deploys:
   this is your safety preflight, and you can push work-in-progress freely.
2. **Tag a release** (`git tag v1.0.0 && git push origin v1.0.0`, or just run
   `/inno-ship`): the gates run again on the tagged commit, then CI exchanges
   a GitHub OIDC token with the platform's deploy broker for a short-lived
   Cloudflare token and pushes the exact container image the gates just
   scanned (pinned by digest); the platform runs it behind its front door.
3. The broker attaches your app's domain, records the release, and
   marks the app live.

Your D1/R2 storage was provisioned at `register_app` time and is served to
your container at `http://storage.internal` by the platform's host.
(`/healthz` is enforced twice: CI's container gate
smoke-tests it (the built image must answer 200 within 90s of `docker run`),
and the platform probes it after each green deploy and then every
`health.probe_interval_hours` hours, 24 by default, allowing one 45 second
attempt and one retry 5 seconds later, so size the boot for the first attempt.)

## What's in This Template

- `app/`: Your Python application (Starlette reference implementation; any
  stack that meets the contract works, see CLAUDE.md. FastAPI is allowed, but
  check your lockfile resolves a CVE-clean Starlette first).
- `app/storage.py`: Python client for platform storage, cross-app data
  links, and connections.
- `lib/`: the same client for JS/TS container apps (`storage.js` +
  `storage.d.ts`).
- `Dockerfile`: Container image definition.
- `CLAUDE.md`: Platform constraints and best practices (its five `##`
  section headers are CI-enforced: rewrite the body, keep the headers).
- `LICENSE`: MIT-0, since template code is meant to be embedded in generated
  apps, attribution-free.

The template carries no `.github/workflows/deploy.yml`: the platform hands you
the exact one for your instance in `register_app`'s second call, and the
plugin's `inno-new-app` skill writes it into your repo.

Not in this repo, by design: anything under a root `src/` (the platform owns
that directory) and `wrangler.jsonc` (plus the root build inputs
`package.json`/`package-lock.json`/`tsconfig.json`), all supplied by the
platform. Committing your own copies, or any file under `src/`, fails the
config-integrity gate.

## Deployment-type scaffolds

This template carries every deployment type: the container scaffold at the
root (`Dockerfile`, `app/`, `lib/`, where the `container` preset starts) and one
overlay for each other preset. The function-shaped overlays,
`scaffold/function/` and `scaffold/mcp-function/`, replace the container files
with a Worker; `scaffold/mcp-container/` keeps the container shape (the root
`Dockerfile`, `lib/` and `app/storage.py`) and swaps in a FastMCP server. When
the platform generates an app repo it prunes to exactly one, driven by the
app's type: an overlay's files replace their root namesakes, and its
`.scaffold-remove` lists what that variant deletes outright. An app registered
anonymous also takes the files under `scaffold/anonymous/<type>/`, laid over its
type's scaffold in the same commit: its `CLAUDE.md` (one anonymous guide per
type, each its type's guide rewritten where an app that is never told who the
caller is differs), reference entry files that read no identity, a `README.md`
for every type but `function` (whose README holds for both), and, for the two
function types, a `.scaffold-remove` that deletes the identity helper. Generated repos never contain `scaffold/`: CI rejects it as a
leftover once `app/.needs-build` is deleted, and tolerates it only while that
marker is still present.

## Maintainer notes

Twenty-one files here are byte-mirrored into `inno-platform`'s CI fixtures
(`ci/fixtures/template/`): `CLAUDE.md`, `Dockerfile`, `lib/storage.js`,
`lib/storage.d.ts`, `app/storage.py`, the three overlay guides `scaffold/function/CLAUDE.md`,
`scaffold/mcp-function/CLAUDE.md` and `scaffold/mcp-container/CLAUDE.md`,
the function overlays' identity helper, `scaffold/function/app/identity.ts` and
`scaffold/mcp-function/app/identity.ts`, the four anonymous guides,
`scaffold/anonymous/container/CLAUDE.md`, `scaffold/anonymous/function/CLAUDE.md`,
`scaffold/anonymous/mcp-function/CLAUDE.md` and
`scaffold/anonymous/mcp-container/CLAUDE.md`, and the anonymous layers'
reference code, `scaffold/anonymous/container/app/main.py`,
`scaffold/anonymous/container/app/templates/index.html`,
`scaffold/anonymous/function/app/index.ts`,
`scaffold/anonymous/function/.scaffold-remove`,
`scaffold/anonymous/mcp-function/app/index.ts`,
`scaffold/anonymous/mcp-function/.scaffold-remove` and
`scaffold/anonymous/mcp-container/app/main.py`. No README is mirrored. The
platform's `template-drift` CI job diffs the fixtures against this repo's
`main` in **both directions** on platform pushes, platform pull requests and a
nightly schedule; a push to this repo does not run it. Changing one side alone
turns platform CI red at its next run, so land changes to these files in both
repos together.
`CLAUDE.md` has a third copy: a platform unit test pins
`ci/fixtures/good-app/CLAUDE.md` byte-identical to the template fixture, so a
`CLAUDE.md` change touches three files.

Platform internals (the front door and host source, deploy broker, Cloudflare, identity provider and
GitHub App setup, and the OPERATIONS runbook that documents how to rebuild
the whole environment from scratch) live in the `inno-platform` repo. The
public reusable CI workflow apps call is published by the platform (its CI workflow in `get_platform_status`).
