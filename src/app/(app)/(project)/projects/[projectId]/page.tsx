import Link from "next/link";
import { Box, FileSearch, Layers, ListChecks, Plug, Upload, type LucideIcon } from "lucide-react";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { requireProject } from "@/lib/auth/session";
import { BOQ } from "@/lib/line-items/terms";

// Connector calls that changed something in the project (reads aren't activity).
const EDIT_TOOLS = ["flag_issue", "add_cloud", "add_note", "rename_sheet", "create_3d_model", "update_3d_model", "create_detailed_model", "convert_to_detailed", "ifc_edit"];

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const day = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

function Section({ href, icon: Icon, title, value, hint }: { href: string; icon: LucideIcon; title: string; value: string; hint: string }) {
  return (
    <Link href={href} className="group">
      <Card size="sm" className="h-full transition-shadow group-hover:shadow-md group-hover:ring-primary/30">
        <CardContent className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
            <Icon className="size-4" />
          </div>
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium group-hover:text-primary">{title}</p>
            <p className="text-sm">{value}</p>
            <p className="text-xs text-muted-foreground">{hint}</p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

/** A project at a glance: what it holds, and what happened in it lately. */
export default async function ProjectOverviewPage({ params }: PageProps<"/projects/[projectId]">) {
  const { project } = await requireProject((await params).projectId);
  const where = { projectId: project.id };

  const [sets, sheetCount, markupCount, uploads, uploadCount, built, reviews, reviewCount, flagged, items, activity] = await Promise.all([
    db.drawingSet.findMany({ where: { ...where, status: "ready" }, orderBy: { uploadedAt: "desc" }, select: { id: true, fileName: true, pageCount: true, uploadedAt: true } }),
    db.sheet.count({ where: { drawingSet: where } }),
    db.markup.count({ where: { sheet: { drawingSet: where } } }),
    db.modelVersion.findMany({ where, orderBy: { uploadedAt: "desc" }, take: 10, select: { id: true, fileName: true, status: true, uploadedAt: true } }),
    db.modelVersion.count({ where }),
    db.ifcModel.count({ where }),
    db.review.findMany({ where, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, name: true, createdAt: true } }),
    db.review.count({ where }),
    db.reviewIssue.count({ where: { review: where, status: "kept" } }),
    db.lineItem.count({ where: { ...where, isHeading: false } }),
    db.mcpActivity.findMany({ where: { ...where, ok: true, tool: { in: EDIT_TOOLS } }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const clientIds = [...new Set(activity.map((a) => a.clientId).filter((c): c is string => !!c))];
  const clients = clientIds.length ? await db.oauthClient.findMany({ where: { clientId: { in: clientIds } }, select: { clientId: true, name: true } }) : [];
  const appName = new Map(clients.map((c) => [c.clientId, c.name || "Your AI app"]));

  const base = `/projects/${project.id}`;
  const models = uploadCount + built;
  const recent = [
    ...sets.map((s) => ({ at: s.uploadedAt, icon: Upload, text: `Uploaded ${s.fileName}${s.pageCount ? ` (${plural(s.pageCount, "sheet")})` : ""}`, href: `${base}/sheets` })),
    ...uploads.map((m) => ({ at: m.uploadedAt, icon: Upload, text: `Uploaded model ${m.fileName}`, href: m.status === "ready" ? `${base}/models/${m.id}` : `${base}/models` })),
    ...reviews.map((r) => ({ at: r.createdAt, icon: FileSearch, text: `Review: ${r.name}`, href: `${base}/reviews/${r.id}` })),
    ...activity.map((a) => ({ at: a.createdAt, icon: Plug, text: `${appName.get(a.clientId ?? "") ?? "Your AI app"}: ${a.summary}`, href: null })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 8);

  return (
    <PageBody>
      <PageHeader title={project.name} description={[project.location, project.description].filter(Boolean).join(" · ") || undefined} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Section
          href={`${base}/sheets`}
          icon={Layers}
          title="Sheets"
          value={sheetCount ? `${plural(sheetCount, "sheet")} in ${plural(sets.length, "set")}` : "No drawings yet"}
          hint={sheetCount ? plural(markupCount, "markup") : "Upload a PDF drawing set"}
        />
        <Section
          href={`${base}/models`}
          icon={Box}
          title="Models"
          value={models ? plural(models, "model") : "No models yet"}
          hint={models ? `${built} built from drawings · ${uploadCount} uploaded` : "Upload Revit or IFC, or have your AI app build one"}
        />
        <Section
          href={`${base}/reviews`}
          icon={FileSearch}
          title="Review"
          value={reviewCount ? plural(reviewCount, "review") : "No reviews yet"}
          hint={reviewCount ? `${plural(flagged, "issue")} flagged on sheets` : "Check sheets against your manuals"}
        />
        <Section
          href={`${base}/line-items`}
          icon={ListChecks}
          title={BOQ.title}
          value={items ? plural(items, BOQ.item) : "Not imported yet"}
          hint={items ? "Priced against models and sheets" : "Import from Excel or CSV"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nothing yet. Upload a drawing set to get started.</p>
          ) : (
            <ul className="divide-y">
              {recent.map((r, i) => (
                <li key={i} className="flex items-center gap-3 py-2.5 text-sm">
                  <r.icon className="size-4 shrink-0 text-muted-foreground" />
                  {r.href ? (
                    <Link href={r.href} className="min-w-0 flex-1 truncate hover:text-primary hover:underline">
                      {r.text}
                    </Link>
                  ) : (
                    <span className="min-w-0 flex-1 truncate">{r.text}</span>
                  )}
                  <span className="shrink-0 text-xs text-muted-foreground">{day(r.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </PageBody>
  );
}
