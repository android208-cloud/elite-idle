/**
 * §133.6: «СВЕРХНОВАЯ» — ЯДРО.
 *
 * Проверяется то, что можно проверить без экрана:
 *   - событие включается только по всем четырём условиям;
 *   - утечка течёт по игровым часам и не берёт дважды одно и то же время;
 *   - заправиться и торговать на станции события нельзя;
 *   - беженцы занимают трюм целиком;
 *   - уход прыжком сохраняет двигатель, взрыв — сжигает;
 *   - взрыв уничтожает станцию навсегда и снижает репутацию;
 *   - беженцы дают 100 г камней и +5 репутации;
 *   - старый сейв читается без полей события.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  advance,
  buy,
  DEFAULT_SETTINGS,
  deserialize,
  missionRepOf,
  newGame,
  nextGalaxyArrival,
  refuel,
  sell,
  serialize,
  startJump,
  systemsOf,
  type GameState,
} from '../src/core/state.ts';
import {
  deliverRefugees,
  galacticEscapeSupernova,
  newSystemsVisited,
  noteVisit,
  destroyStation,
  escapeSupernova,
  GEMS_INDEX,
  startSupernova,
  stationAlive,
  stationKey,
  stationLocked,
  supernovaArmed,
  supernovaOf,
  supernovaProgress,
  takeRefugees,
  tickSupernova,
  SUPERNOVA_HOURS,
  SUPERNOVA_LEAK_PER_HOUR,
  SUPERNOVA_REFUGEES_TONS,
  SUPERNOVA_REWARD_GEMS,
  SUPERNOVA_TRIGGER_JUMPS,
  SUPERNOVA_TRIGGER_KILLS,
} from '../src/core/supernova.ts';
import { holdCapacity, maxFuel } from '../src/core/ships.ts';
import { distance } from '../src/core/galaxy.ts';

/** Ближайшая система в пределах бака: прыжок в тесте должен быть возможен. */
function neighbour(state: GameState): number {
  const systems = systemsOf(state.galaxy);
  const here = systems[state.system];
  let best = -1;
  for (let i = 0; i < systems.length; i++) {
    if (i === state.system) continue;
    const d = distance(here, systems[i]);
    if (d > 0 && d <= state.fuel && (best < 0 || d < distance(here, systems[best]))) best = i;
  }
  return best;
}

const T0 = 1_000_000;
const calm = { ...DEFAULT_SETTINGS, encounterRate: 0 };
const HOUR = 3_600_000;

/**
 * Готовый «ветеран»: не первая галактика, прыжков больше 32, ранг «Опасный»,
 * галактический двигатель на борту — то есть все четыре условия.
 */
/** Ключи систем: `newSystemsVisited` считает длину списка без стартовой. */
const visited = (n: number): string[] =>
  Array.from({ length: n + 1 }, (_, i) => `2:${i}`);

function veteran(overrides: Partial<GameState> = {}): GameState {
  const base = newGame(7);
  return {
    ...base,
    galaxy: 2,
    system: 3,
    fuel: maxFuel(base.ship),
    kills: SUPERNOVA_TRIGGER_KILLS,
    ship: { ...base.ship, galacticHyperdrive: true },
    stats: { ...base.stats, jumps: 40 },
    visitedSystems: visited(SUPERNOVA_TRIGGER_JUMPS),
    ...overrides,
  };
}

test('§133.6: без любого из четырёх условий событие не включается', () => {
  assert.equal(supernovaArmed(veteran()), true);

  assert.equal(supernovaArmed(veteran({ galaxy: 1 })), false, 'первая галактика');
  assert.equal(
    supernovaArmed(veteran({ visitedSystems: visited(SUPERNOVA_TRIGGER_JUMPS - 1) })),
    false,
    'новых систем меньше 36 — ещё мало',
  );
  assert.equal(supernovaArmed(veteran({ kills: SUPERNOVA_TRIGGER_KILLS - 1 })), false, 'ранг ниже Опасного');
  const noDrive = veteran();
  assert.equal(
    supernovaArmed({ ...noDrive, ship: { ...noDrive.ship, galacticHyperdrive: false } }),
    false,
    'нет галактического двигателя',
  );
});

test('§133.10: считаются только прыжки в новые системы', () => {
  const shuttle = veteran({ visitedSystems: ['2:3', '2:4', '2:3', '2:4'] as string[] });
  assert.equal(newSystemsVisited(shuttle), 3, 'повторы не в счёт');
  assert.equal(supernovaArmed(shuttle), false, 'челнок между двумя станциями событие не включает');
});

