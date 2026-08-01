# {app} (function type)

A function-type app on the Innovation Platform: your code in `app/index.ts` runs as its own Cloudflare Worker behind the platform's identity gateway.

## Developing

Everything you own is under `app/`. Start in `app/index.ts` (a standard Worker
`fetch` handler) and read `CLAUDE.md` for the platform's constraints —
identity headers, storage bindings, and the `## Function contract` section of `CLAUDE.md`.

Need npm packages? Add them to `app/package.json` (never a root package.json —
the platform injects the root build inputs at deploy time). The scaffold
itself ships dependency-free — `index.ts` references `D1Database`/`R2Bucket`
as ambient types; for editor/typecheck support, add
`@cloudflare/workers-types` as a devDependency when you create
`app/package.json`.

## Running locally

There is no local dev flow for function-type apps yet: the wrangler config and
the gateway are injected at deploy time from the platform's promoted gateway
ref, so `npx wrangler dev` has nothing to run against in this repo. Push to
`main` instead — CI runs the full safety-gate suite as your preflight, without
deploying anything.

## Deploying

Deploys are RELEASE-driven:

1. **Push to main** — safety gates run (nothing deploys). Delete
   `app/.needs-build` once real code is in place; deploys are skipped while it
   exists.
2. **Tag a release** — `git tag v1.0.0 && git push origin v1.0.0` deploys your
   Worker and the gateway, then attaches your app's hostname.
