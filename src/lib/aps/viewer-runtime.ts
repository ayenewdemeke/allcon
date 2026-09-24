"use client";

// Shared loader for the APS Viewer, used by both the 3D model viewer and the 2D sheet viewer.

const VIEWER_BASE = "https://developer.api.autodesk.com/modelderivative/v2/viewers/7.*";

let viewerScript: Promise<void> | undefined;
let viewerRuntime: Promise<void> | undefined;

/** Loads the APS Viewer library from Autodesk's CDN once per page. */
function loadViewerLibrary() {
  viewerScript ??= new Promise<void>((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = `${VIEWER_BASE}/style.min.css`;
    document.head.appendChild(css);

    const script = document.createElement("script");
    script.src = `${VIEWER_BASE}/viewer3D.min.js`;
    script.onload = () => resolve();
    script.onerror = () => {
      viewerScript = undefined;
      reject(new Error("Could not load the Autodesk Viewer"));
    };
    document.head.appendChild(script);
  });
  return viewerScript;
}

async function fetchToken() {
  const res = await fetch("/api/aps/viewer-token", { cache: "no-store" });
  if (!res.ok) throw new Error("Could not get a viewer token");
  return (await res.json()) as { access_token: string; expires_in: number };
}

/** Loads and initializes the Viewer runtime once; calling Initializer twice leaves it hanging. */
export function initViewerRuntime() {
  viewerRuntime ??= loadViewerLibrary().then(
    () =>
      new Promise<void>((resolve) =>
        Autodesk.Viewing.Initializer(
          {
            env: "AutodeskProduction2",
            api: "streamingV2",
            getAccessToken: (done) => {
              fetchToken()
                .then((t) => done?.(t.access_token, t.expires_in))
                .catch((e) => console.error(e));
            },
          },
          resolve,
        ),
      ),
  );
  viewerRuntime.catch(() => (viewerRuntime = undefined));
  return viewerRuntime;
}
