# {app} (mcp type)

An mcp-type app on the Innovation Platform: your code in `app/index.ts` runs as
its own Cloudflare Worker — a Model Context Protocol (MCP) server — behind the
platform's OAuth identity gateway. MCP clients (Claude Code, claude.ai) reach it
at `https://inno-{app}.<platform-domain>/mcp` (the exact URL is shown by
`register_app`, the first-deploy notification, and the panel).

## Developing

Everything you own is under `app/`. Start in `app/index.ts` — a stateless
Streamable-HTTP MCP server with two example tools (`whoami`, `echo`) — and read
`CLAUDE.md` for the platform's constraints: identity headers, storage bindings,
and the worker contract.

This scaffold ships `app/package.json` with the MCP SDK and zod. Add more npm
packages there (never a root package.json — the platform injects the root build
inputs at deploy time).

## Running locally

There is no local dev flow for mcp-type apps yet: the wrangler config and the
gateway are injected at deploy time from the platform's promoted gateway ref, so
`npx wrangler dev` has nothing to run against in this repo. Push to `main`
instead — CI runs the full safety-gate suite as your preflight, without deploying.

## Deploying

Deploys are RELEASE-driven:

1. **Push to main** — safety gates run (nothing deploys). Delete
   `app/.needs-build` once real code is in place; deploys are skipped while it
   exists.
2. **Tag a release** — `git tag v1.0.0 && git push origin v1.0.0` deploys your
   Worker and the gateway, then attaches your app's hostname. Add the resulting
   `/mcp` URL as an MCP server in your client.
