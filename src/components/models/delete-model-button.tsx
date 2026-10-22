"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteIfcModel, deleteUploadedModel } from "@/app/actions/models3d";
import { Button } from "@/components/ui/button";

/** Deletes a model after a confirmation: an uploaded one, or one an AI app built. */
export function DeleteModelButton({
  kind,
  id,
  name,
  afterHref,
  label = false,
}: {
  kind: "upload" | "built";
  id: string;
  name: string;
  /** Where to go after deleting (from the model's own page). */
  afterHref?: string;
  label?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const remove = () => {
    const what = kind === "upload" ? "its elements, its mappings to the SOV / BoQ and the uploaded file" : "its file and backup";
    if (!window.confirm(`Delete "${name}"? This also deletes ${what}.`)) return;
    start(async () => {
      try {
        await (kind === "upload" ? deleteUploadedModel(id) : deleteIfcModel(id));
        toast.success("Model deleted");
        if (afterHref) router.push(afterHref);
      } catch {
        toast.error("Could not delete the model");
      }
    });
  };
  return (
    <Button
      variant="ghost"
      size={label ? "sm" : "icon-sm"}
      className="text-destructive hover:text-destructive"
      onClick={remove}
      disabled={pending}
      title="Delete model"
      aria-label={`Delete ${name}`}
    >
      {pending ? <Loader2 className="animate-spin" /> : <Trash2 />}
      {label && "Delete"}
    </Button>
  );
}
