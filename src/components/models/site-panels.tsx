"use client";

import { useEffect } from "react";
import { AdvancedMarker, Map, Polygon, useMap } from "@vis.gl/react-google-maps";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronsDown, ChevronsUp, ExternalLink, MapPin, RotateCcw, RotateCw } from "lucide-react";
import { useMapsConfig } from "@/components/maps/maps-provider";
import { FloatingPanel } from "@/components/models/viewer-panels";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { PLACEMENT_SOURCE, googleMapsUrl, type Placement } from "@/lib/maps/placement";
import { cn } from "@/lib/utils";

// The model's site: a map beside the model with its outline, and the controls for placing it
// on the 3D site.

export type Footprint = { east: number; north: number }[];

const METRES_PER_DEGREE = 111_320;

/** A point some metres east and north of a placement's origin. */
export function offset(p: { lat: number; lon: number }, east: number, north: number) {
  return { lat: p.lat + north / METRES_PER_DEGREE, lng: p.lon + east / (METRES_PER_DEGREE * Math.cos((p.lat * Math.PI) / 180)) };
}

/** The outline on the map, around the placement's anchor, the model's axes turned by its heading (clockwise from north). */
function outline(p: Placement, footprint: Footprint) {
  const h = (p.heading * Math.PI) / 180;
  // The footprint is measured from the model's origin; the anchor is the origin, a base point, or (null) the middle.
  const [ax, ay] = p.anchor ?? [
    footprint.reduce((sum, c) => sum + c.east, 0) / footprint.length,
    footprint.reduce((sum, c) => sum + c.north, 0) / footprint.length,
  ];
  return footprint.map(({ east, north }) => {
    const [x, y] = [east - ax, north - ay];
    return offset(p, x * Math.cos(h) + y * Math.sin(h), y * Math.cos(h) - x * Math.sin(h));
  });
}

export function NoPlacement({ editable, settingsHref }: { editable: boolean; settingsHref?: string }) {
  return (
    <div className="space-y-3 py-6 text-center">
      <MapPin className="mx-auto size-7 text-muted-foreground opacity-60" />
      <p className="px-2 text-xs text-muted-foreground">
        This model doesn&apos;t say where it is{editable ? ", and the project's site isn't pinned yet." : "."}
      </p>
      {editable && settingsHref && (
        <LinkButton href={settingsHref} size="sm" variant="outline">
          Pin the site in Settings
        </LinkButton>
      )}
    </div>
  );
}

