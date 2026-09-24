// Shared by the upload forms and the upload APIs.
export const ACCEPTED_EXTENSIONS = [".rvt", ".ifc"];
export const DRAWING_EXTENSIONS = [".pdf"];

export function extensionOf(fileName: string) {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot).toLowerCase();
}
