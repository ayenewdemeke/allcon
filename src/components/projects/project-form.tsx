"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import type { ProjectFormState } from "@/app/actions/projects";
import { LocationPicker, type LatLon } from "@/components/maps/location-picker";
import { MapsProvider } from "@/components/maps/maps-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { MapsConfig } from "@/lib/maps/config";

const fieldClass =
  "w-full rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

type Action = (prev: ProjectFormState, formData: FormData) => Promise<ProjectFormState>;

export type ProjectDetails = { name: string; description: string; location: string; pin: LatLon | null };
export type ProjectBilling = { currency: string; measurementStandard: string; retentionPct: string; unitSystem: string };

function useSaved(action: Action) {
  const [state, formAction, pending] = useActionState(action, {});
  useEffect(() => {
    if (state.saved) toast.success("Project saved");
  }, [state]);
  return { state, formAction, pending };
}

function Footer({ error, pending, submitLabel, pendingLabel }: { error?: string; pending: boolean; submitLabel: string; pendingLabel: string }) {
  return (
    <>
      {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
      <div className="flex justify-end sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
      </div>
    </>
  );
}

/** What the project is: its name, and optionally a description, location and pin on the map. Used to create a project and in settings. */
export function ProjectDetailsForm({
  action,
  initial = { name: "", description: "", location: "", pin: null },
  maps,
  submitLabel,
  pendingLabel,
}: {
  action: Action;
  initial?: ProjectDetails;
  /** Google Maps, for pinning the site (left out when maps aren't set up). */
  maps: MapsConfig | null;
  submitLabel: string;
  pendingLabel: string;
}) {
  const { state, formAction, pending } = useSaved(action);
  const [location, setLocation] = useState(initial.location);
  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <div className="grid gap-1.5 sm:col-span-2">
        <Label htmlFor="name">Project name</Label>
        <Input id="name" name="name" required defaultValue={initial.name} placeholder="e.g. Riverside Medical Office Building" />
      </div>
      <div className="grid gap-1.5 sm:col-span-2">
        <Label htmlFor="location">
          Location <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input id="location" name="location" maxLength={200} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Fargo, ND or Nairobi, Kenya" />
      </div>
      {maps && (
        <div className="grid gap-1.5 sm:col-span-2">
          <Label>
            Site on the map <span className="font-normal text-muted-foreground">(optional; places 3D models)</span>
          </Label>
          <MapsProvider config={maps}>
            <LocationPicker initial={initial.pin} onPlace={(address) => !location.trim() && setLocation(address.slice(0, 200))} />
          </MapsProvider>
        </div>
      )}
      <div className="grid gap-1.5 sm:col-span-2">
        <Label htmlFor="description">
          Description <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <textarea
          id="description"
          name="description"
          rows={3}
          maxLength={1000}
          defaultValue={initial.description}
          placeholder="What the project is, for anyone opening it"
          className={`${fieldClass} resize-y py-1.5`}
        />
      </div>
      <Footer error={state.error} pending={pending} submitLabel={submitLabel} pendingLabel={pendingLabel} />
    </form>
  );
}

/** Currency, measurement standard, retainage and units: used for quantities, pricing and payment valuation. */
export function ProjectBillingForm({ action, initial }: { action: Action; initial: ProjectBilling }) {
  const { state, formAction, pending } = useSaved(action);
  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <div className="grid gap-1.5">
        <Label htmlFor="measurementStandard">Measurement standard</Label>
        <select id="measurementStandard" name="measurementStandard" defaultValue={initial.measurementStandard} className={`${fieldClass} h-8`}>
          <option value="CSI">CSI MasterFormat</option>
          <option value="NRM2">NRM2</option>
          <option value="SMM7">SMM7</option>
          <option value="custom">Custom</option>
        </select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="unitSystem">Units</Label>
        <select id="unitSystem" name="unitSystem" defaultValue={initial.unitSystem} className={`${fieldClass} h-8`}>
          <option value="imperial">Imperial (ft, sf, cy)</option>
          <option value="metric">Metric (m, m², m³)</option>
        </select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="currency">Currency</Label>
        <Input id="currency" name="currency" defaultValue={initial.currency} maxLength={3} required />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="retentionPct">Retainage %</Label>
        <Input id="retentionPct" name="retentionPct" type="number" min={0} max={100} step="0.5" defaultValue={initial.retentionPct} />
      </div>
      <Footer error={state.error} pending={pending} submitLabel="Save changes" pendingLabel="Saving…" />
    </form>
  );
}
