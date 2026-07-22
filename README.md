# inno-template

A template for building container-based applications on the Innovation Platform.

## Creating an App from This Template

1. Click **"Use this template"** on GitHub to create a new repository.
2. Clone your new repository.
3. Edit the container app in `app/main.py` and the Dockerfile as needed.
4. Read `CLAUDE.md` for the platform's constraints (identity, persistence, container contract).

## Running Locally

### Prerequisites
- Node.js and npm
- Docker (for building the container image)

### Start the local dev gateway and container

```bash
./scripts/dev.sh
```

This starts Wrangler dev mode at `http://localhost:8787`. The gateway will build and run your container using Docker.

### Test the app

```bash
# In another terminal, with mocked identity:
curl -H 'X-Mock-User: alice@example.com' \
  -H 'X-Mock-Groups: inno-app-users' \
  http://localhost:8787/
```

See `CLAUDE.md` for details on identity, storage, and the container contract.

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
