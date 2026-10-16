import { useMemo } from 'react';
import type { Dataset, PlanRequest, RouteMode, Theme } from '../types';
import { THEMES } from '../types';

interface Props {
  data: Dataset;
  value: PlanRequest;
  onChange: (v: PlanRequest) => void;
  onSubmit: () => void;
  busy: boolean;
}

const TIMES = [30, 60, 90, 120];
const TIME_LABELS: Record<number, string> = { 30: '30 min', 60: '1 h', 90: '1½ h', 120: '2 h' };

export const EXAMPLES: { title: string; req: Omit<PlanRequest, 'mode'> & { mode?: RouteMode } }[] = [
  { title: 'Duomo to Castello Sforzesco, 90 min, Renaissance and hidden gems', req: { startId: 'duomo', endId: 'castello', minutes: 90, themes: ['renaissance', 'hidden'] } },
  { title: "Sant'Ambrogio to the Duomo, 60 min, Roman Milan", req: { startId: 'santambrogio', endId: 'duomo', minutes: 60, themes: ['antiquity'] } },
  { title: 'La Scala to the Darsena, 120 min, everything', req: { startId: 'scala', endId: 'darsena', minutes: 120, themes: [] } },
];

export default function Planner({ data, value, onChange, onSubmit, busy }: Props) {
  const options = useMemo(() => [...data.places].sort((a, b) => b.significance - a.significance || a.name.localeCompare(b.name)), [data]);
  const majors = options.filter((p) => p.significance >= 4);
  const others = options.filter((p) => p.significance < 4);
  const set = (patch: Partial<PlanRequest>) => onChange({ ...value, ...patch });
  const toggleTheme = (t: Theme) => set({ themes: value.themes.includes(t) ? value.themes.filter((x) => x !== t) : [...value.themes, t] });

  const placeSelect = (id: string, label: string, val: string, key: 'startId' | 'endId') => (
    <label className="field" htmlFor={id}>
      <span className="field__label">{label}</span>
      <select id={id} value={val} onChange={(e) => set({ [key]: e.target.value } as Partial<PlanRequest>)}>
        <optgroup label="Landmarks">{majors.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
        <optgroup label="Lesser-known places">{others.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
      </select>
    </label>
  );

  return (
    <form className="planner" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      <div className="planner__ends">
        {placeSelect('from', 'From', value.startId, 'startId')}
        <button type="button" className="swap" aria-label="Swap start and destination" onClick={() => set({ startId: value.endId, endId: value.startId })}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 4v14m0 0l-3-3m3 3l3-3M17 20V6m0 0l-3 3m3-3l3 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        {placeSelect('to', 'To', value.endId, 'endId')}
      </div>

      <fieldset className="field">
        <legend className="field__label">Time you have</legend>
        <div className="segmented" role="radiogroup">
          {TIMES.map((t) => (
            <button type="button" key={t} role="radio" aria-checked={value.minutes === t} className={value.minutes === t ? 'is-on' : ''} onClick={() => set({ minutes: t })}>
              {TIME_LABELS[t]}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend className="field__label">What interests you <span className="field__hint">Pick any, or none for everything</span></legend>
        <div className="chips">
          {THEMES.map((t) => (
            <button type="button" key={t.id} aria-pressed={value.themes.includes(t.id)} className={`chip ${value.themes.includes(t.id) ? 'is-on' : ''}`} onClick={() => toggleTheme(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend className="field__label">Kind of walk</legend>
        <div className="segmented segmented--wide" role="radiogroup">
          <button type="button" role="radio" aria-checked={value.mode === 'highlights'} className={value.mode === 'highlights' ? 'is-on' : ''} onClick={() => set({ mode: 'highlights' })}>Only the highlights</button>
          <button type="button" role="radio" aria-checked={value.mode === 'maximum'} className={value.mode === 'maximum' ? 'is-on' : ''} onClick={() => set({ mode: 'maximum' })}>Maximum history</button>
          <button type="button" role="radio" aria-checked={false} disabled={!data.city.elevationData} title={data.city.elevationNote}>With climbs</button>
        </div>
        {!data.city.elevationData && <p className="field__note">{data.city.elevationNote}</p>}
      </fieldset>

      {value.startId === value.endId && <p className="field__note">Start and finish are the same, so this will be a loop walk.</p>}

      <button className="btn btn--primary" type="submit" disabled={busy}>{busy ? 'Planning your walk…' : 'Plan my walk'}</button>
    </form>
  );
}
