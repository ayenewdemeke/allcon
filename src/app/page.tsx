import { redirect } from "next/navigation";
import { Box, FileSearch, Layers, ListChecks } from "lucide-react";
import { Wordmark } from "@/components/brand/logo";
import { SignInForm } from "@/components/auth/sign-in-form";
import { Card, CardContent } from "@/components/ui/card";
import { APP_NAME } from "@/lib/app-config";
import { emailSignInEnabled, googleSignInEnabled } from "@/lib/env";
import { authorizeUrl, connectorName, verifiedConnectorQuery } from "@/lib/auth/connector-query";
import { getCurrentUser } from "@/lib/auth/session";

// Better Auth reports failures as ?error=<code>.
const ERROR_MESSAGES: Record<string, string> = {
  EXPIRED_TOKEN: "That sign-in link has expired. Request a new one below.",
  INVALID_TOKEN: "That sign-in link is no longer valid. Request a new one below.",
  access_denied: "Sign-in was cancelled.",
};

const FEATURES = [
  { icon: Layers, text: "Mark up and measure PDF drawings, then share or export them" },
  { icon: FileSearch, text: "Review plans against your design manuals, with citations" },
  { icon: ListChecks, text: "Price quantities against your schedule of values" },
  { icon: Box, text: "Take quantities straight from Revit and IFC models" },
];

export default async function SignInPage({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  // An AI app connecting to allcon sends people here to sign in first.
  const connector = await verifiedConnectorQuery(params);
  if (await getCurrentUser()) redirect(connector ? authorizeUrl(connector) : "/projects");
  const connecting = connector ? await connectorName(connector.get("client_id")!) : null;
  const { error } = params;
  const message =
    typeof error === "string" ? (ERROR_MESSAGES[error] ?? "Sign-in failed. Please try again.") : undefined;

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-6">
          <Wordmark className="text-[1.75rem]" />
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-12 px-6 py-12 lg:grid-cols-2">
        <div className="space-y-6">
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            The everyday toolkit for construction projects.
          </h1>
          <ul className="space-y-3">
            {FEATURES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-muted-foreground">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
                  <Icon className="size-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <Card className="mx-auto w-full max-w-sm shadow-sm">
          <CardContent className="space-y-6 p-6">
            <div className="space-y-1 text-center">
              <h2 className="text-xl font-semibold tracking-tight">Sign in</h2>
              <p className="text-sm text-muted-foreground">
                {connecting
                  ? `to connect ${connecting.name} to your ${APP_NAME} account.`
                  : "New here? Signing in creates your account."}
              </p>
            </div>
            <SignInForm googleEnabled={googleSignInEnabled()} emailEnabled={emailSignInEnabled()} initialError={message} />
          </CardContent>
        </Card>
      </main>

      <footer className="border-t bg-card py-6">
        <div className="mx-auto max-w-6xl px-6 text-sm text-muted-foreground">
          &copy; {new Date().getFullYear()} {APP_NAME}
        </div>
      </footer>
    </div>
  );
}
