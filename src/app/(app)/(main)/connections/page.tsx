import type { Metadata } from "next";
import Link from "next/link";
import { CircleAlert, Plug } from "lucide-react";
import { CopyUrl, DisconnectButton, UndoButton } from "@/components/connections/connection-actions";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { APP_NAME } from "@/lib/app-config";
import { mcpResource } from "@/lib/auth/server";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "Connections" };

const SKILLS = [
  { name: "Review a sheet against the manuals", text: "Checks a sheet against your library and flags real issues on it, with citations." },
  { name: "Explain a sheet", text: "A plain-language walkthrough of what a sheet shows and its key values." },
  { name: "Summarize quantities and cost", text: "Measured quantities against the schedule of values, with the biggest variances." },
  { name: "Build a 3D model from drawings", text: "Structural or architectural: reads a drawing set and builds a 3D IFC model you can view, check and download." },
];

const when = (d: Date) => d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

export default async function ConnectionsPage() {
  const user = await requireUser();
  const url = mcpResource(env().APP_URL);
  const [consents, activity] = await Promise.all([
    db.oauthConsent.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: { client: { select: { clientId: true, name: true, uri: true } } },
    }),
    db.mcpActivity.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 40,
      include: { project: { select: { id: true, name: true } } },
    }),
  ]);
  const appName = (c: { name: string | null; uri: string | null; clientId: string }) => {
    if (c.name) return c.name;
    try {
      return new URL(c.uri ?? c.clientId).hostname;
    } catch {
      return "An app";
    }
  };
  const names = new Map(consents.map((c) => [c.clientId, appName(c.client)]));

  return (
    <PageBody>
      <PageHeader
        title="Connections"
        description={`Use ${APP_NAME} from your own AI app, such as Claude, ChatGPT or Gemini. The AI runs on your plan with that app; ${APP_NAME} gives it your projects and tools.`}
      />

      <Card>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <h2 className="font-semibold">Connector address</h2>
            <CopyUrl url={url} />
          </div>
          <div className="grid gap-4 text-sm md:grid-cols-3">
            <div className="space-y-1">
              <p className="font-medium">Claude</p>
              <p className="text-muted-foreground">
                Settings → Connectors → Add custom connector. Paste the address, then Connect and sign in to {APP_NAME}.
              </p>
            </div>
            <div className="space-y-1">
              <p className="font-medium">ChatGPT</p>
              <p className="text-muted-foreground">
                Settings → Apps &amp; Connectors. Add a custom connector (it may need developer mode) with the address, then
                sign in to {APP_NAME}.
              </p>
            </div>
            <div className="space-y-1">
              <p className="font-medium">Gemini</p>
              <p className="text-muted-foreground">
                In the Gemini app: Settings → Connected apps → Add a custom app, paste the address and sign in. In Gemini CLI,
                add it to <code className="text-xs">~/.gemini/settings.json</code>, then run{" "}
                <code className="text-xs">/mcp auth conkit</code>:
              </p>
              <pre className="overflow-x-auto rounded-md bg-muted/60 px-2 py-1.5 text-xs">{`"mcpServers": {
  "conkit": { "httpUrl": "${url}" }
}`}</pre>
            </div>
          </div>
          <p className="flex gap-2 text-xs text-muted-foreground">
            <CircleAlert className="size-4 shrink-0" />
            Menu names change from time to time, and custom connectors need a paid plan with those apps.
          </p>
        </CardContent>
      </Card>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Ready-made skills</h2>
        <p className="text-sm text-muted-foreground">
          Your AI app lists these as prompts from {APP_NAME} (in Claude, under the + menu). You can also just ask in your own words.
        </p>
        <div className="grid gap-3 md:grid-cols-3">
          {SKILLS.map((s) => (
            <Card key={s.name} className="gap-1 py-4">
              <CardContent className="space-y-1 px-4">
                <p className="text-sm font-medium">{s.name}</p>
                <p className="text-xs text-muted-foreground">{s.text}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Connected apps</h2>
        {consents.length ? (
          <ul className="divide-y rounded-lg border bg-card">
            {consents.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <Plug className="size-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{names.get(c.clientId)}</p>
                  <p className="text-xs text-muted-foreground">Connected {c.createdAt ? when(c.createdAt) : ""}</p>
                </div>
                <DisconnectButton clientId={c.clientId} name={names.get(c.clientId) ?? "the app"} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            No apps connected yet.
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Recent activity</h2>
        {activity.length ? (
          <ul className="divide-y rounded-lg border bg-card">
            {activity.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate">
                    {!a.ok && <Badge variant="destructive" className="mr-1.5">failed</Badge>}
                    {a.summary}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {when(a.createdAt)} · {(a.clientId && names.get(a.clientId)) || "AI app"}
                    {a.project && (
                      <>
                        {" · "}
                        <Link href={`/projects/${a.project.id}`} className="hover:text-primary hover:underline">
                          {a.project.name}
                        </Link>
                      </>
                    )}
                  </p>
                </div>
                {(a.markupIds.length > 0 || a.undo !== null) && <UndoButton activityId={a.id} />}
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            What connected apps do in {APP_NAME} shows up here.
          </p>
        )}
      </section>
    </PageBody>
  );
}
