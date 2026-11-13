/**
 * Инварианты ядра, проверяемые на длинных случайных прогонах.
 *
 * В отличие от остальных тестов эти не сверяют конкретные числа, а проверяют
 * свойства, которые обязаны выполняться всегда: деньги не уходят в минус,
 * трюм и топливо не «протекают», время не идёт назад, состояние не зависит от
 * того, разбит ли досчёт на много вызовов `advance` или на один.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  advance,
  buy,
  buyEquipment,
  cargoTons,
  combatAction,
  combatAutoplay,
  currentSystem,
  DEFAULT_SETTINGS,
  deserialize,
  MAX_FUEL,
  newGame,
  refuel,
  sell,
  serialize,
  startJump,
  systemsOf,
  type GameState,
  type Settings,
} from '../src/core/state.ts';
import { distance } from '../src/core/galaxy.ts';
import { COMMODITIES } from '../src/core/market.ts';
import { holdCapacity } from '../src/core/ships.ts';

const MIN = 60_000;

/** Проверка базовых инвариантов состояния. Возвращает текст первой проблемы. */
function checkState(s: GameState, where: string): void {
  const fail = (msg: string): never => {
    assert.fail(`${where}: ${msg}\n${JSON.stringify(s)}`);
  };
  if (!Number.isFinite(s.cash) || s.cash < 0) fail(`деньги вне диапазона: ${s.cash}`);
  if (!Number.isInteger(s.cash)) fail(`деньги не целые: ${s.cash}`);
  if (!Number.isFinite(s.fuel) || s.fuel < 0 || s.fuel > MAX_FUEL) fail(`топливо вне диапазона: ${s.fuel}`);
  if (s.cargo.length !== COMMODITIES.length) fail(`в трюме ${s.cargo.length} позиций вместо ${COMMODITIES.length}`);
  for (let i = 0; i < s.cargo.length; i++) {
    if (!Number.isInteger(s.cargo[i]) || s.cargo[i] < 0) fail(`груз ${i} некорректен: ${s.cargo[i]}`);
  }
  const capacity = holdCapacity(s.ship);
  if (!Number.isInteger(s.holdSpace) || s.holdSpace < 0 || s.holdSpace > capacity) {
    fail(`свободное место вне диапазона 0..${capacity}: ${s.holdSpace}`);
  }
  // Свободное место и фактический груз должны согласовываться
  if (s.holdSpace + cargoTons(s) !== capacity) {
    fail(`трюм рассинхронизирован: свободно ${s.holdSpace} + груз ${cargoTons(s)} != ${capacity}`);
  }
  if (!Number.isInteger(s.kills) || s.kills < 0) fail(`счётчик убийств некорректен: ${s.kills}`);
  if (!Number.isInteger(s.legal) || s.legal < 0 || s.legal > 255) fail(`правовой статус вне 0..255: ${s.legal}`);
  if (s.system < 0 || s.system >= 256) fail(`система вне диапазона: ${s.system}`);
  if (s.galaxy < 1 || s.galaxy > 8) fail(`галактика вне диапазона: ${s.galaxy}`);
  if (s.market.length !== COMMODITIES.length) fail('рынок другого размера');
  for (const m of s.market) {
    if (!Number.isInteger(m.price) || m.price < 0) fail(`цена рынка некорректна: ${m.price}`);
    if (!Number.isInteger(m.quantity) || m.quantity < 0) fail(`количество на рынке некорректно: ${m.quantity}`);
  }
  if (s.combat && !s.flight) fail('бой без полёта');
  if (s.combat && s.encounter) fail('бой и встреча одновременно');
  if (s.flight) {
    if (s.flight.arriveAt < s.flight.departAt) fail('прибытие раньше вылета');
    if (s.flight.from !== s.system) fail(`система вылета ${s.flight.from} != текущая ${s.system}`);
    if (s.flight.pending.some((t) => !Number.isFinite(t))) fail('встреча в несуществующее время');
    if (s.flight.fuelUsed !== distance(systemsOf(s.galaxy)[s.flight.from], systemsOf(s.galaxy)[s.flight.to])) {
      fail('израсходовано не то количество топлива');
    }
  }
  if (!Number.isFinite(s.rng)) fail(`состояние ГПСЧ испорчено: ${s.rng}`);
}

/** Случайный, но детерминированный набор действий над состоянием. */
function fuzzSession(seed: number, steps: number, settings: Settings): GameState {
  let rng = seed * 2654435761;
  const rand = (): number => {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    return rng / 4294967296;
  };
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];

  let s = newGame(seed);
  let now = 1_000_000;
  checkState(s, `seed ${seed}: старт`);

  for (let step = 0; step < steps; step++) {
    const action = pick(['wait', 'wait', 'trade', 'equip', 'refuel', 'jump', 'advance-only'] as const);
    if (s.combat) {
      s = rand() < 0.5 ? combatAction(s, 'laser', now, settings).state : combatAutoplay(s, now, settings).state;
    } else if (action === 'trade') {
      const i = Math.floor(rand() * COMMODITIES.length);
      s = rand() < 0.5 ? buy(s, i, 1 + Math.floor(rand() * 20)).state : sell(s, i, 1 + Math.floor(rand() * 20)).state;
    } else if (action === 'equip') {
      s = buyEquipment(s, pick(['missile', 'cargoBay', 'ecm', 'pulse', 'beam', 'scoops', 'pod'] as const)).state;
    } else if (action === 'refuel') {
      s = refuel(s, 1 + Math.floor(rand() * 80)).state;
    } else if (action === 'jump') {
      const systems = systemsOf(s.galaxy);
      const reachable: number[] = [];
      systems.forEach((sys, i) => {
        if (i !== s.system && distance(systems[s.system], sys) <= s.fuel) reachable.push(i);
      });
      if (reachable.length > 0) s = startJump(s, pick(reachable), now, settings).state;
    }
    now += Math.floor(rand() * 40 * MIN);
    s = advance(s, now, settings).state;
    checkState(s, `seed ${seed}, шаг ${step}, действие ${action}`);
  }
  return s;
}

