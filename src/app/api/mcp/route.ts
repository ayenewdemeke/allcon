import { requireMcpAuth } from "@better-auth/mcp";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { auth, mcpResource } from "@/lib/auth/server";
import { isUuid } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { buildMcpServer } from "@/lib/mcp/server";

// The connector endpoint (Model Context Protocol). AI apps sign in through conkit's OAuth
// provider (see lib/auth/server) and send the access token with every request; the token
// says which user is calling, and the tools act for that user only.

export const maxDuration = 120; // reading and rendering a large sheet can take a while

const unauthorized = (message: string) =>
  Response.json({ jsonrpc: "2.0", error: { code: -32001, message }, id: null }, { status: 401 });

async function handle(request: Request) {
  const protectedHandler = requireMcpAuth(
    auth(),
    async (req, claims) => {
      const userId = typeof claims.sub === "string" && isUuid(claims.sub) ? claims.sub : null;
      const user = userId ? await db.user.findUnique({ where: { id: userId }, select: { id: true, orgId: true } }) : null;
      if (!user) return unauthorized("This conkit account no longer exists.");
      const clientId = typeof claims.azp === "string" ? claims.azp : typeof claims.client_id === "string" ? claims.client_id : null;
      // Access tokens are self-contained, so check the app is still connected: disconnecting
      // it (Connections page) then takes effect immediately rather than when the token expires.
      if (clientId && !(await db.oauthConsent.findFirst({ where: { userId: user.id, clientId }, select: { id: true } }))) {
        return unauthorized("This app has been disconnected from conkit. Connect it again to continue.");
      }
      // A fresh server per request: requests are stateless, and each carries its own user.
      const mcp = createMcpHandler(() => buildMcpServer({ userId: user.id, orgId: user.orgId, clientId }), {
        onerror: (err) => console.error("MCP request error", err),
      });
      return mcp.fetch(req);
    },
    { resource: mcpResource(env().APP_URL) },
  );
  return protectedHandler(request);
}

export { handle as GET, handle as POST, handle as DELETE };
