import { useEffect, useState } from 'react';
import type { Place } from '../types';

/**
 * Optional photo + canonical article link from Wikipedia (plain HTTP API, no AI).
 * If the network is down, the card just shows its typographic fallback.
 */
export interface WikiInfo { image?: string; url?: string }

const mem = new Map<string, Promise<WikiInfo>>();
const CACHE_KEY = 'echowalk.wiki.v1';

function readCache(): Record<string, WikiInfo> {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}'); } catch { return {}; }
}

async function fetchWiki(query: string): Promise<WikiInfo> {
  const cached = readCache()[query];
  if (cached) return cached;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const u = new URL('https://en.wikipedia.org/w/api.php');
    Object.entries({
      action: 'query', format: 'json', origin: '*', generator: 'search', gsrsearch: query, gsrlimit: '1',
      prop: 'pageimages|info', piprop: 'thumbnail', pithumbsize: '900', inprop: 'url',
    }).forEach(([k, v]) => u.searchParams.set(k, v));
    const res = await fetch(u, { signal: ctrl.signal });
    if (!res.ok) return {};
    const json = await res.json();
    const page = Object.values(json?.query?.pages ?? {})[0] as { thumbnail?: { source: string }; fullurl?: string } | undefined;
    const info: WikiInfo = { image: page?.thumbnail?.source, url: page?.fullurl };
    try {
      const c = readCache(); c[query] = info; localStorage.setItem(CACHE_KEY, JSON.stringify(c));
    } catch { /* ignore */ }
    return info;
  } catch {
    return {};
  } finally {
    clearTimeout(t);
  }
}

export function wikiSearchUrl(p: Place): string {
  return `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(p.wikiQuery ?? `${p.name} Milan`)}`;
}

export function useWiki(p: Place | null): WikiInfo {
  const [info, setInfo] = useState<WikiInfo>({});
  useEffect(() => {
    if (!p) return;
    setInfo({ image: p.image, url: p.wikiUrl });
    if (p.image && p.wikiUrl) return;
    const q = p.wikiQuery ?? `${p.name} Milan`;
    if (!mem.has(q)) mem.set(q, fetchWiki(q));
    let alive = true;
    mem.get(q)!.then((w) => { if (alive) setInfo({ image: p.image ?? w.image, url: p.wikiUrl ?? w.url }); });
    return () => { alive = false; };
  }, [p]);
  return info;
}
