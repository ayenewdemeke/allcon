"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireProject, requireUser } from "@/lib/auth/session";
import { regionalDefaults } from "@/lib/projects/defaults";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .optional();

const detailsInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  description: optionalText(1000),
  location: optionalText(200),
});

const billingInput = z.object({
  currency: z.string().trim().length(3, "Use a 3-letter currency code").toUpperCase(),
  measurementStandard: z.enum(["CSI", "NRM2", "SMM7", "custom"]),
  retentionPct: z.coerce.number().min(0).max(100),
  unitSystem: z.enum(["imperial", "metric"]),
});

export type ProjectFormState = { error?: string; saved?: boolean };

function parse<T extends z.ZodType>(schema: T, formData: FormData) {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  return parsed.success ? { data: parsed.data as z.infer<T> } : { error: parsed.error.issues[0]?.message ?? "Invalid input" };
}

/** A new project needs only a name; currency, standard and units follow its location (US otherwise). */
export async function createProject(_prev: ProjectFormState, formData: FormData): Promise<ProjectFormState> {
  const user = await requireUser();
  const { data, error } = parse(detailsInput, formData);
  if (!data) return { error };

  const project = await db.project.create({ data: { ...data, ...regionalDefaults(data.location), orgId: user.orgId } });
  redirect(`/projects/${project.id}`);
}

export async function updateProjectDetails(projectId: string, _prev: ProjectFormState, formData: FormData): Promise<ProjectFormState> {
  const { project } = await requireProject(projectId);
  const { data, error } = parse(detailsInput, formData);
  if (!data) return { error };

  await db.project.update({ where: { id: project.id }, data: { ...data, description: data.description ?? null, location: data.location ?? null } });
  // The name appears in the sidebar and breadcrumbs across the whole project.
  revalidatePath(`/projects/${project.id}`, "layout");
  return { saved: true };
}

export async function updateProjectBilling(projectId: string, _prev: ProjectFormState, formData: FormData): Promise<ProjectFormState> {
  const { project } = await requireProject(projectId);
  const { data, error } = parse(billingInput, formData);
  if (!data) return { error };

  await db.project.update({ where: { id: project.id }, data });
  revalidatePath(`/projects/${project.id}`, "layout");
  return { saved: true };
}
