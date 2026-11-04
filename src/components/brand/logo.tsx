import { cn } from "@/lib/utils";

// The logo is the name: "allcon", lowercase, in black Nunito ExtraBold. Where there's only room for
// a square (collapsed sidebar, favicon), a black tile with a rounded "a"; src/app/icon.svg is the
// same drawing.

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-8 shrink-0", className)}>
      <rect width="32" height="32" rx="8" fill="#171717" />
      <circle cx="14.6" cy="17.4" r="5.3" fill="none" stroke="#ffffff" strokeWidth="3.4" />
      <path d="M21.6 12.2 V22.6" stroke="#ffffff" strokeWidth="3.4" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return <span className={cn("font-brand leading-none font-extrabold tracking-tight text-neutral-900 lowercase", className)}>allcon</span>;
}
