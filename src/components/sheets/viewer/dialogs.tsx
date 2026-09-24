"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseDistance, type UnitSystem } from "@/lib/takeoff";

export function CalibrateDialog({
  open,
  unitSystem,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  unitSystem: UnitSystem;
  onSubmit: (meters: number) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const meters = parseDistance(value, unitSystem);
  const example = unitSystem === "imperial" ? `24'-6", 24.5 ft or 294 in` : "7.5 m or 7500 mm";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (meters) {
              onSubmit(meters);
              setValue("");
            }
          }}
          className="grid gap-4"
        >
          <DialogHeader>
            <DialogTitle>Calibrate scale</DialogTitle>
            <DialogDescription>
              How long is the line you just drew in reality? Every length and area on this sheet will use this scale.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="known-distance">Known distance</Label>
            <Input
              id="known-distance"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={example}
              aria-invalid={value !== "" && !meters}
            />
            <p className="text-xs text-muted-foreground">
              {value && !meters ? "Couldn't read that distance." : `e.g. ${example}`}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={!meters}>
              Set scale
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function NoteDialog({
  open,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) {
              onSubmit(text.trim());
              setText("");
            }
          }}
          className="grid gap-4"
        >
          <DialogHeader>
            <DialogTitle>Add note</DialogTitle>
          </DialogHeader>
          <textarea
            autoFocus
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={2000}
            className="w-full rounded-lg border border-input bg-card px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            placeholder="e.g. Verify slab thickness with structural"
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={!text.trim()}>
              Add note
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
