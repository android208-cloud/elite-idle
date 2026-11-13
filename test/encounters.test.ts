import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  advance,
  buyEquipment,
  combatAction,
  combatAutoplay,
  currentSystem,
  DEFAULT_SETTINGS,
  deserialize,
  newGame,
  startJump,
  systemsOf,
  INSURANCE_CASH_KEPT,
  type GameState,
  type Settings,
} from '../src/core/state.ts';
import { autoCombat, canDo, combatRound, startCombat } from '../src/core/combat.ts';
import { distance } from '../src/core/galaxy.ts';
import { legalLabel, rankOf, STARTER_SHIP } from '../src/core/ships.ts';

const NOW = 10_000_000;
const MIN = 60_000;

function targetOf(g: GameState): number {
  const systems = systemsOf(g.galaxy);
  const t = systems.findIndex((s, i) => i !== g.system && distance(systems[g.system], s) <= g.fuel);
  assert.ok(t >= 0);
  return t;
}

/** Состояние в полёте без встреч */
function flying(settings: Settings = DEFAULT_SETTINGS): GameState {
  const g = newGame(5);
  return startJump(g, targetOf(g), NOW, { ...settings, encounterRate: 0 }).state;
}

/* ---------- Бой ---------- */

test('бой детерминирован и всегда заканчивается', () => {
  const run = () => autoCombat(startCombat('sidewinder', STARTER_SHIP, true, 0, 123));
  const a = run();
  assert.ok(a.outcome);
  assert.deepEqual(a, run());
});

test('баланс: стартовый корабль почти всегда побеждает Sidewinder и чаще проигрывает Python', () => {
  const rate = (enemy: string): number => {
    let died = 0;
    for (let seed = 1; seed <= 300; seed++) {
      if (autoCombat(startCombat(enemy, STARTER_SHIP, false, 0, seed)).outcome === 'died') died++;
    }
    return died / 300;
  };
  const weak = rate('sidewinder');
  const strong = rate('python');
  assert.ok(weak < 0.05, `Sidewinder убивает слишком часто: ${weak}`);
  assert.ok(strong > weak, `Python должен быть опаснее: ${strong} против ${weak}`);
});

test('доступность действий: ECM только против ракеты, бомба только при наличии', () => {
  const c = startCombat('python', { ...STARTER_SHIP, ecm: true }, true, 5, 1);
  assert.equal(canDo(c, 'ecm'), false);
  assert.equal(canDo({ ...c, incomingMissile: true }, 'ecm'), true);
  assert.equal(canDo(c, 'bomb'), false);
  assert.equal(canDo(c, 'dump'), true);
  assert.equal(canDo(startCombat('python', STARTER_SHIP, true, 0, 1), 'dump'), false);
});

test('энергобомба уничтожает противника сразу', () => {
  const c = startCombat('python', { ...STARTER_SHIP, energyBomb: true }, true, 0, 1);
  const r = combatRound(c, 'bomb');
  assert.equal(r.outcome, 'won');
  assert.equal(r.bombUsed, true);
});

test('капсула завершает бой исходом pod, только если она есть', () => {
  const withPod = startCombat('python', { ...STARTER_SHIP, escapePod: true }, true, 0, 1);
  assert.equal(combatRound(withPod, 'pod').outcome, 'pod');
  const without = startCombat('python', STARTER_SHIP, true, 0, 1);
  assert.equal(canDo(without, 'pod'), false);
});

test('ракета противника без ECM наносит урон', () => {
  const c = { ...startCombat('python', STARTER_SHIP, true, 0, 7), incomingMissile: true };
  const r = combatRound(c, 'laser');
  assert.equal(r.incomingMissile, false);
  assert.ok(r.log.some((l) => l.includes('Ракета противника попала')));
});

/* ---------- Встречи по ходу полёта ---------- */

