import { useEffect, useRef, useState } from 'react';
import type { Place } from '../types';
import { THEMES } from '../types';
import { useWiki, wikiSearchUrl } from '../lib/wiki';

interface Props {
  place: Place | null;
  stopNumber?: number;
  startExpanded?: boolean;
  onClose: () => void;
}

const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;

export function themeLabel(id: string) {
  return THEMES.find((t) => t.id === id)?.label ?? id;
}

export function Photo({ place, className }: { place: Place; className?: string }) {
  const { image } = useWiki(place);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [image]);
  if (!image || broken) {
    return (
      <div className={`photo photo--empty ${className ?? ''}`} aria-hidden="true">
        <span>{place.name.charAt(0)}</span>
      </div>
    );
  }
  return <img className={`photo ${className ?? ''}`} src={image} alt={place.name} loading="lazy" onError={() => setBroken(true)} />;
}

export default function PlaceSheet({ place, stopNumber, startExpanded, onClose }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const { url } = useWiki(place);

  useEffect(() => {
    setExpanded(!!startExpanded);
    if (canSpeak) { window.speechSynthesis.cancel(); setSpeaking(false); }
    if (place) closeBtn.current?.focus();
  }, [place, startExpanded]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => () => { if (canSpeak) window.speechSynthesis.cancel(); }, []);

  if (!place) return null;

  const listen = () => {
    if (!canSpeak) return;
    if (speaking) { window.speechSynthesis.cancel(); setSpeaking(false); return; }
    const u = new SpeechSynthesisUtterance([place.name, place.summary, place.then, place.now].filter(Boolean).join('. '));
    u.lang = 'en-GB';
    u.rate = 0.98;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(u);
    setSpeaking(true);
  };

  return (
    <div className="sheet-wrap" onClick={onClose}>
      <aside className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" onClick={(e) => e.stopPropagation()}>
        <button ref={closeBtn} className="sheet__close" onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
        <Photo place={place} className="sheet__photo" />
        <div className="sheet__body">
          <p className="sheet__meta">
            {stopNumber ? <span className="stopnum">Stop {stopNumber}</span> : null}
            {place.period}
          </p>
          <h2 id="sheet-title">{place.name}</h2>
          <ul className="tags">
            {place.themes.map((t) => <li key={t} className={`tag tag--${t}`}>{themeLabel(t)}</li>)}
          </ul>
          <p className="sheet__summary">{place.summary}</p>

          {(place.then || place.now) && (
            <div className="thennow">
              {place.then && <div><h3>Then</h3><p>{place.then}</p></div>}
              {place.now && <div><h3>Now</h3><p>{place.now}</p></div>}
            </div>
          )}

          {place.more && (
            expanded
              ? <div className="sheet__more"><h3>More information</h3><p>{place.more}</p></div>
              : <button className="btn btn--ghost" onClick={() => setExpanded(true)}>More information</button>
          )}

          <div className="sheet__actions">
            {place.audio
              ? <audio controls src={place.audio} preload="none" />
              : canSpeak && <button className="btn btn--quiet" onClick={listen} aria-pressed={speaking}>{speaking ? 'Stop reading' : 'Read aloud'}</button>}
            <a className="btn btn--quiet" href={url ?? wikiSearchUrl(place)} target="_blank" rel="noreferrer">Open on Wikipedia</a>
          </div>
        </div>
      </aside>
    </div>
  );
}
