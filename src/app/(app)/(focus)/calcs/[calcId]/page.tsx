import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalcEditor } from "@/components/calcs/calc-editor";
import { isUuid, requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";

/** The browser tab shows the worksheet's name. */
export async function generateMetadata({ params }: PageProps<"/calcs/[calcId]">): Promise<Metadata> {
  const { calcId } = await params;
  const user = await requireUser();
  const calc = isUuid(calcId) ? await db.calc.findFirst({ where: { id: calcId, orgId: user.orgId }, select: { name: true } }) : null;
  return { title: calc?.name ?? "Calcs" };
}

/** A worksheet open in the Calcs editor, full screen. */
export default async function CalcPage({ params, searchParams }: PageProps<"/calcs/[calcId]">) {
  const { calcId } = await params;
  const query = await searchParams;
  const system = query.system === "SI" ? "SI" : "USCS";
  const template = typeof query.template === "string" ? query.template : undefined;
  const user = await requireUser();
  const calc = isUuid(calcId) ? await db.calc.findFirst({ where: { id: calcId, orgId: user.orgId }, select: { id: true, name: true, revision: true } }) : null;
  if (!calc) notFound();
  return <CalcEditor key={calc.id} calc={calc} system={system} template={template} backHref="/calcs" />;
}
