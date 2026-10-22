import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";
import { devStoragePath, verifyDevLink } from "@/lib/storage";

// The local stand-in for R2's signed links, used when no R2 keys are set. Never in production.

const keyOf = async (ctx: RouteContext<"/api/dev-storage/[...key]">) => (await ctx.params).key.join("/");
const disabled = () => process.env.NODE_ENV === "production";

export async function GET(request: NextRequest, ctx: RouteContext<"/api/dev-storage/[...key]">) {
  const key = await keyOf(ctx);
  if (disabled() || !verifyDevLink(key, request.nextUrl.searchParams, "get")) return new Response("Forbidden", { status: 403 });
  try {
    const body = await readFile(devStoragePath(key));
    const gz = body[0] === 0x1f && body[1] === 0x8b;
    const dl = request.nextUrl.searchParams.get("dl");
    return new Response(body, {
      headers: {
        "Content-Type": key.endsWith(".ifc.gz") || key.endsWith(".ifc") ? "application/x-step" : "application/octet-stream",
        ...(gz ? { "Content-Encoding": "gzip" } : {}),
        ...(dl ? { "Content-Disposition": dl } : {}),
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

export async function PUT(request: NextRequest, ctx: RouteContext<"/api/dev-storage/[...key]">) {
  const key = await keyOf(ctx);
  if (disabled() || !verifyDevLink(key, request.nextUrl.searchParams, "put")) return new Response("Forbidden", { status: 403 });
  const file = devStoragePath(key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, new Uint8Array(await request.arrayBuffer()));
  return new Response(null, { status: 200 });
}
