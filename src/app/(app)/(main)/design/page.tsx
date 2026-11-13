import type { Metadata } from "next";
import { DesignList } from "@/components/design/design-list";
import { DesignCatalog, NewDesignMenu } from "@/components/design/design-list-actions";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { CATEGORIES, kindInfo } from "@/lib/design/kinds";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Design" };

/** The Design section: the designs made, and a menu of what can be designed. */
export default async function DesignPage() {
  const user = await requireUser();
  const designs = await db.design.findMany({ where: { orgId: user.orgId }, orderBy: { updatedAt: "desc" }, include: { project: { select: { id: true, name: true } } } });
  const categories = CATEGORIES.map((c) => ({ id: c.id, name: c.name, kinds: c.kinds.map((k) => ({ id: k.id, name: k.name, short: k.short, available: k.available })) }));
  const categoryOf = (kind: string) => CATEGORIES.find((c) => c.kinds.some((k) => k.id === kind))?.id ?? "other";
  const order = CATEGORIES.flatMap((c) => c.kinds.map((k) => k.id as string));
  const kindOrder = (kind: string) => (order.includes(kind) ? order.indexOf(kind) : order.length); // unknown kinds last

  return (
    <PageBody>
      <PageHeader title="Design" description="Highway structures to AASHTO LRFD, worked out as you enter them, with every check and its code reference, and a calc package to print." actions={<NewDesignMenu categories={categories} />} />
      {designs.length === 0 ? (
        <Card>
          <CardContent className="space-y-4 py-5">
            <p className="text-sm text-muted-foreground">Start a design:</p>
            <DesignCatalog categories={categories} />
          </CardContent>
        </Card>
      ) : (
        <>
          <DesignList
            designs={designs.map((d) => ({ id: d.id, name: d.name, kind: d.kind, kindName: kindInfo(d.kind)?.name ?? d.kind, kindOrder: kindOrder(d.kind), category: categoryOf(d.kind), project: d.project, updatedAt: d.updatedAt.toISOString() }))}
            categories={categories}
          />
          <details className="group rounded-lg border bg-card px-4 py-2">
            <summary className="cursor-pointer list-none py-1 text-sm font-medium select-none">
              <span className="mr-1 inline-block transition-transform group-open:rotate-90">›</span>
              All design types
            </summary>
            <div className="pt-3 pb-2">
              <DesignCatalog categories={categories} />
            </div>
          </details>
        </>
      )}
    </PageBody>
  );
}
