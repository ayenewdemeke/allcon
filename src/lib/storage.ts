import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectsCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/lib/env";

// Files the app makes (3D model IFCs, their backups, viewer copies) live in object storage,
// Cloudflare R2, and the database keeps only their keys. Browsers and the IFC engine read and
// write them directly through short-lived signed links, so no request body limit applies.
// Without R2 keys (local development) a folder stands in, served by /api/dev-storage with
// signed links that behave the same way.

export type StoredFile = { contentType: string; gzipped?: boolean };

const LOCAL_DIR = path.join(process.cwd(), ".local-storage");
const DEFAULT_TTL = 15 * 60; // seconds

function r2() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = env();
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) return null;
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });
  return { client, bucket: R2_BUCKET };
}

/** A new, never-reused key: files are written once and replaced by new keys, never overwritten. */
export const newFileKey = (prefix: string, extension: string) => `${prefix}/${randomUUID()}${extension}`;

const localPath = (key: string) => {
  const full = path.join(LOCAL_DIR, key);
  if (!full.startsWith(LOCAL_DIR + path.sep)) throw new Error("Invalid storage key");
  return full;
};

export async function putFile(key: string, body: Uint8Array, file: StoredFile) {
  const s3 = r2();
  if (s3) {
    await s3.client.send(
      new PutObjectCommand({ Bucket: s3.bucket, Key: key, Body: body, ContentType: file.contentType, ContentEncoding: file.gzipped ? "gzip" : undefined }),
    );
    return;
  }
  await mkdir(path.dirname(localPath(key)), { recursive: true });
  await writeFile(localPath(key), body);
}

/** A file's bytes as stored (gzipped files stay gzipped). */
export async function getFile(key: string): Promise<Uint8Array> {
  const s3 = r2();
  if (s3) {
    const res = await s3.client.send(new GetObjectCommand({ Bucket: s3.bucket, Key: key }));
    return new Uint8Array(await res.Body!.transformToByteArray());
  }
  return new Uint8Array(await readFile(localPath(key)));
}

export async function deleteFiles(keys: (string | null | undefined)[]) {
  const list = [...new Set(keys.filter((k): k is string => !!k))];
  if (!list.length) return;
  const s3 = r2();
  if (s3) {
    await s3.client.send(new DeleteObjectsCommand({ Bucket: s3.bucket, Delete: { Objects: list.map((Key) => ({ Key })) } }));
    return;
  }
  await Promise.all(list.map((k) => rm(localPath(k), { force: true })));
}

// --- signed links -------------------------------------------------------------------------

const devSignature = (op: string, key: string, exp: number, extra = "") =>
  createHmac("sha256", env().BETTER_AUTH_SECRET).update(`${op}\n${key}\n${exp}\n${extra}`).digest("base64url");

function devUrl(op: "get" | "put", key: string, ttl: number, params: Record<string, string> = {}) {
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const extra = new URLSearchParams(params).toString();
  const query = new URLSearchParams({ ...params, op, exp: String(exp), sig: devSignature(op, key, exp, extra) });
  return `${env().APP_URL}/api/dev-storage/${key}?${query}`;
}

/** Checks a local stand-in link (development only). */
export function verifyDevLink(key: string, query: URLSearchParams, op: "get" | "put") {
  const exp = Number(query.get("exp"));
  if (!exp || exp < Date.now() / 1000 || query.get("op") !== op) return false;
  const params = new URLSearchParams([...query].filter(([k]) => !["op", "exp", "sig"].includes(k)));
  const expected = Buffer.from(devSignature(op, key, exp, params.toString()));
  const given = Buffer.from(query.get("sig") ?? "");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** A link to read a file for a few minutes; with `downloadAs`, the browser saves it under that name. */
export async function signedReadUrl(key: string, opts: { downloadAs?: string; ttl?: number } = {}) {
  const ttl = opts.ttl ?? DEFAULT_TTL;
  const disposition = opts.downloadAs ? `attachment; filename="${opts.downloadAs.replace(/"/g, "")}"` : undefined;
  const s3 = r2();
  if (s3) {
    return getSignedUrl(s3.client, new GetObjectCommand({ Bucket: s3.bucket, Key: key, ResponseContentDisposition: disposition }), { expiresIn: ttl });
  }
  return devUrl("get", key, ttl, disposition ? { dl: disposition } : {});
}

/**
 * A link to write a file once, for a few minutes. The writer must send exactly these headers
 * (they're part of the signature).
 */
export async function signedWriteUrl(key: string, file: StoredFile, ttl = DEFAULT_TTL) {
  const headers: Record<string, string> = { "Content-Type": file.contentType, ...(file.gzipped ? { "Content-Encoding": "gzip" } : {}) };
  const s3 = r2();
  if (s3) {
    const url = await getSignedUrl(
      s3.client,
      new PutObjectCommand({ Bucket: s3.bucket, Key: key, ContentType: file.contentType, ContentEncoding: file.gzipped ? "gzip" : undefined }),
      { expiresIn: ttl, signableHeaders: new Set(["content-type", ...(file.gzipped ? ["content-encoding"] : [])]) },
    );
    return { url, headers };
  }
  return { url: devUrl("put", key, ttl, { ct: file.contentType, ...(file.gzipped ? { gz: "1" } : {}) }), headers };
}

/** Local stand-in only: where a key's file lives, and its metadata from the link. */
export const devStoragePath = localPath;