test('инварианты держатся на длинных случайных прогонах (встречи выключены)', () => {
  const settings: Settings = { ...DEFAULT_SETTINGS, encounterRate: 0 };
  for (let seed = 1; seed <= 12; seed++) fuzzSession(seed, 60, settings);
});

test('инварианты держатся на длинных случайных прогонах (встречи частые, автобой)', () => {
  const settings: Settings = { ...DEFAULT_SETTINGS, encounterRate: 3, combatMode: 'auto' };
  for (let seed = 1; seed <= 12; seed++) fuzzSession(seed, 60, settings);
});

test('инварианты держатся в ручном бою, если игрок надолго уходит', () => {
  const settings: Settings = { ...DEFAULT_SETTINGS, encounterRate: 3, combatMode: 'manual' };
  for (let seed = 1; seed <= 8; seed++) fuzzSession(seed, 30, settings);
});

test('досчёт не зависит от того, разбит он на много вызовов или сделан одним', () => {
  const settings: Settings = { ...DEFAULT_SETTINGS, encounterRate: 1 };
  for (let seed = 1; seed <= 20; seed++) {
    const g = newGame(seed);
    const systems = systemsOf(1);
    const target = systems.findIndex((s, i) => i !== g.system && distance(systems[g.system], s) <= g.fuel);
    const start = startJump(g, target, 0, settings).state;

    const single = advance(start, 60 * MIN, settings).state;
    let many = start;
    for (let t = MIN; t <= 60 * MIN; t += MIN) many = advance(many, t, settings).state;
    assert.deepEqual(many, single, `seed ${seed}: результат зависит от разбиения досчёта`);
  }
});

test('повторный advance с тем же моментом ничего не меняет', () => {
  const settings: Settings = { ...DEFAULT_SETTINGS, encounterRate: 2 };
  for (let seed = 1; seed <= 20; seed++) {
    const g = newGame(seed);
    const systems = systemsOf(1);
    const target = systems.findIndex((s, i) => i !== g.system && distance(systems[g.system], s) <= g.fuel);
    const start = startJump(g, target, 0, settings).state;
    const once = advance(start, 20 * MIN, settings);
    const twice = advance(once.state, 20 * MIN, settings);
    assert.equal(twice.events.length, 0, `seed ${seed}: повторный досчёт выдаёт события`);
    assert.deepEqual(twice.state, once.state, `seed ${seed}: повторный досчёт меняет состояние`);
  }
});

test('сохранение обратимо в любой момент случайного прогона', () => {
  const settings: Settings = { ...DEFAULT_SETTINGS, encounterRate: 2 };
  for (let seed = 1; seed <= 10; seed++) {
    const s = fuzzSession(seed, 40, settings);
    assert.deepEqual(deserialize(serialize(s)), s, `seed ${seed}: сохранение необратимо`);
  }
});

test('ручной бой не откладывает прибытие на всё время отсутствия игрока', () => {
  const settings: Settings = { ...DEFAULT_SETTINGS, encounterRate: 3, combatMode: 'manual' };
  const g = newGame(5);
  const systems = systemsOf(1);
  const target = systems.findIndex((s, i) => i !== g.system && distance(systems[g.system], s) <= g.fuel);

  let s = startJump(g, target, 0, settings).state;
  const planned = s.flight!.arriveAt;

  // Игрок ждёт атаки
  let t = 0;
  for (let i = 0; i < 5000 && !s.combat; i++) {
    t += 1000;
    s = advance(s, t, settings).state;
  }
  assert.ok(s.combat, 'бой должен был начаться');

  // …и возвращается только через 3 часа
  const back = t + 3 * 60 * MIN;
  let rounds = 0;
  while (s.combat && rounds < 200) {
    s = combatAction(s, 'laser', back, settings).state;
    rounds++;
  }

  const shifted = s.flight ? s.flight.arriveAt - planned : 0;
  assert.ok(
    shifted <= rounds * 10_000 + 1000,
    `прибытие сдвинулось на ${(shifted / MIN).toFixed(1)} мин при ${rounds} раундах боя`,
  );
});

test('текущая система всегда существует в текущей галактике', () => {
  for (let seed = 1; seed <= 8; seed++) {
    let s = newGame(seed);
    for (let step = 0; step < 20; step++) {
      const systems = systemsOf(s.galaxy);
      assert.ok(systemInRange(systemIndex(s), systems.length), 'индекс системы вне галактики');
      assert.equal(currentSystem(s).index, s.system);
      s = advance(s, step * 10 * MIN, DEFAULT_SETTINGS).state;
    }
  }
});

const systemIndex = (s: GameState): number => s.system;
const systemInRange = (index: number, size: number): boolean => index >= 0 && index < size;
