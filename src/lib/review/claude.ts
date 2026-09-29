import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { env } from "@/lib/env";
import type { SheetLine } from "./lines";

// One sheet, one request: the sheet image and its text (numbered lines), plus the manual
// sections most relevant to it. Claude returns only issues, each tied to sheet lines and
// the section it relies on, so they can be clouded on the sheet and cited.

export const REVIEW_MODEL = "claude-opus-5-5";
const PRICE_PER_MTOK = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 }; // USD, list prices

const Issue = z.object({
  title: z.string().describe("Short headline, under 80 characters"),
  detail: z.string().describe("One or two sentences: what the sheet shows and what the manual requires"),
  severity: z.enum(["major", "minor"]),
  line_ids: z.array(z.number().int()).describe("Ids of the sheet text lines the issue is about; empty if it's about something missing"),
  excerpt_id: z.string().nullable().describe("Id of the manual excerpt it relies on, e.g. E3; null for an inconsistency within the sheet"),
});
const Result = z.object({ issues: z.array(Issue) });
export type ReviewFinding = z.infer<typeof Issue>;

export type Excerpt = { id: string; source: string; number: string | null; title: string; page: number; text: string };

const SYSTEM = `You check one construction drawing sheet against excerpts from the design manuals the reviewer chose, the way an experienced plan reviewer marks up a set.

Report only real issues:
- something on the sheet that conflicts with a requirement in the excerpts;
- something the excerpts require on this kind of sheet that is clearly missing from it;
- a plain inconsistency within the sheet (for example, a value stated two different ways), only when you're sure.

Don't report topics the excerpts don't cover, drafting style, or anything you can't read with confidence. A few well-founded issues are better than many weak ones, and an empty list is a good answer when the sheet is fine. Quote the sheet and the manual precisely in the detail.`;

let client: Anthropic | undefined;
const anthropic = () => (client ??= new Anthropic({ apiKey: env().ANTHROPIC_API_KEY }));

export async function reviewSheetWithClaude(input: {
  sheetName: string;
  setName: string;
  lines: SheetLine[];
  imageJpegBase64: string | null;
  excerpts: Excerpt[];
}) {
  const text = [
    `Sheet: ${input.sheetName} (from drawing set "${input.setName}")`,
    "",
    input.lines.length
      ? "Sheet text, as numbered lines read from the PDF (the image shows the layout):"
      : "This sheet has no text layer; read it from the image.",
    ...input.lines.map((l) => `L${l.id}: ${l.text}`),
    "",
    input.excerpts.length ? "Manual excerpts:" : "No manual excerpts matched this sheet; report only clear inconsistencies within it.",
    ...input.excerpts.map(
      (e) => `\n[${e.id}] ${e.source} — ${[e.number, e.title].filter(Boolean).join(" ")} (PDF page ${e.page})\n${e.text}`,
    ),
  ].join("\n");

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (input.imageJpegBase64) {
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: input.imageJpegBase64 } });
  }
  content.push({ type: "text", text });

  const response = await anthropic().beta.messages.parse({
    model: REVIEW_MODEL,
    max_tokens: 16000,
    // If a safety classifier declines, the API retries on its recommended fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(Result) },
    system: SYSTEM,
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "refusal") throw new Error("The model declined to review this sheet");
  if (response.stop_reason === "max_tokens") throw new Error("The review was cut off; try again");
  const parsed = response.parsed_output;
  if (!parsed) throw new Error("The review came back in an unexpected format; try again");

  const u = response.usage;
  const inputTokens = u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  const costUsd =
    (u.input_tokens * PRICE_PER_MTOK.input +
      (u.cache_read_input_tokens ?? 0) * PRICE_PER_MTOK.cacheRead +
      (u.cache_creation_input_tokens ?? 0) * PRICE_PER_MTOK.cacheWrite +
      u.output_tokens * PRICE_PER_MTOK.output) /
    1_000_000;
  return { issues: parsed.issues, inputTokens, outputTokens: u.output_tokens, costUsd };
}
