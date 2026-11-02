import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { FEEDBACK_STATUSES, type Attachment } from "@/lib/feedback";
import { bearerMatches } from "@/lib/feedback/export";

// Feedback for the daily feedback check, read-only: `?status=` one of the statuses or "all"
// (default "new"), oldest first. Attachments are listed by name only.

const LIMIT = 200;

export async function GET(request: NextRequest) {
  if (!bearerMatches(request.headers.get("authorization"), env().FEEDBACK_EXPORT_TOKEN)) {
    return Response.json({ error: "Not allowed" }, { status: 401 });
  }
  const status = request.nextUrl.searchParams.get("status") ?? "new";
  if (status !== "all" && !FEEDBACK_STATUSES.some((s) => s.id === status)) {
    return Response.json({ error: `status is one of ${FEEDBACK_STATUSES.map((s) => s.id).join(", ")} or all` }, { status: 400 });
  }
  const rows = await db.feedback.findMany({
    where: status === "all" ? {} : { status },
    orderBy: { createdAt: "asc" },
    take: LIMIT,
    include: { user: { select: { name: true, email: true } } },
  });
  const feedback = rows.map((f) => ({
    id: f.id,
    createdAt: f.createdAt,
    kind: f.kind,
    status: f.status,
    message: f.message,
    page: f.page,
    attachments: (f.attachments as Attachment[]).map(({ name, type, size }) => ({ name, type, size })),
    reply: f.reply,
    sender: f.user ? { name: f.user.name, email: f.user.email } : null,
  }));
  return Response.json({ feedback, truncated: rows.length === LIMIT }, { headers: { "Cache-Control": "no-store" } });
}
