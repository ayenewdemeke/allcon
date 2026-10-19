// The 3D viewer converts a model's IFC to That Open fragments the first time a revision is
// opened, then saves the result so later views load it directly (much faster than reading
// the IFC again). A saved conversion is used only while its key matches.

/** Bump when the IFC compiler or the viewer's import settings change what gets drawn. */
const VIEW_FORMAT = "frag3.4-c1";

/** Saved conversions larger than this aren't kept (request bodies are capped near 4.5 MB). */
export const MAX_VIEW_CACHE_BYTES = 4 * 1024 * 1024;

export const viewCacheKey = (revision: number) => `r${revision}:${VIEW_FORMAT}`;
