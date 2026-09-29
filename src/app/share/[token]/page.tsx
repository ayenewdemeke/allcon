import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, FileText } from "lucide-react";
import { ShareHeader, ShareUnavailable } from "@/components/share/share-header";
import { db } from "@/lib/db";
import { sheetName } from "@/lib/sheets/export-data";
import { findActiveShare, recordShareView, sharedByName } from "@/lib/sheets/share";

/** A share link's landing page: opens the sheet straight away, or lists them if there are several. */
export default async function SharePage({ params }: PageProps<"/share/[token]">) {
  const { token } = await params;
  const share = await findActiveShare(token);
  if (!share) return <ShareUnavailable />;

  const sheets = await db.sheet.findMany({
    where: { drawingSetId: share.drawingSetId, id: { in: share.sheetIds } },
    orderBy: { pageIndex: "asc" },
    select: { id: true, pageIndex: true, number: true, title: true, _count: { select: { markups: true } } },
  });
  if (!sheets.length) return <ShareUnavailable />;
  await recordShareView(share.id);
  if (sheets.length === 1) redirect(`/share/${token}/${sheets[0].id}`);

  const sharedBy = sharedByName(share);
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <ShareHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 p-6">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{share.project.name}</p>
        <h1 className="mt-1 text-xl font-semibold">{share.drawingSet.fileName.replace(/\.pdf$/i, "")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Shared by {sharedBy} · read-only · available until{" "}
          {share.expiresAt.toLocaleDateString("en-US", { dateStyle: "medium" })}
        </p>
        <ul className="mt-6 divide-y rounded-lg border bg-card">
          {sheets.map((s) => (
            <li key={s.id}>
              <Link href={`/share/${token}/${s.id}`} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/50">
                <FileText className="size-4 text-muted-foreground" />
                <span className="flex-1 font-medium">{sheetName(s)}</span>
                <span className="text-xs text-muted-foreground">
                  {s._count.markups} markup{s._count.markups === 1 ? "" : "s"}
                </span>
                <ChevronRight className="size-4 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