test('§133.6: прогресс скрыт, пока не выполнены первые два условия', () => {
  const early = veteran({ galaxy: 1 });
  assert.equal(supernovaProgress(early).basicsMet, false);
  const late = veteran();
  assert.deepEqual(supernovaProgress(late), { basicsMet: true, rankMet: true, driveMet: true });
});

test('§133.6: событие включает прыжок с прибытием, а не кнопка', () => {
  const s = veteran();
  const started = startSupernova(s, T0, calm);
  assert.ok(supernovaOf(started.state));
  assert.equal(started.events.length, 1);
  // Второй раз то же событие не начинается.
  assert.equal(supernovaOf(startSupernova(started.state, T0 + 1000, calm).state)!.startedAt, T0);
});

test('§133.6: утечка — 2.0 св. г. за игровой час, и время не считается дважды', () => {
  const started = startSupernova(veteran(), T0, calm).state;
  const before = started.fuel;
  // Ровно один игровой час.
  const after = tickSupernova(started, T0 + HOUR, calm);
  assert.equal(after.state.fuel, before - SUPERNOVA_LEAK_PER_HOUR);
  // Повторный тик на том же моменте ничего не добавляет.
  const again = tickSupernova(after.state, T0 + HOUR, calm);
  assert.equal(again.state.fuel, after.state.fuel);
  // Половина часа — половина утечки.
  const half = tickSupernova(again.state, T0 + HOUR + HOUR / 2, calm);
  assert.equal(half.state.fuel, after.state.fuel - SUPERNOVA_LEAK_PER_HOUR / 2);
});

test('§133.6: топливо не уходит в минус, а MAYDAY повторяется', () => {
  const started = startSupernova({ ...veteran(), fuel: 5 }, T0, calm).state;
  const after = tickSupernova(started, T0 + HOUR, calm);
  assert.equal(after.state.fuel, 0);
  assert.ok(after.events.filter((e) => e.text.startsWith('MAYDAY')).length >= 3, 'каждые 20 игровых минут');
});

test('§133.6: на станции события нельзя ни заправиться, ни торговать', () => {
  const started = startSupernova(veteran(), T0, calm).state;
  assert.equal(stationLocked(started), true, 'станция закрыта');

  const parked = startJump(started, neighbour(started), T0, calm);
  assert.equal(parked.error, undefined);
  assert.equal(stationLocked(parked.state), false, 'улетели — станция больше не наша');

  // Заправка на закрытой станции — ноль.
  assert.equal(refuel(started, 10).amount, 0);
  // Покупка и продажа — тоже.
  assert.equal(buy(started, 0, 1).amount, 0);
  assert.equal(sell({ ...started, cargo: started.cargo.map((n, i) => (i === 0 ? 3 : n)) }, 0, 1).amount, 0);
});

test('§133.8: беженцев 250 тонн, берут сколько влезет', () => {
  const base = startSupernova(veteran(), T0, calm).state;
  const capacity = holdCapacity(base.ship);
  const first = takeRefugees(base, T0 + 1000);
  assert.equal(first.error, undefined);
  assert.equal(supernovaOf(first.state)!.taken, Math.min(SUPERNOVA_REFUGEES_TONS, capacity));
  assert.equal(first.state.holdSpace, 0, 'трюм занят полностью');
  // Места больше нет — второй раз не берут.
  assert.equal(takeRefugees(first.state, T0 + 2000).error, 'no-hold');
});

test('§133.8: груз больше не выбрасывается сам — его оставляет игрок', () => {
  const base = startSupernova(veteran(), T0, calm).state;
  const loaded: GameState = {
    ...base,
    cargo: base.cargo.map((n, i) => (i === 0 ? 4 : n)),
    holdSpace: base.holdSpace - 4,
  };
  const taken = takeRefugees(loaded, T0 + 1000);
  assert.equal(taken.error, undefined);
  assert.equal(taken.state.cargo[0], 4, 'груз остался в трюме');
  const capacity = holdCapacity(base.ship);
  assert.equal(supernovaOf(taken.state)!.taken, Math.min(SUPERNOVA_REFUGEES_TONS, capacity - 4), 'взяли только свободное место');
  // Свободное место кончилось, но трюм забит не только людьми — награды не будет.
  const jumped = startJump(taken.state, neighbour(taken.state), T0 + 2000, calm).state;
  const landed = deliverRefugees({ ...jumped, system: 11, flight: null }, T0 + 3000, calm);
  assert.equal(landed.state.cargo[GEMS_INDEX], 0, 'награды нет');
  assert.equal(missionRepOf(landed.state), 0);
});

