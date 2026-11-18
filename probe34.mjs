import { newGame, hirePilot, assignPilotRoute, advance, systemsOf, DEFAULT_SETTINGS, pilotCycleMs } from './src/core/state.ts';
import { laneSurveillance, pilotRisk, routeProfit, pirateLoot, surveillanceOf } from './src/core/fleet.ts';
import { SHIPS, shipPrice } from './src/core/ships.ts';
const H = 3_600_000, sys = systemsOf(1);
const role = process.argv[2] ?? 'trader', ship = process.argv[3] ?? 'adder';
let s = newGame(7);
s = { ...s, kills: 128, cash: 300000 };
let h = hirePilot(s, ship, 1_000_000);
if (h.error) { console.log('наём:', h.error); process.exit(0); }
s = h.state;
const a = assignPilotRoute(s, 1, 39, 1_000_000, role);
if (a.error) { console.log('маршрут:', a.error); process.exit(0); }
s = a.state;
const p = s.pilots[0];
const risk = pilotRisk(role, laneSurveillance(sys, p.route), surveillanceOf(sys[39]));
const gross = role === 'pirate' ? pirateLoot(1, sys, p.route, SHIPS[ship].hold) : routeProfit(1, sys, p.route, SHIPS[ship].hold, role);
console.log(`${role}/${ship}: рейс ${(gross/10).toFixed(0)} CR · вам ${(gross*0.75/10).toFixed(0)} · риск ${JSON.stringify(risk)} · цикл ${(pilotCycleMs(s, p)/H).toFixed(2)} ч`);
const cash0 = s.cash;
const r = advance(s, 1_000_000 + 72 * H, DEFAULT_SETTINGS);
const q = r.state.pilots[0];
console.log('72 ч:', q ? `рейсов ${q.runs}, провалов ${q.failures}` : 'ПИЛОТ ПОТЕРЯН', `· деньги ${((r.state.cash - cash0)/10).toFixed(0)} · розыск ${r.state.legal}`);
for (const e of r.events) console.log('   ', e.text);
