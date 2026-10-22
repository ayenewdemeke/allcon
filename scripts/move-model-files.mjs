// One-off: moves 3D model files out of the database into file storage (R2, or the local
// folder in development), keeping each model's current file and one backup (the newest
// earlier revision). Run between the migrations 20261021120000_model_files and
// 20261021130000_model_files_cleanup:  node scripts/move-model-files.mjs
// It uses DIRECT_URL (or DATABASE_URL), and the R2_* variables when set.
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";
import pg from "pg";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

config({ path: ".env.local", override: false });
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
const s3 =
  R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET
    ? new S3Client({ region: "auto", endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY } })
    : null;

async function put(key, body) {
  if (s3) {
    await s3.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: body, ContentType: "application/x-step", ContentEncoding: "gzip" }));
  } else {
    const file = path.join(process.cwd(), ".local-storage", key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  }
}

const db = new pg.Client({ connectionString: url });
await db.connect();
try {
  const { rows: models } = await db.query(`SELECT id, name, kind, ifc_gz, revision, elements_revision FROM ifc_model WHERE file_key IS NULL`);
  const unconvertible = models.filter((m) => m.kind !== "ifc" || !m.ifc_gz);
  if (unconvertible.length) throw new Error(`These models have no IFC file to move: ${unconvertible.map((m) => m.name).join(", ")}`);
  console.log(`${models.length} model(s) to move, to ${s3 ? `R2 bucket ${R2_BUCKET}` : "the local folder .local-storage"}`);
  for (const m of models) {
    const fileKey = `models/${m.id}/${randomUUID()}.ifc.gz`;
    await put(fileKey, m.ifc_gz);
    const { rows: [backup] } = await db.query(
      `SELECT revision, ifc_gz FROM ifc_model_revision WHERE model_id = $1 AND revision < $2 AND ifc_gz IS NOT NULL ORDER BY revision DESC LIMIT 1`,
      [m.id, m.revision],
    );
    let backupKey = null;
    if (backup) {
      backupKey = `models/${m.id}/${randomUUID()}.ifc.gz`;
      await put(backupKey, backup.ifc_gz);
    }
    await db.query(
      `UPDATE ifc_model SET file_key = $2, file_size = $3, backup_key = $4, backup_revision = $5, elements_for = CASE WHEN elements_revision = revision THEN $2 ELSE NULL END WHERE id = $1`,
      [m.id, fileKey, m.ifc_gz.length, backupKey, backup?.revision ?? null],
    );
    console.log(`  ${m.name}: r${m.revision} (${Math.round(m.ifc_gz.length / 1024)} KB)${backup ? `, backup r${backup.revision}` : ""}`);
  }
} finally {
  await db.end();
}
