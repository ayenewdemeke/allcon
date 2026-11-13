// CDOT pay items that ALLCON's design tools produce quantities for, from CDOT's Master Item Code
// Book (Spec Year 05, 2026 3rd quarter): item number, description and pay unit as the code book
// gives them, and which items each tool's quantities go to (the first of each list the default).

export type PayItem = { code: string; description: string; unit: string };

const item = (code: string, description: string, unit: string): PayItem => ({ code, description, unit });

export const CDOT_ITEMS: PayItem[] = [
  { code: "618-01992", description: "Prestressed Concrete Box (Depth Less Than 32 Inches)", unit: "SF" },
  { code: "618-01994", description: 'Prestressed Concrete Box (Depth 32" Through 48")', unit: "SF" },
  { code: "618-01995", description: "Prestressed Concrete Box (Depth Greater Than 48 Inches)", unit: "SF" },
  // 601 Structural concrete
  item("601-03040", "Concrete Class D (Bridge)", "CY"),
  item("601-03041", "Concrete Class D (Bridge) (Special)", "CY"),
  item("601-03030", "Concrete Class D (Box Culvert)", "CY"),
  item("601-03056", "Concrete Class DF", "CY"),
  item("601-01000", "Concrete Class B", "CY"),
  item("601-40300", "Structural Concrete Coating", "SY"),
  item("601-03050", "Concrete Class D (Wall)", "CY"),
  item("601-03055", "Concrete Class D (Wall) (Special)", "CY"),
  item("601-03000", "Concrete Class D", "CY"),
  item("601-01040", "Concrete Class B (Bridge)", "CY"),
  item("601-01030", "Concrete Class B (Box Culvert)", "CY"),
  item("601-01050", "Concrete Class B (Wall)", "CY"),
  item("601-04100", "Concrete Class E (Bridge)", "CY"),
  item("601-05001", "Concrete Class H (Bridge)", "CY"),
  item("601-03540", "Concrete Class DT (Deck Topping)", "CY"),
  item("601-07000", "Concrete Retaining Wall", "SF"),
  // 602 Reinforcing steel
  item("602-00000", "Reinforcing Steel", "LB"),
  item("602-00020", "Reinforcing Steel (Epoxy Coated)", "LB"),
  item("602-00010", "Reinforcing Steel (Galvanized)", "LB"),
  item("602-00011", "Reinforcing Steel (High Performance)", "LB"),
  item("602-00025", "Reinforcing Steel (Stainless)", "LB"),
  item("602-00060", "Reinforcing Steel Splice", "EACH"),
  // 202 Removal
  item("202-00495", "Removal of Portions of Present Structure", "LS"),
  // 206 Excavation and backfill for structures
  item("206-00000", "Structure Excavation", "CY"),
  item("206-00100", "Structure Backfill (Class 1)", "CY"),
  item("206-00200", "Structure Backfill (Class 2)", "CY"),
  item("206-00300", "Structure Backfill (Class 3)", "CY"),
  item("206-00065", "Structure Backfill (Flow-Fill)", "CY"),
  item("206-00360", "Mechanical Reinforcement of Soil", "CY"),
  item("206-01000", "Bed Course Material", "CY"),
  item("206-00510", "Filter Material (Class A)", "CY"),
  // 502 Piling, 503 Drilled shafts
  item("502-10836", "Steel Piling (HP 8x36)", "LF"),
  item("502-11057", "Steel Piling (HP 10x57)", "LF"),
  item("502-11253", "Steel Piling (HP 12x53)", "LF"),
  item("502-11263", "Steel Piling (HP 12x63)", "LF"),
  item("502-11274", "Steel Piling (HP 12x74)", "LF"),
  item("502-11284", "Steel Piling (HP 12x84)", "LF"),
  item("502-11473", "Steel Piling (HP 14x73)", "LF"),
  item("502-11489", "Steel Piling (HP 14x89)", "LF"),
  item("502-14102", "Steel Piling (HP 14x102)", "LF"),
  item("502-14117", "Steel Piling (HP 14x117)", "LF"),
  item("502-00100", "Drilling Hole to Facilitate Pile Driving", "LF"),
  item("502-00460", "Pile Tip", "EACH"),
  item("502-00500", "Complete Joint Penetration (CJP) Splice", "EACH"),
  ...[24, 30, 36, 42, 48, 54, 60, 66, 72, 78, 84, 96].map((d) => item(`503-000${d}`, `Drilled Shaft (${d} Inch)`, "LF")),
  item("503-00310", "Crosshole Sonic Logging Testing", "EACH"),
  ...[6, 7, 8].map((d) => item(`503-010${d}0`, `Micropile (${d} Inch)`, "LF")),
  item("503-01100", "Micropile (10 Inch)", "LF"),
  // 420 Geotextiles, 506 Riprap
  item("420-00102", "Geotextile (Erosion Control) (Class 1)", "SY"),
  item("420-00112", "Geotextile (Drainage) (Class 1)", "SY"),
  item("506-00209", "Riprap (9 Inch)", "CY"),
  // 504 Walls
  item("504-04420", "Precast Panel Facing", "SF"),
  item("504-04430", "Reinforced Concrete Facing", "SF"),
  item("504-04410", "Block Facing", "SF"),
  // 512 Bearings
  item("512-00101", "Bearing Device (Type I)", "EACH"),
  item("512-00102", "Bearing Device (Type II)", "EACH"),
  item("512-00103", "Bearing Device (Type III)", "EACH"),
  item("512-00114", "Bearing Device (Type IV)", "EACH"),
  item("512-00115", "Bearing Device (Type V)", "EACH"),
  item("512-00118", "Bearing Device (Special)", "EACH"),
  // 515 Waterproofing
  item("515-00120", "Waterproofing (Membrane)", "SY"),
  // 518 Joints
  item("518-01002", "Bridge Expansion Device (0-2 Inch)", "LF"),
  item("518-01004", "Bridge Expansion Device (0-4 Inch)", "LF"),
  item("518-01006", "Bridge Expansion Device (0-6 Inch)", "LF"),
  item("518-01009", "Bridge Expansion Device (0-9 Inch)", "LF"),
  item("518-01012", "Bridge Expansion Device (0-12 Inch)", "LF"),
  item("518-01201", "Bridge Expansion Device (Type 1)", "LF"),
  item("518-00100", "Waterstop", "LF"),
  item("518-03000", "Sawing and Sealing Bridge Joint", "LF"),
  // 408 Joint sealant
  item("408-01100", "Joint Sealant", "LF"),
  // 606 Bridge rail
  item("606-10900", "Bridge Rail Type 9", "LF"),
  item("606-10905", "Bridge Rail Type 9 (Special)", "LF"),
  item("606-11035", "Bridge Rail Type 10 MASH", "LF"),
  item("606-11037", "Bridge Rail Type 10R MASH", "LF"),
  item("606-11005", "Bridge Rail Type 10 (Special)", "LF"),
  // 618 Prestressed concrete
  ...[
    ["618-01137", "CBT 37.5"],
    ["618-01145", "CBT45"],
    ["618-01154", "CBT54"],
    ["618-01163", "CBT63"],
    ["618-01172", "CBT72"],
    ["618-01181", "CBT81"],
    ["618-01190", "CBT90"],
    ["618-00142", "BT42"],
    ["618-00154", "BT54"],
    ["618-00163", "BT63"],
    ["618-00172", "BT72"],
    ["618-00184", "BT84"],
  ].map(([code, shape]) => item(code, `Prestressed Concrete I (${shape})`, "LF")),
  item("618-00001", "Prestressing Steel Strand", "LB"),
];

