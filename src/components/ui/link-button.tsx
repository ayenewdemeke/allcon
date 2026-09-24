import Link from "next/link";
import type { VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./button";

/**
 * A real link styled as a button. Use it for navigation instead of <Button render={<Link />}>,
 * which makes screen readers announce the link as a button.
 */
export function LinkButton({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof Link> & VariantProps<typeof buttonVariants>) {
  return <Link className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
