"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Loader2, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { bridgeDesignStatus, createBridgeDesign, type BridgeDesignStatus } from "@/app/actions/bridge";
import type { BridgeDefinition, DesignLink } from "@/lib/bridge/definition";
import { designTargets } from "@/lib/bridge/design-links";
import { cn } from "@/lib/utils";

// The bridge's parts and their designs: each part that has a design tool, what the design takes
// from the model, and the design started for it with whether its checks pass. A design opens in
// the Design section, where it's an ordinary design with the bridge's values filled in.

export function DesignPanel({ bridgeId, def, saved, onLinks }: { bridgeId: string; def: BridgeDefinition; /** The bridge as shown is saved (a design is started from the saved bridge). */ saved: boolean; onLinks: (links: DesignLink[]) => void }) {
  const [status, setStatus] = useState<BridgeDesignStatus[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const links = def.designs;
  useEffect(() => {
    let live = true;
    bridgeDesignStatus(bridgeId)
      .then((s) => live && setStatus(s))
      .catch(() => live && setStatus([]));
    return () => {
      live = false;
    };
  }, [bridgeId, links]);
  const start = async (key: string) => {
    setBusy(key);
    try {
      const r = await createBridgeDesign(bridgeId, key);
      onLinks(r.designs);
      toast.success("Design started with the bridge's values", { action: { label: "Open", onClick: () => window.open(`/design/${r.designId}`, "_blank") } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start the design");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="space-y-2 p-3 text-xs">
      <table className="w-full">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-1 pr-2 font-medium">Part</th>
            <th className="px-2 font-medium">Design tool</th>
            <th className="px-2 font-medium">Taken from the model</th>
            <th className="px-2 font-medium">Design</th>
            <th className="px-2 font-medium">Checks</th>
            <th className="w-32 pl-2" />
          </tr>
        </thead>
        <tbody>
          {designTargets(def).map((t) => {
            const link = links.find((l) => l.target === t.key);
            const s = link ? status?.find((x) => x.id === link.id) : undefined;
            const gone = !!link && !!status && !s;
            return (
              <tr key={t.key} className="border-b border-border/40">
                <td className="py-1 pr-2 font-medium">{t.label}</td>
                <td className="px-2">{t.tool}</td>
                <td className="px-2 text-muted-foreground">{t.from}</td>
                <td className="px-2">
                  {s ? (
                    <Link href={`/design/${s.id}`} target="_blank" className="inline-flex items-center gap-1 text-primary hover:underline">
                      {s.name} <ExternalLink className="size-3" />
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">{gone ? "Deleted" : link && !status ? "…" : "Not started"}</span>
                  )}
                </td>
                <td className={cn("px-2 font-medium", s?.ok === true ? "text-emerald-600" : s?.ok === false ? "text-red-600" : "text-muted-foreground")}>{s ? (s.ok === true ? "Pass" : s.ok === false ? "Fail" : "Can't be worked out") : "—"}</td>
                <td className="pl-2 text-right">
                  <button type="button" disabled={!!busy || !saved} onClick={() => void start(t.key)} title={saved ? undefined : "Saving the bridge first"} className="inline-flex items-center gap-1 rounded border px-2 py-0.5 hover:bg-accent disabled:opacity-50">
                    {busy === t.key ? <Loader2 className="size-3 animate-spin" /> : s ? <RefreshCw className="size-3" /> : <Plus className="size-3" />}
                    {s ? "Start again" : "Start design"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-muted-foreground">
        A design starts with the bridge&apos;s geometry and the forces from this analysis filled in, and is then an ordinary design: its own checks and calc package, edited in Design. It doesn&apos;t follow later changes to the bridge: &ldquo;Start again&rdquo; makes a new one
        from the bridge as it is now. The girder check does its own line-girder analysis with AASHTO&apos;s distribution factors, to compare with this model&apos;s. Pier caps (strut-and-tie) are started in Design for now.
      </p>
    </div>
  );
}
