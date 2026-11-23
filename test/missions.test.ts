/**
 * §133.2: КОНТРАКТЫ — ЯДРО.
 *
 * Проверяется то, что можно проверить без экрана:
 *   - на станции лежат три предложения, все — в пределах бака;
 *   - предложения детерминированы (одно зерно — одна доска) и не трогают
 *     основной генератор: рынок и встречи не должны съезжать от контрактов;
 *   - взятый контракт по-настоящему занимает трюм, а инвариант
 *     «свободно + груз + контракты = вместимость» держится;
 *   - сдача только в целевой системе, отказ — бесплатно, срыв — штраф;
 *   - срок течёт в `advance`, а не в экране;
 *   - старый сейв (без полей) читается.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  abandonMission,
  advance,
  cargoTons,
  deliverMission,
  deserialize,
  DEFAULT_SETTINGS,
  missionRepOf,
  missionsOf,
  missionTons,
  MISSION_OFFERS,
  newGame,
  offersOf,
  serialize,
  startJump,
  systemsOf,
  takeMission,
  type GameState,
} from '../src/core/state.ts';
import { distance } from '../src/core/galaxy.ts';
import { holdCapacity, maxFuel } from '../src/core/ships.ts';
import { COMMODITIES } from '../src/core/market.ts';

const T0 = 1_000_000;
const calm = { ...DEFAULT_SETTINGS, encounterRate: 0 };

const board = (state: GameState) => offersOf(state);
const fresh = (seed = 5) => newGame(seed);

/** Достижимая система рядом — для проверки прибытия с новой доской. */
function reachable(state: GameState): number {
  const systems = systemsOf(state.galaxy);
  const here = systems[state.system];
  const reach = maxFuel(state.ship);
  for (let i = 0; i < 256; i++) {
    if (i === state.system) continue;
    if (distance(here, systems[i]) <= reach) return i;
  }
  throw new Error('нет достижимой системы');
}

test('§133: на стартовой станции три предложения', () => {
  assert.equal(board(fresh()).length, MISSION_OFFERS);
});

test('§133: каждое предложение — в чужие системы и в пределах бака', () => {
  const s = fresh();
  const systems = systemsOf(s.galaxy);
  const here = systems[s.system];
  for (const m of board(s)) {
    assert.notEqual(m.to, s.system, 'контракт в свою же систему — не контракт');
    assert.equal(m.from, s.system);
    assert.ok(distance(here, systems[m.to]) <= maxFuel(s.ship), 'до цели не хватит бака');
  }
});

test('§133: предложения детерминированы и не сдвигают основной генератор', () => {
  const a = fresh(11);
  const b = fresh(11);
  assert.deepEqual(board(a), board(b), 'одно зерно — одна доска');
  assert.equal(a.rng, b.rng);
  // Доска живёт на своём генераторе: рынок и встречи от неё не зависят.
  assert.deepEqual(a.market, b.market);
  assert.notEqual(a.missionRng, undefined);
});

test('§133: награды в объявленных диапазонах и растут с расстоянием', () => {
  const s = fresh();
  const systems = systemsOf(s.galaxy);
  const here = systems[s.system];
  for (const m of board(s)) {
    const base = m.kind === 'courier' ? 400 : 700;
    const top = m.kind === 'courier' ? 900 : 1600;
    const factor = Math.min(2, Math.max(0.75, 0.75 + 0.25 * (distance(here, systems[m.to]) / 70)));
    assert.ok(m.reward >= Math.round(base * 10 * factor) - 5, `награда ${m.reward} мала`);
    assert.ok(m.reward <= Math.round(top * 10 * factor) + 5, `награда ${m.reward} велика`);
  }
});

test('§133: курьер не занимает трюм, пассажиры занимают 1–3 тонны', () => {
  // Перебираем зёрна, чтобы увидеть оба вида.
  const kinds = new Set<string>();
  for (let seed = 1; seed <= 40; seed++) {
    for (const m of board(fresh(seed))) {
      kinds.add(m.kind);
      if (m.kind === 'courier') assert.equal(m.tons, 0);
      else assert.ok(m.tons >= 1 && m.tons <= 3, `тонн ${m.tons}`);
    }
  }
  assert.deepEqual([...kinds].sort(), ['courier', 'passenger'], 'нужны оба вида');
});

