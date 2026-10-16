import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { PlannedRoute } from '../types';

interface Props {
  route: PlannedRoute;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function stopIcon(n: number, major: boolean, active: boolean) {
  const cls = ['pin', major ? 'pin--major' : 'pin--gem', active ? 'is-active' : ''].join(' ');
  return L.divIcon({ className: '', html: `<div class="${cls}"><span>${n}</span></div>`, iconSize: [34, 34], iconAnchor: [17, 17] });
}
function endIcon(label: string) {
  return L.divIcon({ className: '', html: `<div class="pin pin--end"><span>${label}</span></div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
}

export default function MapView({ route, selectedId, onSelect }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const markers = useRef(new Map<string, { m: L.Marker; n: number; major: boolean }>());

  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current, { zoomControl: false, attributionControl: true });
    L.control.zoom({ position: 'bottomright' }).addTo(map.current);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => { map.current?.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const m = map.current, g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    markers.current.clear();
    const dashed = route.routing === 'estimated';
    L.polyline(route.geometry, { color: '#ffffff', weight: 9, opacity: 0.9 }).addTo(g);
    L.polyline(route.geometry, { color: '#7A2433', weight: 4.5, opacity: 0.95, dashArray: dashed ? '2 9' : undefined, lineCap: 'round' }).addTo(g);
    L.marker([route.start.lat, route.start.lon], { icon: endIcon('A'), title: `Start: ${route.start.name}` })
      .on('click', () => onSelect(route.start.id)).addTo(g);
    L.marker([route.end.lat, route.end.lon], { icon: endIcon('B'), title: `Finish: ${route.end.name}` })
      .on('click', () => onSelect(route.end.id)).addTo(g);
    route.stops.forEach((p, i) => {
      const major = p.significance >= 4;
      const mk = L.marker([p.lat, p.lon], { icon: stopIcon(i + 1, major, false), title: p.name, riseOnHover: true })
        .on('click', () => onSelect(p.id)).addTo(g);
      markers.current.set(p.id, { m: mk, n: i + 1, major });
    });
    const pts = [route.start, ...route.stops, route.end].map((p) => [p.lat, p.lon] as [number, number]);
    m.fitBounds(L.latLngBounds([...pts, ...route.geometry]), { padding: [40, 40] });
    setTimeout(() => m.invalidateSize(), 50);
  }, [route, onSelect]);

  useEffect(() => {
    markers.current.forEach(({ m, n, major }, id) => {
      const active = id === selectedId;
      m.setIcon(stopIcon(n, major, active));
      m.setZIndexOffset(active ? 1000 : 0);
    });
    const sel = selectedId ? [route.start, route.end, ...route.stops].find((p) => p.id === selectedId) : null;
    if (sel && map.current) map.current.panTo([sel.lat, sel.lon], { animate: true });
  }, [selectedId, route]);

  return <div ref={el} className="map" role="region" aria-label="Map of your walk" />;
}
