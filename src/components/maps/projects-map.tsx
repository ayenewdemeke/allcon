"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AdvancedMarker, Map, Pin, useMap, useMapsLibrary } from "@vis.gl/react-google-maps";
import { Map3D, MapMode, Marker3D, type Map3DRef } from "@vis.gl/react-google-maps/3d";
import { Box, FolderKanban, MapPin, X } from "lucide-react";
import { useMapsConfig } from "@/components/maps/maps-provider";
import { LinkButton } from "@/components/ui/link-button";
import { cn } from "@/lib/utils";

// The organization's projects at their sites: a map with a pin per project, or the same in
// photorealistic 3D. Picking a pin shows the project, with links to it and its 3D models.

export type MapProject = { id: string; name: string; location: string | null; lat: number; lon: number; models: number };

const WORLD = { lat: 30, lng: -40 };

export function ProjectsMap({ projects }: { projects: MapProject[] }) {
  const [mode, setMode] = useState<"2d" | "3d">("2d");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = projects.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="relative h-[calc(100svh-11rem)] min-h-96 overflow-hidden rounded-xl border bg-muted">
      {mode === "2d" ? <FlatMap projects={projects} selected={selected} onSelect={setSelectedId} /> : <GlobeMap projects={projects} selected={selected} onSelect={setSelectedId} />}

      <div className="absolute top-3 right-3 z-10 flex rounded-lg border bg-background/95 p-0.5 shadow-md backdrop-blur-sm">
        {(["2d", "3d"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn("rounded-md px-3 py-1 text-xs font-medium", mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {m === "2d" ? "Map" : "3D"}
          </button>
        ))}
      </div>

      {selected && (
        <div className="absolute bottom-4 left-3 z-10 w-72 rounded-lg border bg-background/95 p-3 shadow-lg backdrop-blur-sm max-sm:right-3 max-sm:w-auto">
          <div className="flex items-start gap-2">
            <FolderKanban className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{selected.name}</p>
              {selected.location && <p className="truncate text-xs text-muted-foreground">{selected.location}</p>}
            </div>
            <button type="button" onClick={() => setSelectedId(null)} aria-label="Close" className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="size-3.5" />
            </button>
          </div>
          <div className="mt-3 flex gap-2">
            <LinkButton href={`/projects/${selected.id}`} size="sm" className="flex-1">
              Open project
            </LinkButton>
            <LinkButton href={`/projects/${selected.id}/models`} size="sm" variant="outline" className="flex-1">
              <Box /> {selected.models} model{selected.models === 1 ? "" : "s"}
            </LinkButton>
          </div>
        </div>
      )}
    </div>
  );
}

function FlatMap({ projects, selected, onSelect }: { projects: MapProject[]; selected: MapProject | null; onSelect: (id: string | null) => void }) {
  const { mapId } = useMapsConfig();
  return (
    <Map mapId={mapId} defaultCenter={WORLD} defaultZoom={2} gestureHandling="greedy" disableDefaultUI zoomControl mapTypeControl clickableIcons={false} onClick={() => onSelect(null)}>
      {projects.map((p) => (
        <AdvancedMarker key={p.id} position={{ lat: p.lat, lng: p.lon }} title={p.name} onClick={() => onSelect(p.id)} zIndex={selected?.id === p.id ? 2 : 1}>
          <Pin background={selected?.id === p.id ? "#1d4ed8" : "#2563eb"} borderColor="#1e3a8a" glyphColor="#fff" scale={selected?.id === p.id ? 1.2 : 1} />
        </AdvancedMarker>
      ))}
      <FitAll projects={projects} />
    </Map>
  );
}

/** Starts zoomed to show every project (close in when there's only one). */
function FitAll({ projects }: { projects: MapProject[] }) {
  const map = useMap();
  useEffect(() => {
    if (!map || projects.length === 0) return;
    if (projects.length === 1) {
      map.setCenter({ lat: projects[0].lat, lng: projects[0].lon });
      map.setZoom(15);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    for (const p of projects) bounds.extend({ lat: p.lat, lng: p.lon });
    map.fitBounds(bounds, 64);
    // Projects close together shouldn't zoom in past street level.
    google.maps.event.addListenerOnce(map, "idle", () => (map.getZoom() ?? 0) > 16 && map.setZoom(16));
  }, [map, projects]);
  return null;
}

function GlobeMap({ projects, selected, onSelect }: { projects: MapProject[]; selected: MapProject | null; onSelect: (id: string | null) => void }) {
  const [map, setMap] = useState<Map3DRef | null>(null);
  const elevation = useMapsLibrary("elevation");
  // Close in on the picked project, or the only one; otherwise the whole set from afar.
  const focus = selected ?? (projects.length === 1 ? projects[0] : null);

  useEffect(() => {
    if (!map || !focus || !elevation) return;
    let cancelled = false;
    // The 3D map's altitudes are above sea level, so looking at a site needs its ground height.
    // Without it (the Elevation API off), the view stays high enough for any city.
    new elevation.ElevationService()
      .getElevationForLocations({ locations: [{ lat: focus.lat, lng: focus.lon }] })
      .then(({ results }) => results[0]?.elevation ?? null)
      .catch(() => null)
      .then((ground) => {
        if (cancelled) return;
        const center = { lat: focus.lat, lng: focus.lon, altitude: ground ?? 0 };
        map.flyCameraTo({ endCamera: ground === null ? { center, range: 6000, tilt: 0, heading: 0 } : { center, range: 900, tilt: 60, heading: 0 }, durationMillis: 2500 });
      });
    return () => {
      cancelled = true;
    };
  }, [map, focus, elevation]);

  const start = focus ?? projects[0];
  return (
    <Map3D
      ref={setMap}
      mode={MapMode.HYBRID}
      className="size-full"
      defaultCenter={start ? { lat: start.lat, lng: start.lon, altitude: 0 } : { ...WORLD, altitude: 0 }}
      defaultRange={focus ? 20_000 : start ? 6_000_000 : 20_000_000}
      defaultTilt={focus ? 45 : 0}
    >
      {projects.map((p) => (
        <Marker3D key={p.id} position={{ lat: p.lat, lng: p.lon }} label={p.name} title={p.name} onClick={() => onSelect(p.id)} />
      ))}
    </Map3D>
  );
}

/** Projects without a pin, with where to add one. */
export function UnpinnedProjects({ projects }: { projects: { id: string; name: string }[] }) {
  if (projects.length === 0) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
      <MapPin className="size-3.5" />
      Not on the map yet:
      {projects.map((p, i) => (
        <span key={p.id}>
          <Link href={`/projects/${p.id}/settings`} className="text-primary hover:underline">
            {p.name}
          </Link>
          {i < projects.length - 1 && ","}
        </span>
      ))}
      <span>(pin the site in the project&apos;s settings)</span>
    </p>
  );
}

export function NoMapsKey() {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-center">
      <MapPin className="size-6 text-muted-foreground" />
      <p className="text-sm font-medium">Maps aren&apos;t set up</p>
      <p className="max-w-sm text-xs text-muted-foreground">Add a Google Maps key (GOOGLE_MAPS_API_KEY) to show projects on a map.</p>
    </div>
  );
}
