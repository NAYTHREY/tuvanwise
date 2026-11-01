"use client";

import "leaflet/dist/leaflet.css";
import { useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip, Polyline } from "react-leaflet";
import { PLACES } from "@/lib/config";

export default function RouteMap() {
  const [tileError, setTileError] = useState(false);
  const { origin: o, destination: d } = PLACES;
  const osm = `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${o.lat}%2C${o.lng}%3B${d.lat}%2C${d.lng}`;
  return (
    <div>
      <div className="h-[300px] w-full">
        <MapContainer
          bounds={[
            [o.lat, o.lng],
            [d.lat, d.lng],
          ]}
          boundsOptions={{ padding: [40, 40] }}
          scrollWheelZoom={false}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            eventHandlers={{ tileerror: () => setTileError(true) }}
          />
          <Polyline positions={[[o.lat, o.lng], [d.lat, d.lng]]} pathOptions={{ color: "#b5121b", weight: 2, dashArray: "6 6" }} />
          <CircleMarker center={[o.lat, o.lng]} radius={9} pathOptions={{ color: "#fff", weight: 2, fillColor: "#b5121b", fillOpacity: 1 }}>
            <Tooltip permanent direction="right">ขึ้นรถ: {o.name}</Tooltip>
          </CircleMarker>
          <CircleMarker center={[d.lat, d.lng]} radius={9} pathOptions={{ color: "#fff", weight: 2, fillColor: "#22262d", fillOpacity: 1 }}>
            <Tooltip permanent direction="right">ลงรถ: {d.name}</Tooltip>
          </CircleMarker>
        </MapContainer>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm text-ink-2">
        <span>{tileError ? "โหลดภาพแผนที่ไม่สำเร็จ ลองเปิดเส้นทางใน OpenStreetMap แทน" : "เส้นประคือแนวเส้นทาง ไม่ใช่ถนนจริง"}</span>
        <a className="font-semibold text-red underline underline-offset-4" href={osm} target="_blank" rel="noreferrer">
          เปิดเส้นทางจริงใน OpenStreetMap
        </a>
      </div>
    </div>
  );
}
