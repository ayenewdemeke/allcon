import { auth } from "@/lib/auth/server";

// OAuth discovery for connectors: protected-resource metadata (RFC 9728) and authorization
// server metadata (RFC 8414) live at the site root, so they're handed to Better Auth here.
const handle = (request: Request) => auth().handler(request);

export { handle as GET };
