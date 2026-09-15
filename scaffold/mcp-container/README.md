# {app} (mcp-container type)

An mcp-container-type app on the Innovation Platform: your code in `app/main.py` runs
in a container, a Model Context Protocol (MCP) server, behind the platform's OAuth
identity gateway. MCP clients (Claude Code, claude.ai) reach it at
`https://inno-{app}.<platform-domain>/mcp` (the exact URL is shown by
`register_app`, the first-deploy notification, and the panel).

## Developing

Start in `app/main.py`, a stateless Streamable HTTP MCP server built on FastMCP
with two example tools (`whoami`, `echo`), and read `CLAUDE.md` for the platform's
constraints: identity headers, the storage client in `app/storage.py`, and the
`## Container contract` section of `CLAUDE.md`.

Add Python packages to `app/requirements.txt`. The `Dockerfile` is the Python
reference; replace it (and `app/`) wholesale for another stack that meets the same
contract.

## Running locally

The gateway is injected at deploy time, so locally you run the container on its
own:

```bash
docker build -t inno-app .
docker run -p 8080:8080 inno-app
curl http://localhost:8080/healthz
```

Nothing strips spoofed headers locally, so mock the caller by passing the
`X-Forwarded-*` headers yourself on an MCP request:

```bash
curl -X POST http://localhost:8080/mcp \
     -H 'Content-Type: application/json' \
     -H 'Accept: application/json, text/event-stream' \
     -H 'X-Forwarded-User: alice@example.com' \
     -H 'X-Forwarded-Groups: inno-myapp-users' \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"whoami","arguments":{}}}'
```

There is no `/_storage/*` proxy without the gateway, so storage calls fail locally.
To exercise the real gateway and storage, push to `main`: CI runs the full
safety-gate suite as your preflight, without deploying.

## Deploying

Deploys are RELEASE-driven:

1. **Push to main**: safety gates run (nothing deploys). Delete
   `app/.needs-build` once real code is in place; deploys are skipped while it
   exists.
2. **Tag a release**: `git tag v1.0.0 && git push origin v1.0.0` deploys the image
   the gates just scanned and the gateway in front of it, then attaches your app's
   hostname. Add the resulting `/mcp` URL as an MCP server in your client.