/**
 * Generic pay items, for owners other than CDOT: CSI MasterFormat sections (the numbering allcon's
 * line items and mapping already use), one per kind of quantity. Each tool's quantities go to these
 * unless its pay items are set to an agency's.
 */
export const GENERIC_ITEMS: PayItem[] = [
  item("03 30 00", "Cast-in-Place Concrete", "CY"),
  item("03 21 00", "Reinforcement Bars", "LB"),
  item("31 23 16", "Excavation (Structure)", "CY"),
  item("31 23 23.13", "Backfill (Structure)", "CY"),
  item("31 23 23", "Fill (Rest of the Excavation)", "CY"),
  item("31 05 16", "Aggregate Bedding", "CY"),
  item("03 41 00", "Precast Prestressed Concrete Girders", "LF"),
  item("34 71 00", "Bridge Bearings", "EACH"),
  item("07 95 00", "Bridge Expansion Joint", "LF"),
  item("07 13 00", "Sheet Waterproofing", "SY"),
  item("31 63 29", "Drilled Concrete Shafts", "LF"),
  item("32 32 00", "Retaining Wall Facing", "SF"),
  item("31 32 00", "Reinforced Soil", "CY"),
  item("34 71 13", "Bridge Rail (Vehicle Barrier)", "LF"),
  item("02 41 19", "Removal of Portions of Present Structure", "LS"),
  item("07 92 00", "Joint Sealant", "LF"),
  item("31 62 16", "Steel Piles", "LF"),
  item("31 62 16.13", "Pile Tips", "EACH"),
  item("31 23 16.26", "Prebored Holes for Piles", "LF"),
  item("31 09 16", "Foundation Load and Integrity Testing", "EACH"),
  item("31 63 33", "Drilled Micropiles", "LF"),
];

