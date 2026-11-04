import { cn } from "@/lib/utils";

// The logo: a sky-blue tile with a white arch (a bridge, a vault: what gets built), and the name,
// "allcon", set lowercase in Unbounded with "all" in the brand blue. Collapsed to a square
// (sidebar icons, favicon), the tile stands alone; src/app/icon.svg is the same drawing.

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-8 shrink-0", className)}>
      <rect width="32" height="32" rx="8" className="fill-brand" />
      <path d="M6 24 A10 10 0 0 1 26 24 L21 24 A5 5 0 0 0 11 24 Z" fill="#ffffff" />
    </svg>
  );
}

export function Wordmark({ className, mark = false }: { className?: string; mark?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {mark && <LogoMark className="size-[1.35em]" />}
      <span className="font-brand leading-none font-bold tracking-tight lowercase">
        <span className="text-primary">all</span>
        <span>con</span>
      </span>
    </span>
  );
}
