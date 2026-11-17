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
  SAVE_VERSION,
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
  const run = () => autoCombat(startCombat('sidewinder', STARTER_SHIP, 0, 123));
  const a = run();
  assert.ok(a.outcome);
  assert.deepEqual(a, run());
});

test('баланс: стартовый корабль почти всегда побеждает Sidewinder и чаще проигрывает Python', () => {
  const rate = (enemy: string): number => {
    let died = 0;
    for (let seed = 1; seed <= 300; seed++) {
      if (autoCombat(startCombat(enemy, STARTER_SHIP, 0, seed)).outcome === 'died') died++;
    }
    return died / 300;
  };
  const weak = rate('sidewinder');
  const strong = rate('python');
  assert.ok(weak < 0.05, `Sidewinder убивает слишком часто: ${weak}`);
  assert.ok(strong > weak, `Python должен быть опаснее: ${strong} против ${weak}`);
});

test('доступность действий: ECM только против ракеты, бомба только при наличии', () => {
  const c = startCombat('python', { ...STARTER_SHIP, ecm: true }, 5, 1);
  assert.equal(canDo(c, 'ecm'), false);
  assert.equal(canDo({ ...c, incomingMissile: true }, 'ecm'), true);
  assert.equal(canDo(c, 'bomb'), false);
  assert.equal(canDo(c, 'dump'), true);
  assert.equal(canDo(startCombat('python', STARTER_SHIP, 0, 1), 'dump'), false);
});

test('энергобомба уничтожает противника сразу', () => {
  const c = startCombat('python', { ...STARTER_SHIP, energyBomb: true }, 0, 1);
  const r = combatRound(c, 'bomb');
  assert.equal(r.outcome, 'won');
  assert.equal(r.bombUsed, true);
});

test('§77: капсулы в бою больше нет', () => {
  // Раньше здесь проверялось, что «pod» завершает бой и доступен только
  // с купленной капсулой. §77 убрал и действие, и предмет: смертей нет,
  // спасать нечего. Тест сторожит, что действие не вернулось тайком.
  const c = startCombat('python', STARTER_SHIP, 0, 1);
  // Действия 'pod' больше нет в перечислении CombatAction, поэтому
  // canDo возвращает undefined (ветки нет в switch), а не false.
  assert.ok(!canDo(c, 'pod' as never), 'капсула не должна быть доступна');
});

test('ракета противника без ECM наносит урон', () => {
  const c = { ...startCombat('python', STARTER_SHIP, 0, 7), incomingMissile: true };
  const r = combatRound(c, 'laser');
  assert.equal(r.incomingMissile, false);
  assert.ok(r.log.some((l) => l.includes('Ракета противника попала')));
});

/* ---------- Встречи по ходу полёта ---------- */

test('встречи: при высокой частоте за полёт что-то происходит и игра доходит до конца', () => {
  const g = newGame(5);
  const s = { ...DEFAULT_SETTINGS, encounterRate: 100 };
  const started = startJump(g, targetOf(g), NOW, s);
  assert.equal(started.state.flight!.encounters, 0, 'встречи рождаются в процессе, а не заранее');
  const done = advance(started.state, NOW + 48 * 60 * MIN, s);
  assert.equal(done.state.flight, null);
  assert.equal(done.state.combat, null);
  assert.ok(done.events.some((e) => e.type === 'detected' || e.type === 'canister'));
  assert.ok(done.events.some((e) => e.type === 'arrived' || e.type === 'damaged'));
});

