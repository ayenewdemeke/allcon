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
import { ProjectForm } from "./project-form";

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
          <DialogDescription>You can change any of these later in project settings.</DialogDescription>
        </DialogHeader>
        <ProjectForm action={createProject} submitLabel="Create project" pendingLabel="Creating…" />
      </DialogContent>
    </Dialog>
  );
}
