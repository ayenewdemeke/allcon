/** A new object id: short, random, and unique enough for one drawing. */
export const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);
