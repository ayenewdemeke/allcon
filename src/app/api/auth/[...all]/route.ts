import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth/server";

// All sign-in, callback and sign-out endpoints are served by Better Auth.
export async function GET(request: Request) {
  return toNextJsHandler(auth()).GET(request);
}

export async function POST(request: Request) {
  return toNextJsHandler(auth()).POST(request);
}
