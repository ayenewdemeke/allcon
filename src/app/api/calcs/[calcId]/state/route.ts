import type { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser, isUuid } from "@/lib/auth/session";
import { db } from "@/lib/db";

// Collaboration: an open worksheet checks in every couple of seconds with the region its user is
// editing and where their crosshair is, and hears the worksheet's revision (to pull in others'
// changes) and who else is in it: people with it open, and AI apps that are editing it.

const PERSON_SEEN = 12_000; // ms: an editor that stops checking in has closed
const APP_SEEN = 30_000; // an AI app shows for a while after its last edit

const body = z.object({
  region: z.string().max(40).nullable().default(null),
  cursor: z.tuple([z.number(), z.number()]).nullable().default(null),
});

export async function POST(request: NextRequest, ctx: RouteContext<"/api/calcs/[calcId]/state">) {
  const user = await getCurrentUser();
  const calcId = (await ctx.params).calcId;
  if (!user || !isUuid(calcId)) return new Response("Not found", { status: 404 });
  const calc = await db.calc.findFirst({ where: { id: calcId, orgId: user.orgId }, select: { id: true, revision: true } });
  if (!calc) return new Response("Not found", { status: 404 });
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  const me = parsed.success ? parsed.data : { region: null, cursor: null };
  const now = new Date();
  const mine = { name: user.name || user.email, region: me.region, cursor: me.cursor ?? undefined };
  await db.calcPresence.upsert({
    where: { calcId_userId_clientId: { calcId: calc.id, userId: user.id, clientId: "" } },
    create: { calcId: calc.id, userId: user.id, ...mine },
    update: { ...mine, seenAt: now },
  });
  const others = await db.calcPresence.findMany({
    where: { calcId: calc.id, seenAt: { gte: new Date(now.getTime() - APP_SEEN) }, NOT: { userId: user.id, clientId: "" } },
    orderBy: { seenAt: "desc" },
  });
  // Rows from long ago are cleared now and then.
  if (Math.random() < 0.02) await db.calcPresence.deleteMany({ where: { seenAt: { lt: new Date(now.getTime() - 24 * 3600_000) } } }).catch(() => {});
  return Response.json({
    revision: calc.revision,
    people: others
      .filter((p) => p.clientId || now.getTime() - p.seenAt.getTime() <= PERSON_SEEN)
      .map((p) => ({ id: p.id, name: p.name, app: !!p.clientId, region: p.region, cursor: p.cursor, activity: p.clientId ? p.activity : null })),
  });
}

/** Leaving the worksheet (the tab closes): no longer shown to others. */
export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/calcs/[calcId]/state">) {
  const user = await getCurrentUser();
  const calcId = (await ctx.params).calcId;
  if (!user || !isUuid(calcId)) return new Response(null, { status: 204 });
  await db.calcPresence.deleteMany({ where: { calcId, userId: user.id, clientId: "" } });
  return new Response(null, { status: 204 });
}
