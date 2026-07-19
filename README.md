# inno-template

A template for building container-based applications on the Innovation Platform.

## Creating an App from This Template

1. Click **"Use this template"** on GitHub to create a new repository.
2. Clone your new repository and run `npm install`.
3. Edit the container app in `app/main.py` and the Dockerfile as needed.
4. Read `CLAUDE.md` for the platform's constraints (identity, persistence, container contract).

## Running Locally

### Prerequisites
- Node.js and npm
- Docker (for building the container image)

### Start the local dev gateway and container

```bash
./scripts/dev.sh
# or: npm run dev (if a dev script is configured in package.json)
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

Push to the main branch of your repository. CI (the platform's reusable
workflow) then:
1. Runs the security gates (config-integrity, secrets, SAST, deps, container).
2. On all-green, exchanges a GitHub OIDC token with the platform's deploy
   broker for a short-lived Cloudflare token and runs `wrangler deploy`
   (gateway Worker + container).
3. The broker attaches your `inno-{app}` domain and marks the app live.

Your D1/R2 storage was provisioned at `create_app` time and is wired via the
gateway's storage endpoint. (`/healthz` is a runtime contract the gateway
relies on — keep it working — but CI does not probe it.)

## What's in This Template

- `src/gateway/` — Cloudflare Workers gateway (do not edit).
- `app/` — Your Python application (Starlette reference implementation — FastAPI is not permitted; see CLAUDE.md).
- `Dockerfile` — Container image definition.
- `wrangler.jsonc` — Cloudflare Workers and container config.
- `test/` — Test suite for gateway and app contracts.
- `CLAUDE.md` — Platform constraints and best practices.
