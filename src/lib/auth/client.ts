import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";

// Autodesk (generic OAuth) and Google both sign in through `signIn.social`.
// oauthProviderClient carries a connector's signed sign-in request (Claude, ChatGPT...)
// along with the sign-in and consent calls, so the connection completes afterwards.
export const authClient = createAuthClient({
  plugins: [magicLinkClient(), oauthProviderClient()],
});
