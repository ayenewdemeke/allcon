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
import { ProjectDetailsForm } from "./project-form";

export function NewProjectDialog({ label = "New project" }: { label?: string }) {
  return (
    <Dialog>
      <DialogTrigger render={<Button />}>
        <Plus />
        {label}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>Only a name is needed. Currency, units and billing settings follow the location, and can be changed in project settings.</DialogDescription>
        </DialogHeader>
        <ProjectDetailsForm action={createProject} submitLabel="Create project" pendingLabel="Creating…" />
      </DialogContent>
    </Dialog>
  );
}
