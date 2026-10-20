// Settings a new project starts with, picked from its location when that names a country (or
// a well-known city), and otherwise US: dollars, CSI MasterFormat, imperial units. All of
// them can be changed later in the project's settings.

export type RegionalDefaults = { currency: string; measurementStandard: "CSI" | "NRM2"; unitSystem: "imperial" | "metric" };

const US: RegionalDefaults = { currency: "USD", measurementStandard: "CSI", unitSystem: "imperial" };

const metric = (currency: string, measurementStandard: "CSI" | "NRM2" = "NRM2"): RegionalDefaults => ({ currency, measurementStandard, unitSystem: "metric" });

const EURO = ["germany", "france", "netherlands", "belgium", "spain", "portugal", "italy", "austria", "finland", "greece", "luxembourg", "slovakia", "slovenia", "estonia", "latvia", "lithuania", "malta", "cyprus", "croatia"];

// Matched as whole words in the location, most specific first.
const REGIONS: [string[], RegionalDefaults][] = [
  [["united kingdom", "uk", "england", "scotland", "wales", "northern ireland", "london", "manchester", "birmingham", "edinburgh", "glasgow"], metric("GBP")],
  [["ireland", "dublin"], metric("EUR")],
  [EURO, metric("EUR")],
  [["canada", "toronto", "vancouver", "montreal", "calgary", "ottawa"], metric("CAD", "CSI")],
  [["australia", "sydney", "melbourne", "brisbane", "perth"], metric("AUD")],
  [["new zealand", "auckland", "wellington"], metric("NZD")],
  [["ethiopia", "addis ababa"], metric("ETB")],
  [["kenya", "nairobi", "mombasa"], metric("KES")],
  [["nigeria", "lagos", "abuja"], metric("NGN")],
  [["ghana", "accra"], metric("GHS")],
  [["uganda", "kampala"], metric("UGX")],
  [["tanzania", "dar es salaam"], metric("TZS")],
  [["rwanda", "kigali"], metric("RWF")],
  [["south africa", "johannesburg", "cape town", "durban", "pretoria"], metric("ZAR")],
  [["egypt", "cairo"], metric("EGP")],
  [["united arab emirates", "uae", "dubai", "abu dhabi"], metric("AED")],
  [["saudi arabia", "riyadh", "jeddah"], metric("SAR")],
  [["qatar", "doha"], metric("QAR")],
  [["oman", "muscat"], metric("OMR")],
  [["india", "mumbai", "delhi", "bangalore", "bengaluru"], metric("INR")],
  [["pakistan", "karachi", "lahore"], metric("PKR")],
  [["singapore"], metric("SGD")],
  [["malaysia", "kuala lumpur"], metric("MYR")],
  [["hong kong"], metric("HKD")],
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function regionalDefaults(location: string | null | undefined): RegionalDefaults {
  const text = location?.toLowerCase().trim();
  if (!text) return US;
  for (const [names, defaults] of REGIONS) {
    if (names.some((n) => new RegExp(`(^|[^a-z])${escape(n)}([^a-z]|$)`).test(text))) return defaults;
  }
  return US;
}
