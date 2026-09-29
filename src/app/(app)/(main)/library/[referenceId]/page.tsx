import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { ReferenceActions } from "@/components/library/reference-actions";
import { ReferenceSections } from "@/components/library/reference-sections";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { LinkButton } from "@/components/ui/link-button";
import { db } from "@/lib/db";
import { isUuid, requireUser } from "@/lib/auth/session";

export default async function ReferencePage({ params }: PageProps<"/library/[referenceId]">) {
  const user = await requireUser();
  const { referenceId } = await params;
  const reference = isUuid(referenceId)
    ? await db.reference.findFirst({ where: { id: referenceId, orgId: user.orgId } })
    : null;
  if (!reference) notFound();
  const sections = await db.referenceSection.findMany({
    where: { referenceId: reference.id },
    orderBy: { sortOrder: "asc" },
    select: { id: true, number: true, title: true, page: true, text: true },
  });

  return (
    <PageBody>
      <PageHeader
        title={reference.title}
        description={`${reference.fileName}${reference.pageCount ? ` · ${reference.pageCount} pages` : ""} · ${sections.length} sections`}
        actions={
          <>
            {reference.status === "ready" && (
              <LinkButton variant="outline" size="sm" href={`/api/references/${reference.id}/pdf`} target="_blank" prefetch={false}>
                <FileText /> Open PDF
              </LinkButton>
            )}
            <ReferenceActions referenceId={reference.id} title={reference.title} />
          </>
        }
      />
      <ReferenceSections
        referenceId={reference.id}
        sections={sections.map((s) => ({
          id: s.id,
          number: s.number,
          title: s.title,
          page: s.page,
          // Skip the heading line itself so the preview shows the section's content.
          preview: s.text.split("\n").slice(1, 3).join(" ").slice(0, 200),
        }))}
      />
    </PageBody>
  );
}
