"use client";

import { useEffect, useRef, useState } from "react";
import { AdvancedMarker, Map, useMap, useMapsLibrary } from "@vis.gl/react-google-maps";
import { MapPin } from "lucide-react";
import { useMapsConfig } from "@/components/maps/maps-provider";

// Pins a project's site: search for a place or click the map, then drag the pin to the exact
// spot. The pin goes with the form as `latitude` and `longitude` (empty when there's none).

export type LatLon = { lat: number; lon: number };

const US_CENTER = { lat: 39.8, lng: -98.6 };

export function LocationPicker({ initial, onPlace }: { initial: LatLon | null; onPlace?: (address: string) => void }) {
  const { mapId } = useMapsConfig();
  const [pin, setPin] = useState<LatLon | null>(initial);
  const [flyTo, setFlyTo] = useState<{ at: LatLon; viewport?: google.maps.LatLngBounds | null } | null>(null);

  const drop = (at: google.maps.LatLng | google.maps.LatLngLiteral | null | undefined) => {
    if (!at) return;
    const { lat, lng } = typeof at.lat === "function" ? (at as google.maps.LatLng).toJSON() : (at as google.maps.LatLngLiteral);
    setPin({ lat: round(lat), lon: round(lng) });
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
      <div className="h-56 overflow-hidden rounded-lg border">
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
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <MapPin className="size-3.5 shrink-0" />
        {pin ? (
          <>
            <span className="tabular-nums">
              {pin.lat.toFixed(6)}, {pin.lon.toFixed(6)}
            </span>
            <button type="button" className="ml-auto text-primary hover:underline" onClick={() => setPin(null)}>
              Remove pin
            </button>
          </>
        ) : (
          <span>Search for the site or click the map to pin it. Drag the pin to adjust.</span>
        )}
      </div>
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
