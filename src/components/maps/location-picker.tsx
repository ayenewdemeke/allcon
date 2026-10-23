"use client";

import { useEffect, useRef, useState } from "react";
import { AdvancedMarker, Map, useMap, useMapsLibrary } from "@vis.gl/react-google-maps";
import { MapPin } from "lucide-react";
import { useMapsConfig } from "@/components/maps/maps-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Pins a project's site: search for a place, click the map or type its coordinates, then drag
// the pin to the exact spot. The pin goes with the form as `latitude` and `longitude` (empty
// when there's none).

export type LatLon = { lat: number; lon: number };

const US_CENTER = { lat: 39.8, lng: -98.6 };

export function LocationPicker({ initial, onPlace }: { initial: LatLon | null; onPlace?: (address: string) => void }) {
  const { mapId } = useMapsConfig();
  const [pin, setPinState] = useState<LatLon | null>(initial);
  // The coordinate boxes, as typed (they can be incomplete while typing).
  const [typed, setTyped] = useState({ lat: initial ? String(initial.lat) : "", lon: initial ? String(initial.lon) : "" });
  const [flyTo, setFlyTo] = useState<{ at: LatLon; viewport?: google.maps.LatLngBounds | null } | null>(null);

  const setPin = (next: LatLon | null) => {
    setPinState(next);
    setTyped(next ? { lat: String(next.lat), lon: String(next.lon) } : { lat: "", lon: "" });
  };
  const drop = (at: google.maps.LatLng | google.maps.LatLngLiteral | null | undefined) => {
    if (!at) return;
    const { lat, lng } = typeof at.lat === "function" ? (at as google.maps.LatLng).toJSON() : (at as google.maps.LatLngLiteral);
    setPin({ lat: round(lat), lon: round(lng) });
  };
  /** Coordinates typed in; the pin follows once both are valid. */
  const type = (next: { lat: string; lon: string }) => {
    setTyped(next);
    const lat = Number(next.lat);
    const lon = Number(next.lon);
    if (next.lat.trim() && next.lon.trim() && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      const at = { lat: round(lat), lon: round(lon) };
      setPinState(at);
      setFlyTo({ at });
    }
  };

  /** Both coordinates pasted together ("40.022378, -79.886648") into either box. */
  const pastePair = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pair = e.clipboardData.getData("text").match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!pair) return;
    e.preventDefault();
    type({ lat: pair[1], lon: pair[2] });
  };

  return (
    <div className="space-y-2">
      <PlaceSearch
        onSelect={(place) => {
          setPin(place.at);
          setFlyTo({ at: place.at, viewport: place.viewport });
          onPlace?.(place.address);
        }}
      />
      <div className="h-72 overflow-hidden rounded-lg border sm:h-80">
        <Map
          mapId={mapId}
          defaultCenter={initial ? { lat: initial.lat, lng: initial.lon } : US_CENTER}
          defaultZoom={initial ? 17 : 3}
          mapTypeId={initial ? "hybrid" : "roadmap"}
          gestureHandling="cooperative"
          disableDefaultUI
          zoomControl
          mapTypeControl
          clickableIcons={false}
          onClick={(e) => drop(e.detail.latLng)}
        >
          {pin && <AdvancedMarker position={{ lat: pin.lat, lng: pin.lon }} draggable onDragEnd={(e) => drop(e.latLng)} title="Drag to the exact spot" />}
          <FlyTo target={flyTo} />
        </Map>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid min-w-36 flex-1 gap-1 text-xs text-muted-foreground">
          Latitude
          <Input inputMode="decimal" placeholder="e.g. 40.022378" value={typed.lat} onChange={(e) => type({ ...typed, lat: e.target.value })} onPaste={pastePair} />
        </label>
        <label className="grid min-w-36 flex-1 gap-1 text-xs text-muted-foreground">
          Longitude
          <Input inputMode="decimal" placeholder="e.g. -79.886648" value={typed.lon} onChange={(e) => type({ ...typed, lon: e.target.value })} onPaste={pastePair} />
        </label>
        {pin && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setPin(null)}>
            Remove pin
          </Button>
        )}
      </div>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <MapPin className="size-3.5 shrink-0" />
        Search, click the map, or enter coordinates (decimal degrees, west negative). Drag the pin to adjust.
      </p>
      <input type="hidden" name="latitude" value={pin?.lat ?? ""} />
      <input type="hidden" name="longitude" value={pin?.lon ?? ""} />
    </div>
  );
}

const round = (degrees: number) => Math.round(degrees * 1e7) / 1e7; // about a centimetre

/** Moves the map to a searched place: its whole area when Google gives one, else close in. */
function FlyTo({ target }: { target: { at: LatLon; viewport?: google.maps.LatLngBounds | null } | null }) {
  const map = useMap();
  useEffect(() => {
    if (!map || !target) return;
    map.setMapTypeId("hybrid");
    if (target.viewport) map.fitBounds(target.viewport);
    else {
      map.setCenter({ lat: target.at.lat, lng: target.at.lon });
      map.setZoom(17);
    }
  }, [map, target]);
  return null;
}

/** Google's place search box (Places API, New). */
function PlaceSearch({ onSelect }: { onSelect: (place: { at: LatLon; address: string; viewport: google.maps.LatLngBounds | null }) => void }) {
  const places = useMapsLibrary("places");
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(onSelect);
  useEffect(() => {
    latest.current = onSelect;
  });

  useEffect(() => {
    if (!places || !host.current) return;
    const search = new places.PlaceAutocompleteElement({});
    search.style.width = "100%";
    search.setAttribute("placeholder", "Search for an address or place");
    search.addEventListener("gmp-select", async (event) => {
      const place = (event as google.maps.places.PlacePredictionSelectEvent).placePrediction.toPlace();
      await place.fetchFields({ fields: ["formattedAddress", "location", "viewport"] });
      if (!place.location) return;
      latest.current({ at: { lat: round(place.location.lat()), lon: round(place.location.lng()) }, address: place.formattedAddress ?? "", viewport: place.viewport ?? null });
    });
    const el = host.current;
    el.replaceChildren(search);
    return () => el.replaceChildren();
  }, [places]);

  return <div ref={host} className="min-h-9 overflow-hidden rounded-lg border [color-scheme:light] dark:[color-scheme:dark]" />;
}
