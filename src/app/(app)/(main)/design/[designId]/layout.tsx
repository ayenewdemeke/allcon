import type { ReactNode } from "react";
import { AgencyProvider } from "@/components/design/agency-context";
import { requireUser } from "@/lib/auth/session";
import { agencyRulesOf } from "@/lib/design/agency";

/** A design's editor, with the person's agency rules (which CDOT options it offers). */
export default async function DesignLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  return <AgencyProvider value={agencyRulesOf(user.agency)}>{children}</AgencyProvider>;
}