test('§133.8: пустой трюм заполняется целиком — награда есть', () => {
  const base = startSupernova(veteran(), T0, calm).state;
  const capacity = holdCapacity(base.ship);
  const taken = takeRefugees(base, T0 + 1000).state;
  assert.equal(supernovaOf(taken)!.taken, Math.min(SUPERNOVA_REFUGEES_TONS, capacity));
  const jumped = startJump(taken, neighbour(taken), T0 + 2000, calm).state;
  const landed = deliverRefugees({ ...jumped, system: 11, flight: null }, T0 + 3000, calm);
  // Кобра: трюм 20 ≤ 250, значит полный трюм беженцев — награда.
  assert.equal(landed.state.cargo[GEMS_INDEX], SUPERNOVA_REWARD_GEMS);
});

test('§133.9: «все 200 взяты» — полный трюм, даже если он больше', () => {
  // Анаконда: трюм 253 т, беженцев 200 — добрать нечего, но награда есть.
  const base = startSupernova(
    veteran({ ship: { ...veteran().ship, model: 'anaconda' }, holdSpace: holdCapacity(veteran({ ship: { ...veteran().ship, model: 'anaconda' } }).ship) }),
    T0,
    calm,
  ).state;
  const taken = takeRefugees(base, T0 + 1000).state;
  assert.equal(supernovaOf(taken)!.taken, SUPERNOVA_REFUGEES_TONS);
  assert.ok(taken.holdSpace > 0, 'место в трюме ещё осталось');
  const jumped = startJump(taken, neighbour(taken), T0 + 2000, calm).state;
  const landed = deliverRefugees({ ...jumped, system: 11, flight: null }, T0 + 3000, calm);
  assert.equal(landed.state.cargo[GEMS_INDEX], SUPERNOVA_REWARD_GEMS, 'взяли всех — награда есть');
});

test('§133.6: уход прыжком сохраняет двигатель и гасит утечку', () => {
  const base = startSupernova(veteran(), T0, calm).state;
  const taken = takeRefugees(base, T0 + 1000).state;
  const jumped = startJump(taken, neighbour(taken), T0 + 2000, calm);
  assert.equal(jumped.error, undefined);
  assert.equal(supernovaOf(jumped.state)!.escaped, true, 'событие перешло в «вывезли»');
  assert.equal(jumped.state.ship.galacticHyperdrive, true, 'двигатель цел');
  assert.equal(stationAlive({ ...jumped.state, system: 3 }), false, 'станция гибнет в любом случае');
  assert.equal(jumped.state.supernovaDone, true, 'событие больше не повторится');
  // Утечка больше не идёт: топливо только то, что стоило прыжку.
  const later = tickSupernova(jumped.state, T0 + HOUR, calm);
  assert.equal(later.state.fuel, jumped.state.fuel);
});

test('§133.6: взрыв уничтожает станцию навсегда и сжигает двигатель', () => {
  const base = startSupernova(veteran(), T0, calm).state;
  const exploded = tickSupernova(base, T0 + HOUR * SUPERNOVA_HOURS, calm);
  assert.equal(exploded.exploded, true);

  const dead = destroyStation(exploded.state, T0 + HOUR * SUPERNOVA_HOURS);
  assert.equal(stationAlive(dead.state), false, 'станция погибла');
  assert.deepEqual(dead.state.destroyedStations, [stationKey(2, 3)]);
  assert.equal(supernovaOf(dead.state), null, 'событие кончилось');
  // Станция не возвращается, даже если вернуться в эту систему.
  assert.equal(stationAlive({ ...dead.state, system: 3 }), false);
  // В другой галактике на том же номере системы станция жива.
  assert.equal(stationAlive({ ...dead.state, galaxy: 3, system: 3 }), true);
});

test('§133.6: беженцы дают 100 г камней и +5 репутации', () => {
  const base = startSupernova(veteran(), T0, calm).state;
  const taken = takeRefugees(base, T0 + 1000).state;
  const jumped = startJump(taken, neighbour(taken), T0 + 2000, calm).state;
  const landed = deliverRefugees({ ...jumped, system: 11, flight: null }, T0 + 3000, calm);
  assert.equal(landed.state.cargo[GEMS_INDEX], SUPERNOVA_REWARD_GEMS);
  assert.equal(missionRepOf(landed.state), 5);
  assert.equal(landed.state.holdSpace, holdCapacity(landed.state.ship), 'трюм свободен');
  assert.equal(supernovaOf(landed.state), null);
  // Повторно награду не выдают.
  assert.equal(deliverRefugees(landed.state, T0 + 4000, calm).state.cargo[GEMS_INDEX], SUPERNOVA_REWARD_GEMS);
});

