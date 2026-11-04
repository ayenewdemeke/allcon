import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Eye, PenLine, RefreshCw } from "lucide-react";
import { Wordmark } from "@/components/brand/logo";
import { ConsentButtons } from "@/components/connections/consent-buttons";
import { Card, CardContent } from "@/components/ui/card";
import { APP_NAME } from "@/lib/app-config";
import { connectorName, verifiedConnectorQuery } from "@/lib/auth/connector-query";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Connect an app", robots: { index: false } };

/** Asks the user to allow an AI app (Claude, ChatGPT, Gemini...) to use their allcon account. */
export default async function ConsentPage({ searchParams }: PageProps<"/oauth/consent">) {
  const params = await searchParams;
  const query = await verifiedConnectorQuery(params);
  const user = await getCurrentUser();
  if (query && !user) redirect(`/?${query}`);
  const app = query ? await connectorName(query.get("client_id")!) : null;
  const scopes = new Set((query?.get("scope") ?? "").split(" ").filter(Boolean));

  const can = [
    { icon: Eye, text: "See your projects, drawings, models, estimates and library manuals" },
    { icon: PenLine, text: "Add notes, clouds and flagged issues to your sheets (it can't delete them), and build 3D models from your drawings" },
    ...(scopes.has("offline_access") ? [{ icon: RefreshCw, text: "Stay connected until you disconnect it in Connections" }] : []),
  ];

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-16 max-w-6xl items-center px-6">
          <Wordmark mark className="text-2xl" />
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center p-6">
        <Card className="w-full max-w-md shadow-sm">
          <CardContent className="space-y-5 p-6">
            {!query || !app ? (
              <div className="space-y-1 text-center">
                <h1 className="text-lg font-semibold">This connection request has expired</h1>
                <p className="text-sm text-muted-foreground">Start the connection again from your AI app.</p>
              </div>
            ) : (
              <>
                <div className="space-y-1 text-center">
                  {app.icon && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={app.icon} alt="" className="mx-auto mb-2 size-10 rounded-md" />
                  )}
                  <h1 className="text-lg font-semibold">
                    {app.name} wants to use your {APP_NAME} account
                  </h1>
                  {app.host && app.host !== app.name && <p className="text-xs text-muted-foreground">{app.host}</p>}
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium">It will be able to:</p>
                  <ul className="space-y-2">
                    {can.map(({ icon: Icon, text }) => (
                      <li key={text} className="flex gap-2.5 text-sm text-muted-foreground">
                        <Icon className="mt-0.5 size-4 shrink-0 text-foreground" />
                        {text}
                      </li>
                    ))}
                  </ul>
                </div>
                <p className="text-xs text-muted-foreground">
                  Signed in as <span className="font-medium text-foreground">{user?.email}</span>. Its AI usage counts
                  against your plan with that app, not {APP_NAME}. You can see what it does and disconnect it any time
                  under Connections.
                </p>
                <ConsentButtons />
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