test('встречи: при высокой частоте за полёт что-то происходит и игра доходит до конца', () => {
  const g = newGame(5);
  const s = { ...DEFAULT_SETTINGS, encounterRate: 100 };
  const started = startJump(g, targetOf(g), NOW, s);
  assert.ok(started.state.flight!.pending.length > 0);
  const done = advance(started.state, NOW + 48 * 60 * MIN, s);
  assert.equal(done.state.flight, null);
  assert.equal(done.state.combat, null);
  assert.ok(done.events.some((e) => e.type === 'detected' || e.type === 'canister'));
  assert.ok(done.events.some((e) => e.type === 'arrived' || e.type === 'death'));
});

test('ненападающий корабль исчезает через N минут, полёт не прерывается', () => {
  const g = flying();
  const encounter = {
    role: 'trader' as const,
    enemyId: 'cobra3',
    detectedAt: NOW + MIN,
    resolveAt: NOW + MIN + 5 * MIN,
    outcome: 'leave' as const,
  };
  const s: GameState = { ...g, encounter };
  const before = advance(s, NOW + 5 * MIN);
  assert.ok(before.state.encounter, 'через 4 минуты корабль ещё рядом');
  const after = advance(s, NOW + 7 * MIN);
  assert.equal(after.state.encounter, null);
  assert.ok(after.events.some((e) => e.type === 'vanished'));
  assert.ok(after.state.flight, 'полёт продолжается');
});

test('прибытие раньше N минут: корабль остаётся позади', () => {
  const g = flying();
  const s: GameState = {
    ...g,
    encounter: { role: 'trader', enemyId: 'cobra3', detectedAt: NOW, resolveAt: NOW + 99 * MIN, outcome: 'leave' },
  };
  const done = advance(s, NOW + 20 * MIN);
  assert.equal(done.state.flight, null);
  assert.equal(done.state.encounter, null);
  assert.ok(done.events.some((e) => e.type === 'arrived'));
});

test('нападение в ручном режиме ставит полёт на паузу и ждёт игрока', () => {
  const settings = { ...DEFAULT_SETTINGS, combatMode: 'manual' as const };
  const g = flying(settings);
  const s: GameState = {
    ...g,
    encounter: { role: 'pirate', enemyId: 'sidewinder', detectedAt: NOW, resolveAt: NOW + MIN, outcome: 'attack' },
  };
  const r = advance(s, NOW + 100 * MIN, settings);
  assert.ok(r.state.combat, 'бой ждёт решения игрока');
  assert.ok(r.state.flight, 'полёт не завершён');
  assert.ok(r.events.some((e) => e.type === 'combat-start' && e.manual));
  assert.ok(!r.events.some((e) => e.type === 'arrived'));
});

test('нападение в автоматическом режиме разрешается без участия игрока', () => {
  const settings = { ...DEFAULT_SETTINGS, combatMode: 'auto' as const };
  const g = flying(settings);
  const s: GameState = {
    ...g,
    encounter: { role: 'pirate', enemyId: 'sidewinder', detectedAt: NOW, resolveAt: NOW + MIN, outcome: 'attack' },
  };
  const r = advance(s, NOW + 100 * MIN, settings);
  assert.equal(r.state.combat, null);
  assert.ok(r.events.some((e) => e.type === 'combat-end' || e.type === 'death'));
});

test('пауза боя сдвигает прибытие на время ожидания игрока', () => {
  const g = flying();
  const arrive = g.flight!.arriveAt;
  const won = { ...startCombat('sidewinder', STARTER_SHIP, true, 0, 1), outcome: 'won' as const };
  // Бой начался через минуту, игрок вернулся через три минуты после начала,
  // но игра была открыта только две из них: простой = 2 минуты, остальное — офлайн
  const s: GameState = {
    ...g,
    combat: { combat: won, role: 'pirate', pausedAt: NOW + MIN + 2 * MIN, pausedMs: 2 * MIN },
  };
  const r = combatAutoplay(s, NOW + MIN + 3 * MIN);
  assert.equal(r.state.flight!.arriveAt, arrive + 2 * MIN);
  assert.equal(r.state.kills, 1);
  assert.ok(r.state.cash > s.cash, 'награда за убийство выплачена');
});

