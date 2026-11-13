// Fields, as AutoCAD's: text that fills itself in, written as AutoCAD writes them in DXF, such
// as %<\AcVar Filename>% or %<\AcVar Date \f "M/d/yyyy">%. They're shown with their current value
// wherever text is drawn or plotted (in text, multiline text and block attributes); editing the
// text shows the code. Supported: Filename, Date, SaveDate and PlotDate (all today), and CTAB
// (the layout being drawn or plotted, AutoCAD's sheet name).

export type FieldContext = { fileName: string; layout: string; now?: Date };

const FIELD = /%<\\AcVar\s+([A-Za-z]+)(?:\s+\\f\s+"([^"]*)")?>%/g;

/** The field codes the FIELD command offers, by keyword. */
export const FIELD_CODES = {
  Filename: "%<\\AcVar Filename>%",
  Date: '%<\\AcVar Date \\f "M/d/yyyy">%',
  PlotDate: '%<\\AcVar PlotDate \\f "M/d/yyyy">%',
  Layout: "%<\\AcVar ctab>%",
} as const;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** A date in AutoCAD's field format codes (M, MM, MMM, MMMM, d, dd, yy, yyyy). */
export function formatDate(date: Date, format = "M/d/yyyy") {
  const m = date.getMonth();
  const d = date.getDate();
  const y = date.getFullYear();
  return format.replace(/MMMM|MMM|MM|M|dd|d|yyyy|yy/g, (t) => {
    switch (t) {
      case "MMMM":
        return MONTHS[m];
      case "MMM":
        return MONTHS[m].slice(0, 3);
      case "MM":
        return String(m + 1).padStart(2, "0");
      case "M":
        return String(m + 1);
      case "dd":
        return String(d).padStart(2, "0");
      case "d":
        return String(d);
      case "yyyy":
        return String(y);
      default:
        return String(y).slice(-2);
    }
  });
}

export const hasFields = (text: string) => text.includes("%<\\AcVar");

/** Text with its fields replaced by their values (an unknown field shows ####, as AutoCAD's do). */
export function evaluateFields(text: string, ctx: FieldContext): string {
  if (!hasFields(text)) return text;
  return text.replace(FIELD, (_all, name: string, format?: string) => {
    switch (name.toLowerCase()) {
      case "filename":
        return ctx.fileName;
      case "date":
      case "savedate":
      case "plotdate":
        return formatDate(ctx.now ?? new Date(), format || "M/d/yyyy");
      case "ctab":
        return ctx.layout;
      default:
        return "####";
    }
  });
}