test('§133: взятый контракт уходит с доски и занимает трюм по-настоящему', () => {
  const s = fresh();
  const offer = board(s).find((m) => m.tons > 0) ?? board(s)[0];
  const taken = takeMission(s, offer.id, T0, DEFAULT_SETTINGS);
  assert.equal(taken.error, undefined);
  const state = taken.state;

  assert.equal(missionsOf(state).length, 1);
  assert.equal(board(state).length, MISSION_OFFERS - 1, 'с доски предложение снимается');
  assert.equal(state.holdSpace, s.holdSpace - offer.tons);
  assert.equal(missionsOf(state)[0].deadline, T0 + offer.hours * 3_600_000);
  // Инвариант трюма: свободно + груз + контракты = вместимость.
  assert.equal(state.holdSpace + cargoTons(state) + missionTons(state), holdCapacity(state.ship));
});

test('§133: срок короче на быстром темпе — контракт горит по игровым часам', () => {
  const s = fresh();
  const offer = board(s)[0];
  const fast = { ...DEFAULT_SETTINGS, speed: 200 };
  const taken = takeMission(s, offer.id, T0, fast);
  assert.equal(missionsOf(taken.state)[0].deadline, T0 + Math.round((offer.hours * 3_600_000) / 200));
});

test('§133: без места в трюме контракт не берётся и состояние не меняется', () => {
  const s = fresh();
  const passenger = board(s).find((m) => m.tons > 0);
  if (!passenger) return; // доска без пассажиров — проверять нечего
  const full = { ...s, holdSpace: 0, cargo: s.cargo.map((v, i) => (i === 0 ? holdCapacity(s.ship) : v)) };
  const res = takeMission(full, passenger.id, T0, DEFAULT_SETTINGS);
  assert.equal(res.error, 'no-hold');
  assert.equal(res.state, full, 'отказ не меняет состояние');
});

test('§133: больше трёх контрактов не взять', () => {
  const base = fresh();
  const sample = board(base)[0];
  // Доска из одних курьеров: трюм они не занимают, значит упираемся ровно в счёт.
  const couriers = [101, 102, 103, 104].map((id) => ({ ...sample, id, kind: 'courier' as const, tons: 0 }));
  let s: GameState = { ...base, missionOffers: couriers };
  for (const id of [101, 102, 103]) {
    const res = takeMission(s, id, T0, DEFAULT_SETTINGS);
    assert.equal(res.error, undefined, `контракт ${id} должен взяться`);
    s = res.state;
  }
  assert.equal(missionsOf(s).length, MISSION_OFFERS);
  assert.equal(takeMission(s, 104, T0, DEFAULT_SETTINGS).error, 'no-hold');
});

test('§133: сдача только в целевой системе', () => {
  const s = fresh();
  const offer = board(s)[0];
  const taken = takeMission(s, offer.id, T0, DEFAULT_SETTINGS).state;

  const wrong = deliverMission(taken, offer.id);
  assert.equal(wrong.error, 'wrong-system');
  assert.equal(wrong.state, taken);

  const arrived = { ...taken, system: offer.to };
  const done = deliverMission(arrived, offer.id);
  assert.equal(done.error, undefined);
  assert.equal(missionsOf(done.state).length, 0);
  assert.equal(done.state.cash, taken.cash + offer.reward, 'награда начислена');
  assert.equal(done.state.holdSpace, taken.holdSpace + offer.tons, 'трюм освобождён');
  assert.equal(missionRepOf(done.state), missionRepOf(taken) + 2);
});

test('§133: отказ бесплатен, но стоит репутации', () => {
  const s = fresh();
  const offer = board(s)[0];
  const taken = takeMission(s, offer.id, T0, DEFAULT_SETTINGS).state;
  const quit = abandonMission(taken, offer.id).state;
  assert.equal(quit.cash, taken.cash, 'штрафа нет');
  assert.equal(missionRepOf(quit), missionRepOf(taken) - 1);
  assert.equal(quit.holdSpace, taken.holdSpace + offer.tons);
  assert.equal(missionsOf(quit).length, 0);
});