test('ход игрока спустя часы не откладывает прибытие на всё это время', () => {
  const g = flying();
  const arrive = g.flight!.arriveAt;
  const won = { ...startCombat('sidewinder', STARTER_SHIP, true, 0, 1), outcome: 'won' as const };
  // Игрок закрыл вкладку на два часа: пауза «стоит» с момента начала боя
  const s: GameState = { ...g, combat: { combat: won, role: 'pirate', pausedAt: NOW + MIN, pausedMs: 0 } };
  const r = combatAutoplay(s, NOW + MIN + 120 * MIN);
  assert.equal(r.state.flight!.arriveAt, arrive, 'офлайн-время не должно сдвигать полёт');
});

test('досчёт перед ходом фиксирует простой, но не растягивает его на всё ожидание', () => {
  const settings = { ...DEFAULT_SETTINGS, combatMode: 'manual' as const };
  const g = flying(settings);
  const arrive = g.flight!.arriveAt;
  const c = startCombat('python', STARTER_SHIP, true, 0, 1);
  const waiting: GameState = { ...g, combat: { combat: c, role: 'pirate', pausedAt: NOW, pausedMs: 0 } };

  // Игрок вернулся через час: досчёт закрывает паузу ровно этим часом
  const resumed = advance(waiting, NOW + 60 * MIN, settings).state;
  assert.equal(resumed.combat!.pausedMs, 60 * MIN);
  assert.equal(resumed.combat!.pausedAt, NOW + 60 * MIN);

  // Ход игрока сам по себе простой не удлиняет — только онлайн-тики через advance
  const acted = combatAction(resumed, 'laser', NOW + 61 * MIN, settings).state;
  assert.equal(acted.combat!.pausedMs, 60 * MIN);
  assert.equal(acted.flight!.arriveAt, arrive);
});

test('ручной бой: действие игрока не ломает состояние и в итоге завершается', () => {
  const settings = { ...DEFAULT_SETTINGS, combatMode: 'manual' as const };
  const g = flying(settings);
  let s: GameState = {
    ...g,
    encounter: { role: 'pirate', enemyId: 'sidewinder', detectedAt: NOW, resolveAt: NOW + MIN, outcome: 'attack' },
  };
  s = advance(s, NOW + 2 * MIN, settings).state;
  assert.ok(s.combat);
  let guard = 0;
  while (s.combat && guard++ < 200) s = combatAction(s, 'laser', NOW + 3 * MIN, settings).state;
  assert.equal(s.combat, null);
});

/* ---------- Смерть ---------- */

function deadState(settings: Settings): { s: GameState; from: number } {
  const g = flying(settings);
  const bought: GameState = { ...g, cargo: g.cargo.map((_, i) => (i === 0 ? 5 : 0)), holdSpace: 15 };
  const died = { ...startCombat('python', STARTER_SHIP, true, 5, 1), outcome: 'died' as const };
  return { s: { ...bought, combat: { combat: died, role: 'pirate', pausedAt: NOW, pausedMs: 0 } }, from: g.flight!.from };
}

test('смерть, режим «страховка»: потеря груза и части денег, возврат на станцию вылета', () => {
  const settings = { ...DEFAULT_SETTINGS, deathMode: 'insurance' as const };
  const { s, from } = deadState(settings);
  const r = combatAutoplay(s, NOW, settings);
  assert.equal(r.state.flight, null);
  assert.equal(r.state.system, from);
  assert.equal(r.state.cargo[0], 0);
  assert.equal(r.state.cash, Math.floor(s.cash * INSURANCE_CASH_KEPT));
  assert.ok(r.events.some((e) => e.type === 'death'));
});

