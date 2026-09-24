import { AlertTriangle, ArrowRight, Download } from "lucide-react";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney, formatNumber } from "@/lib/format";
import { requireProject } from "@/lib/auth/session";
import { buildReport } from "@/lib/report";
import { cn } from "@/lib/utils";

const pct = (v: number) => `${Math.round(v * 100)}%`;
// Coverage rounds down, so 99.7% never reads as "100%" while a line is still unmeasured.
const coveragePct = (v: number) => (v >= 1 ? "100%" : `${(Math.floor(v * 1000) / 10).toFixed(1)}%`);

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card size="sm">
      <CardContent className="space-y-1">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

const SOURCES = [
  ["property", "Model properties", "bg-success"],
  ["qto_set", "IFC quantity sets", "bg-primary"],
  ["geometry", "Computed from geometry", "bg-info"],
  ["missing", "No usable quantity", "bg-warning"],
] as const;

export default async function ReportPage({ params }: PageProps<"/projects/[projectId]/report">) {
  const { project } = await requireProject((await params).projectId);
  const report = await buildReport(project.id);
  const { totals, model, lines } = report;
  const money = (v: number) => formatMoney(v, project.currency);

  return (
    <PageBody>
      <PageHeader
        title="Validation report"
        description="How much of the contract is backed by measured quantities, and where those quantities came from."
        actions={
          <a href={`/api/projects/${project.id}/export`} download className={buttonVariants()}>
            <Download /> Export to Excel
          </a>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Contract value" value={money(totals.contractValue)} hint={`${money(totals.lumpSumValue)} of it in lump sums`} />
        <Stat
          label="Measured value"
          value={money(totals.measuredValue)}
          hint={`Unit-price lines at measured quantities (contract ${money(totals.unitPriceValue)})`}
        />
        <Stat
          label="Value covered by measurement"
          value={coveragePct(totals.coverage)}
          hint={`${totals.measuredLines} of ${totals.unitPriceLines} unit-price lines measured`}
        />
        <Stat
          label="Model elements mapped"
          value={model.totalElements ? pct(model.mappedElements / model.totalElements) : "—"}
          hint={model.totalElements ? `${model.mappedElements.toLocaleString()} of ${model.totalElements.toLocaleString()}` : "No model yet"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Where model quantities come from</CardTitle>
            <CardDescription>{report.version ? report.version.fileName : "No model processed yet"}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {SOURCES.map(([key, label, color]) => {
              const n = model.sources[key];
              const share = model.totalElements ? n / model.totalElements : 0;
              return (
                <div key={key} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>{label}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {n.toLocaleString()} · {pct(share)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className={cn("h-full rounded-full", color)} style={{ width: `${share * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between">
            <div className="space-y-1">
              <CardTitle>Largest unmapped groups</CardTitle>
              <CardDescription>Model elements not yet linked to any line item.</CardDescription>
            </div>
            <LinkButton variant="ghost" size="sm" href={`/projects/${project.id}/mapping`}>
              Map <ArrowRight />
            </LinkButton>
          </CardHeader>
          <CardContent>
            {model.unmappedGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground">Every element group is mapped.</p>
            ) : (
              <ul className="divide-y text-sm">
                {model.unmappedGroups.map((g) => (
                  <li key={`${g.category}-${g.typeName}`} className="flex justify-between gap-3 py-1.5">
                    <span className="min-w-0 truncate">
                      {g.typeName ?? "(no type)"} <span className="text-muted-foreground">· {g.category}</span>
                    </span>
                    <span className="shrink-0 text-muted-foreground tabular-nums">{g.count.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="gap-0 pb-0">
        <CardHeader className="pb-4">
          <CardTitle>Contract vs. measured</CardTitle>
          <CardDescription>
            Quantities in each line&apos;s unit. {totals.flagged > 0 && `${totals.flagged} line(s) need a look.`}
          </CardDescription>
        </CardHeader>
        <div className="overflow-x-auto border-t">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="pl-4">Line item</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Contract</TableHead>
                <TableHead className="text-right">Model</TableHead>
                <TableHead className="text-right">Drawings</TableHead>
                <TableHead className="text-right">Variance</TableHead>
                <TableHead className="text-right">Measured value</TableHead>
                <TableHead className="pr-4">Checks</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) =>
                l.isHeading ? (
                  <TableRow key={l.id} className="bg-muted/40 hover:bg-muted/40">
                    <TableCell colSpan={8} className="pl-4 font-semibold">
                      {l.code} {l.description}
                    </TableCell>
                  </TableRow>
                ) : (
                  <TableRow key={l.id}>
                    <TableCell className="max-w-xs pl-4">
                      <span className="line-clamp-1">
                        {l.code && <span className="text-muted-foreground">{l.code} · </span>}
                        {l.description}
                      </span>
                    </TableCell>
                    <TableCell>{l.unit}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.billingType === "lump_sum" ? "LS" : formatNumber(l.contractQuantity)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(l.modelQuantity, 1)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(l.drawingQuantity, 1)}</TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums",
                        l.variance !== null && Math.abs(l.variance) > 0.1 && "font-medium text-[hsl(32_95%_35%)]",
                      )}
                    >
                      {l.variance === null ? "—" : `${l.variance > 0 ? "+" : ""}${Math.round(l.variance * 100)}%`}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{l.measuredValue === null ? "—" : money(l.measuredValue)}</TableCell>
                    <TableCell className="pr-4">
                      {l.billingType === "lump_sum" ? (
                        <Badge variant="secondary">Lump sum</Badge>
                      ) : l.flags.length ? (
                        <span className="flex items-start gap-1 text-xs text-[hsl(32_95%_35%)]">
                          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                          {l.flags.join("; ")}
                        </span>
                      ) : (
                        <Badge variant="success">OK</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ),
              )}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={6} className="pl-4">
                  Measured value (unit-price lines)
                </TableCell>
                <TableCell className="text-right tabular-nums">{money(totals.measuredValue)}</TableCell>
                <TableCell className="pr-4">
                  <Progress value={totals.coverage * 100} className="w-24" />
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </Card>
    </PageBody>
  );
}
