"use client";

import { Plus } from "lucide-react";
import { createProject } from "@/app/actions/projects";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { MapsConfig } from "@/lib/maps/config";
import { ProjectDetailsForm } from "./project-form";

export function NewProjectDialog({ label = "New project", maps }: { label?: string; maps: MapsConfig | null }) {
  return (
    <Dialog>
      <DialogTrigger render={<Button />}>
        <Plus />
        {label}
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>Only a name is needed. Currency, units and billing settings follow the location, and can be changed in project settings.</DialogDescription>
        </DialogHeader>
        <ProjectDetailsForm action={createProject} maps={maps} submitLabel="Create project" pendingLabel="Creating…" />
      </DialogContent>
    </Dialog>
  );
}
