import { Icon } from './components/Icon'
import { DATASET_VERSION } from './lib/data'
import { Camera } from './screens/Camera'
import { Home } from './screens/Home'
import { Lab } from './screens/Lab'
import { Navigate } from './screens/Navigate'
import { PlaceDetail } from './screens/PlaceDetail'
import { Profile } from './screens/Profile'
import { Results } from './screens/Results'
import { SharedWalk } from './screens/SharedWalk'
import { About } from './screens/About'
import { DEMO_SCENARIOS, useApp, useHashRoute } from './state'

const TABS = [
  { path: '', label: 'Plan', icon: 'compass' },
  { path: 'route', label: 'Route', icon: 'route' },
  { path: 'camera', label: 'Camera', icon: 'camera' },
  { path: 'profile', label: 'Profile', icon: 'user' },
]

export default function App() {
  const route = useHashRoute()
  const { demo, setDemo, scenario, setScenario } = useApp()
  const [top, arg] = [route[0]?.split('?')[0] ?? '', route[1]]
  const current = top === 'navigate' ? 'route' : top === 'walk' ? 'route' : top === 'place' || top === 'about' || top === 'lab' ? '' : top

  let screen
  switch (top) {
    case 'route': screen = <Results />; break
    case 'navigate': screen = <Navigate />; break
    case 'place': screen = <PlaceDetail id={arg} />; break
    case 'camera': screen = <Camera />; break
    case 'profile': screen = <Profile />; break
    case 'about': screen = <About />; break
    case 'lab': screen = <Lab />; break
    case 'walk': screen = <SharedWalk code={arg} />; break
    default: screen = <Home />
  }
  const full = top === 'route' || top === 'navigate'
  const immersive = top === 'navigate' // the walk screen is a full-screen map with its own back button

  return (
    <div className="app">
      <a href="#main" className="sr-only">Skip to content</a>
      {!immersive && <header className="header">
        <a className="brand" href="#/" aria-label="TRAILS home">
          <span className="brand-mark">TRAILS</span>
          <span className="brand-tag">Every route has a story.</span>
        </a>
        <nav className="nav" aria-label="Main">
          {TABS.map((t) => (
            <a key={t.path} href={`#/${t.path}`} aria-current={current === t.path ? 'page' : undefined}>
              <Icon name={t.icon} size={16} /> {t.label}
            </a>
          ))}
        </nav>
        <button className="demo-pill" aria-pressed={demo} onClick={() => setDemo(!demo)} title="Indoor demo mode: simulated location">
          <Icon name="locate" size={15} /> Demo{demo ? ' on' : ''}
        </button>
        {demo && (
          <select className="demo-scenario" aria-label="Demo scenario" value={scenario.id} style={{ width: 'auto', maxWidth: 190, padding: '6px 8px', fontSize: '0.8rem' }}
            onChange={(e) => setScenario(DEMO_SCENARIOS.find((s) => s.id === e.target.value)!)}>
            {DEMO_SCENARIOS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        )}
      </header>}
      <main id="main" className="main">{screen}</main>
      {!full && (
        <footer className="footer">
          TRAILS · Rome dataset v{DATASET_VERSION} · Map data © OpenStreetMap contributors · <a href="#/about">Sources, models & limitations</a>
        </footer>
      )}
      {!immersive && <nav className="tabbar" aria-label="Main">
        {TABS.map((t) => (
          <a key={t.path} href={`#/${t.path}`} aria-current={current === t.path ? 'page' : undefined}>
            <Icon name={t.icon} size={20} /> {t.label}
          </a>
        ))}
      </nav>}
    </div>
  )
}
