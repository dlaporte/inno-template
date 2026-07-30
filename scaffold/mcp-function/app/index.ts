// REFERENCE IMPLEMENTATION (TypeScript Worker) for an mcp-function-type app. Your whole
// app lives in app/; this file is the module the platform deploys as your app
// Worker. In front of it runs the platform's gateway, which has ALREADY verified
// the caller's OAuth bearer token and injected spoof-proof identity headers —
// never build auth here (see CLAUDE.md).
//
// This is a STATELESS Streamable-HTTP MCP server: a fresh transport + server per
// request, with no session store. Stateless is the ONLY mode this platform
// supports (see CLAUDE.md — server-initiated MCP features are unavailable), and
// it works with every MCP client's tool calls.
//
// Contract highlights (see CLAUDE.md for the full version):
//   - export default { fetch }                    (standard Worker module)
//   - POST /mcp     -> the MCP endpoint (JSON-RPC over Streamable HTTP)
//   - GET  /healthz -> 200, storage-independent   (the platform probes it)
//   - identity arrives as spoof-proof request headers (gateway-injected)
//   - declare npm deps in app/package.json (a ROOT package.json is rejected)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

interface Env {
  DATA: D1Database;   // the app's own D1 database
  FILES: R2Bucket;    // the app's own R2 bucket
  ENVIRONMENT: string;
}

// Build a fresh MCP server for a single request, closing over the caller's
// gateway-verified identity so tools can authorize by user/group. Register your
// tools here; `_env` is threaded through so a tool can use env.DATA / env.FILES
// the moment you need them (rename it to `env` when you do).
function buildServer(user: string, groups: string[], _env: Env): McpServer {
  const server = new McpServer({ name: "inno-mcp-app", version: "0.1.0" });

  // A read-only tool with NO inputs: reports who the platform says you are. The
  // identity is injected by the gateway — the app never authenticates anyone.
  server.registerTool(
    "whoami",
    {
      title: "Who am I",
      description: "Return the platform-verified caller identity (email + groups).",
      inputSchema: {},
    },
    async () => ({
      content: [{
        type: "text",
        text: `You are ${user || "(unknown)"}${groups.length ? `; groups: ${groups.join(", ")}` : "; no groups"}.`,
      }],
    }),
  );

  // A tool WITH an input schema: MCP tool inputs are declared as a zod raw shape
  // (an object of zod validators). Replace this with your own tools.
  server.registerTool(
    "echo",
    {
      title: "Echo",
      description: "Echo a message back — a template for input-validated tools.",
      inputSchema: { message: z.string().describe("Text to echo back.") },
    },
    async ({ message }) => ({
      content: [{ type: "text", text: message }],
    }),
  );

  return server;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health probe: 200 without touching storage. The platform (through its
    // gateway) probes this after deploy and on schedule; keep it dependency-free.
    if (request.method === "GET" && url.pathname === "/healthz") {
      return Response.json({ status: "ok" });
    }

    if (url.pathname === "/mcp") {
      // POST only. A stateless server has nothing to stream on GET (the SDK
      // would hold a structurally-always-empty SSE stream open, burning a
      // Worker invocation) and no session for DELETE to end — the MCP spec
      // allows 405 for both.
      if (request.method !== "POST") {
        return new Response("method not allowed", { status: 405, headers: { Allow: "POST" } });
      }
      // Identity: spoof-proof headers the gateway injected after verifying the
      // caller's OAuth bearer token. Trust these; never parse a token yourself.
      const user = request.headers.get("X-Forwarded-User") ?? "";
      const groups = (request.headers.get("X-Forwarded-Groups") ?? "")
        .split(",").map((s) => s.trim()).filter(Boolean);

      // Stateless: a new transport + server per request (no sessionIdGenerator).
      const transport = new WebStandardStreamableHTTPServerTransport();
      const server = buildServer(user, groups, env);
      await server.connect(transport);
      return transport.handleRequest(request);
    }

    return new Response("not found", { status: 404 });
  },
};
