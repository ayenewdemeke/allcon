import type { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { workOutSymbolic } from "@/lib/calcs/symbolic";

// Symbolic evaluation for the Calcs editor: the expressions a worksheet works out with →, passed
// to the SymPy worker. Signed-in people only.

const body = z.object({
  requests: z.array(z.object({ key: z.string().max(200_000), tree: z.array(z.unknown()), names: z.record(z.string(), z.string().max(200)) })).max(50),
});

export async function POST(request: NextRequest) {
  if (!(await getCurrentUser())) return new Response("Not signed in", { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response("Invalid", { status: 400 });
  return Response.json({ results: await workOutSymbolic(parsed.data.requests) });
}