test('смерть, режим «без смерти»: ничего не теряется, возврат на станцию вылета', () => {
  const settings = { ...DEFAULT_SETTINGS, deathMode: 'none' as const };
  const { s, from } = deadState(settings);
  const r = combatAutoplay(s, NOW, settings);
  assert.equal(r.state.flight, null);
  assert.equal(r.state.system, from);
  assert.equal(r.state.cargo[0], 5);
  assert.equal(r.state.cash, s.cash);
});

test('спасательная капсула: корабль и оборудование потеряны, деньги целы', () => {
  const g = flying();
  const rich: GameState = { ...g, ship: { ...g.ship, ecm: true, escapePod: true } };
  const pod = { ...startCombat('python', rich.ship, true, 0, 1), outcome: 'pod' as const };
  const s: GameState = { ...rich, combat: { combat: pod, role: 'pirate', pausedAt: NOW, pausedMs: 0 } };
  const r = combatAutoplay(s, NOW);
  assert.equal(r.state.ship.ecm, false);
  assert.equal(r.state.ship.escapePod, false);
  assert.equal(r.state.cash, s.cash);
  assert.equal(r.state.flight, null);
});

test('убийство полицейского делает беглецом', () => {
  const g = flying();
  const won = { ...startCombat('viper', STARTER_SHIP, true, 0, 1), outcome: 'won' as const };
  const s: GameState = { ...g, combat: { combat: won, role: 'police', pausedAt: NOW, pausedMs: 0 } };
  const r = combatAutoplay(s, NOW);
  assert.equal(legalLabel(r.state.legal), 'Беглец');
});

test('правовой статус уменьшается при прибытии', () => {
  const g = { ...flying(), legal: 100 };
  const r = advance(g, NOW + 99 * MIN);
  assert.equal(r.state.legal, 50);
});

/* ---------- Оборудование, ранги, миграция ---------- */

test('оборудование: нужен технологический уровень, деньги; повторно не купить', () => {
  const g = newGame(1);
  // Lave: тех. уровень невысок, ECM (ТУ 2) доступен, галактический гипердвигатель (ТУ 10) нет
  assert.ok(currentSystem(g).techLevel + 1 < 10);
  assert.equal(buyEquipment({ ...g, cash: 10 ** 7 }, 'galacticHyperdrive').error, 'tech');
  const ecm = buyEquipment({ ...g, cash: 10 ** 7 }, 'ecm');
  assert.equal(ecm.error, undefined);
  assert.equal(ecm.state.ship.ecm, true);
  assert.equal(buyEquipment(ecm.state, 'ecm').error, 'owned');
  assert.equal(buyEquipment({ ...g, cash: 1 }, 'ecm').error, 'cash');
});

test('ракеты: максимум 4, увеличенный трюм добавляет 15 т', () => {
  let g: GameState = { ...newGame(1), cash: 10 ** 7 };
  g = buyEquipment(g, 'missile').state;
  assert.equal(g.ship.missiles, 4);
  assert.equal(buyEquipment(g, 'missile').error, 'full');
  const bay = buyEquipment(g, 'cargoBay');
  assert.equal(bay.state.holdSpace, 35);
});

test('ранги по числу убийств', () => {
  assert.equal(rankOf(0), 'Безобидный');
  assert.equal(rankOf(8), 'Почти безобидный');
  assert.equal(rankOf(130), 'Опытный');
  assert.equal(rankOf(6400), 'ЭЛИТА');
});

test('миграция сохранения версии 1', () => {
  const old = { ...newGame(3), version: 1 } as Record<string, unknown>;
  for (const k of ['ship', 'kills', 'legal', 'encounter', 'combat']) delete old[k];
  const g = deserialize(JSON.stringify(old));
  assert.equal(g.version, 2);
  assert.equal(g.kills, 0);
  assert.equal(g.ship.missiles, 3);
});