test('ненападающий корабль исчезает через N минут, полёт не прерывается', () => {
  // `flying()` уже включает encounterRate: 0 — встречи не рождаются, и в
  // кадре только та, что подложена вручную. §76 сделал встречи живыми,
  // поэтому без этого в полёте успевала появиться ещё одна и портила кадр.
  const g = flying();
  const encounter = {
    role: 'trader' as const,
    enemyId: 'cobra3',
    detectedAt: NOW + MIN,
    resolveAt: NOW + MIN + 5 * MIN,
    outcome: 'leave' as const,
  };
  const s: GameState = { ...g, encounter };
  // §76: настройки передаются в КАЖДЫЙ вызов advance, а не запоминаются при
  // старте прыжка. Без этого `encounterRate: 0` не действует на досчёт, и в
  // полёте рождаются новые встречи — тест ловил именно это.
  const quiet: Settings = { ...DEFAULT_SETTINGS, encounterRate: 0 };
  const before = advance(s, NOW + 5 * MIN, quiet);
  assert.ok(before.state.encounter, 'через 4 минуты корабль ещё рядом');
  const after = advance(s, NOW + 7 * MIN, quiet);
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
  // Прибытие наступает по расписанию полёта, а оно теперь зависит от
  // расстояния. Берём точный момент прибытия, а не «через 20 минут».
  const arriveAt = s.flight!.arriveAt;
  const done = advance(s, arriveAt);
  assert.equal(done.state.flight, null);
  assert.equal(done.state.encounter, null);
  assert.ok(done.events.some((e) => e.type === 'arrived'));
});

test('§38.1: не решил вовремя — слабый враждебный даёт победу', () => {
  // Раундов больше нет: истёк срок — исход наступил сам.
  const g = flying();
  const s: GameState = {
    ...g,
    ship: { ...g.ship, laser: 'pulse' },
    encounter: { role: 'pirate', enemyId: 'sidewinder', detectedAt: NOW, resolveAt: NOW + MIN, outcome: 'attack' },
  };
  const r = advance(s, NOW + 100 * MIN);
  assert.equal(r.state.combat, null, 'боя как процесса нет');
  assert.equal(r.state.encounter, null);
  assert.ok(r.events.some((e) => e.type === 'auto-victory'));
  assert.ok(r.state.cash > g.cash, 'награда начислена');
});

test('§38.1: не решил вовремя — сильный пропускается', () => {
  const g = flying();
  const s: GameState = {
    ...g,
    ship: { ...g.ship, laser: 'pulse' },
    encounter: { role: 'pirate', enemyId: 'python', detectedAt: NOW, resolveAt: NOW + MIN, outcome: 'attack' },
  };
  // §76: за 100 минут рождаются новые встречи, и они тоже дают свой вклад.
  // Тест про КОНКРЕТНУЮ встречу — поэтому остальные отключаем.
  const r = advance(s, NOW + 100 * MIN, { ...DEFAULT_SETTINGS, encounterRate: 0 });
  assert.equal(r.state.combat, null);
  assert.ok(r.events.some((e) => e.type === 'auto-skip'));
  assert.equal(r.state.cash, g.cash, 'награды нет');
});

test('пауза боя сдвигает прибытие на время ожидания игрока', () => {
  const g = flying();
  const arrive = g.flight!.arriveAt;
  const won = { ...startCombat('sidewinder', STARTER_SHIP, 0, 1), outcome: 'won' as const };
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
  const won = { ...startCombat('sidewinder', STARTER_SHIP, 0, 1), outcome: 'won' as const };
  // Игрок закрыл вкладку на два часа: пауза «стоит» с момента начала боя
  const s: GameState = { ...g, combat: { combat: won, role: 'pirate', pausedAt: NOW + MIN, pausedMs: 0 } };
  const r = combatAutoplay(s, NOW + MIN + 120 * MIN);
  assert.equal(r.state.flight!.arriveAt, arrive, 'офлайн-время не должно сдвигать полёт');
});

