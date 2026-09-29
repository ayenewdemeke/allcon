"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { deleteObject } from "@/lib/aps/oss";
import { db } from "@/lib/db";
import { findAccessibleProject, findAccessibleReference, findAccessibleReview, getCurrentUser, isUuid } from "@/lib/auth/session";
import { issueNoteText, toIssueView, type ReviewIssueView } from "@/lib/review/types";

const newReview = z.object({
  name: z.string().trim().min(1).max(200),
  drawingSetId: z.uuid(),
  referenceIds: z.array(z.uuid()).min(1).max(20),
});

export async function createReview(projectId: string, input: z.input<typeof newReview>) {
  const access = await findAccessibleProject(projectId);
  if (!access) throw new Error("Project not found");
  const data = newReview.parse(input);
  const set = await db.drawingSet.findFirst({ where: { id: data.drawingSetId, projectId, status: "ready" } });
  if (!set) throw new Error("Choose a drawing set from this project");
  const refs = await db.reference.findMany({
    where: { id: { in: data.referenceIds }, orgId: access.user.orgId, status: "ready" },
    select: { id: true },
  });
  if (!refs.length) throw new Error("Choose at least one manual from the library");

  const review = await db.review.create({
    data: { projectId, drawingSetId: set.id, name: data.name, referenceIds: refs.map((r) => r.id), createdById: access.user.id },
  });
  revalidatePath(`/projects/${projectId}/reviews`);
  return review.id;
}

export async function deleteReview(reviewId: string) {
  const access = await findAccessibleReview(reviewId);
  if (!access) throw new Error("Review not found");
  // Markups already drawn from kept issues stay on the sheets; they're ordinary markups now.
  await db.review.delete({ where: { id: reviewId } });
  revalidatePath(`/projects/${access.review.projectId}/reviews`);
}

const ISSUE_COLORS = { major: "#dc2626", minor: "#ea580c" } as const;
const NOTE_WIDTH = 270; // points; a little wider than notes draw, to keep clear of the cloud

/**
 * Keeping an issue draws it on the sheet as a cloud around the text it's about plus a note
 * beside it, as ordinary markups (so they export and share like any other). Un-keeping
 * removes exactly those markups.
 */
export async function setIssueStatus(issueId: string, status: "suggested" | "kept" | "dismissed"): Promise<ReviewIssueView> {
  const user = await getCurrentUser();
  if (!user || !isUuid(issueId)) throw new Error("Issue not found");
  const issue = await db.reviewIssue.findFirst({
    where: { id: issueId, review: { project: { orgId: user.orgId } } },
    include: { sheet: true, section: { select: { page: true } } },
  });
  if (!issue) throw new Error("Issue not found");
  z.enum(["suggested", "kept", "dismissed"]).parse(status);

  let markupIds = issue.markupIds;
  if (status === "kept" && issue.status !== "kept") {
    const color = ISSUE_COLORS[issue.severity];
    const { width, height } = issue.sheet;
    const box = Array.isArray(issue.box) ? (issue.box as number[]) : null;
    const clamp = (v: number, max: number) => Math.min(Math.max(v, 4), max - 4);
    const created: string[] = [];
    await db.$transaction(async (tx) => {
      let noteAt: [number, number] = [36, 36]; // nowhere to point: top-left corner
      if (box) {
        const cloud = await tx.markup.create({
          data: {
            sheetId: issue.sheetId,
            kind: "cloud",
            points: [
              [clamp(box[0], width), clamp(box[1], height)],
              [clamp(box[2], width), clamp(box[3], height)],
            ],
            color,
            label: `Review: ${issue.title}`.slice(0, 120),
            createdById: user.id,
          },
        });
        created.push(cloud.id);
        // Beside the cloud, on whichever side has room.
        const right = box[2] + 12;
        noteAt = [right + NOTE_WIDTH < width ? right : Math.max(4, box[0] - 12 - NOTE_WIDTH), clamp(box[1], height - 100)];
      }
      const note = await tx.markup.create({
        data: {
          sheetId: issue.sheetId,
          kind: "note",
          points: [noteAt],
          color,
          text: issueNoteText(issue),
          createdById: user.id,
        },
      });
      created.push(note.id);
    });
    markupIds = created;
  } else if (status !== "kept" && issue.status === "kept" && issue.markupIds.length) {
    await db.markup.deleteMany({ where: { id: { in: issue.markupIds }, sheetId: issue.sheetId } });
    markupIds = [];
  }

  const updated = await db.reviewIssue.update({
    where: { id: issue.id },
    data: { status, markupIds },
    include: { section: { select: { page: true } } },
  });
  return toIssueView(updated);
}

// --- library ------------------------------------------------------------------

export async function renameReference(referenceId: string, title: string) {
  const access = await findAccessibleReference(referenceId);
  if (!access) throw new Error("Manual not found");
  await db.reference.update({ where: { id: referenceId }, data: { title: z.string().trim().min(1).max(200).parse(title) } });
  revalidatePath("/library");
}

export async function deleteReference(referenceId: string) {
  const access = await findAccessibleReference(referenceId);
  if (!access) throw new Error("Manual not found");
  // Reviews keep their issues; citations to this manual just lose their link.
  await db.reference.delete({ where: { id: referenceId } });
  if (access.reference.objectKey) {
    await deleteObject(access.reference.objectKey).catch((err) => console.error("Could not delete the manual's file", err));
  }
  revalidatePath("/library");
}
