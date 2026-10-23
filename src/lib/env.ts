import "server-only";
import { z } from "zod";

const optional = z.string().trim().min(1).optional().catch(undefined);

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_URL: z.url(),
  // Other domains the app also answers on, comma-separated (e.g. "planlogic.vercel.app").
  APP_ALIASES: optional,
  BETTER_AUTH_SECRET: z.string().min(32, "generate one with: openssl rand -base64 32"),
  APS_CLIENT_ID: z.string().min(1),
  APS_CLIENT_SECRET: z.string().min(1),
  APS_BUCKET_KEY: z.string().regex(/^[-_.a-z0-9]{3,128}$/, "lowercase letters, digits, - _ . (3-128 chars)"),
  // Optional sign-in methods: each is enabled only when its keys are present.
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  RESEND_API_KEY: optional,
  EMAIL_FROM: optional,
  // Plan review (AI pass); the rest of the app works without it.
  ANTHROPIC_API_KEY: optional,
  // File storage (Cloudflare R2); without it, development uses a local folder.
  R2_ACCOUNT_ID: optional,
  R2_ACCESS_KEY_ID: optional,
  R2_SECRET_ACCESS_KEY: optional,
  R2_BUCKET: optional,
});

let cached: z.infer<typeof schema> | undefined;

// Validated lazily so `next build` works without secrets present.
export function env() {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export const googleSignInEnabled = () => Boolean(env().GOOGLE_CLIENT_ID && env().GOOGLE_CLIENT_SECRET);

/** Email links need an email service in production; in development they're printed to the console. */
export const emailSignInEnabled = () =>
  Boolean(env().RESEND_API_KEY && env().EMAIL_FROM) || process.env.NODE_ENV !== "production";

export const planReviewEnabled = () => Boolean(env().ANTHROPIC_API_KEY);
