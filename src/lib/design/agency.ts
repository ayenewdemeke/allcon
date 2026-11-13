// Agency rules: Design is AASHTO LRFD only unless a person turns an agency's rules on. With CDOT on,
// the tools offer CDOT's criteria (the Bridge Design Manual), standards (rails), pay items and
// CDOT-only tools (the LFR double-tee rating). Saved per person (user.agency).

export type AgencyRules = "none" | "cdot";

export const AGENCY_RULES: { value: AgencyRules; label: string }[] = [
  { value: "none", label: "None (AASHTO only)" },
  { value: "cdot", label: "CDOT" },
];

export const agencyRulesOf = (v: unknown): AgencyRules => (v === "cdot" ? "cdot" : "none");
