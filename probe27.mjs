import { newGame, hirePilot, assignPilotRoute, advance, pilotCycleMs, pilotRouteProfit, systemsOf, DEFAULT_SETTINGS } from './src/core/state.ts';
import { distance } from './src/core/galaxy.ts';
import { routeProfit } from './src/core/fleet.ts';
const H = 3_600_000, sys = systemsOf(1);
const near = sys.map((x, i) => ({ i, d: distance(sys[7], x) })).filter((x) => x.i !== 7 && x.d <= 60)
  .map((x) => ({ ...x, p: routeProfit(1, sys, { from: 7, to: x.i }, 8) })).sort((a, b) => b.p - a.p);
console.log('соседи Аддера:', near.map((n) => `${n.i}:${sys[n.i].name} ${(n.d/10).toFixed(1)}ly ${(n.p/10).toFixed(0)}CR`).join(' | '));

let s = newGame(1);
s = { ...s, kills: 128, cash: 200000 };
let h = hirePilot(s, 'adder', 1_000_000); s = h.state;
const to = near[0].i;
const a = assignPilotRoute(s, 1, to, 1_000_000);
console.log('маршрут:', a.error ?? `${sys[7].name} → ${sys[to].name} · рейс ${(pilotRouteProfit(a.state, a.pilot)/10).toFixed(0)} CR · цикл ${(pilotCycleMs(a.state, a.pilot)/H).toFixed(2)} ч`);
s = a.state;
const cash0 = s.cash;
for (const hours of [24, 48, 24 * 30]) {
  const r = advance(s, 1_000_000 + hours * H, DEFAULT_SETTINGS);
  console.log(`${hours} ч:`, r.state.pilots[0].runs, 'рейсов · доход', ((r.state.cash - cash0)/10).toFixed(0), 'CR ·', r.events.filter(e=>e.type==='fleet').map(e=>e.text).join(''));
  s = r.state;
}
