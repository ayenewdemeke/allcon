import { getViewerToken } from "@/lib/aps/auth";
import { getCurrentUser } from "@/lib/session";

export async function GET() {
  if (!(await getCurrentUser())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(await getViewerToken(), { headers: { "Cache-Control": "no-store" } });
}
