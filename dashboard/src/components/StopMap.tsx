import { Circle, CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet'
import type { Hotspot, StopPoint } from '../lib/api'

const MARKERS = {
  obstacle: { color: '#38bdf8', label: 'Obstacle' },
  stop: { color: '#f59e0b', label: 'Stop' },
  pull: { color: '#a855f7', label: 'Pull' },
}

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
          <Popup>Hotspot: {h.count} events nearby</Popup>
        </Circle>
      ))}
      {stops.map((s, i) => (
        <CircleMarker key={i} center={[s.lat, s.lng]} radius={6}
          pathOptions={{ color: MARKERS[s.type].color, fillOpacity: 0.9 }}>
          <Popup>{MARKERS[s.type].label} · {new Date(s.at).toLocaleString()}</Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  )
}