const GENERIC_BY_ROLE: Record<QuantityRole, string> = {
  concrete: "03 30 00",
  rebar: "03 21 00",
  excavation: "31 23 16",
  backfill: "31 23 23.13",
  refill: "31 23 23",
  bedding: "31 05 16",
  girder: "03 41 00",
  bearing: "34 71 00",
  joint: "07 95 00",
  waterproofing: "07 13 00",
  shaft: "31 63 29",
  facing: "32 32 00",
  "soil-reinforcement": "31 32 00",
  rail: "34 71 13",
  removal: "02 41 19",
  sealant: "07 92 00",
  pile: "31 62 16",
  "pile-tip": "31 62 16.13",
  prebore: "31 23 16.26",
  testing: "31 09 16",
  micropile: "31 63 33",
};

/** Whose pay items a design's quantities go under: generic (CSI MasterFormat, the default) or CDOT's. */
export type Agency = "generic" | "cdot";
export const AGENCIES: { value: Agency; label: string }[] = [
  { value: "generic", label: "Generic (CSI MasterFormat)" },
  { value: "cdot", label: "CDOT (Master Item Code Book)" },
];
export const agencyOf = (v: unknown): Agency => (v === "cdot" ? "cdot" : "generic");
/** A pay item code as saved: CDOT's (601-03040) or a MasterFormat section (03 30 00, 31 23 23.13). */
export const isPayCode = (v: unknown): v is string => typeof v === "string" && (/^\d{3}-\d{5}$/.test(v) || /^\d{2} \d{2} \d{2}(\.\d{2})?$/.test(v));

export const payItem = (code: string) => CDOT_ITEMS.find((p) => p.code === code) ?? GENERIC_ITEMS.find((p) => p.code === code) ?? null;

/** What a quantity is, for choosing its pay item. */
export type QuantityRole = "concrete" | "rebar" | "excavation" | "backfill" | "refill" | "bedding" | "girder" | "bearing" | "joint" | "waterproofing" | "shaft" | "facing" | "soil-reinforcement" | "rail" | "removal" | "sealant" | "pile" | "pile-tip" | "prebore" | "testing" | "micropile";

/**
 * Each tool's quantities and the pay items each may go to (first: the default). Defaults follow
 * CDOT's own bridge and wall quantity sets: bridge elements in Concrete Class D (Bridge) (decks in
 * Class DF) with epoxy-coated bars; walls in Class D (Wall) or, for an MSE wall's leveling pad,
 * Class B, with plain bars; MSE walls by facing area and the reinforced soil's volume.
 */
