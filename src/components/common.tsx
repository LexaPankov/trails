import { IMAGES, KIND_LABEL, LEAD_IMAGES, PERIOD_LABEL, placeImage } from '../lib/data'
import { INTEREST_LABEL, INTERESTS } from '../lib/model/features'
import { MODE_BLURB, MODE_LABEL } from '../lib/optimizer'
import { QUALITY_LABEL } from '../lib/routing'
import type { RouteQuality } from '../lib/routing/types'
import type { Interest, Place, RouteMode } from '../lib/types'
import { Icon } from './Icon'

const BASE = import.meta.env.BASE_URL

export function InterestPicker({ value, onChange }: { value: Interest[]; onChange: (v: Interest[]) => void }) {
  return (
    <div className="row wrap" role="group" aria-label="Cultural interests">
      {INTERESTS.map((k) => {
        const on = value.includes(k)
        return (
          <button key={k} type="button" className="chip" aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== k) : [...value, k])}>
            {on && <Icon name="check" size={14} />}{INTEREST_LABEL[k]}
          </button>
        )
      })}
    </div>
  )
}

export function ModeSelector({ value, onChange }: { value: RouteMode; onChange: (m: RouteMode) => void }) {
  return (
    <div className="seg" role="group" aria-label="Route mode">
      {(['fastest', 'discovery', 'history'] as RouteMode[]).map((m) => (
        <button key={m} type="button" aria-pressed={value === m} onClick={() => onChange(m)}>
          <strong>{MODE_LABEL[m]}</strong>
          <span>{MODE_BLURB[m]}</span>
        </button>
      ))}
    </div>
  )
}

export function QualityBadge({ q, provider }: { q: RouteQuality; provider?: string }) {
  return (
    <span className={`badge badge-${q}`} title={provider ? `Provider: ${provider}` : undefined}>
      <Icon name={q === 'estimate' ? 'info' : 'route'} size={14} />
      {QUALITY_LABEL[q]}
    </span>
  )
}

export function PlaceTags({ p }: { p: Place }) {
  return (
    <div className="row wrap" style={{ gap: 6 }}>
      <span className={`tag ${p.kind === 'hidden_gem' ? 'tag-gem' : p.kind === 'major' ? 'tag-major' : ''}`}>{KIND_LABEL[p.kind]}</span>
      {p.periods.map((x) => <span key={x} className="tag">{PERIOD_LABEL[x]}</span>)}
    </div>
  )
}

export function PlaceThumb({ p, size = 64 }: { p: Place; size?: number }) {
  const img = placeImage(p.id)
  return img ? (
    <img src={BASE + img.file} alt="" width={size} height={size} loading="lazy"
      style={{ width: size, height: size, objectFit: 'cover', borderRadius: 10, display: 'block', flex: 'none' }} />
  ) : (
    <div aria-hidden style={{ width: size, height: size, borderRadius: 10, flex: 'none', display: 'grid', placeItems: 'center',
      background: 'var(--parchment)', color: 'var(--muted)', fontFamily: 'var(--serif)', fontSize: size / 2.4 }}>
      {p.name[0]}
    </div>
  )
}

export function ImageCredit({ file }: { file: string }) {
  const all = [...Object.values(IMAGES.landmarks).flat(), ...IMAGES.unknown_negatives]
  const m = all.find((i) => i.file === file)
  const lead = Object.values(LEAD_IMAGES).find((i) => i.file === file)
  if (!m && !lead) return null
  const page = m ? m.commons_page : (lead!.file_page ?? lead!.commons_page)
  const info = (m ?? lead)!
  return (
    <span>
      Photo: {info.author || 'unknown author'}, <a href={info.license_url ?? page} target="_blank" rel="noreferrer">{info.license}</a>,
      {' '}via <a href={page} target="_blank" rel="noreferrer">Wikimedia Commons</a>{m ? ' (GLDv2)' : ''}
    </span>
  )
}

export function Meter({ v }: { v: number }) {
  return <span className="meter" aria-hidden><i style={{ width: `${Math.round(v * 100)}%` }} /></span>
}
