"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireProject, requireUser } from "@/lib/session";

const projectInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  currency: z.string().trim().length(3, "Use a 3-letter currency code").toUpperCase(),
  measurementStandard: z.enum(["CSI", "NRM2", "SMM7", "custom"]),
  retentionPct: z.coerce.number().min(0).max(100),
});

export type ProjectFormState = { error?: string; saved?: boolean };

function parse(formData: FormData) {
  const parsed = projectInput.safeParse(Object.fromEntries(formData));
  return parsed.success
    ? { data: parsed.data }
    : { error: parsed.error.issues[0]?.message ?? "Invalid input" };
}

export async function createProject(_prev: ProjectFormState, formData: FormData): Promise<ProjectFormState> {
  const user = await requireUser();
  const { data, error } = parse(formData);
  if (!data) return { error };

  const project = await db.project.create({ data: { ...data, orgId: user.orgId } });
  redirect(`/projects/${project.id}`);
}

export async function updateProject(
  projectId: string,
  _prev: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const { project } = await requireProject(projectId);
  const { data, error } = parse(formData);
  if (!data) return { error };

  await db.project.update({ where: { id: project.id }, data });
  // The name appears in the sidebar and breadcrumbs across the whole project.
  revalidatePath(`/projects/${project.id}`, "layout");
  return { saved: true };
}
