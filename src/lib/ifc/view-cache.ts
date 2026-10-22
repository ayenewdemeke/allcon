// The 3D viewer converts a model's IFC to That Open fragments the first time a file is
// opened, then saves the result in file storage so later views load it directly (much faster
// than reading the IFC again). A saved copy is used only while it matches the current file.

/** Bump when the viewer's import settings change what gets drawn. */
const VIEW_FORMAT = "frag3.4-v2";

/** What a saved viewer copy was made from: the model's file, in the viewer's current format. */
export const viewSource = (fileKey: string) => `${fileKey}#${VIEW_FORMAT}`;

export const hasViewCopy = (model: { fileKey: string; viewKey: string | null; viewFor: string | null }) =>
  !!model.viewKey && model.viewFor === viewSource(model.fileKey);
