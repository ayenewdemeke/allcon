"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import type { ModelStatus as Status } from "@/generated/prisma/enums";

const POLL_MS = 5000;

const labels: Record<Status, string> = {
  uploading: "Uploading",
  translating: "Translating",
  extracting: "Extracting data",
  ready: "Ready",
  failed: "Failed",
};

/** Status badge that polls APS (via our API) while the model is still being processed. */
export function ModelStatus({
  modelId,
  initialStatus,
  initialProgress,
}: {
  modelId: string;
  initialStatus: Status;
  initialProgress: string | null;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [progress, setProgress] = useState(initialProgress);
  const extracting = useRef(false);
  const active = status === "translating" || status === "extracting";

  useEffect(() => {
    if (status !== "translating") return;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/models/${modelId}/status`, { cache: "no-store" });
      if (!res.ok) return;
      const data: { status: Status; progress: string | null } = await res.json();
      setProgress(data.progress);
      if (data.status !== status) {
        setStatus(data.status);
        router.refresh();
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [modelId, status, router]);

  // Once translation is done, ask the server to read the model's elements.
  useEffect(() => {
    if (status !== "extracting" || extracting.current) return;
    extracting.current = true;
    (async () => {
      try {
        const res = await fetch(`/api/models/${modelId}/extract`, { method: "POST" });
        const data = await res.json().catch(() => ({}));
        setStatus(res.ok && data.status === "ready" ? "ready" : res.status === 202 ? "extracting" : "failed");
      } catch {
        setStatus("failed");
      } finally {
        extracting.current = false;
        router.refresh();
      }
    })();
  }, [modelId, status, router]);

  const variant = status === "failed" ? "destructive" : status === "ready" ? "success" : "info";
  return (
    <Badge variant={variant}>
      {labels[status]}
      {active && progress ? ` · ${progress.replace(" complete", "")}` : ""}
    </Badge>
  );
}
