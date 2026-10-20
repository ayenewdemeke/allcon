"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setModelCounted } from "@/app/actions/models3d";

/** Switches a model's quantities in or out of the SOV / BoQ (mapping and the report). */
export function CountToggle({ projectId, target, counted }: { projectId: string; target: { kind: "upload" | "built"; id?: string }; counted: boolean }) {
  const [pending, start] = useTransition();
  const [on, setOn] = useState(counted); // shown at once; put back if saving fails
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-muted-foreground" title="Its quantities feed the SOV / BoQ">
      <input
        type="checkbox"
        className="size-4 accent-primary"
        checked={on}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.checked;
          setOn(next);
          start(async () => {
            try {
              await setModelCounted(projectId, target, next);
            } catch {
              setOn(!next);
              toast.error("Could not change it");
            }
          });
        }}
      />
      {on ? "Counts" : "Off"}
    </label>
  );
}