test('§133.6: уход без беженцев не даёт награды', () => {
  const base = startSupernova(veteran(), T0, calm).state;
  const left = escapeSupernova(base, T0 + 1000).state;
  assert.equal(supernovaOf(left), null);
  const landed = deliverRefugees({ ...left, system: 11 }, T0 + 2000, calm);
  assert.equal(landed.state.cargo[GEMS_INDEX], 0);
});

test('§133.6: «Сверхновая» включает advance и уносит в другую галактику', () => {
  const started = startSupernova(veteran(), T0, calm).state;
  const later = advance(started, T0 + HOUR * (SUPERNOVA_HOURS + 1), calm);
  assert.ok(later.events.some((e) => e.text.includes('Сверхновая')));
  assert.equal(later.state.galaxy, 3, 'унесло в следующую галактику');
  assert.equal(later.state.ship.galacticHyperdrive, false, 'двигатель сгорел');
  assert.equal(missionRepOf(later.state), -10, 'репутация −10');
  assert.equal(later.state.destroyedStations!.length, 1);
});

test('§133.10: галактический прыжок — выход без награды', () => {
  const base = startSupernova(veteran(), T0, calm).state;
  const taken = takeRefugees(base, T0 + 1000).state;
  const escaped = galacticEscapeSupernova(taken, T0 + 2000);
  assert.equal(supernovaOf(escaped.state), null, 'событие закрыто');
  assert.equal(stationAlive({ ...escaped.state, system: 3 }), false, 'станция погибла');
  const landed = deliverRefugees({ ...escaped.state, system: 11 }, T0 + 3000, calm);
  assert.equal(landed.state.cargo[GEMS_INDEX], 0, 'камней нет');
  assert.equal(missionRepOf(landed.state), 0, 'и репутации тоже');
});

test('§133.10: взрыв — станция гибнет, беженцы награды не приносят', () => {
  const base = startSupernova(veteran(), T0, calm).state;
  const taken = takeRefugees(base, T0 + 1000).state;
  const exploded = tickSupernova(taken, T0 + HOUR * SUPERNOVA_HOURS, calm);
  assert.equal(exploded.exploded, true);
  const dead = destroyStation(exploded.state, T0 + HOUR * SUPERNOVA_HOURS);
  assert.equal(supernovaOf(dead.state), null);
  assert.equal(stationAlive({ ...dead.state, system: 3 }), false);
  const landed = deliverRefugees({ ...dead.state, system: 11 }, T0 + HOUR * SUPERNOVA_HOURS, calm);
  assert.equal(landed.state.cargo[GEMS_INDEX], 0, 'после взрыва камней нет');
});

test('§133.10: событие больше не повторяется', () => {
  const base = startSupernova(veteran(), T0, calm).state;
  const left = escapeSupernova(base, T0 + 1000).state;
  assert.equal(left.supernovaDone, true);
  const again = startSupernova({ ...left, supernova: null }, T0 + HOUR * 24, calm);
  assert.equal(supernovaOf(again.state), null, 'второй раз не приходит');
  assert.equal(supernovaArmed({ ...left, supernova: null }), false, 'и условия не откроют его заново');
});

test('§133.10: новая система отмечается при прыжке и в новой галактике', () => {
  const s = newGame(11);
  const before = newSystemsVisited(s);
  assert.equal(before, 0, 'стартовая система не в счёт');
  const withVisit = noteVisit({ ...s, system: 4 });
  assert.equal(newSystemsVisited(withVisit), 1);
  // Повторный визит ничего не меняет.
  assert.equal(noteVisit(withVisit), withVisit);
});

test('§133.6: старый сейв без полей события читается', () => {
  const raw = JSON.parse(serialize(newGame(9)));
  delete raw.supernova;
  delete raw.destroyedStations;
  delete raw.supernovaEndedAt;
  raw.version = 5;
  const loaded = deserialize(JSON.stringify(raw));
  assert.equal(loaded.supernova, null);
  assert.deepEqual(loaded.destroyedStations, []);
  assert.equal(loaded.supernovaEndedAt, 0);
});

test('§133.6: поля события переживают сохранение', () => {
  const base = startSupernova(veteran(), T0, calm).state;
  const taken = takeRefugees(base, T0 + 1000).state;
  const loaded = deserialize(serialize(taken));
  assert.equal(supernovaOf(loaded)!.refugees, true);
  assert.equal(loaded.fuel, taken.fuel);
});

test('§133.6: переход в следующую галактику — по кругу и с новой доской', () => {
  const s = newGame(3);
  assert.ok(systemsOf(2).length > 0);
  assert.equal(nextGalaxyArrival(s).galaxy, 2);
  assert.equal(nextGalaxyArrival({ ...s, galaxy: 8 }).galaxy, 1, 'после восьмой снова первая');
});
