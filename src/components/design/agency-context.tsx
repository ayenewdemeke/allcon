"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { AgencyRules } from "@/lib/design/agency";

// The person's agency rules, for the design editors: CDOT's options show only with CDOT on (or where
// a design already uses one, so it stays editable).

const AgencyContext = createContext<AgencyRules>("none");

export function AgencyProvider({ value, children }: { value: AgencyRules; children: ReactNode }) {
  return <AgencyContext.Provider value={value}>{children}</AgencyContext.Provider>;
}

/** Whether CDOT's rules are on for this person. */
export const useCdot = () => useContext(AgencyContext) === "cdot";
