import type { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser, isUuid } from "@/lib/auth/session";
import { db } from "@/lib/db";

// Collaboration: an open editor checks in every couple of seconds with where its user is and
// where their cursor is, and hears the drawing's revision (to pull in others' changes) and
// who else is in it: people with it open, and AI apps that are editing it.

const PERSON_SEEN = 12_000; // ms: an editor that stops checking in has closed
const APP_SEEN = 30_000; // an AI app shows for a while after its last edit

const body = z.object({
  space: z.string().max(40).nullable().default(null),
  cursor: z.tuple([z.number(), z.number()]).nullable().default(null),
});

export async function POST(request: NextRequest, ctx: RouteContext<"/api/drafting/[drawingId]/state">) {
  const user = await getCurrentUser();
  const drawingId = (await ctx.params).drawingId;
  if (!user || !isUuid(drawingId)) return new Response("Not found", { status: 404 });
  const drawing = await db.drawing.findFirst({ where: { id: drawingId, orgId: user.orgId }, select: { id: true, revision: true } });
  if (!drawing) return new Response("Not found", { status: 404 });
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  const me = parsed.success ? parsed.data : { space: null, cursor: null };
  const now = new Date();
  await db.drawingPresence.upsert({
    where: { drawingId_userId_clientId: { drawingId: drawing.id, userId: user.id, clientId: "" } },
    create: { drawingId: drawing.id, userId: user.id, name: user.name || user.email, space: me.space, cursor: me.cursor ?? undefined },
    update: { name: user.name || user.email, space: me.space, cursor: me.cursor ?? undefined, seenAt: now },
  });
  const others = await db.drawingPresence.findMany({
    where: { drawingId: drawing.id, seenAt: { gte: new Date(now.getTime() - APP_SEEN) }, NOT: { userId: user.id, clientId: "" } },
    orderBy: { seenAt: "desc" },
  });
  // Rows from long ago are cleared now and then.
  if (Math.random() < 0.02) await db.drawingPresence.deleteMany({ where: { seenAt: { lt: new Date(now.getTime() - 24 * 3600_000) } } }).catch(() => {});
  return Response.json({
    revision: drawing.revision,
    people: others
      .filter((p) => p.clientId || now.getTime() - p.seenAt.getTime() <= PERSON_SEEN)
      .map((p) => ({ id: p.id, name: p.name, app: !!p.clientId, space: p.space, cursor: p.cursor, activity: p.clientId ? p.activity : null })),
  });
}

/** Leaving the drawing (the tab closes): no longer shown to others. */
export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/drafting/[drawingId]/state">) {
  const user = await getCurrentUser();
  const drawingId = (await ctx.params).drawingId;
  if (!user || !isUuid(drawingId)) return new Response(null, { status: 204 });
  await db.drawingPresence.deleteMany({ where: { drawingId, userId: user.id, clientId: "" } });
  return new Response(null, { status: 204 });
}
