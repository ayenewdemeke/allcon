"use client";

import { useSyncExternalStore } from "react";

// Dates and times in the viewer's own time zone. Pages are made on the server (in UTC), so they're
// written here, in the browser: UTC at first (labelled so), local once the page is live.

export type TimeFormat = "datetime" | "date" | "day";

const OPTIONS: Record<TimeFormat, Intl.DateTimeFormatOptions> = {
  datetime: { dateStyle: "medium", timeStyle: "short" },
  date: { dateStyle: "medium" },
  day: { month: "short", day: "numeric" },
};

const noop = () => () => {};

/** A date as text in the viewer's time zone (in UTC until the page is live in the browser). */
export function useLocalTime(date: Date | string | null | undefined, format: TimeFormat = "datetime") {
  const live = useSyncExternalStore(noop, () => true, () => false);
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  if (live) return d.toLocaleString("en-US", OPTIONS[format]);
  return d.toLocaleString("en-US", { ...OPTIONS[format], timeZone: "UTC" }) + (format === "datetime" ? " UTC" : "");
}

export function LocalTime({ date, format = "datetime" }: { date: Date | string; format?: TimeFormat }) {
  const text = useLocalTime(date, format);
  const full = useLocalTime(date, "datetime");
  return (
    <time dateTime={typeof date === "string" ? date : date.toISOString()} title={full}>
      {text}
    </time>
  );
}
