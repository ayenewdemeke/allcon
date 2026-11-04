import type { Metadata } from "next";
import { MessageSquare, Paperclip } from "lucide-react";
import { FeedbackReview, SendFeedbackButton } from "@/components/feedback/feedback-actions";
import { LocalTime } from "@/components/local-time";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { isAdminEmail } from "@/lib/env";
import { kindLabel, statusLabel, type Attachment } from "@/lib/feedback";
import { signedReadUrl } from "@/lib/storage";

export const metadata: Metadata = { title: "Feedback" };

const STATUS_VARIANT: Record<string, "secondary" | "info" | "warning" | "success" | "outline"> = { new: "secondary", reviewing: "info", planned: "warning", done: "success", declined: "outline" };

type Item = { id: string; kind: string; message: string; page: string | null; status: string; reply: string | null; createdAt: Date; attachments: unknown; user?: { name: string | null; email: string } | null };

/** Links to an item's files, good for a few minutes (the page is made fresh each visit). */
async function files(item: Item) {
  const list = (Array.isArray(item.attachments) ? item.attachments : []) as Attachment[];
  return Promise.all(list.map(async (a) => ({ ...a, url: await signedReadUrl(a.key, { downloadAs: a.name }) })));
}

async function FeedbackCard({ item, admin }: { item: Item; admin: boolean }) {
  const attached = await files(item);
  return (
    <Card>
      <CardContent className="space-y-2 py-3 text-sm">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant={STATUS_VARIANT[item.status] ?? "secondary"}>{statusLabel(item.status)}</Badge>
          <span className="font-medium text-foreground">{kindLabel(item.kind)}</span>
          <span>·</span>
          <LocalTime date={item.createdAt} />
          {admin && item.user && (
            <>
              <span>·</span>
              <span>{item.user.name ? `${item.user.name} (${item.user.email})` : item.user.email}</span>
            </>
          )}
          {item.page && (
            <>
              <span>·</span>
              <span className="truncate font-mono text-[11px]">{item.page}</span>
            </>
          )}
        </div>
        <p className="whitespace-pre-wrap">{item.message}</p>
        {attached.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attached.map((a) => (
              <a key={a.key} href={a.url} className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs hover:bg-accent">
                <Paperclip className="size-3" />
                {a.name}
              </a>
            ))}
          </div>
        )}
        {admin ? (
          <FeedbackReview id={item.id} status={item.status} reply={item.reply ?? ""} />
        ) : (
          item.reply && (
            <div className="rounded-md bg-muted/60 px-3 py-2 text-xs">
              <span className="font-medium">Reply: </span>
              <span className="whitespace-pre-wrap">{item.reply}</span>
            </div>
          )
        )}
      </CardContent>
    </Card>
  );
}

export default async function FeedbackPage() {
  const user = await requireUser();
  const admin = isAdminEmail(user.email);
  const [mine, all] = await Promise.all([
    db.feedback.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 100 }),
    admin ? db.feedback.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { user: { select: { name: true, email: true } } } }) : null,
  ]);
  return (
    <PageBody>
      <PageHeader title="Feedback" description="Ideas, problems and questions about allcon, and what's become of them." actions={<SendFeedbackButton />} />
      {all && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Everyone&apos;s feedback ({all.filter((f) => f.status === "new").length} new)</h2>
          {all.length ? all.map((item) => <FeedbackCard key={item.id} item={item} admin />) : <p className="text-sm text-muted-foreground">None yet.</p>}
        </section>
      )}
      {!admin && (
        <section className="space-y-2">
          {mine.length ? (
            mine.map((item) => <FeedbackCard key={item.id} item={item} admin={false} />)
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
                <MessageSquare className="size-6" />
                You haven&apos;t sent any feedback yet. Ideas, problems and questions are all welcome.
              </CardContent>
            </Card>
          )}
        </section>
      )}
    </PageBody>
  );
}
