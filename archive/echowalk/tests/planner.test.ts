// Run: npm test
import { readFileSync } from 'node:fs';
import { validateDataset } from '../src/lib/data';
import { planRoute, PLANNER_CONFIG } from '../src/lib/planner';
import { angleDiff, bearing, haversine } from '../src/lib/geo';
import type { PlanRequest, Theme } from '../src/types';

let failed = 0;
const check = (name: string, ok: boolean, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
  if (!ok) failed++;
};

const { data, warnings } = validateDataset(JSON.parse(readFileSync('public/data/places.json', 'utf8')));
check('dataset validates with no warnings', warnings.length === 0, `${data.places.length} places`);
const box = data.places.every((p) => p.lat > 45.44 && p.lat < 45.49 && p.lon > 9.16 && p.lon < 9.21);
check('all coordinates inside central Milan', box);

check('bearing north ≈ 0', Math.abs(bearing({ lat: 45, lon: 9 }, { lat: 46, lon: 9 })) < 0.5);
check('bearing east ≈ 90', Math.abs(bearing({ lat: 45, lon: 9 }, { lat: 45, lon: 9.1 }) - 90) < 0.5);
check('angleDiff wraps', angleDiff(5, 355) === 10 && angleDiff(355, 5) === -10);
check('Duomo → Castello ≈ 1.3 km', Math.abs(haversine(data.places[0], data.places.find((p) => p.id === 'castello')!) - 1300) < 250);

const base: PlanRequest = { startId: 'duomo', endId: 'castello', minutes: 90, themes: ['renaissance', 'hidden'], mode: 'maximum' };
const combos: [number, Theme[], PlanRequest['mode']][] = [];
for (const m of [30, 60, 90, 120]) for (const t of [[], ['antiquity'], ['renaissance', 'hidden'], ['baroque'], ['modern']] as Theme[][]) for (const mode of ['maximum', 'highlights'] as const) combos.push([m, t, mode]);
let budgetOk = true, worst = '';
for (const [minutes, themes, mode] of combos) {
  for (const [s, e] of [['duomo', 'castello'], ['santambrogio', 'duomo'], ['scala', 'darsena'], ['duomo', 'duomo']]) {
    const r = planRoute(data.places, { startId: s, endId: e, minutes, themes, mode });
    if (r.stops.length > 0 && r.totalMin > minutes + 0.01) { budgetOk = false; worst = `${s}->${e} ${minutes}min ${mode} ${themes} = ${r.totalMin.toFixed(1)}`; }
    if (r.stops.length > PLANNER_CONFIG.maxStops[mode]) { budgetOk = false; worst = 'too many stops'; }
  }
}
check('time budget always respected (160 combinations)', budgetOk, worst);

const r90 = planRoute(data.places, base);
check('90 min Duomo→Castello has 5–15 stops', r90.stops.length >= 5 && r90.stops.length <= 15, `${r90.stops.length} stops, ${r90.totalMin.toFixed(0)} min`);
console.log('      ', r90.stops.map((s) => s.name).join(' | '));
const hl = planRoute(data.places, { ...base, mode: 'highlights' });
check('highlights only picks significance ≥ 4', hl.stops.every((s) => s.significance >= 4), `${hl.stops.length} stops`);
check('highlights has fewer stops than maximum', hl.stops.length < r90.stops.length);
const anti = planRoute(data.places, { ...base, themes: ['antiquity'] });
check('antiquity theme only picks antiquity places', anti.stops.every((s) => s.themes.includes('antiquity')), anti.stops.map((s) => s.id).join(','));
const differs = anti.stops.map((s) => s.id).join() !== r90.stops.map((s) => s.id).join();
check('changing theme changes the route', differs);
const longer = planRoute(data.places, { ...base, minutes: 120 });
const shorter = planRoute(data.places, { ...base, minutes: 30 });
check('more time → at least as many stops', longer.stops.length >= r90.stops.length && r90.stops.length >= shorter.stops.length, `${shorter.stops.length}/${r90.stops.length}/${longer.stops.length}`);
const tooShort = planRoute(data.places, { startId: 'vicolo-lavandai', endId: 'porta-nuova', minutes: 30, themes: [], mode: 'maximum' });
check('impossible budget returns direct route with a note', tooShort.stops.length === 0 && tooShort.notes.length > 0, tooShort.notes[0]);

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nAll checks passed');
