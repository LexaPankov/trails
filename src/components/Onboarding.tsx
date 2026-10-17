import { useEffect, useState } from 'react'
import { useApp } from '../state'
import { InterestPicker } from './common'
import { Icon } from './Icon'

const KEY = 'trails.onboarded.v1'

export function onboardingSeen(): boolean {
  try { return localStorage.getItem(KEY) === '1' } catch { return true } // no storage: never nag
}
export function resetOnboarding() {
  try { localStorage.removeItem(KEY) } catch { /* storage unavailable */ }
}

/** First-run intro, three short steps: what TRAILS is, what you love, where you are. Skippable, shown once. */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const { profile, setProfile, setDemo } = useApp()
  const [step, setStep] = useState(0)

  function finish(demo?: boolean) {
    try { localStorage.setItem(KEY, '1') } catch { /* storage unavailable */ }
    if (demo !== undefined) setDemo(demo)
    onDone()
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') finish() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const steps = ['Welcome', 'Your interests', 'Where you are']
  return (
    <div className="onboard-backdrop" role="dialog" aria-modal="true" aria-label={`Welcome to TRAILS, step ${step + 1} of 3: ${steps[step]}`}>
      <div className="onboard card fade-in" key={step}>
        <div className="row spread">
          <div className="onboard-dots" aria-hidden="true">{steps.map((s, i) => <span key={s} className={i === step ? 'on' : ''} />)}</div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => finish()}>Skip</button>
        </div>

        {step === 0 && (
          <>
            <p className="eyebrow" style={{ margin: '14px 0 4px' }}>Welcome to TRAILS</p>
            <h2 className="onboard-title">Every route has a story.</h2>
            <ul className="onboard-points">
              <li><Icon name="route" size={20} /><span><b>A walk planned for you.</b> Any start, any destination, your time: TRAILS picks the places worth a detour for your taste.</span></li>
              <li><Icon name="sparkle" size={20} /><span><b>Its story, written for you.</b> Gemma 4 31B on AMD GPUs writes the story of your walk, with sources.</span></li>
              <li><Icon name="sound" size={20} /><span><b>Told as you walk.</b> Each place is read aloud when you get close.</span></li>
              <li><Icon name="camera" size={20} /><span><b>Point and learn.</b> The camera recognises Rome’s landmarks.</span></li>
            </ul>
            <button type="button" className="btn btn-primary onboard-next" onClick={() => setStep(1)}>Get started <Icon name="arrow" size={16} /></button>
          </>
        )}

        {step === 1 && (
          <>
            <h2 className="onboard-title" style={{ marginTop: 14 }}>What do you love?</h2>
            <p className="small muted">Pick a few. Your walks and stories follow them, and they keep learning from your likes and skips.</p>
            <InterestPicker value={profile.interests} onChange={(v) => setProfile({ ...profile, interests: v })} />
            <p className="tiny muted" style={{ marginTop: 10 }}>Stored only on this device. No account.</p>
            <button type="button" className="btn btn-primary onboard-next" disabled={!profile.interests.length} onClick={() => setStep(2)}>
              Continue <Icon name="arrow" size={16} />
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="onboard-title" style={{ marginTop: 14 }}>Are you in Rome?</h2>
            <p className="small muted">TRAILS covers central Rome. Not there? Demo mode lets you try the walk, the audio guide and the camera from anywhere.</p>
            <div className="onboard-choices">
              <button type="button" className="preset" onClick={() => finish(false)}>
                <strong><Icon name="locate" size={16} /> Yes, I’m in Rome</strong>
                <span className="small muted">Start from your location or any address</span>
              </button>
              <button type="button" className="preset" onClick={() => finish(true)}>
                <strong><Icon name="compass" size={16} /> No, show me a demo</strong>
                <span className="small muted">Pretend to stand in Piazza Navona; then tap a ready walk like “Ancient stones”</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
