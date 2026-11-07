import { Circle, CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet'
import type { Hotspot, StopPoint } from '../lib/api'

const FALLBACK_CENTER: [number, number] = [43.6532, -79.3832]

export default function StopMap({ stops, hotspots }: { stops: StopPoint[]; hotspots: Hotspot[] }) {
  const center: [number, number] = stops.length ? [stops[0].lat, stops[0].lng] : FALLBACK_CENTER

  return (
    <MapContainer center={center} zoom={16} className="h-full min-h-80 w-full rounded-2xl">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {hotspots.map((h) => (
        <Circle key={`${h.lat},${h.lng}`} center={[h.lat, h.lng]} radius={40 + h.count * 8}
          pathOptions={{ color: '#ef4444', fillOpacity: 0.15 }}>
          <Popup>Hotspot: {h.count} stops nearby</Popup>
        </Circle>
      ))}
      {stops.map((s, i) => (
        <CircleMarker key={i} center={[s.lat, s.lng]} radius={6}
          pathOptions={{ color: s.type === 'pull' ? '#a855f7' : '#f59e0b', fillOpacity: 0.9 }}>
          <Popup>{s.type === 'pull' ? 'Pull' : 'Stop'} · {new Date(s.at).toLocaleString()}</Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  )
}
