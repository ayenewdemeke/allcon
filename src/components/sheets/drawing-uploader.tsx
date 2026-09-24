"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { DRAWING_EXTENSIONS } from "@/lib/model-files";
import { readLocalPdf } from "@/lib/pdf/client";
import { postJson, uploadParts } from "@/lib/upload-client";

type UploadStart = { drawingSetId: string; uploadKey: string; urls: string[]; partSize: number };
type Status = { file: string; index: number; total: number; percent: number };

/**
 * Uploads PDF drawing sets. While each file uploads, the browser reads its pages
 * (sizes, sheet numbers) with pdf.js, so the server never parses the PDF.
 */
export function DrawingUploader({ projectId, label = "Upload drawings" }: { projectId: string; label?: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status | null>(null);

  async function uploadOne(file: File, index: number, total: number) {
    let uploaded = 0;
    let read = 0;
    // Upload counts for most of the bar; reading pages is quick.
    const report = () =>
      setStatus({ file: file.name, index, total, percent: Math.round(uploaded * 0.85 + read * 0.15) });

    const start = await postJson<UploadStart>(`/api/projects/${projectId}/drawings`, {
      fileName: file.name,
      fileSize: file.size,
    });
    const [pages] = await Promise.all([
      readLocalPdf(file, (done, count) => {
        read = (done / count) * 100;
        report();
      }),
      uploadParts(file, start.urls, start.partSize, (p) => {
        uploaded = p;
        report();
      }),
    ]);
    await postJson(`/api/drawings/${start.drawingSetId}/complete`, { uploadKey: start.uploadKey, pages });
    return pages.length;
  }

  async function upload(files: File[]) {
    let sheets = 0;
    try {
      for (const [i, file] of files.entries()) {
        setStatus({ file: file.name, index: i + 1, total: files.length, percent: 0 });
        try {
          sheets += await uploadOne(file, i + 1, files.length);
        } catch (err) {
          const reason = err instanceof Error ? err.message : "Upload failed";
          toast.error(
            /password|encrypted/i.test(reason) ? `${file.name} is password-protected` : `${file.name}: ${reason}`,
          );
        }
      }
      if (sheets) toast.success(`Added ${sheets} sheet${sheets === 1 ? "" : "s"}`);
    } finally {
      setStatus(null);
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    }
  }

  return (
    <div className="flex items-center gap-3">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={DRAWING_EXTENSIONS.join(",")}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) void upload(files);
        }}
      />
      {status && (
        <div className="hidden min-w-0 items-center gap-2 text-xs text-muted-foreground sm:flex">
          <span className="max-w-48 truncate">
            {status.total > 1 && `${status.index}/${status.total} · `}
            {status.file}
          </span>
          <Progress value={status.percent} className="w-32" />
        </div>
      )}
      <Button onClick={() => inputRef.current?.click()} disabled={status !== null}>
        <Upload />
        {status ? `Uploading ${status.percent}%` : label}
      </Button>
    </div>
  );
}
