import { GitMerge } from "lucide-react";
import { MappingWorkspace, type GroupRow, type LineItemOption } from "@/components/mapping/mapping-workspace";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { LinkButton } from "@/components/ui/link-button";
import { Card, CardContent } from "@/components/ui/card";
import { db } from "@/lib/db";
import { boqTerms } from "@/lib/line-items/terms";
import { requireProject } from "@/lib/auth/session";
import { currentModelVersion, elementGroups, type GroupConditions } from "@/lib/mapping/server";
import { suggest } from "@/lib/mapping/suggest";

const groupKey = (g: GroupConditions) => `${g.category ?? ""}\u0000${g.typeName ?? ""}`;

export default async function MappingPage({ params }: PageProps<"/projects/[projectId]/mapping">) {
  const { project } = await requireProject((await params).projectId);
  const [version, items] = await Promise.all([
    currentModelVersion(project.id),
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
    const terms = boqTerms(project.measurementStandard);
    return empty(
      `Import your ${terms.title.toLowerCase()} first`,
      `Mapping links model elements to the ${terms.items} of your ${terms.title.toLowerCase()}.`,
      `/projects/${project.id}/line-items`,
      `Go to ${terms.title.toLowerCase()}`,
    );
  }
  if (!version) {
    return empty("No model to map yet", "Upload a Revit or IFC model; once it's processed its elements appear here.", `/projects/${project.id}/models`, "Go to models");
  }

  const [groups, rules] = await Promise.all([
    elementGroups(version.id),
    db.mappingRule.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "asc" } }),
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
    return {
      ...g,
      key: groupKey(g),
      rules: groupRules.map((r) => ({ id: r.id, lineItemId: r.lineItemId, quantityKey: r.quantityKey, isAuto: r.isAuto })),
      suggestion: s,
    };
  });

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
            Link element groups from <span className="font-medium text-foreground">{version.fileName}</span> to your line
            items. Each mapping is a rule, so it carries over to future model versions.
          </>
        }
      />
      <MappingWorkspace
        projectId={project.id}
        modelVersionId={version.id}
        unitSystem={project.unitSystem}
        groups={rows}
        lineItems={options}
      />
    </PageBody>
  );
}
