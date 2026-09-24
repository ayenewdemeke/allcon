export { cn } from "cn"

/** "⌘" on Apple devices, "Ctrl+" elsewhere, for keyboard shortcut hints. Client-side only. */
export const modKey = () => (typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+");
