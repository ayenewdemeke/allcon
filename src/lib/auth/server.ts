import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { genericOAuth, magicLink } from "better-auth/plugins";
import { db } from "@/lib/db";
import { env, googleSignInEnabled } from "@/lib/env";
import { sendSignInLink } from "@/lib/mail";

const APS_AUTH = "https://developer.api.autodesk.com/authentication/v2";

function createAuth() {
  const e = env();
  return betterAuth({
    baseURL: e.APP_URL,
    secret: e.BETTER_AUTH_SECRET,
    database: prismaAdapter(db, { provider: "postgresql" }),
    advanced: { database: { generateId: "uuid" } },

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
