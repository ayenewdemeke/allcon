import type { Check } from "./walls/cip";

// A design tool's criteria: AASHTO LRFD (with the FHWA methods it relies on), or AASHTO with an
// agency's manual on top. The agency's own checks (those citing only its manual or standards) are
// left out unless its criteria are chosen, and its citations dropped from the checks both share.

export type Criteria = "aashto" | "cdot";
export const CRITERIA: { value: Criteria; label: string }[] = [
  { value: "aashto", label: "AASHTO LRFD" },
  { value: "cdot", label: "AASHTO LRFD with the CDOT Bridge Design Manual" },
];
export const isCdot = (i: { criteria?: Criteria }) => i.criteria === "cdot";

const agency = /CDOT|\bBDM\b|B-601/;
const general = /AASHTO|FHWA|ACI|AISC|PCI|Manufacturer/;

/** The checks for the criteria chosen: all of them for the agency's, otherwise without the agency's own. */
export function agencyChecks(checks: Check[], criteria: Criteria | undefined): Check[] {
  if (criteria === "cdot") return checks;
  return checks
    .filter((c) => !agency.test(c.name) && !(agency.test(c.ref) && !general.test(c.ref)))
    .map((c) => (agency.test(c.ref) ? { ...c, ref: c.ref.split(/[,;]\s*/).filter((part) => !agency.test(part) || general.test(part)).join(", ") } : c));
}
