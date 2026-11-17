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

/**
 * База полёта в миллисекундах при ×1.
 *
 * Время прыжка теперь зависит от расстояния (§70), поэтому «15 минут»
 * в тестах больше не константа: ожидание берём из той же функции, а
 * проверяем то, ради чего тесты и написаны, — влияние темпа.
 */
function baseMs(g: GameState): number {
  const systems = systemsOf(g.galaxy);
  const d = distance(systems[g.flight!.from], systems[g.flight!.to]);
  return jumpDuration(noEncounters(1), d);
}

test('jumpDuration обратно пропорционален темпу', () => {
  // §77: опорная точка — полный бак (70 св. лет) за 10 секунд на ×200.
  const fullTank = jumpDuration(noEncounters(1), 70);
  assert.equal(fullTank, 2000 * 1000, 'на ×1 полный бак — 2000 секунд');
  const base = jumpDuration(noEncounters(1), 7);
  assert.equal(jumpDuration(noEncounters(5), 7), Math.round(base / 5));
  assert.equal(jumpDuration(noEncounters(100), 7), Math.round(base / 100));
  assert.equal(baseToReal(15 * MIN, noEncounters(10)), 1.5 * MIN);
});

test('полный бак на ×200 занимает десять секунд', () => {
  // Главное число §77: полный бак на быстром темпе — десять секунд.
  assert.equal(jumpDuration(noEncounters(200), 70), 10 * 1000);
});

test('повышение темпа посреди полёта ускоряет прибытие (было: не ускоряло)', () => {
  const flying = startFlying(1);
  const base = baseMs(flying);
  assert.equal(flying.flight!.arriveAt, NOW + base);

  // Прошло 3 минуты при ×1, затем темп поднят до ×100
  const after = advance(flying, NOW + 3 * MIN, noEncounters(100)).state;
  // Осталось base − 3 минуты базовых, при ×100 это единицы секунд
  assert.equal(after.flight, null, 'при ×100 полёт должен моментально завершиться');
  assert.equal(after.system, flying.flight!.to);
});

test('повышение темпа с частичным прогрессом: остаток считается в базовых единицах', () => {
  const flying = startFlying(1);
  const base = baseMs(flying);
  // 1 минута при ×10 = 10 базовых минут
  const tenX = advance(flying, NOW + MIN, noEncounters(10)).state;
  assert.ok(tenX.flight, 'полёт продолжается');
  assert.equal(tenX.flight.remainingBaseMs, base - 10 * MIN, 'осталось base − 10 базовых минут');
  // Остаток при ×10 переводится в реальное время делением на 10.
  assert.equal(tenX.flight.arriveAt - (NOW + MIN), baseToReal(base - 10 * MIN, noEncounters(10)));
});

test('понижение темпа посреди полёта замедляет прибытие', () => {
  const flying = startFlying(100);
  const half = flying.flight!.arriveAt - NOW;
  const mid = advance(flying, NOW + half / 2, noEncounters(100)).state;
  const base = baseMs(flying);
  assert.ok(mid.flight);
  // Допуск шире пары миллисекунд: реальное время переводится в базовое
  // делением на темп, и при ×100 округление даёт доли процента разброса.
  assert.ok(
    Math.abs(mid.flight.remainingBaseMs - base / 2) <= base * 0.001 + 2,
    `половина базового времени пройдена: ${mid.flight.remainingBaseMs} из ${base}`,
  );

  const switchAt = NOW + half / 2;
  const slowed = advance(mid, switchAt, noEncounters(1)).state;
  assert.ok(slowed.flight, 'при ×1 полёт ещё не завершён');
  // Осталась половина базового времени, при ×1 это ровно столько реальных
  // минут. Допуск 0.1% — на округление baseToReal и обратный перевод при ×100.
  const left = slowed.flight.arriveAt - switchAt;
  assert.ok(
    Math.abs(left - base / 2) <= base * 0.001 + 2,
    `осталось ${left} мс вместо ${base / 2}`,
  );
});

test('темп не влияет на прошлое: прошедшая часть пути не пересчитывается', () => {
  const flying = startFlying(1);
  const base = baseMs(flying);
  const mid = advance(flying, NOW + 6 * MIN, noEncounters(1)).state;
  assert.equal(mid.flight!.elapsedBaseMs, 6 * MIN);
  assert.equal(mid.flight!.remainingBaseMs, base - 6 * MIN);
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
