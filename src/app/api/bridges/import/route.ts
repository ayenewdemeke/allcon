import { gzipSync } from "node:zlib";
import type { NextRequest } from "next/server";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { getCurrentUser } from "@/lib/auth/session";
import type { ImportedInfo } from "@/lib/bridge/imported";
import { db } from "@/lib/db";
import { newFileKey, putFile } from "@/lib/storage";

// An analysis model read from a file in the browser (a midas MCT file), kept as a bridge: the
// model goes to file storage, gzipped; the bridge's row keeps a summary of it.

const num = z.number().finite();
const dof = z.tuple([z.boolean(), z.boolean(), z.boolean(), z.boolean(), z.boolean(), z.boolean()]);
const six = z.tuple([num, num, num, num, num, num]);
const dir = z.enum(["GX", "GY", "GZ", "LX", "LY", "LZ"]);
const model = z.object({
  nodes: z.array(z.object({ id: z.number().int(), x: num, y: num, z: num })).min(2).max(20000),
  materials: z.array(z.object({ id: z.number().int(), name: z.string().max(200), E: num, G: num, density: num, alpha: num })).max(2000),
  sections: z.array(z.object({ id: z.number().int(), name: z.string().max(200), A: num, Asy: num, Asz: num, J: num, Iy: num, Iz: num })).max(5000),
  elements: z.array(z.object({ id: z.number().int(), type: z.enum(["beam", "truss"]), mat: z.number().int(), sec: z.number().int(), n1: z.number().int(), n2: z.number().int(), angle: num.optional(), releases: z.object({ i: dof, j: dof }).optional() })).min(1).max(40000),
  supports: z.array(z.object({ node: z.number().int(), fixed: dof })).max(20000),
  springs: z.array(z.object({ node: z.number().int(), k: six })).max(20000),
  links: z.array(z.object({ id: z.number().int(), n1: z.number().int(), n2: z.number().int(), k: six, angle: num.optional() })).max(20000),
  loadCases: z.array(z.object({ name: z.string().min(1).max(100), type: z.enum(["DC", "DW", "LL", "TU", "WS", "USER"]), description: z.string().max(300).optional() })).max(200),
  loads: z
    .array(
      z.union([
        z.object({ case: z.string(), kind: z.literal("nodal"), node: z.number().int(), F: six }),
        z.object({ case: z.string(), kind: z.literal("uniform"), element: z.number().int(), dir, w: num }),
        z.object({ case: z.string(), kind: z.literal("point"), element: z.number().int(), dir, P: num, a: num }),
      ]),
    )
    .max(400000),
});
const body = z.object({
  name: z.string().trim().min(1).max(200),
  source: z.string().max(200),
  model,
  report: z.object({ units: z.object({ force: z.string().max(10), length: z.string().max(10) }), read: z.record(z.string().max(60), z.number()), notRead: z.array(z.string().max(60)).max(300), warnings: z.array(z.string().max(400)).max(100) }),
});

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in first", { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response("That isn't a model this can take (too large, or not laid out as expected).", { status: 400 });
  const { name, source, model: m, report } = parsed.data;
  const key = newFileKey("bridges", ".json.gz");
  await putFile(key, gzipSync(JSON.stringify(m)), { contentType: "application/json", gzipped: true });
  const imported: ImportedInfo = { fileKey: key, source, nodes: m.nodes.length, elements: m.elements.length, cases: m.loadCases.length, report };
  const bridge = await db.bridge.create({ data: { orgId: user.orgId, name, definition: { imported } as unknown as Prisma.InputJsonValue, createdById: user.id } });
  return Response.json({ id: bridge.id });
}
