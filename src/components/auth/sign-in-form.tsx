"use client";

import { useState } from "react";
import { Loader2, Mail, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth/client";

const AFTER_SIGN_IN = "/projects";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4">
      <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.9l-3.88-3.02c-1.07.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.11A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.29 14.28a7.2 7.2 0 0 1 0-4.56V6.61H1.28a12 12 0 0 0 0 10.78l4.01-3.11Z" />
      <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44A11.97 11.97 0 0 0 12 0 12 12 0 0 0 1.28 6.61l4.01 3.11C6.23 6.88 8.88 4.77 12 4.77Z" />
    </svg>
  );
}

type Pending = "autodesk" | "google" | "email" | null;

export function SignInForm({
  googleEnabled,
  emailEnabled,
  initialError,
}: {
  googleEnabled: boolean;
  emailEnabled: boolean; // hidden in production until an email service is configured
  initialError?: string;
}) {
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState(initialError);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function run(kind: Exclude<Pending, null>, action: () => Promise<{ error: { message?: string } | null }>) {
    setPending(kind);
    setError(undefined);
    const { error } = await action();
    // OAuth redirects away on success; only failures come back here.
    if (error) {
      setError(error.message ?? "Sign-in failed. Please try again.");
      setPending(null);
    }
    return !error;
  }

  if (sentTo) {
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <MailCheck className="size-6" />
        </div>
        <div className="space-y-1">
          <p className="font-medium">Check your email</p>
          <p className="text-sm text-muted-foreground">
            We sent a sign-in link to <span className="font-medium text-foreground">{sentTo}</span>. It expires in 15
            minutes.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setSentTo(null)}>
          Use a different method
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2.5">
        <Button
          size="lg"
          className="h-10 w-full"
          disabled={pending !== null}
          onClick={() =>
            run("autodesk", () =>
              authClient.signIn.social({ provider: "autodesk", callbackURL: AFTER_SIGN_IN, errorCallbackURL: "/" }),
            )
          }
        >
          {pending === "autodesk" && <Loader2 className="animate-spin" />}
          Continue with Autodesk
        </Button>
        {googleEnabled && (
          <Button
            variant="outline"
            size="lg"
            className="h-10 w-full"
            disabled={pending !== null}
            onClick={() =>
              run("google", () =>
                authClient.signIn.social({ provider: "google", callbackURL: AFTER_SIGN_IN, errorCallbackURL: "/" }),
              )
            }
          >
            {pending === "google" ? <Loader2 className="animate-spin" /> : <GoogleIcon />}
            Continue with Google
          </Button>
        )}
      </div>

      {emailEnabled && (
        <>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-border" />
          or use your email
          <div className="h-px flex-1 bg-border" />
        </div>

        <form
          className="space-y-2.5"
          onSubmit={async (e) => {
            e.preventDefault();
            const email = String(new FormData(e.currentTarget).get("email") ?? "").trim();
            const ok = await run("email", () =>
              authClient.signIn.magicLink({ email, callbackURL: AFTER_SIGN_IN, errorCallbackURL: "/" }),
            );
            if (ok) {
              setPending(null);
              setSentTo(email);
            }
          }}
        >
          <Label htmlFor="email" className="sr-only">
            Email
          </Label>
          <Input id="email" name="email" type="email" required placeholder="you@company.com" className="h-10" />
          <Button type="submit" variant="outline" size="lg" className="h-10 w-full" disabled={pending !== null}>
            {pending === "email" ? <Loader2 className="animate-spin" /> : <Mail />}
            Email me a sign-in link
          </Button>
        </form>
        </>
      )}

      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
