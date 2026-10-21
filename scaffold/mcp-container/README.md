# {app} (mcp-container type)

An mcp-container-type app on the Innovation Platform: your code in `app/main.py` runs
in a container, a Model Context Protocol (MCP) server, behind the platform's front
door, which checks each caller's OAuth token (it asks for none once the app is public). MCP clients (Claude Code, claude.ai) reach it at
`https://<app host>/mcp` (the exact URL is shown by
`register_app`, the first-deploy notification, and the panel; `get_platform_status`'s App host pattern gives the host, and `<members group>` is your app's one group under App groups).

## Developing

Start in `app/main.py`, a stateless Streamable HTTP MCP server built on FastMCP
with two example tools (`whoami`, `echo`), and read `CLAUDE.md` for the platform's
constraints: identity headers, the storage client in `app/storage.py`, and the
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

Nothing strips spoofed headers locally, so mock each of the three kinds of caller
`CLAUDE.md` describes by passing the `X-Forwarded-*` headers yourself on an MCP
request:

```bash
call_whoami() {
  curl -X POST http://localhost:8080/mcp \
       -H 'Content-Type: application/json' \
       -H 'Accept: application/json, text/event-stream' \
       "$@" \
       -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"whoami","arguments":{}}}'
}
# A member
call_whoami -H 'X-Forwarded-User: alice@example.com' -H 'X-Forwarded-Subject: alice-id' -H 'X-Forwarded-Groups: <members group>'
# Signed in, not a member: no group
call_whoami -H 'X-Forwarded-User: bob@example.com' -H 'X-Forwarded-Subject: bob-id' -H 'X-Forwarded-Groups;'
# No identity: both headers present and empty
call_whoami -H 'X-Forwarded-User;' -H 'X-Forwarded-Groups;'
```

An anonymous app is never told who the caller is, so every request it gets looks
like the third.

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
