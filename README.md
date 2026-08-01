# inno-template

A template for building container-based applications on the Innovation Platform.

## Creating an App from This Template

1. Click **"Use this template"** on GitHub to create a new repository.
2. Clone your new repository.
3. Edit the container app in `app/main.py` and the Dockerfile as needed.
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
does, but without the gateway in front — so there's no Access identity, no
`X-Forwarded-*` headers, and no `/_storage/*` proxy. To exercise those, push
to `main`: CI runs the full gate suite (including the gateway) as your
safety preflight before any tag deploys. See `CLAUDE.md` for details on
identity, storage, and the container contract.

## Deploying

Deploys are RELEASE-driven: pushing to main runs the safety checks only;
tagging a `v*` release is what deploys.

1. **Push to main** — CI (the platform's reusable workflow) runs the safety
   gates (config-integrity, secrets, SAST, deps, container). Nothing deploys:
   this is your safety preflight, and you can push work-in-progress freely.
2. **Tag a release** (`git tag v1.0.0 && git push origin v1.0.0`, or just run
   `/inno-ship`) — the gates run again on the tagged commit, then CI exchanges
   a GitHub OIDC token with the platform's deploy broker for a short-lived
   Cloudflare token and runs `wrangler deploy` (gateway Worker + container).
3. The broker attaches your `inno-{app}` domain, records the release, and
   marks the app live.

Your D1/R2 storage was provisioned at `create_app` time and is wired via the
gateway's storage endpoint. (`/healthz` is a runtime contract the gateway
relies on — keep it working — but CI does not probe it.)

## What's in This Template

- `src/gateway/` — not in this repo. The gateway lives in `inno-platform` and is injected here at build time (config `gateway.ref`); `wrangler.jsonc`'s `main` names the injected path. Don't create this directory locally.
- `app/` — Your Python application (Starlette reference implementation — FastAPI is not permitted; see CLAUDE.md).
- `Dockerfile` — Container image definition.
- `wrangler.jsonc` — Cloudflare Workers and container config.
- `CLAUDE.md` — Platform constraints and best practices.

## Deployment-type scaffolds

This template carries every deployment type: the container scaffold at the
root (`Dockerfile`, `app/`, `lib/` — where the `container` and `mcp-container`
presets start) and one overlay per function-shaped preset,
`scaffold/function/` and `scaffold/mcp-function/`. When the platform generates
an app repo it prunes to exactly one, driven by the app's type (each overlay's
`.scaffold-remove` lists what that variant deletes). Generated repos never
contain `scaffold/` — CI rejects it as a leftover.
