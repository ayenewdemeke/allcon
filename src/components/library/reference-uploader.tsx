"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { readManual } from "@/lib/pdf/review-client";
import { postJson, uploadParts } from "@/lib/upload-client";

type UploadStart = { referenceId: string; uploadKey: string; urls: string[]; partSize: number };
const BATCH_CHARS = 1_500_000; // keep each sections request well under request-size limits

/**
 * Adds a manual to the library. While the PDF uploads, the browser reads its text and splits
 * it into sections, so the server never parses the file.
 */
export function ReferenceUploader({ label = "Add manual" }: { label?: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<{ file: string; percent: number } | null>(null);

  async function upload(file: File) {
    let uploaded = 0;
    let read = 0;
    const report = () => setStatus({ file: file.name, percent: Math.round(uploaded * 0.6 + read * 0.4) });
    setStatus({ file: file.name, percent: 0 });
    try {
      const start = await postJson<UploadStart>("/api/references", {
        fileName: file.name,
        fileSize: file.size,
        title: file.name.replace(/\.pdf$/i, "").replace(/[_]+/g, " ").trim() || file.name,
      });
      const [manual] = await Promise.all([
        readManual(file, (done, total) => {
          read = (done / total) * 100;
          report();
        }),
        uploadParts(file, start.urls, start.partSize, (p) => {
          uploaded = p;
          report();
        }),
      ]);
      if (!manual.sections.length) throw new Error("No text found. Scanned manuals need OCR first.");

      let batch: typeof manual.sections = [];
      let size = 0;
      let offset = 0;
      const send = async () => {
        if (!batch.length) return;
        await postJson(`/api/references/${start.referenceId}/sections`, { offset, sections: batch });
        offset += batch.length;
        batch = [];
        size = 0;
      };
      for (const s of manual.sections) {
        if (size + s.text.length > BATCH_CHARS || batch.length >= 500) await send();
        batch.push(s);
        size += s.text.length;
      }
      await send();
      await postJson(`/api/references/${start.referenceId}/complete`, { uploadKey: start.uploadKey, pageCount: manual.pageCount });
      toast.success(`Added ${file.name}: ${manual.sections.length} sections`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Upload failed";
      toast.error(/password|encrypted/i.test(reason) ? `${file.name} is password-protected` : `${file.name}: ${reason}`);
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
        accept=".pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      {status && (
        <div className="hidden min-w-0 items-center gap-2 text-xs text-muted-foreground sm:flex">
          <span className="max-w-48 truncate">{status.file}</span>
          <Progress value={status.percent} className="w-32" />
        </div>
      )}
      <Button onClick={() => inputRef.current?.click()} disabled={status !== null}>
        <Upload />
        {status ? `Reading ${status.percent}%` : label}
      </Button>
    </div>
  );
}
