import "server-only";
import { Resend } from "resend";
import { APP_NAME } from "@/lib/app-config";
import { env } from "@/lib/env";

export async function sendSignInLink(email: string, url: string) {
  const { RESEND_API_KEY, EMAIL_FROM } = env();

  if (!RESEND_API_KEY || !EMAIL_FROM) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Email sign-in needs RESEND_API_KEY and EMAIL_FROM");
    }
    // Local development without an email service: print the link instead.
    console.info(`\n[dev] Sign-in link for ${email}:\n${url}\n`);
    return;
  }

  const { error } = await new Resend(RESEND_API_KEY).emails.send({
    from: EMAIL_FROM,
    to: email,
    subject: `Your ${APP_NAME} sign-in link`,
    text: `Click to sign in to ${APP_NAME}:\n\n${url}\n\nThe link expires in 15 minutes. If you didn't ask for it, you can ignore this email.`,
    html: `<p>Click to sign in to ${APP_NAME}:</p>
<p><a href="${url}" style="display:inline-block;padding:10px 16px;background:#1b76bb;color:#fff;border-radius:6px;text-decoration:none">Sign in</a></p>
<p style="color:#64748b;font-size:13px">The link expires in 15 minutes. If you didn't ask for it, you can ignore this email.</p>`,
  });
  if (error) throw new Error(`Could not send sign-in email: ${error.message}`);
}
