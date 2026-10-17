import { useEffect, useId, useRef, useState } from 'react'
import { reverseLabel, searchAddress, searchAddressNominatim, searchPlaces, type GeoResult } from '../lib/geocode'
import type { Endpoint, LatLon } from '../lib/types'
import { Icon } from './Icon'
import { MapView } from './MapView'

interface Props {
  id: string
  label: string
  value: Endpoint | null
  onChange: (e: Endpoint) => void
  here?: (LatLon & { label: string }) | null
  /** asks the device for one GPS fix; rejects with a message the user can act on */
  onLocate?: () => Promise<Endpoint>
  placeholder?: string
}

/** Google-Maps-style field: type any address or place in Rome, use your location, or drop a pin on the map. */
export function LocationField({ id, label, value, onChange, here, onLocate, placeholder }: Props) {
  const [q, setQ] = useState(value?.label ?? '')
  const [locating, setLocating] = useState(false)
  const [locateErr, setLocateErr] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [remote, setRemote] = useState<GeoResult[]>([])
  const [status, setStatus] = useState<'idle' | 'searching' | 'error'>('idle')
  const [picking, setPicking] = useState(false)
  const [active, setActive] = useState(0)
  const listId = useId()
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => { setQ(value?.label ?? '') }, [value?.label, value?.lat, value?.lon])

  // type-ahead against Photon (debounced, cancelled on every keystroke)
  useEffect(() => {
    if (!open || q.trim().length < 3 || q === value?.label) { setRemote([]); return }
    const ctl = new AbortController()
    const t = setTimeout(() => {
      setStatus('searching')
      searchAddress(q, ctl.signal).then((r) => { setRemote(r); setStatus('idle') })
        .catch((e) => { if ((e as Error).name !== 'AbortError') setStatus('error') })
    }, 350)
    return () => { clearTimeout(t); ctl.abort() }
  }, [q, open, value?.label])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const local = open ? searchPlaces(q) : []
  const results: GeoResult[] = [...local, ...remote.filter((r) => !local.some((l) => l.label === r.label))].slice(0, 8)

  function choose(r: Endpoint) {
    onChange({ lat: r.lat, lon: r.lon, label: r.label, placeId: r.placeId })
    setQ(r.label); setOpen(false); setRemote([])
  }

  async function locateMe() {
    if (!onLocate) return
    setLocating(true); setLocateErr(null)
    try { choose(await onLocate()) } catch (e) { setLocateErr((e as Error).message); setOpen(false) } finally { setLocating(false) }
  }

  async function onEnter() {
    if (results[active]) return choose(results[active])
    if (q.trim().length < 3) return
    setStatus('searching')
    try {
      const r = await searchAddressNominatim(q)
      setRemote(r); setStatus('idle'); setOpen(true)
    } catch { setStatus('error') }
  }

  return (
    <div className="locfield" ref={box}>
      <label className="field" htmlFor={id}>{label}</label>
      <div className="locfield-input">
        <Icon name="locate" size={16} />
        <input id={id} type="text" autoComplete="off" value={q} placeholder={placeholder ?? 'Search an address or place in Rome'}
          role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); setLocateErr(null) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
            else if (e.key === 'Enter') { e.preventDefault(); void onEnter() }
            else if (e.key === 'Escape') setOpen(false)
          }} />
        {status === 'searching' && <span className="spinner" aria-label="Searching" />}
      </div>
      {open && (
        <ul className="locfield-list card" id={listId} role="listbox">
          {here && (
            <li role="option" aria-selected={false}>
              <button type="button" onClick={() => choose(here)}><Icon name="locate" size={15} /> <b>{here.label}</b></button>
            </li>
          )}
          {onLocate && (
            <li role="option" aria-selected={false}>
              <button type="button" onClick={() => void locateMe()} disabled={locating}>
                {locating ? <span className="spinner" /> : <Icon name="locate" size={15} />} <b>{locating ? 'Finding you…' : 'Use my current location'}</b>
              </button>
            </li>
          )}
          <li role="option" aria-selected={false}>
            <button type="button" onClick={() => { setOpen(false); setPicking(true) }}><Icon name="map" size={15} /> <b>Pick on the map</b></button>
          </li>
          {results.map((r, i) => (
            <li key={`${r.source}-${r.label}-${r.lat}`} role="option" aria-selected={i === active}>
              <button type="button" className={i === active ? 'active' : ''} onClick={() => choose(r)}>
                <Icon name={r.source === 'trails' ? 'sparkle' : 'route'} size={15} />
                <span><b>{r.label}</b>{r.detail && <span className="tiny muted"> · {r.detail}</span>}</span>
              </button>
            </li>
          ))}
          {status === 'error' && <li className="tiny muted locfield-note">Address search is unavailable right now. Pick a TRAILS place or drop a pin on the map.</li>}
          {q.trim().length >= 3 && status === 'idle' && !results.length && <li className="tiny muted locfield-note">No match yet. Press Enter to search more widely, or pick on the map.</li>}
          <li className="tiny muted locfield-note">Search by OpenStreetMap (Photon, Nominatim)</li>
        </ul>
      )}
      {locateErr && !open && <p className="notice notice-danger small" role="alert" style={{ marginTop: 8 }}>{locateErr}</p>}
      {picking && <MapPicker title={label} initial={value} onCancel={() => setPicking(false)} onPick={(e) => { setPicking(false); choose(e) }} />}
    </div>
  )
}

function MapPicker({ title, initial, onPick, onCancel }: { title: string; initial: Endpoint | null; onPick: (e: Endpoint) => void; onCancel: () => void }) {
  const [pin, setPin] = useState<LatLon | null>(initial ? { lat: initial.lat, lon: initial.lon } : null)
  const [name, setName] = useState<string>('')
  const [busy, setBusy] = useState(false)

  async function drop(p: LatLon) {
    setPin(p); setBusy(true); setName('')
    setName(await reverseLabel(p)); setBusy(false)
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`Pick ${title} on the map`}>
      <div className="modal card">
        <div className="row spread" style={{ padding: '12px 14px' }}>
          <strong>{title}: tap the map</strong>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} aria-label="Close"><Icon name="x" size={15} /></button>
        </div>
        <div className="modal-map">
          <MapView className="map" still onMapClick={(p) => void drop(p)} pin={pin} fitKey="picker" start={null} end={null} />
        </div>
        <div className="row spread wrap" style={{ padding: '12px 14px', gap: 8 }}>
          <span className="small">{pin ? (busy ? 'Finding the street…' : name) : 'Tap anywhere in Rome.'}</span>
          <button type="button" className="btn btn-primary btn-sm" disabled={!pin || busy}
            onClick={() => pin && onPick({ ...pin, label: name || `Pin at ${pin.lat.toFixed(4)}, ${pin.lon.toFixed(4)}` })}>
            <Icon name="check" size={15} /> Use this point
          </button>
        </div>
      </div>
    </div>
  )
}
