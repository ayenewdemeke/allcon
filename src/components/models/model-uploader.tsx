"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ACCEPTED_EXTENSIONS, extensionOf } from "@/lib/model-files";
import { postJson, uploadParts } from "@/lib/upload-client";

type UploadStart = { modelId: string; uploadKey: string; urls: string[]; partSize: number };
type IfcUploadStart = { modelId: string; key: string; upload: { url: string; headers: Record<string, string> } };

/** PUTs a file to a signed storage link, reporting 0-100 progress. */
function putWithProgress(file: File, url: string, headers: Record<string, string>, onProgress: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.send(file);
  });
}

/**
 * Uploads a model straight from the browser. IFC files go to file storage and open at once in
 * conkit's IFC viewer; Revit files go to Autodesk, which translates them for its viewer.
 */
export function ModelUploader({ projectId }: { projectId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);

  async function upload(file: File) {
    setProgress(0);
    if (extensionOf(file.name) === ".ifc") {
      try {
        const start = await postJson<IfcUploadStart>(`/api/projects/${projectId}/ifc-uploads`, { fileName: file.name, fileSize: file.size });
        await putWithProgress(file, start.upload.url, start.upload.headers, setProgress);
        const done = await postJson<{ link: string }>(`/api/projects/${projectId}/ifc-uploads/${start.modelId}`, {
          key: start.key,
          fileName: file.name,
          fileSize: file.size,
        });
        toast.success(`${file.name} uploaded.`);
        router.push(done.link);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setProgress(null);
        if (inputRef.current) inputRef.current.value = "";
      }
      return;
    }
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