test('досчёт перед ходом фиксирует простой, но не растягивает его на всё ожидание', () => {
  const settings = { ...DEFAULT_SETTINGS, combatMode: 'manual' as const };
  const g = flying(settings);
  const arrive = g.flight!.arriveAt;
  const c = startCombat('python', STARTER_SHIP, 0, 1);
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

test('§38.1: решение принимается один раз, раундов нет', () => {
  // Прежняя модель с раундами снята решением пользователя (§38.1).
  // Встреча разрешается одним исходом, `combat` остаётся null.
  const g = flying();
  const s: GameState = {
    ...g,
    ship: { ...g.ship, laser: 'military' },
    encounter: { role: 'pirate', enemyId: 'sidewinder', detectedAt: NOW, resolveAt: NOW + MIN, outcome: 'attack' },
  };
  const r = advance(s, NOW + 2 * MIN);
  assert.equal(r.state.combat, null, 'боя как процесса нет');
  assert.equal(r.state.encounter, null, 'встреча разрешена');
  assert.ok(r.events.length > 0, 'исход зафиксирован в событиях');
});

/* ---------- Проигранный бой (§77: смерти нет, есть «повреждён») ---------- */

function deadState(settings: Settings): { s: GameState; from: number } {
  const g = flying(settings);
  const bought: GameState = { ...g, cargo: g.cargo.map((_, i) => (i === 0 ? 5 : 0)), holdSpace: 15 };
  const died = { ...startCombat('python', STARTER_SHIP, 5, 1), outcome: 'died' as const };
  return { s: { ...bought, combat: { combat: died, role: 'pirate', pausedAt: NOW, pausedMs: 0 } }, from: g.flight!.from };
}

test('§77 проигранный бой: груз и четверть денег потеряны, корабль и оборудование целы', () => {
  // Раньше здесь было две ветки по настройке `deathMode` («страховка» /
  // «без смерти») и отдельный тест на капсулу. §77 оставил одну цену
  // проигрыша — она и проверяется.
  const settings = { ...DEFAULT_SETTINGS };
  const g = flying(settings);
  const { s, from } = deadState(settings);
  const rich: GameState = { ...s, ship: { ...s.ship, ecm: true } };
  const r = combatAutoplay(rich, NOW, settings);
  assert.equal(r.state.flight, null, 'полёт окончен');
  assert.equal(r.state.system, from, 'вернулись на станцию вылета');
  assert.equal(r.state.cargo[0], 0, 'груз потерян');
  assert.equal(r.state.cash, Math.floor(s.cash * INSURANCE_CASH_KEPT), 'четверть денег потеряна');
  assert.equal(r.state.ship.ecm, true, 'оборудование осталось при корабле');
  assert.ok(r.events.some((e) => e.type === 'damaged'), 'событие «повреждён»');
  assert.ok(!r.events.some((e) => (e.type as string) === 'death'), 'смерти больше нет');
});

test('убийство полицейского делает беглецом', () => {
  const g = flying();
  const won = { ...startCombat('viper', STARTER_SHIP, 0, 1), outcome: 'won' as const };
  const s: GameState = { ...g, combat: { combat: won, role: 'police', pausedAt: NOW, pausedMs: 0 } };
  const r = combatAutoplay(s, NOW);
  assert.equal(legalLabel(r.state.legal), 'Беглец');
});

test('правовой статус уменьшается при прибытии', () => {
  /*
   * §80.1: деление при прибытии ОТМЕНЕНО для криминального статуса —
   * вместо него работает побег (доля от 12 планет). Поэтому 100 после
   * одного прыжка дают 92 (100 × 11/12), а не 50.
   *
   * Встречи отключаем: при криминальном статусе патруль становится
   * пиратством и может поднять статус сам.
   */
  const settings = { ...DEFAULT_SETTINGS, encounterRate: 0 };
  const g = { ...flying(settings), legal: 100 };
  const r = advance(g, NOW + 99 * MIN, settings);
  assert.equal(r.state.legal, 91, "100 × 11/12 = 91.67, округление вниз");
});

test('§80.1: у чистого пилота прибытие по-прежнему делит статус', () => {
  // Деление сохранилось только там, где побег не идёт: делить нуль нечего,
  // но если статус вдруг ненулевой и не криминальный — оригинал работает.
  const settings = { ...DEFAULT_SETTINGS, encounterRate: 0 };
  const g = { ...flying(settings), legal: 0 };
  const r = advance(g, NOW + 99 * MIN, settings);
  assert.equal(r.state.legal, 0);
});

/* ---------- Оборудование, ранги, миграция ---------- */

test('оборудование: нужен технологический уровень, деньги; повторно не купить', () => {
  const g = newGame(1);
  // Lave: tek = 4 → QQ25 = 7, ECM (номер 4) доступен, гипердвигатель (12) — нет
  assert.equal(currentSystem(g).techLevel, 4);
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
  assert.equal(g.version, SAVE_VERSION, 'миграция поднимает версию до текущей');
  assert.equal(g.kills, 0);
  assert.equal(g.ship.missiles, 3);
  assert.deepEqual(g.escapeRoute, [], '§80: маршрут побега пуст');
  assert.equal(g.escapeStatus, -1);
});

