import "server-only";
import { signedReadUrl } from "@/lib/storage";

/**
 * A model's current IFC: a redirect to a short-lived link straight to file storage, so the
 * file never passes through the app's server. With `download`, the browser saves it as a file.
 */
export async function modelFileRedirect(model: { name: string; revision: number; fileKey: string }, download: boolean) {
  const fileName = `${model.name.replace(/[^\w.-]+/g, "_")}-r${model.revision}.ifc`;
  const url = await signedReadUrl(model.fileKey, download ? { downloadAs: fileName } : {});
  return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "private, no-store" } });
}