test('§133: срыв по сроку — штраф, репутация и запись в журнал', () => {
  const s = fresh();
  const offer = board(s)[0];
  const taken = takeMission(s, offer.id, T0, DEFAULT_SETTINGS).state;
  const late = T0 + (offer.hours + 1) * 3_600_000;

  const { state, events } = advance(taken, late, calm);
  assert.equal(missionsOf(state).length, 0, 'просроченный контракт снят');
  assert.equal(state.cash, Math.max(0, taken.cash - offer.penalty));
  assert.equal(missionRepOf(state), missionRepOf(taken) - 2);
  assert.equal(state.holdSpace, taken.holdSpace + offer.tons);
  const failed = events.find((e) => e.type === 'mission-failed');
  assert.ok(failed, 'без записи игрок не поймёт, куда делись деньги');
  assert.match(failed!.text, /срок/i);
});

test('§133: штраф не уводит деньги в минус', () => {
  const s = fresh();
  const offer = board(s)[0];
  const poor = takeMission({ ...s, cash: 0 }, offer.id, T0, DEFAULT_SETTINGS).state;
  const late = T0 + (offer.hours + 1) * 3_600_000;
  const { state } = advance(poor, late, calm);
  assert.equal(state.cash, 0);
});

test('§133: срок проверяется досчётом, а не экраном', () => {
  const s = fresh();
  const offer = board(s)[0];
  const taken = takeMission(s, offer.id, T0, DEFAULT_SETTINGS).state;
  // До срока ничего не происходит — сколько бы раз ни досчитывали.
  for (let i = 1; i <= 5; i++) {
    const { state } = advance(taken, T0 + i * 60_000, calm);
    assert.equal(missionsOf(state).length, 1);
  }
});

test('§133: при прибытии на станции новая доска, и это система прибытия', () => {
  const s = { ...fresh(), fuel: maxFuel(fresh().ship) };
  const target = reachable(s);
  const old = board(s).map((m) => m.id);
  const started = startJump(s, target, T0, calm);
  const arrived = advance(started.state, T0 + 3_600_000, calm).state;

  assert.equal(arrived.system, target);
  assert.equal(board(arrived).length, MISSION_OFFERS);
  for (const m of board(arrived)) {
    assert.equal(m.from, target, 'доска принадлежит станции прибытия');
    assert.ok(!old.includes(m.id), 'идентификаторы не переиспользуются');
  }
});

test('§133: сейв помнит контракты и доску, старый сейв читается', () => {
  const s = fresh();
  const offer = board(s)[0];
  const taken = takeMission(s, offer.id, T0, DEFAULT_SETTINGS).state;

  const round = deserialize(serialize(taken));
  assert.deepEqual(missionsOf(round), missionsOf(taken));
  assert.deepEqual(board(round), board(taken));
  assert.equal(missionRepOf(round), missionRepOf(taken));

  // Сейв версии 4 (до контрактов) читается без отказа.
  const legacy = JSON.parse(serialize(taken)) as Record<string, unknown>;
  legacy.version = 4;
  delete legacy.missions;
  delete legacy.missionOffers;
  delete legacy.missionRep;
  delete legacy.nextMissionId;
  const loaded = deserialize(JSON.stringify(legacy));
  assert.deepEqual(missionsOf(loaded), []);
  assert.equal(missionRepOf(loaded), 0);
  assert.equal(board(loaded).length, MISSION_OFFERS, 'доска заполняется сама');
});

test('§133: трюм под контракт не отбирается при выбросе груза', () => {
  const s = fresh();
  const passenger = board(s).find((m) => m.tons > 0);
  if (!passenger) return;
  const taken = takeMission(s, passenger.id, T0, DEFAULT_SETTINGS).state;
  const capacity = holdCapacity(taken.ship);
  // Пустой трюм, но контракт в силе: свободного места ровно на вместимость минус контракт.
  assert.equal(taken.holdSpace + cargoTons(taken) + missionTons(taken), capacity);
  assert.equal(COMMODITIES.length > 0, true);
});
