"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";

/** Allow / Cancel for a connecting app. The signed request in the URL goes along automatically. */
export function ConsentButtons() {
  const [pending, setPending] = useState<"allow" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(accept: boolean) {
    setPending(accept ? "allow" : "deny");
    setError(null);
    const { data, error } = await authClient.$fetch<{ redirect_uri?: string; url?: string }>("/oauth2/consent", {
      method: "POST",
      body: { accept },
    });
    const next = data?.redirect_uri ?? data?.url;
    if (error || !next) {
      setError(error?.message ?? "Something went wrong. Start the connection again from your AI app.");
      setPending(null);
      return;
    }
    window.location.href = next; // back to the app, with an authorization code or a refusal
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" disabled={pending !== null} onClick={() => decide(false)}>
          {pending === "deny" && <Loader2 className="animate-spin" />} Cancel
        </Button>
        <Button disabled={pending !== null} onClick={() => decide(true)}>
          {pending === "allow" && <Loader2 className="animate-spin" />} Allow
        </Button>
      </div>
      {error && <p className="text-center text-sm text-destructive">{error}</p>}
    </div>
  );
}