/** A map of the site with the model's outline. While the model is being placed, its pin can be dragged to move it. */
export function SiteMapPanel({
  placement,
  footprint,
  editable,
  placing,
  settingsHref,
  onMove,
  onClose,
}: {
  placement: Placement | null;
  footprint: Footprint | null;
  editable: boolean;
  /** The model is being placed on the 3D site: the pin moves it. */
  placing: boolean;
  settingsHref?: string;
  onMove: (lat: number, lon: number) => void;
  onClose: () => void;
}) {
  const { mapId } = useMapsConfig();
  return (
    <FloatingPanel title="Site" onClose={onClose} className="top-3 left-3 w-96 max-sm:right-3 max-sm:w-auto">
      {!placement ? (
        <NoPlacement editable={editable} settingsHref={settingsHref} />
      ) : (
        <div>
          <div className="h-72">
            <Map
              mapId={mapId}
              defaultCenter={{ lat: placement.lat, lng: placement.lon }}
              defaultZoom={18}
              mapTypeId="hybrid"
              gestureHandling="greedy"
              disableDefaultUI
              zoomControl
              mapTypeControl
              clickableIcons={false}
            >
              {footprint && <Polygon paths={outline(placement, footprint)} strokeColor="#60a5fa" strokeWeight={2} fillOpacity={0} clickable={false} />}
              <FitSite placement={placement} footprint={footprint} />
              <AdvancedMarker
                position={{ lat: placement.lat, lng: placement.lon }}
                draggable={editable && placing}
                title={editable && placing ? "Drag to move the model" : "Where the model is"}
                onDragEnd={(e) => e.latLng && onMove(e.latLng.lat(), e.latLng.lng())}
              />
            </Map>
          </div>
          <div className="space-y-0.5 border-t px-3 py-2 text-xs text-muted-foreground">
            <p className="tabular-nums">
              {placement.lat.toFixed(6)}, {placement.lon.toFixed(6)} · facing {Math.round(placement.heading)}°
            </p>
            <p>Placed {PLACEMENT_SOURCE[placement.source]}.</p>
            {editable && placing && <p>Drag the pin to move the model.</p>}
            <a
              href={googleMapsUrl(placement.lat, placement.lon)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 pt-1 text-primary hover:underline"
            >
              Open in Google Maps <ExternalLink className="size-3" />
            </a>
          </div>
        </div>
      )}
    </FloatingPanel>
  );
}

/** Starts with the model's outline and origin in view. */
function FitSite({ placement, footprint }: { placement: Placement; footprint: Footprint | null }) {
  const map = useMap();
  const ready = !!footprint;
  useEffect(() => {
    if (!map || !footprint) return;
    const bounds = new google.maps.LatLngBounds({ lat: placement.lat, lng: placement.lon });
    for (const corner of outline(placement, footprint)) bounds.extend(corner);
    map.fitBounds(bounds, 48);
    google.maps.event.addListenerOnce(map, "idle", () => (map.getZoom() ?? 0) > 20 && map.setZoom(20));
    // Only when the panel opens: moving the model shouldn't move the map under the pointer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, ready]);
  return null;
}

/** Nudges the model on the 3D site: move, turn, raise; then save or put it back. */
export function PlacementPanel({
  placement,
  editable,
  dirty,
  saving,
  credits,
  onChange,
  onSave,
  onRevert,
  onReset,
}: {
  placement: Placement;
  editable: boolean;
  dirty: boolean;
  saving: boolean;
  credits: string;
  onChange: (next: Placement) => void;
  onSave: () => void;
  onRevert: () => void;
  onReset: () => void;
}) {
  const move = (east: number, north: number) => {
    const at = offset(placement, east, north);
    onChange({ ...placement, lat: at.lat, lon: at.lng });
  };
  const turn = (degrees: number) => onChange({ ...placement, heading: (((placement.heading + degrees) % 360) + 360) % 360 });
  const raise = (metres: number) => onChange({ ...placement, elevation: Math.round((placement.elevation + metres) * 100) / 100 });

  return (
    <>
      {editable && (
        <div className="absolute bottom-4 left-3 z-10 w-64 space-y-2 rounded-lg border bg-background/95 p-3 text-xs shadow-lg backdrop-blur-sm max-sm:right-3 max-sm:w-auto">
          <div>
            <p className="text-sm font-semibold">On the site</p>
            <p className="text-muted-foreground">{dirty ? "Moved, not saved yet" : `Placed ${PLACEMENT_SOURCE[placement.source]}`}</p>
            <p className="text-muted-foreground">
              {placement.height !== null ? `Level 0 at ${placement.height.toFixed(1)} m above sea level, from the model` : "Level 0 on the ground"}
            </p>
          </div>
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5">
            <span className="text-muted-foreground">Move 1 m</span>
            <div className="flex gap-1">
              <Nudge icon={ArrowLeft} label="West" onClick={() => move(-1, 0)} />
              <Nudge icon={ArrowUp} label="North" onClick={() => move(0, 1)} />
              <Nudge icon={ArrowDown} label="South" onClick={() => move(0, -1)} />
              <Nudge icon={ArrowRight} label="East" onClick={() => move(1, 0)} />
            </div>
            <span className="text-muted-foreground">Turn</span>
            <div className="flex items-center gap-1">
              <Nudge icon={RotateCcw} label="Anticlockwise 1°" onClick={() => turn(-1)} />
              <Nudge icon={RotateCw} label="Clockwise 1°" onClick={() => turn(1)} />
              <span className="ml-1 tabular-nums">{placement.heading.toFixed(1)}°</span>
            </div>
            <span className="text-muted-foreground">Height</span>
            <div className="flex items-center gap-1">
              <Nudge icon={ChevronsDown} label="Lower 0.25 m" onClick={() => raise(-0.25)} />
              <Nudge icon={ChevronsUp} label="Raise 0.25 m" onClick={() => raise(0.25)} />
              <span className="ml-1 tabular-nums">{placement.elevation >= 0 ? "+" : ""}{placement.elevation.toFixed(2)} m</span>
            </div>
          </div>
          <p className="text-muted-foreground">To move it further, drag its pin in the Site map.</p>
          <div className="flex gap-1.5 pt-1">
            <Button size="sm" className="flex-1" disabled={!dirty || saving} onClick={onSave}>
              {saving ? "Saving…" : "Save placement"}
            </Button>
            {dirty ? (
              <Button size="sm" variant="outline" onClick={onRevert}>
                Undo
              </Button>
            ) : (
              placement.source === "manual" && (
                <Button size="sm" variant="outline" disabled={saving} onClick={onReset} title="Back to the model's own location, or the project's pin">
                  Reset
                </Button>
              )
            )}
          </div>
        </div>
      )}
      <p className={cn("pointer-events-none absolute right-3 bottom-2 z-10 max-w-[60%] truncate text-right text-[10px] text-white [text-shadow:0_0_3px_rgb(0_0_0/0.9)]")}>
        <span className="font-semibold">Google</span>
        {credits && ` · ${credits}`}
      </p>
    </>
  );
}

function Nudge({ icon: Icon, label, onClick }: { icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void }) {
  return (
    <Button variant="outline" size="icon-sm" title={label} aria-label={label} onClick={onClick}>
      <Icon className="size-3.5" />
    </Button>
  );
}
