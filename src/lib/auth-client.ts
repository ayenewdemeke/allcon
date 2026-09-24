import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";

// Autodesk (generic OAuth) and Google both sign in through `signIn.social`.
export const authClient = createAuthClient({
  plugins: [magicLinkClient()],
});
