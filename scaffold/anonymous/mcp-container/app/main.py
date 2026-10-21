# REFERENCE IMPLEMENTATION (Python, FastMCP) for an mcp-container-type app. It
# runs in the container the root Dockerfile builds. In front of it runs the
# platform's front door, which decides who reaches the app, by its audience, and
# never tells the app who the caller is: this app is anonymous, reads no
# identity and builds no auth (see CLAUDE.md).
#
# This is a STATELESS Streamable HTTP MCP server: no session store, no state
# carried from one request to the next. Stateless is the ONLY mode this
# platform supports (see CLAUDE.md: server-initiated MCP features are
# unavailable), and it works with every MCP client's tool calls.
#
# Contract highlights (see CLAUDE.md for the full version):
#   - `app` below is the ASGI app the Dockerfile serves (uvicorn on 0.0.0.0:8080)
#   - POST /mcp     -> the MCP endpoint (JSON-RPC over Streamable HTTP; GET/DELETE 405)
#   - GET  /healthz -> 200, storage-independent   (CI smoke gate + runtime probe)
#   - durable state goes through storage.py, never the container's disk

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from starlette.requests import Request
from starlette.responses import JSONResponse, PlainTextResponse

mcp = FastMCP(
    "inno-mcp-app",
    # Stateless: a fresh transport per request, nothing correlated across them.
    stateless_http=True,
    # FastMCP turns on localhost-only DNS-rebinding protection when its host
    # setting is left at the default. The platform's host proxies with this
    # app's public Host header, so with protection on every /mcp request answers
    # 421. The front door is the access boundary here; keep this off.
    transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
)


@mcp.custom_route("/healthz", methods=["GET"])
async def healthz(request: Request) -> JSONResponse:
    # Container contract: 200 without touching storage. CI's smoke gate and the
    # platform's health probe both call this; keep it dependency-free.
    return JSONResponse({"status": "ok"})


# A tool WITH an input: the signature is the input schema (type hints become
# the JSON schema FastMCP publishes and validates). Replace with your own tools.
@mcp.tool()
async def echo(message: str) -> str:
    """Echo a message back: a template for input-validated tools."""
    return message


# Streamable HTTP at /mcp plus the custom routes above, as one ASGI app.
mcp_app = mcp.streamable_http_app()


async def app(scope, receive, send):
    # POST only on /mcp. A stateless server has nothing to stream on GET (FastMCP
    # would hold an empty SSE stream open, keeping the container awake) and no
    # session for DELETE to end; the MCP spec allows 405 for both.
    if scope["type"] == "http" and scope["path"] in ("/mcp", "/mcp/") and scope["method"] != "POST":
        response = PlainTextResponse("method not allowed", status_code=405, headers={"Allow": "POST"})
        await response(scope, receive, send)
        return
    await mcp_app(scope, receive, send)
