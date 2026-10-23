import { updateProjectBilling, updateProjectDetails } from "@/app/actions/projects";
import { ProjectBillingForm, ProjectDetailsForm } from "@/components/projects/project-form";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireProject } from "@/lib/auth/session";
import { mapsConfig } from "@/lib/maps/config";

export default async function ProjectSettingsPage({ params }: PageProps<"/projects/[projectId]/settings">) {
  const { project } = await requireProject((await params).projectId);

  return (
    <PageBody>
      <PageHeader title="Settings" description="The project's details, and the settings used for quantities, pricing and payment valuation." />
      <Card className="max-w-4xl">
        <CardHeader>
          <CardTitle>Project details</CardTitle>
        </CardHeader>
        <CardContent>
          <ProjectDetailsForm
            action={updateProjectDetails.bind(null, project.id)}
            initial={{
              name: project.name,
              description: project.description ?? "",
              location: project.location ?? "",
              pin: project.latitude !== null && project.longitude !== null ? { lat: project.latitude, lon: project.longitude } : null,
            }}
            maps={mapsConfig()}
            submitLabel="Save changes"
            pendingLabel="Saving…"
          />
        </CardContent>
      </Card>
      <Card className="max-w-4xl">
        <CardHeader>
          <CardTitle>Units and billing</CardTitle>
          <CardDescription>Units apply to measurements; the rest to the SOV / BoQ, exports and payment applications.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProjectBillingForm
            action={updateProjectBilling.bind(null, project.id)}
            initial={{
              currency: project.currency,
              measurementStandard: project.measurementStandard,
              retentionPct: project.retentionPct.toString(),
              unitSystem: project.unitSystem,
            }}
          />
        </CardContent>
      </Card>
    </PageBody>
  );
}
