import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { genericOAuth, jwt, magicLink } from "better-auth/plugins";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { mcp } from "@better-auth/mcp";
import { db } from "@/lib/db";
import { env, googleSignInEnabled } from "@/lib/env";
import { sendSignInLink } from "@/lib/mail";

const APS_AUTH = "https://developer.api.autodesk.com/authentication/v2";

/** The MCP endpoint, as the OAuth "resource" that connector access tokens are issued for. */
export const mcpResource = (appUrl: string) => `${appUrl}/api/mcp`;
const MCP_SCOPES = ["openid", "profile", "email", "offline_access"];

function createAuth() {
  const e = env();
  const app = new URL(e.APP_URL);
  const aliases = (e.APP_ALIASES ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  return betterAuth({
    // Sign-in works on the app's domain and its aliases, each with its own callback URLs.
    baseURL: aliases.length
      ? { allowedHosts: [app.host, ...aliases], fallback: e.APP_URL, protocol: app.protocol === "http:" ? "http" : "https" }
      : e.APP_URL,
    secret: e.BETTER_AUTH_SECRET,
    database: prismaAdapter(db, { provider: "postgresql" }),
    advanced: { database: { generateId: "uuid" } },
    // The JWT plugin's own /token route isn't used; connector tokens come from /oauth2/token.
    disabledPaths: ["/token"],

    user: {
      additionalFields: {
        // Set by the create hook below, never by the client.
        orgId: { type: "string", required: false, input: false },
        role: { type: "string", required: false, input: false },
      },
    },
    account: {
      // Someone who signs in with Google and later Autodesk (same email) keeps one account.
      accountLinking: { enabled: true, trustedProviders: ["autodesk", "google"] },
      // Autodesk tokens are kept for the Forma integration; store them encrypted.
      encryptOAuthTokens: true,
    },

    socialProviders: googleSignInEnabled()
      ? { google: { clientId: e.GOOGLE_CLIENT_ID!, clientSecret: e.GOOGLE_CLIENT_SECRET!, prompt: "select_account" } }
      : {},

    plugins: [
      genericOAuth({
        config: [
          {
            providerId: "autodesk",
            clientId: e.APS_CLIENT_ID,
            clientSecret: e.APS_CLIENT_SECRET,
            authorizationUrl: `${APS_AUTH}/authorize`,
            tokenUrl: `${APS_AUTH}/token`,
            userInfoUrl: "https://api.userprofile.autodesk.com/userinfo",
            // Autodesk's userinfo identifies the user by `sub`; without discovery,
            // Better Auth would otherwise look for an `id` field and find none.
            accountSubject: ({ profile }) => String(profile.sub ?? ""),
            // Read-only: identity now, Forma/ACC data later.
            scopes: ["user-profile:read", "data:read"],
            authentication: "basic",
          },
        ],
      }),
      magicLink({
        expiresIn: 15 * 60,
        sendMagicLink: async ({ email, url }) => sendSignInLink(email, url),
      }),
      // Connectors: allcon is the OAuth provider that Claude, ChatGPT and other MCP clients
      // sign in through (see app/api/mcp). Tokens are JWTs signed with the JWT plugin's keys.
      jwt(),
      mcp({
        loginPage: "/",
        consentPage: "/oauth/consent",
        resource: mcpResource(e.APP_URL),
        scopes: MCP_SCOPES,
        resources: [{ identifier: mcpResource(e.APP_URL), allowedScopes: MCP_SCOPES }],
        // Clients identify themselves with a metadata document (current MCP spec, via cimd
        // below) or, for clients that still do, by registering dynamically.
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        clientRegistrationDefaultApplicationType: "infer",
      }),
      cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" }),
      nextCookies(), // must stay last: lets server actions set the session cookie
    ],

    databaseHooks: {
      user: {
        create: {
          // Every new user starts with their own organization.
          before: async (user) => {
            const org = await db.organization.create({
              data: { name: user.name ? `${user.name}'s organization` : user.email },
            });
            return { data: { ...user, orgId: org.id } };
          },
        },
      },
    },
  });
}

let instance: ReturnType<typeof createAuth> | undefined;

/** Created lazily so `next build` works without secrets present. */
export function auth() {
  instance ??= createAuth();
  return instance;
}
