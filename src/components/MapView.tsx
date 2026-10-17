import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useMemo, useState } from 'react'
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import type { RouteQuality } from '../lib/routing/types'
import type { LatLon, Place } from '../lib/types'

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env
// Default: CARTO "Voyager" raster tiles built from OpenStreetMap data (attribution required).
// CARTO basemaps need a key (carto.com/basemaps/apikey): set VITE_CARTO_KEY in .env.local, which git ignores.
// It is a browser key by design (it ships in tile URLs), so restrict it to your domains in the CARTO dashboard.
// Override with VITE_TILE_URL / VITE_TILE_ATTRIBUTION (e.g. your own tile server or a paid provider).
const CARTO_KEY = env.VITE_CARTO_KEY
export const TILE_URL = env.VITE_TILE_URL ||
  `https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png${CARTO_KEY ? `?key=${encodeURIComponent(CARTO_KEY)}` : ''}`
export const TILE_ATTRIBUTION = env.VITE_TILE_ATTRIBUTION ||
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'

function divIcon(html: string, size: number) {
  return L.divIcon({ html, className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2] })
}

export interface MapStop { place: Place; n: number }

interface Props {
  route?: { geometry: [number, number][]; quality: RouteQuality } | null
  alt?: [number, number][] | null
  stops?: MapStop[]
  start?: LatLon | null
  end?: LatLon | null
  others?: Place[]
  me?: (LatLon & { heading?: number }) | null
  onPlace?: (id: string) => void
  fitKey?: string
  follow?: LatLon | null
  className?: string
  /** tap/click on the map (used to drop a start or destination pin) */
  onMapClick?: (p: LatLon) => void
  pin?: LatLon | null
  /** places passed on the way (not visited) */
  passing?: Place[]
  /** turn off zoom/fade animations (maps that unmount quickly, e.g. in a dialog) */
  still?: boolean
  /** open framing exactly these points instead of the route and markers */
  focus?: LatLon[]
}

function ClickCatcher({ onClick }: { onClick: (p: LatLon) => void }) {
  useMapEvents({ click: (e) => onClick({ lat: e.latlng.lat, lon: e.latlng.lng }) })
  return null
}

function Fit({ pts, fitKey }: { pts: [number, number][]; fitKey?: string }) {
  const map = useMap()
  useEffect(() => {
    // no animation: a zoom transition still running when the screen changes throws inside Leaflet
    if (pts.length >= 2) map.fitBounds(L.latLngBounds(pts), { padding: [36, 36], maxZoom: 17, animate: false })
    else if (pts.length === 1) map.setView(pts[0], 16, { animate: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey])
  return null
}

function Follow({ p }: { p: LatLon | null | undefined }) {
  const map = useMap()
  useEffect(() => { if (p) map.panTo([p.lat, p.lon], { animate: true }) }, [p?.lat, p?.lon, map]) // eslint-disable-line
  return null
}

export function MapView({ route, alt, stops = [], start, end, others = [], me, onPlace, fitKey, follow, className, onMapClick, pin, passing = [], still, focus }: Props) {
  const [tileErrors, setTileErrors] = useState(0)
  const pts = useMemo<[number, number][]>(() => {
    const p: [number, number][] = []
    if (focus?.length) return focus.map((f): [number, number] => [f.lat, f.lon])
    if (route) p.push(...route.geometry)
    if (start) p.push([start.lat, start.lon])
    if (end) p.push([end.lat, end.lon])
    stops.forEach((s) => p.push([s.place.lat, s.place.lon]))
    if (!p.length && me) p.push([me.lat, me.lon])
    return p
  }, [route, start, end, stops, me, focus])

  return (
    <div className={className ?? 'map'}>
      <MapContainer center={[41.8967, 12.4822]} zoom={15} style={{ position: 'absolute', inset: 0 }} zoomControl={false} attributionControl
        zoomAnimation={!still} fadeAnimation={!still} markerZoomAnimation={!still}>
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} maxZoom={19}
          eventHandlers={{ tileerror: () => setTileErrors((n) => n + 1) }} />
        <Fit pts={pts} fitKey={fitKey} />
        <Follow p={follow} />
        {onMapClick && <ClickCatcher onClick={onMapClick} />}
        {pin && (
          <Marker position={[pin.lat, pin.lon]} icon={divIcon('<div class="marker-stop marker-pin">●</div>', 28)}>
            <Tooltip direction="top" offset={[0, -12]} permanent>Selected point</Tooltip>
          </Marker>
        )}
        {alt && alt.length > 1 && (
          <Polyline positions={alt} pathOptions={{ color: '#6f665b', weight: 4, opacity: 0.45, dashArray: '2 8' }}>
            <Tooltip sticky>Direct route (no stops)</Tooltip>
          </Polyline>
        )}
        {route && route.geometry.length > 1 && (
          <>
            <Polyline positions={route.geometry} pathOptions={{ color: '#fffdf8', weight: 9, opacity: 0.9 }} />
            <Polyline positions={route.geometry} pathOptions={{
              color: route.quality === 'estimate' ? '#9a6a12' : '#b04a26', weight: 5, opacity: 0.95,
              dashArray: route.quality === 'estimate' ? '8 10' : undefined,
            }}>
              <Tooltip sticky>{route.quality === 'estimate' ? 'Approximate line, not a walking route' : 'Your trail'}</Tooltip>
            </Polyline>
          </>
        )}
        {others.map((p) => (
          <Marker key={p.id} position={[p.lat, p.lon]} icon={divIcon(`<div class="marker-dot ${p.kind === 'hidden_gem' ? 'gem' : ''}"></div>`, 12)}
            eventHandlers={{ click: () => onPlace?.(p.id) }} keyboard>
            <Tooltip direction="top" offset={[0, -6]}>{p.name}</Tooltip>
          </Marker>
        ))}
        {passing.map((p) => (
          <Marker key={`pass-${p.id}`} position={[p.lat, p.lon]} icon={divIcon('<div class="marker-pass"></div>', 16)}
            eventHandlers={{ click: () => onPlace?.(p.id) }} keyboard>
            <Tooltip direction="top" offset={[0, -8]}>You pass {p.name}</Tooltip>
          </Marker>
        ))}
        {start && (
          <Marker position={[start.lat, start.lon]} icon={divIcon('<div class="marker-stop marker-start">A</div>', 28)}>
            <Tooltip direction="top" offset={[0, -12]}>Start</Tooltip>
          </Marker>
        )}
        {end && (
          <Marker position={[end.lat, end.lon]} icon={divIcon('<div class="marker-stop marker-end">B</div>', 28)}>
            <Tooltip direction="top" offset={[0, -12]}>Destination</Tooltip>
          </Marker>
        )}
        {stops.map((s) => (
          <Marker key={s.place.id} position={[s.place.lat, s.place.lon]} icon={divIcon(`<div class="marker-stop">${s.n}</div>`, 28)}
            eventHandlers={{ click: () => onPlace?.(s.place.id) }} keyboard>
            <Tooltip direction="top" offset={[0, -12]}>{s.n}. {s.place.name}</Tooltip>
          </Marker>
        ))}
        {me && (
          <Marker position={[me.lat, me.lon]} icon={divIcon('<div class="marker-me"></div>', 18)} zIndexOffset={1000}>
            <Tooltip direction="top" offset={[0, -10]}>You</Tooltip>
          </Marker>
        )}
      </MapContainer>
      {tileErrors > 3 && (
        <div className="map-status notice" role="status">
          Map tiles could not be loaded (offline or tile service unavailable). The route and places are still drawn.
        </div>
      )}
    </div>
  )
}
