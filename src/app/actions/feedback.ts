"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isUuid, requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { isAdminEmail } from "@/lib/env";
import { attachmentPrefix, FEEDBACK_KINDS, FEEDBACK_STATUSES, MAX_ATTACHMENT_SIZE, MAX_ATTACHMENTS, MAX_MESSAGE } from "@/lib/feedback";

const sent = z.object({
  kind: z.enum(FEEDBACK_KINDS.map((k) => k.id)),
  message: z.string().trim().min(1, "Say what you'd like").max(MAX_MESSAGE),
  page: z.string().max(500).optional(),
  userAgent: z.string().max(500).optional(),
  attachments: z
    .array(z.object({ key: z.string().max(400), name: z.string().min(1).max(255), type: z.string().max(200), size: z.number().int().positive().max(MAX_ATTACHMENT_SIZE) }))
    .max(MAX_ATTACHMENTS),
});

/** Sends feedback (its files already uploaded under the sender's folder). */
export async function sendFeedback(input: z.input<typeof sent>) {
  const user = await requireUser();
  const parsed = sent.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid feedback");
  const { attachments, ...rest } = parsed.data;
  if (attachments.some((a) => !a.key.startsWith(attachmentPrefix(user.id)) || a.key.includes(".."))) throw new Error("Invalid attachment");
  await db.feedback.create({
    data: { ...rest, attachments, userId: user.id, orgId: user.orgId, appVersion: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null },
  });
  revalidatePath("/feedback");
}

const review = z.object({ status: z.enum(FEEDBACK_STATUSES.map((s) => s.id)), reply: z.string().trim().max(MAX_MESSAGE) });

/** An admin's status and reply on someone's feedback (the sender sees both). */
export async function reviewFeedback(feedbackId: string, input: z.input<typeof review>) {
  const user = await requireUser();
  if (!isAdminEmail(user.email)) throw new Error("Not allowed");
  if (!isUuid(feedbackId)) throw new Error("Not found");
  const parsed = review.safeParse(input);
  if (!parsed.success) throw new Error("Invalid review");
  await db.feedback.update({ where: { id: feedbackId }, data: { status: parsed.data.status, reply: parsed.data.reply || null } });
  revalidatePath("/feedback");
}
