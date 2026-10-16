import { APP_NAME } from "@/lib/app-config";
import { cn } from "@/lib/utils";

// The name is the logo: "conkit" set in Unbounded. Where there's only room for a square
// (collapsed sidebar, favicon), its "c" stands in on a blue tile.

export function Wordmark({ className }: { className?: string }) {
  return <span className={cn("font-brand leading-none font-bold tracking-tight lowercase", className)}>{APP_NAME}</span>;
}

export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-md bg-primary pb-[0.08em] font-brand text-lg leading-none font-bold text-primary-foreground",
        className,
      )}
    >
      c
    </span>
  );
}
