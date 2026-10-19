"use client";

import { useSyncExternalStore } from "react";

// Whether a side panel is open, remembered in this browser (open by default, and on the
// server render, so the first paint matches).

const listeners = new Set<() => void>();
const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
};
const read = (key: string) => {
  try {
    return localStorage.getItem(key) !== "closed";
  } catch {
    return true;
  }
};

export function usePanelOpen(key: string) {
  const open = useSyncExternalStore(subscribe, () => read(key), () => true);
  const toggle = () => {
    try {
      localStorage.setItem(key, open ? "closed" : "open");
    } catch {}
    listeners.forEach((l) => l());
  };
  return [open, toggle] as const;
}
