// Feedback people send from the app: what kinds there are, the statuses an admin moves it
// through, and the limits on attached files.

export const FEEDBACK_KINDS = [
  { id: "idea", label: "Idea" },
  { id: "bug", label: "Something's wrong" },
  { id: "question", label: "Question" },
] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]["id"];

export const FEEDBACK_STATUSES = [
  { id: "new", label: "Received" },
  { id: "reviewing", label: "Under review" },
  { id: "planned", label: "Planned" },
  { id: "done", label: "Done" },
  { id: "declined", label: "Not planned" },
] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number]["id"];

export const statusLabel = (id: string) => FEEDBACK_STATUSES.find((s) => s.id === id)?.label ?? id;
export const kindLabel = (id: string) => FEEDBACK_KINDS.find((k) => k.id === id)?.label ?? id;

export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024; // 50 MB
export const MAX_MESSAGE = 5000;

export type Attachment = { key: string; name: string; type: string; size: number };

/** Where a person's attachments are stored: only keys under their own folder are accepted. */
export const attachmentPrefix = (userId: string) => `feedback/${userId}/`;

/** A file name made safe for a storage key. */
export const safeName = (name: string) => name.replace(/[^\w.-]+/g, "_").slice(-120) || "file";
