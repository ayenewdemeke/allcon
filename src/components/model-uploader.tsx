"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ACCEPTED_EXTENSIONS } from "@/lib/model-files";
import { postJson, uploadParts } from "@/lib/upload-client";

type UploadStart = { modelId: string; uploadKey: string; urls: string[]; partSize: number };

/** Uploads a model straight from the browser to APS storage, then starts translation. */
export function ModelUploader({ projectId }: { projectId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);

  async function upload(file: File) {
    setProgress(0);
    try {
      const start = await postJson<UploadStart>(`/api/projects/${projectId}/models`, {
        fileName: file.name,
        fileSize: file.size,
      });
      router.refresh(); // show the new row as "uploading"

      await uploadParts(file, start.urls, start.partSize, setProgress);

      await postJson(`/api/models/${start.modelId}/complete`, { uploadKey: start.uploadKey });
      toast.success(`${file.name} uploaded. Translation has started.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    }
  }

  return (
    <div className="flex items-center gap-3">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_EXTENSIONS.join(",")}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      {progress !== null && <Progress value={progress} className="w-40" />}
      <Button onClick={() => inputRef.current?.click()} disabled={progress !== null}>
        {progress !== null ? `Uploading ${progress}%` : "Upload model"}
      </Button>
    </div>
  );
}
