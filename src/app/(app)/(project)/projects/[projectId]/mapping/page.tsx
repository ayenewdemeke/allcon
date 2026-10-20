import { GitMerge } from "lucide-react";
import { MappingWorkspace, type GroupRow, type LineItemOption } from "@/components/mapping/mapping-workspace";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { LinkButton } from "@/components/ui/link-button";
import { Card, CardContent } from "@/components/ui/card";
import { db } from "@/lib/db";
import { BOQ } from "@/lib/line-items/terms";
import { requireProject } from "@/lib/auth/session";
import { countedModels, elementGroups, modelNames, type GroupConditions } from "@/lib/mapping/server";
import { suggest } from "@/lib/mapping/suggest";

const groupKey = (g: GroupConditions) => `${g.category ?? ""}\u0000${g.typeName ?? ""}`;

export default async function MappingPage({ params }: PageProps<"/projects/[projectId]/mapping">) {
  const { project } = await requireProject((await params).projectId);
  const [scope, items] = await Promise.all([
    countedModels(project.id),
    db.lineItem.findMany({ where: { projectId: project.id }, orderBy: { sortOrder: "asc" } }),
  ]);
  const lines = items.filter((i) => !i.isHeading);

  const empty = (title: string, body: string, href: string, action: string) => (
    <PageBody>
      <PageHeader title="Mapping" />
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <GitMerge className="size-6" />
          </div>
          <p className="font-medium">{title}</p>
          <p className="max-w-md text-sm text-muted-foreground">{body}</p>
          <LinkButton href={href}>{action}</LinkButton>
        </CardContent>
      </Card>
    </PageBody>
  );
  if (!lines.length) {
    return empty(
      `Import your ${BOQ.title} first`,
      `Mapping links model elements to the ${BOQ.items} of your ${BOQ.title}.`,
      `/projects/${project.id}/line-items`,
      `Go to ${BOQ.title}`,
    );
  }
  if (!scope.sources.length) {
    return empty(
      "No model to map yet",
      "Upload a Revit or IFC model, or have your AI app build one from the drawings. Models switched off on the Models page don't count.",
      `/projects/${project.id}/models`,
      "Go to models",
    );
  }

  const [groups, rules] = await Promise.all([
    elementGroups(scope),
    db.mappingRule.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "asc" } }),
  ]);

  const names = new Map<string, string>([
    ...(scope.upload ? ([[scope.upload.id, scope.upload.fileName]] as [string, string][]) : []),
    ...scope.built.map((m) => [m.id, m.name] as [string, string]),
  ]);
  const suggestionItems = lines.map((l) => ({ id: l.id, code: l.code, description: l.description, unit: l.unit }));
  const rulesByGroup = new Map<string, typeof rules>();
  for (const r of rules) {
    const key = groupKey(r.conditions as GroupConditions);
    rulesByGroup.set(key, [...(rulesByGroup.get(key) ?? []), r]);
  }

  const rows: GroupRow[] = groups.map((g) => {
    const groupRules = rulesByGroup.get(groupKey(g)) ?? [];
    const s = groupRules.length ? null : suggest(g, suggestionItems);
    const upload = g.sources.find((src) => src.kind === "upload");
    const built = g.sources.filter((src) => src.kind === "built");
    return {
      ...g,
      key: groupKey(g),
      // An uploaded model highlights the group (the focus is appended); an AI-built one opens.
      viewHref: upload
        ? `/projects/${project.id}/models/${upload.id}?focus=`
        : built[0]
          ? `/projects/${project.id}/models/ifc/${built[0].id}`
          : null,
      modelLabel: scope.sources.length > 1 ? g.sources.map((src) => names.get(src.id) ?? "").filter(Boolean).join(", ") : "",
      rules: groupRules.map((r) => ({ id: r.id, lineItemId: r.lineItemId, quantityKey: r.quantityKey, isAuto: r.isAuto })),
      suggestion: s,
    };
  });

  // The same kind of element in two counted models is usually the same thing modelled twice.
  const modelsByCategory = new Map<string, Set<string>>();
  for (const g of groups) for (const src of g.sources) modelsByCategory.set(g.category ?? "", (modelsByCategory.get(g.category ?? "") ?? new Set()).add(src.id));
  const overlapping = [...modelsByCategory].filter(([category, ids]) => category && ids.size > 1).map(([category]) => category);

  const headings = new Map(items.filter((i) => i.isHeading).map((h) => [h.id, h]));
  const options: LineItemOption[] = lines.map((l) => ({
    id: l.id,
    code: l.code,
    description: l.description,
    unit: l.unit,
    section: l.parentId ? [headings.get(l.parentId)?.code, headings.get(l.parentId)?.description].filter(Boolean).join(" ") : "Other",
  }));

  return (
    <PageBody>
      <PageHeader
        title="Mapping"
        description={
          <>
            Link element groups from <span className="font-medium text-foreground">{modelNames(scope)}</span> to your{" "}
            {BOQ.title} {BOQ.items}. Each mapping is a rule: it applies to matching groups in every counted model and carries over as models change.
          </>
        }
      />
      {overlapping.length > 0 && (
        <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          {overlapping.slice(0, 4).join(", ")}
          {overlapping.length > 4 && ` and ${overlapping.length - 4} more`} come from more than one counted model: check they&apos;re not counted
          twice, and switch off a model on the Models page if they are.
        </p>
      )}
      <MappingWorkspace
        projectId={project.id}
        unitSystem={project.unitSystem}
        groups={rows}
        lineItems={options}
      />
    </PageBody>
  );
}
