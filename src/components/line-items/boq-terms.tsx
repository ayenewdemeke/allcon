"use client";

import { createContext, useContext } from "react";
import { boqTerms, type BoqTerms } from "@/lib/line-items/terms";

// The project's words for its priced lines, for client components inside a project.

const TermsContext = createContext<BoqTerms>(boqTerms(null));

export function BoqTermsProvider({ standard, children }: { standard: string; children: React.ReactNode }) {
  return <TermsContext.Provider value={boqTerms(standard)}>{children}</TermsContext.Provider>;
}

export const useBoqTerms = () => useContext(TermsContext);
