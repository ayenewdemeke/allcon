import { updateProject } from "@/app/actions/projects";
import { ProjectForm } from "@/components/projects/project-form";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireProject } from "@/lib/session";

export default async function ProjectSettingsPage({ params }: PageProps<"/projects/[projectId]/settings">) {
  const { project } = await requireProject((await params).projectId);

  return (
    <PageBody>
      <PageHeader title="Settings" description="Project details used across measurement and valuation." />
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Project details</CardTitle>
          <CardDescription>Currency and retainage apply to exports and payment applications.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProjectForm
            action={updateProject.bind(null, project.id)}
            initial={{
              name: project.name,
              currency: project.currency,
              measurementStandard: project.measurementStandard,
              retentionPct: project.retentionPct.toString(),
            }}
            submitLabel="Save changes"
            pendingLabel="Saving…"
          />
        </CardContent>
      </Card>
    </PageBody>
  );
}
