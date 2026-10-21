# {app} (mcp-container type, anonymous)

An mcp-container-type app on the Innovation Platform: your code in `app/main.py` runs
in a container, a Model Context Protocol (MCP) server, behind the platform's front
door, which checks each caller's OAuth token (it asks for none once the app is public) and never
tells the app who the caller is. MCP clients (Claude Code, claude.ai) reach it at
`https://<app host>/mcp` (the exact URL is shown by
`register_app`, the first-deploy notification, and the panel; `get_platform_status`'s App host pattern gives the host).

## Developing

Start in `app/main.py`, a stateless Streamable HTTP MCP server built on FastMCP
with one example tool (`echo`), and read `CLAUDE.md` for the platform's
constraints: the identity headers this app never reads, the storage client in `app/storage.py`, and the
`## Container contract` section of `CLAUDE.md`.

Add Python packages to `app/requirements.txt`. The `Dockerfile` is the Python
reference; replace it (and `app/`) wholesale for another stack that meets the same
contract.

## Running locally

The front door and the host that runs your container are the platform's, so
locally you run the container on its own:

```bash
docker build -t inno-app .
docker run -p 8080:8080 inno-app
curl http://localhost:8080/healthz
```

Call the example tool with an MCP request:

```bash
curl -X POST http://localhost:8080/mcp \
     -H 'Content-Type: application/json' \
     -H 'Accept: application/json, text/event-stream' \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"echo","arguments":{"message":"hello"}}}'
```

This app is never told who the caller is: every request it gets carries the
identity headers present and empty, so there is no caller to mock.

There is no `/_storage/*` proxy without the platform's host, so storage calls fail
locally. To exercise the real front door and storage, push to your default branch: CI runs the full
safety-gate suite as your preflight, without deploying.

## Deploying

Deploys are RELEASE-driven:

1. **Push to the default branch**: safety gates run (nothing deploys). Delete
   `app/.needs-build` once real code is in place; deploys are skipped while it
   exists.
2. **Tag a release**: `git tag v1.0.0 && git push origin v1.0.0` deploys the image
   the gates just scanned behind the platform's front door, then attaches your
   app's hostname. Add the resulting `/mcp` URL as an MCP server in your client.
