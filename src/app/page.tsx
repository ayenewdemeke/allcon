import { redirect } from "next/navigation";
import { Box, FileText, Ruler, Sheet } from "lucide-react";
import { SignInForm } from "@/components/auth/sign-in-form";
import { Card, CardContent } from "@/components/ui/card";
import { APP_NAME } from "@/lib/app-config";
import { googleSignInEnabled } from "@/lib/env";
import { getCurrentUser } from "@/lib/auth/session";

// Better Auth reports failures as ?error=<code>.
const ERROR_MESSAGES: Record<string, string> = {
  EXPIRED_TOKEN: "That sign-in link has expired. Request a new one below.",
  INVALID_TOKEN: "That sign-in link is no longer valid. Request a new one below.",
  access_denied: "Sign-in was cancelled.",
};

const FEATURES = [
  { icon: Box, text: "Quantities straight from Revit and IFC models" },
  { icon: Ruler, text: "Measure lengths, areas and counts on PDF drawings" },
  { icon: Sheet, text: "Price them against your schedule of values" },
  { icon: FileText, text: "Export priced quantities and pay applications" },
];

export default async function SignInPage({ searchParams }: PageProps<"/">) {
  if (await getCurrentUser()) redirect("/projects");
  const { error } = await searchParams;
  const message =
    typeof error === "string" ? (ERROR_MESSAGES[error] ?? "Sign-in failed. Please try again.") : undefined;

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-6">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Ruler className="size-4" />
          </div>
          <span className="text-lg font-semibold tracking-tight">{APP_NAME}</span>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-12 px-6 py-12 lg:grid-cols-2">
        <div className="space-y-6">
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Quantities and payment applications, from model or drawing.
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
              <p className="text-sm text-muted-foreground">New here? Signing in creates your account.</p>
            </div>
            <SignInForm googleEnabled={googleSignInEnabled()} initialError={message} />
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
