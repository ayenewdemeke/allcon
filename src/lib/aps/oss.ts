import "server-only";
import { env } from "@/lib/env";
import { APS_BASE, getInternalToken } from "./auth";

const OSS = `${APS_BASE}/oss/v2`;

// OSS allows up to 25 signed part URLs per request; 64 MB parts cover files up to 1.6 GB.
export const PART_SIZE = 64 * 1024 * 1024;
export const MAX_PARTS = 25;
export const MAX_FILE_SIZE = PART_SIZE * MAX_PARTS;

async function authHeaders() {
  return { Authorization: `Bearer ${await getInternalToken()}` };
}

let bucketReady = false;

export async function ensureBucket() {
  if (bucketReady) return;
  const res = await fetch(`${OSS}/buckets`, {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ bucketKey: env().APS_BUCKET_KEY, policyKey: "persistent" }),
  });
  // 409 = bucket already exists (and is ours, otherwise creation would be refused with 403).
  if (!res.ok && res.status !== 409) {
    throw new Error(`Could not create OSS bucket (${res.status}): ${await res.text()}`);
  }
  bucketReady = true;
}

function objectUrl(objectKey: string) {
  return `${OSS}/buckets/${env().APS_BUCKET_KEY}/objects/${encodeURIComponent(objectKey)}/signeds3upload`;
}

/** Signed S3 URLs the browser PUTs file parts to directly. */
export async function getUploadUrls(objectKey: string, parts: number) {
  await ensureBucket();
  const res = await fetch(`${objectUrl(objectKey)}?parts=${parts}&minutesExpiration=60`, {
    headers: await authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Could not get upload URLs (${res.status}): ${await res.text()}`);
  const data: { uploadKey: string; urls: string[] } = await res.json();
  return data;
}

export async function completeUpload(objectKey: string, uploadKey: string) {
  const res = await fetch(objectUrl(objectKey), {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ uploadKey }),
  });
  if (!res.ok) throw new Error(`Could not complete upload (${res.status}): ${await res.text()}`);
  const data: { objectId: string; size: number } = await res.json();
  return data;
}

/** Derivative URN: URL-safe base64 of the OSS objectId, without padding. */
export function toUrn(objectId: string) {
  return Buffer.from(objectId).toString("base64url");
}

/** Short-lived direct download URL; S3 honours Range requests, which the PDF viewer relies on. */
export async function getDownloadUrl(objectKey: string, minutes = 60) {
  const res = await fetch(
    `${OSS}/buckets/${env().APS_BUCKET_KEY}/objects/${encodeURIComponent(objectKey)}/signeds3download?minutesExpiration=${minutes}`,
    { headers: await authHeaders(), cache: "no-store" },
  );
  if (!res.ok) throw new Error(`Could not get download URL (${res.status}): ${await res.text()}`);
  const data: { url: string; size: number } = await res.json();
  return data;
}

/** Uploads a small server-side buffer (e.g. a compressed JSON dump) in a single part. */
export async function uploadBuffer(objectKey: string, body: Uint8Array) {
  const { uploadKey, urls } = await getUploadUrls(objectKey, 1);
  const put = await fetch(urls[0], { method: "PUT", body: body as BodyInit });
  if (!put.ok) throw new Error(`Could not upload ${objectKey} (${put.status})`);
  return completeUpload(objectKey, uploadKey);
}

/** Downloads a whole object into memory; for small files only. */
export async function downloadBuffer(objectKey: string) {
  const { url } = await getDownloadUrl(objectKey, 5);
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not download ${objectKey} (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function deleteObject(objectKey: string) {
  const res = await fetch(`${OSS}/buckets/${env().APS_BUCKET_KEY}/objects/${encodeURIComponent(objectKey)}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok && res.status !== 404) throw new Error(`Could not delete ${objectKey} (${res.status})`);
}
