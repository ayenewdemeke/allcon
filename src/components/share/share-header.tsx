import { Ruler } from "lucide-react";
import { APP_NAME } from "@/lib/app-config";

export function ShareHeader({ children }: { children?: React.ReactNode }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-card px-4">
      <div className="flex items-center gap-2">
        <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Ruler className="size-3.5" />
        </div>
        <span className="font-semibold tracking-tight">{APP_NAME}</span>
      </div>
      {children}
    </header>
  );
}

export function ShareUnavailable() {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <ShareHeader />
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <h1 className="text-lg font-semibold">This link isn&apos;t available</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            It may have expired or been turned off by the person who shared it. Ask them for a new link.
          </p>
        </div>
      </main>
    </div>
  );
}
