/**
 * Регрессия на настройку «темп игры».
 *
 * Раньше длительность прыжка фиксировалась в абсолютном `arriveAt` в момент
 * старта, поэтому смена темпа влияла только на ещё не начатые полёты.
 * Теперь полёт хранит остаток в «базовых» миллисекундах (при ×1) и
 * пересчитывается в `advance`, так что темп действует и посреди полёта.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  advance,
  baseToReal,
  DEFAULT_SETTINGS,
  jumpDuration,
  newGame,
  startJump,
  deserialize,
  serialize,
  syncFlightToSpeed,
  systemsOf,
  type GameState,
  type Settings,
} from '../src/core/state.ts';
import { distance } from '../src/core/galaxy.ts';

const MIN = 60_000;
const NOW = 1_000_000;

const noEncounters = (speed: number): Settings => ({ ...DEFAULT_SETTINGS, speed, encounterRate: 0 });

function targetOf(g: GameState): number {
  const systems = systemsOf(g.galaxy);
  const t = systems.findIndex((s, i) => i !== g.system && distance(systems[g.system], s) <= g.fuel);
  assert.ok(t >= 0);
  return t;
}

function startFlying(speed: number): GameState {
  const g = newGame(1);
  return startJump(g, targetOf(g), NOW, noEncounters(speed)).state;
}

test('jumpDuration обратно пропорционален темпу', () => {
  assert.equal(jumpDuration(noEncounters(1)), 15 * MIN);
  assert.equal(jumpDuration(noEncounters(5)), 3 * MIN);
  assert.equal(jumpDuration(noEncounters(100)), 15 * MIN / 100);
  assert.equal(baseToReal(15 * MIN, noEncounters(10)), 1.5 * MIN);
});

test('повышение темпа посреди полёта ускоряет прибытие (было: не ускоряло)', () => {
  const flying = startFlying(1);
  assert.equal(flying.flight!.arriveAt, NOW + 15 * MIN);

  // Прошло 3 минуты при ×1, затем темп поднят до ×100
  const after = advance(flying, NOW + 3 * MIN, noEncounters(100)).state;
  // Осталось 12 базовых минут, при ×100 это 7.2 секунды — полёт уже завершён
  assert.equal(after.flight, null, 'при ×100 полёт должен моментально завершиться');
  assert.equal(after.system, flying.flight!.to);
});

test('повышение темпа с частичным прогрессом: остаток считается в базовых единицах', () => {
  const flying = startFlying(1);
  // 1 минута при ×10 = 10 базовых минут из 15
  const tenX = advance(flying, NOW + MIN, noEncounters(10)).state;
  assert.ok(tenX.flight, 'полёт продолжается');
  assert.equal(tenX.flight.remainingBaseMs, 5 * MIN, 'осталось 5 базовых минут');
  // остаток при ×10 — это 30 секунд реального времени
  assert.equal(tenX.flight.arriveAt - (NOW + MIN), 30_000);
});

test('понижение темпа посреди полёта замедляет прибытие', () => {
  const flying = startFlying(100);
  const half = flying.flight!.arriveAt - NOW;
  const mid = advance(flying, NOW + half / 2, noEncounters(100)).state;
  assert.ok(mid.flight);
  assert.equal(mid.flight.remainingBaseMs, 7.5 * MIN, 'половина базового времени пройдена');

  const switchAt = NOW + half / 2;
  const slowed = advance(mid, switchAt, noEncounters(1)).state;
  assert.ok(slowed.flight, 'при ×1 полёт ещё не завершён');
  // Осталось 7.5 базовых минут, при ×1 это ровно 7.5 реальных минут
  // (допускаем 1 мс на округление baseToReal)
  const left = slowed.flight.arriveAt - switchAt;
  assert.ok(Math.abs(left - 7.5 * MIN) <= 2, `осталось ${left} мс вместо ${7.5 * MIN}`);
});

test('темп не влияет на прошлое: прошедшая часть пути не пересчитывается', () => {
  const flying = startFlying(1);
  const mid = advance(flying, NOW + 6 * MIN, noEncounters(1)).state;
  assert.equal(mid.flight!.elapsedBaseMs, 6 * MIN);
  assert.equal(mid.flight!.remainingBaseMs, 9 * MIN);
  // Меняем темп — прошедшее остаётся 6 минут, а не пересчитывается
  const fast = advance(mid, NOW + 6 * MIN + 1000, noEncounters(50)).state;
  assert.ok(fast.flight!.elapsedBaseMs >= 6 * MIN);
  assert.ok(fast.flight!.elapsedBaseMs < 7 * MIN, 'прошедшее не должно прыгать вперёд');
});

test('при неизменном темпе досчёт не зависит от разбиения на вызовы', () => {
  const single = advance(startFlying(1), NOW + 5 * MIN, noEncounters(1)).state;
  let many = startFlying(1);
  for (let m = 1; m <= 5; m++) many = advance(many, NOW + m * MIN, noEncounters(1)).state;
  assert.equal(many.flight!.remainingBaseMs, single.flight!.remainingBaseMs);
  assert.equal(many.flight!.arriveAt, single.flight!.arriveAt);
});

test('syncFlightToSpeed идемпотентна при отсутствии прошедшего времени', () => {
  const flying = startFlying(1);
  const once = syncFlightToSpeed(flying.flight!, NOW, noEncounters(1));
  const twice = syncFlightToSpeed(once, NOW, noEncounters(1));
  assert.deepEqual(twice, once);
});

test('повторный advance с тем же моментом ничего не меняет при смене темпа', () => {
  const flying = startFlying(1);
  const once = advance(flying, NOW + MIN, noEncounters(20)).state;
  const twice = advance(once, NOW + MIN, noEncounters(20)).state;
  assert.deepEqual(twice.flight, once.flight);
});

test('старое сохранение с полётом мигрирует без NaN и сохраняет прибытие', () => {
  const g = newGame(1);
  const target = targetOf(g);
  // Формат до появления базовых миллисекунд: только абсолютный arriveAt
  const oldSave = JSON.stringify({
    ...g,
    version: 2,
    flight: {
      from: g.system,
      to: target,
      departAt: NOW,
      arriveAt: NOW + 15 * MIN,
      fuelUsed: 10,
      pending: [NOW + 5 * MIN],
    },
  });

  const restored = deserialize(oldSave);
  assert.equal(typeof restored.flight!.remainingBaseMs, 'number');
  assert.equal(restored.flight!.remainingBaseMs, 15 * MIN);
  assert.ok(Number.isFinite(restored.flight!.arriveAt), 'arriveAt не должен стать NaN');

  // Досчёт по старому сохранению ведёт себя как раньше: прибытие в тот же момент
  const after = advance(restored, NOW + 5 * MIN, noEncounters(1)).state;
  assert.ok(after.flight);
  assert.equal(after.flight.arriveAt, NOW + 15 * MIN);
});

test('сохранение обратимо в середине полёта при нестандартном темпе', () => {
  const fast = advance(startFlying(1), NOW + 2 * MIN, noEncounters(7)).state;
  assert.deepEqual(deserialize(serialize(fast)), fast);
});
