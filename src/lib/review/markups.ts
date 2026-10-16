import "server-only";
import { db } from "@/lib/db";
import { issueNoteText } from "./types";

// Draws a finding on its sheet as ordinary markups: a cloud around what it's about (when
// there's a spot to point at) and a note beside it. Used when a review finding is kept and
// when a connected AI app flags an issue.

export const ISSUE_COLORS = { major: "#dc2626", minor: "#ea580c" } as const;
const NOTE_WIDTH = 270; // points; a little wider than notes draw, to keep clear of the cloud

export async function drawIssueMarkups(input: {
  sheet: { id: string; width: number; height: number };
  box: number[] | null; // [x0, y0, x1, y1] in sheet points
  title: string;
  detail: string;
  citation: string | null;
  severity: keyof typeof ISSUE_COLORS;
  userId: string;
}) {
  const { sheet, box, severity, userId } = input;
  const color = ISSUE_COLORS[severity];
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 4), max - 4);
  const created: string[] = [];
  await db.$transaction(async (tx) => {
    let noteAt: [number, number] = [36, 36]; // nowhere to point: top-left corner
    if (box) {
      const cloud = await tx.markup.create({
        data: {
          sheetId: sheet.id,
          kind: "cloud",
          points: [
            [clamp(box[0], sheet.width), clamp(box[1], sheet.height)],
            [clamp(box[2], sheet.width), clamp(box[3], sheet.height)],
          ],
          color,
          label: `Review: ${input.title}`.slice(0, 120),
          createdById: userId,
        },
      });
      created.push(cloud.id);
      // Beside the cloud, on whichever side has room.
      const right = box[2] + 12;
      noteAt = [right + NOTE_WIDTH < sheet.width ? right : Math.max(4, box[0] - 12 - NOTE_WIDTH), clamp(box[1], sheet.height - 100)];
    }
    const note = await tx.markup.create({
      data: { sheetId: sheet.id, kind: "note", points: [noteAt], color, text: issueNoteText(input), createdById: userId },
    });
    created.push(note.id);
  });
  return created;
}
