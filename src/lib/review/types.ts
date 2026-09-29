// Shapes shared by the review pages (server) and the review workspace (client).

export type ReviewIssueView = {
  id: string;
  sheetId: string;
  title: string;
  detail: string;
  severity: "major" | "minor";
  quote: string | null;
  citation: string | null; // "CDOT Bridge Design Manual §5.4.3 Clear Cover"
  referenceId: string | null;
  page: number | null; // manual page to open the citation at
  status: "suggested" | "kept" | "dismissed";
  located: boolean; // has a spot on the sheet (otherwise the note goes in the corner)
};

export type ReviewSheetView = {
  id: string;
  pageIndex: number;
  name: string;
  status: "running" | "done" | "failed" | null; // null = not reviewed yet
  error: string | null;
  costUsd: number;
};

type IssueRow = {
  id: string;
  sheetId: string;
  title: string;
  detail: string;
  severity: "major" | "minor";
  quote: string | null;
  box: unknown;
  citation: string | null;
  referenceId: string | null;
  status: "suggested" | "kept" | "dismissed";
  section: { page: number } | null;
};

export const toIssueView = (i: IssueRow): ReviewIssueView => ({
  id: i.id,
  sheetId: i.sheetId,
  title: i.title,
  detail: i.detail,
  severity: i.severity,
  quote: i.quote,
  citation: i.citation,
  referenceId: i.referenceId,
  page: i.section?.page ?? null,
  status: i.status,
  located: Array.isArray(i.box),
});

/** Note text for a kept issue: wrapped to the note's width and a few lines, as notes are drawn. */
export function issueNoteText(issue: { title: string; detail: string; citation: string | null }, width = 42, maxLines = 6) {
  const wrap = (text: string) => {
    const out: string[] = [];
    let line = "";
    for (const word of text.split(/\s+/).filter(Boolean)) {
      if (line && (line + " " + word).length > width) {
        out.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    if (line) out.push(line);
    return out;
  };
  const head = wrap(issue.title);
  const cite = issue.citation ? wrap(`Ref: ${issue.citation}`) : [];
  const room = Math.max(1, maxLines - head.length - cite.length);
  let body = wrap(issue.detail);
  if (body.length > room) body = [...body.slice(0, room - 1), `${body[room - 1].slice(0, width - 1)}…`];
  return [...head, ...body, ...cite].slice(0, maxLines).join("\n");
}
