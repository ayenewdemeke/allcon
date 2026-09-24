"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import type { ProjectFormState } from "@/app/actions/projects";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export type ProjectFormValues = {
  name: string;
  currency: string;
  measurementStandard: string;
  retentionPct: string;
};

const DEFAULTS: ProjectFormValues = { name: "", currency: "USD", measurementStandard: "CSI", retentionPct: "10" };

/** Project details form, used both for creating a project and in project settings. */
export function ProjectForm({
  action,
  initial = DEFAULTS,
  submitLabel,
  pendingLabel,
}: {
  action: (prev: ProjectFormState, formData: FormData) => Promise<ProjectFormState>;
  initial?: ProjectFormValues;
  submitLabel: string;
  pendingLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});

  useEffect(() => {
    if (state.saved) toast.success("Project saved");
  }, [state]);

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <div className="grid gap-1.5 sm:col-span-2">
        <Label htmlFor="name">Project name</Label>
        <Input
          id="name"
          name="name"
          required
          defaultValue={initial.name}
          placeholder="e.g. Riverside Medical Office Building"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="measurementStandard">Measurement standard</Label>
        <select
          id="measurementStandard"
          name="measurementStandard"
          defaultValue={initial.measurementStandard}
          className={selectClass}
        >
          <option value="CSI">CSI MasterFormat</option>
          <option value="NRM2">NRM2</option>
          <option value="SMM7">SMM7</option>
          <option value="custom">Custom</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="currency">Currency</Label>
          <Input id="currency" name="currency" defaultValue={initial.currency} maxLength={3} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="retentionPct">Retainage %</Label>
          <Input
            id="retentionPct"
            name="retentionPct"
            type="number"
            min={0}
            max={100}
            step="0.5"
            defaultValue={initial.retentionPct}
          />
        </div>
      </div>
      {state.error && <p className="text-sm text-destructive sm:col-span-2">{state.error}</p>}
      <div className="flex justify-end sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}
