"use server";

import { z } from "zod";
import { getCurrentUser, isUuid } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { newModelShareToken } from "@/lib/ifc/model-share";

const shareUrl = (token: string) => `${env().APP_URL}/share/model/${token}`;

async function requireModel(modelId: string) {
  const user = await getCurrentUser();
  if (!user || !isUuid(modelId)) throw new Error("Model not found");
  const model = await db.ifcModel.findFirst({ where: { id: modelId, project: { orgId: user.orgId } }, select: { id: true } });
  if (!model) throw new Error("Model not found");
  return { user, model };
}

export async function createModelShareLink(modelId: string, input: { allowDownload: boolean; expiresInDays: number | null }) {
  const { user, model } = await requireModel(modelId);
  const data = z.object({ allowDownload: z.boolean(), expiresInDays: z.number().int().min(1).max(365).nullable() }).parse(input);
  const link = await db.modelShareLink.create({
    data: {
      token: newModelShareToken(),
      modelId: model.id,
      allowDownload: data.allowDownload,
      expiresAt: data.expiresInDays ? new Date(Date.now() + data.expiresInDays * 86_400_000) : null,
      createdById: user.id,
    },
  });
  return { id: link.id, url: shareUrl(link.token) };
}

export type ModelShareSummary = {
  id: string;
  url: string;
  allowDownload: boolean;
  expiresAt: string | null; // null = no expiry
  active: boolean;
  viewCount: number;
  createdAt: string;
};

export async function listModelShareLinks(modelId: string): Promise<ModelShareSummary[]> {
  const { model } = await requireModel(modelId);
  const links = await db.modelShareLink.findMany({ where: { modelId: model.id }, orderBy: { createdAt: "desc" } });
  const now = new Date();
  return links.map((l) => ({
    id: l.id,
    url: shareUrl(l.token),
    allowDownload: l.allowDownload,
    expiresAt: l.expiresAt?.toISOString() ?? null,
    active: !l.revokedAt && (!l.expiresAt || l.expiresAt > now),
    viewCount: l.viewCount,
    createdAt: l.createdAt.toISOString(),
  }));
}

export async function revokeModelShareLink(id: string) {
  const user = await getCurrentUser();
  if (!user || !isUuid(id)) throw new Error("Link not found");
  const { count } = await db.modelShareLink.updateMany({
    where: { id, model: { project: { orgId: user.orgId } }, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (!count) throw new Error("Link not found");
}
