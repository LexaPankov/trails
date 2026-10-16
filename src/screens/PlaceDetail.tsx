import { useEffect } from 'react'
import { Icon } from '../components/Icon'
import { ImageCredit, Meter, PlaceTags, PlaceThumb } from '../components/common'
import { getPlace, PLACE_BY_ID, placeImage, placeImages, THEME_LABEL } from '../lib/data'
import { useApp } from '../state'

const BASE = import.meta.env.BASE_URL

export function PlaceDetail({ id }: { id: string }) {
  const { profile, signal, scorer } = useApp()
  const p = getPlace(id)
  useEffect(() => { if (p) document.title = `${p.name} · TRAILS` ; return () => { document.title = 'TRAILS · Every route has a story' } }, [p])
  if (!p) {
    return <div className="page"><div className="card card-pad"><h2>Place not found</h2><a href="#/">Back to planning</a></div></div>
  }
  const imgs = placeImages(p.id).filter((i) => i.split === 'reference')
  const lead = imgs[0] ?? placeImage(p.id)
  const score = scorer?.score(profile.interests, profile.affinity, p)
  const saved = profile.saved.includes(p.id)
  const dismissed = profile.dismissed.includes(p.id)

  return (
    <div className="page fade-in">
      <button className="btn btn-ghost btn-sm" onClick={() => history.back()} style={{ marginBottom: 16 }}>
        <Icon name="back" size={15} /> Back
      </button>
      <div className="place-hero">
        <figure className="place-img" style={{ margin: 0 }}>
          {lead ? (
            <>
              <img src={BASE + lead.file} alt={p.name} />
              <figcaption><ImageCredit file={lead.file} /></figcaption>
            </>
          ) : (
            <div className="placeholder-img">No openly licensed photo is bundled for this place yet.</div>
          )}
        </figure>
        <div>
          <p className="eyebrow">{p.category}{p.built ? ` · ${p.built}` : ''}</p>
          <h1 style={{ fontSize: 'clamp(1.9rem, 4vw, 2.8rem)' }}>{p.name}</h1>
          <PlaceTags p={p} />
          <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
            {p.themes.map((t) => <span key={t} className="tag">{THEME_LABEL[t]}</span>)}
          </div>
          <p style={{ fontSize: '1.1rem', marginTop: 16 }}>{p.summary}</p>
          {score !== undefined && (
            <p className="small muted">
              Match for you <Meter v={score} /> {Math.round(score * 100)}% <span className="tiny">({scorer?.source === 'neural-network' ? 'preference network' : 'fallback rule'})</span>
            </p>
          )}
          <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
            <button className="btn btn-dark btn-sm" onClick={() => signal(p.id, 'like')}><Icon name="heart" size={15} /> I like this</button>
            <button className="btn btn-ghost btn-sm" onClick={() => signal(p.id, 'save')} aria-pressed={saved}>
              <Icon name="bookmark" size={15} /> {saved ? 'Saved' : 'Save'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => signal(p.id, 'dislike')} aria-pressed={dismissed}>
              <Icon name="x" size={15} /> {dismissed ? 'Hidden from routes' : 'Not for me'}
            </button>
          </div>
          <p className="tiny muted" style={{ marginTop: 8 }}>
            Your reactions update a local preference profile on this device; they shape future recommendations.
          </p>
        </div>
      </div>

      <hr className="rule" />
      <div className="grid2">
        <section className="prose">
          {p.then_now && (
            <div className="card card-pad" style={{ background: 'var(--parchment)', marginBottom: 16 }}>
              <p className="eyebrow">Then and now</p>
              <p style={{ margin: 0 }}>{p.then_now}</p>
            </div>
          )}
          {p.history && (<><h3>History</h3><p>{p.history}</p></>)}
          {p.wikidata && <p className="tiny muted">Wikidata: <a href={`https://www.wikidata.org/wiki/${p.wikidata}`} target="_blank" rel="noreferrer">{p.wikidata}</a></p>}
          <p className="small muted">Suggested time here: about {p.visit_minutes} minutes.</p>
        </section>
        <section>
          <h3>Sources</h3>
          <ul className="small">
            {p.sources.map((s) => (
              <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title} <Icon name="external" size={12} /></a></li>
            ))}
          </ul>
          {p.origin === 'wikidata'
            ? <p className="tiny muted">Imported automatically: the text is the lead of the English Wikipedia article (<a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>) and the period and type come from Wikidata. Not reviewed by the TRAILS team.</p>
            : <p className="tiny muted">Text is a short TRAILS summary of well-documented facts; read the sources for the full account.</p>}
          {imgs.length > 1 && (
            <>
              <h3 style={{ marginTop: 16 }}>More views</h3>
              <div className="thumbs">
                {imgs.slice(1, 9).map((i) => (
                  <a key={i.file} href={i.commons_page} target="_blank" rel="noreferrer" title={`${i.author}, ${i.license}`}>
                    <img src={BASE + i.file} alt={`${p.name}, view by ${i.author}`} loading="lazy" />
                  </a>
                ))}
              </div>
              <p className="tiny muted">Photos from Wikimedia Commons via Google Landmarks v2; tap a photo for author and licence.</p>
            </>
          )}
          {p.vision?.supported && (
            <a className="btn btn-ghost btn-sm" href="#/camera" style={{ marginTop: 12 }}><Icon name="camera" size={15} /> Recognisable in camera mode</a>
          )}
          {p.related.length > 0 && (
            <>
              <h3 style={{ marginTop: 20 }}>Nearby and related</h3>
              <div className="stack">
                {p.related.map((r) => PLACE_BY_ID[r]).filter(Boolean).map((r) => (
                  <a key={r.id} href={`#/place/${r.id}`} className="row" style={{ textDecoration: 'none', color: 'inherit' }}>
                    <PlaceThumb p={r} size={44} />
                    <span><strong>{r.name}</strong><br /><span className="tiny muted">{r.summary.slice(0, 80)}…</span></span>
                  </a>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
