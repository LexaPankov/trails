import type { Dataset, Place, Theme } from '../types';

const VALID_THEMES: Theme[] = ['antiquity', 'medieval', 'renaissance', 'baroque', 'modern', 'hidden'];

const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Validates one raw record. Returns the cleaned place or an error message. */
export function validatePlace(raw: unknown): Place | string {
  if (!raw || typeof raw !== 'object') return 'not an object';
  const p = raw as Record<string, unknown>;
  if (!isStr(p.id)) return 'missing id';
  if (!isStr(p.name)) return `${p.id}: missing name`;
  if (!isNum(p.lat) || !isNum(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) return `${p.id}: bad coordinates`;
  if (!isStr(p.summary)) return `${p.id}: missing summary`;
  const themes = Array.isArray(p.themes) ? (p.themes as unknown[]).filter((t): t is Theme => VALID_THEMES.includes(t as Theme)) : [];
  const significance = isNum(p.significance) ? Math.min(5, Math.max(1, p.significance)) : 2;
  return {
    id: p.id,
    name: p.name,
    lat: p.lat,
    lon: p.lon,
    period: isStr(p.period) ? p.period : 'Period unknown',
    themes,
    significance,
    hidden: p.hidden === true || themes.includes('hidden'),
    summary: p.summary,
    then: isStr(p.then) ? p.then : '',
    now: isStr(p.now) ? p.now : '',
    more: isStr(p.more) ? p.more : '',
    wikiQuery: isStr(p.wikiQuery) ? p.wikiQuery : undefined,
    wikiUrl: isStr(p.wikiUrl) ? p.wikiUrl : undefined,
    image: isStr(p.image) ? p.image : undefined,
    audio: isStr(p.audio) ? p.audio : undefined,
  };
}

export function validateDataset(raw: unknown): { data: Dataset; warnings: string[] } {
  if (!raw || typeof raw !== 'object') throw new Error('Dataset is not a JSON object');
  const d = raw as Record<string, unknown>;
  const city = d.city as Dataset['city'] | undefined;
  if (!city || !isStr(city.name) || !Array.isArray(city.center)) throw new Error('Dataset is missing city information');
  if (!Array.isArray(d.places)) throw new Error('Dataset has no places array');
  const warnings: string[] = [];
  const seen = new Set<string>();
  const places: Place[] = [];
  for (const r of d.places) {
    const v = validatePlace(r);
    if (typeof v === 'string') { warnings.push(v); continue; }
    if (seen.has(v.id)) { warnings.push(`${v.id}: duplicate id`); continue; }
    seen.add(v.id);
    places.push(v);
  }
  if (places.length < 3) throw new Error('Dataset has fewer than 3 valid places');
  const vp = city.demoViewpoint ?? { name: city.name, lat: city.center[0], lon: city.center[1], heading: 0 };
  return {
    data: {
      schemaVersion: isNum(d.schemaVersion) ? d.schemaVersion : 1,
      city: { ...city, elevationData: city.elevationData === true, demoViewpoint: vp },
      source: (d.source as Dataset['source']) ?? { generatedBy: 'unknown' },
      places,
    },
    warnings,
  };
}

export async function loadDataset(): Promise<Dataset> {
  const url = `${import.meta.env.BASE_URL}data/places.json`;
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load ${url} (HTTP ${res.status})`);
  const { data, warnings } = validateDataset(await res.json());
  if (warnings.length) console.warn('[EchoWalk] skipped invalid places:', warnings);
  return data;
}
