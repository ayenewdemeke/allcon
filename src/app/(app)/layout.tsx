import { TooltipProvider } from "@/components/ui/tooltip";
import { requireUser } from "@/lib/session";

/** Everything under (app) requires a signed-in user. */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  await requireUser();
  return <TooltipProvider>{children}</TooltipProvider>;
}