export const TOOL_PAY_ITEMS: Record<string, Partial<Record<QuantityRole, string[]>>> = {
  "stm-d-region": {
    concrete: ["601-03040", "601-03041", "601-03056", "601-03000", "601-04100", "601-05001", "601-01040"],
    rebar: ["602-00020", "602-00000", "602-00010", "602-00011", "602-00025"],
    excavation: ["206-00000"],
    backfill: ["206-00100", "206-00065"],
    "soil-reinforcement": ["206-00360"],
    refill: ["206-00200", "206-00100"],
  },
  "box-culvert": { concrete: ["601-03030", "601-01030"], rebar: ["602-00000", "602-00020"], waterproofing: ["515-00120"], excavation: ["206-00000"], backfill: ["206-00100", "206-00200", "206-00065"], bedding: ["206-01000"], removal: ["202-00495"] },
  "cip-cantilever-wall": { concrete: ["601-03050", "601-03055", "601-01050"], rebar: ["602-00000", "602-00020"], excavation: ["206-00000"], backfill: ["206-00100", "206-00200"] },
  "cantilever-wingwall": { concrete: ["601-03040", "601-03050"], rebar: ["602-00020", "602-00000"] },
  "mse-wall": { facing: ["504-04420", "504-04410", "504-04430"], "soil-reinforcement": ["206-00360"], backfill: ["206-00100", "206-00200"], excavation: ["206-00000"], concrete: ["601-01000"], rebar: ["602-00000"] },
  "deck-slab": { concrete: ["601-03056", "601-03040", "601-04100", "601-05001"], rebar: ["602-00020", "602-00000"], waterproofing: ["515-00120"], rail: ["606-10900", "606-10905", "606-11035", "606-11037", "606-11005"] },
  "lrfd-girder-check": { concrete: ["601-03056", "601-03040"], rebar: ["602-00020", "602-00000"], waterproofing: ["515-00120"], rail: ["606-10900", "606-10905", "606-11035", "606-11037", "606-11005"], girder: ["618-01154", "618-01992", "618-01994", "618-01995", "618-01137", "618-01145", "618-01163", "618-01172", "618-01181", "618-01190", "618-00142", "618-00154", "618-00163", "618-00172", "618-00184"] },
  "pier-column": { concrete: ["601-03040", "601-03041", "601-03000"], rebar: ["602-00020", "602-00000", "602-00010", "602-00011", "602-00025"], excavation: ["206-00000"], backfill: ["206-00200", "206-00100"] },
  "elastomeric-bearing": { bearing: ["512-00101", "512-00102", "512-00103", "512-00114", "512-00115", "512-00118"] },
  "ptfe-bearing": { bearing: ["512-00118", "512-00103", "512-00114", "512-00115"] },
  "spread-footing": { concrete: ["601-03040", "601-03000"], rebar: ["602-00000", "602-00020"], excavation: ["206-00000"], backfill: ["206-00100", "206-00200"] },
  "pile-foundation": { concrete: ["601-03040", "601-03000"], rebar: ["602-00000", "602-00020"], pile: ["502-11253", "502-11274", "502-11489", "502-10836", "502-11057", "502-11263", "502-11284", "502-11473", "502-14102", "502-14117"], "pile-tip": ["502-00460"], excavation: ["206-00000"], backfill: ["206-00100", "206-00200"] },
  "drilled-shaft": { shaft: ["503-00036", "503-00024", "503-00030", "503-00042", "503-00048", "503-00054", "503-00060", "503-00066", "503-00072", "503-00078", "503-00084", "503-00096"], testing: ["503-00310"] }, // the shaft's bars are paid in item 503 (CDOT Standard Specifications 503.07)
  micropile: { micropile: ["503-01070", "503-01060", "503-01080", "503-01100"] },
  abutment: { concrete: ["601-03040", "601-03000"], rebar: ["602-00020", "602-00000"], pile: ["502-11253", "502-11274", "502-11489", "502-10836", "502-11057", "502-11263", "502-11284", "502-11473", "502-14102", "502-14117"], "pile-tip": ["502-00460"], prebore: ["502-00100"], shaft: ["503-00036", "503-00024", "503-00030", "503-00042", "503-00048", "503-00054", "503-00060", "503-00072"], excavation: ["206-00000"], backfill: ["206-00100", "206-00200"] },
  "approach-slab": { concrete: ["601-03056", "601-03040", "601-03000"], rebar: ["602-00020", "602-00000", "602-00025"], waterproofing: ["515-00120"], joint: ["518-01004", "518-01002"], sealant: ["408-01100"] },
  "strip-seal-joint": { joint: ["518-01004", "518-01002", "518-01006", "518-01009", "518-01012", "518-01201"] },
  "sign-cantilever": { shaft: ["503-00036", "503-00024", "503-00030", "503-00042", "503-00048", "503-00054", "503-00060", "503-00072"], rebar: ["602-00000"] },
};

/** Each of a tool's quantities and the pay items it may go to, for an agency (generic: one item per quantity). */
export function toolPayItems(kind: string, agency: Agency = "generic"): Partial<Record<QuantityRole, string[]>> {
  const cdot = TOOL_PAY_ITEMS[kind] ?? {};
  if (agency === "cdot") return cdot;
  return Object.fromEntries(Object.keys(cdot).map((role) => [role, [GENERIC_BY_ROLE[role as QuantityRole]]]));
}

/** The pay items a tool's quantity may go to. */
export const payItemsFor = (kind: string, role: QuantityRole, agency: Agency = "generic") => (toolPayItems(kind, agency)[role] ?? []).map((c) => payItem(c)!).filter(Boolean);
