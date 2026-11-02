import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { attachmentPrefix, MAX_ATTACHMENT_SIZE, MAX_ATTACHMENTS, safeName } from "@/lib/feedback";
import { signedWriteUrl } from "@/lib/storage";

// Upload links for the files attached to feedback: each goes straight to file storage, under the
// sender's own folder, before the feedback is sent.

const body = z.object({
  files: z
    .array(z.object({ name: z.string().min(1).max(255), type: z.string().max(200), size: z.number().int().positive().max(MAX_ATTACHMENT_SIZE) }))
    .min(1)
    .max(MAX_ATTACHMENTS),
});

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: `Up to ${MAX_ATTACHMENTS} files, each up to 50 MB` }, { status: 400 });
  const uploads = await Promise.all(
    parsed.data.files.map(async (f) => {
      const key = `${attachmentPrefix(user.id)}${randomUUID()}/${safeName(f.name)}`;
      const contentType = f.type || "application/octet-stream";
      return { key, name: f.name, type: contentType, size: f.size, upload: await signedWriteUrl(key, { contentType }) };
    }),
  );
  return Response.json({ uploads });
}
