import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame,
  buy,
  sell,
  refuel,
  startJump,
  advance,
  serialize,
  deserialize,
  currentSystem,
  systemsOf,
  jumpDuration,
  DEFAULT_SETTINGS as BASE_SETTINGS,
  MAX_FUEL,
  START_SYSTEM_LAVE,
} from '../src/core/state.ts';
import { distance } from '../src/core/galaxy.ts';

/** Встречи отключены: в этом файле проверяется только торговля и полёт */
const DEFAULT_SETTINGS = { ...BASE_SETTINGS, encounterRate: 0 };

const FOOD = 0;
const GOLD = 13;
const GEMS = 15;
const NOW = 1_000_000;

test('старт: Lave, 100 CR, 7.0 св. года топлива, трюм 20 т', () => {
  const g = newGame(1);
  assert.equal(currentSystem(g).name, 'LAVE');
  assert.equal(g.system, START_SYSTEM_LAVE);
  assert.equal(g.cash, 1000);
  assert.equal(g.fuel, 70);
  assert.equal(g.holdSpace, 20);
});

test('покупка: ограничена количеством, деньгами и трюмом', () => {
  const g = newGame(1);
  const price = g.market[FOOD].price;
  const r = buy(g, FOOD, 1000);
  const expected = Math.min(g.market[FOOD].quantity, 20, Math.floor(1000 / price));
  assert.equal(r.amount, expected);
  assert.equal(r.state.cash, 1000 - expected * price);
  assert.equal(r.state.holdSpace, 20 - expected);
  assert.equal(r.state.cargo[FOOD], expected);
  assert.equal(r.state.market[FOOD].quantity, g.market[FOOD].quantity - expected);
  // исходное состояние не изменилось
  assert.equal(g.cash, 1000);
});

test('покупка и продажа: туда-обратно не меняет трюм, деньги возвращаются целиком', () => {
  const g = newGame(1);
  const bought = buy(g, FOOD, 3);
  const sold = sell(bought.state, FOOD, 3);
  assert.equal(sold.state.cash, g.cash);
  assert.equal(sold.state.holdSpace, g.holdSpace);
});

test('золото и камни не занимают места в трюме (кг и г)', () => {
  let g = newGame(1);
  g = { ...g, cash: 1_000_000, market: g.market.map((m, i) => (i === GOLD || i === GEMS ? { ...m, quantity: 10 } : m)) };
  const r1 = buy(g, GOLD, 5);
  assert.equal(r1.state.holdSpace, 20);
  const r2 = buy(r1.state, GEMS, 5);
  assert.equal(r2.state.holdSpace, 20);
});

test('нельзя продать больше, чем есть', () => {
  const g = newGame(1);
  assert.equal(sell(g, FOOD, 5).amount, 0);
});

test('заправка: не больше бака и не больше денег', () => {
  let g = { ...newGame(1), fuel: 30 };
  const r = refuel(g, 1000);
  assert.equal(r.amount, MAX_FUEL - 30);
  assert.equal(r.state.cash, 1000 - 40 * 2);
  g = { ...g, cash: 10 };
  assert.equal(refuel(g, 1000).amount, 5);
});

test('прыжок: топливо списывается, прибытие по таймеру, рынок обновляется', () => {
  const g = newGame(1);
  const systems = systemsOf(1);
  const target = systems.findIndex(
    (s, i) => i !== g.system && distance(systems[g.system], s) <= g.fuel,
  );
  assert.ok(target >= 0);
  const d = distance(systems[g.system], systems[target]);

  const started = startJump(g, target, NOW, DEFAULT_SETTINGS);
  assert.equal(started.error, undefined);
  assert.equal(started.state.fuel, g.fuel - d);
  assert.equal(started.state.flight?.arriveAt, NOW + DEFAULT_SETTINGS.baseJumpMs);

  // во время полёта торговать нельзя
  assert.equal(buy(started.state, FOOD, 1).amount, 0);
  assert.equal(startJump(started.state, target, NOW, DEFAULT_SETTINGS).error, 'in-flight');

  // рано: ничего не происходит
  const early = advance(started.state, NOW + 1);
  assert.equal(early.events.length, 0);
  assert.ok(early.state.flight);

  // вовремя: прибытие
  const done = advance(started.state, NOW + DEFAULT_SETTINGS.baseJumpMs);
  assert.equal(done.events.length, 1);
  assert.equal(done.events[0].type, 'arrived');
  assert.equal(done.state.system, target);
  assert.equal(done.state.flight, null);
});

test('досчёт: через сутки корабль уже на месте', () => {
  const g = newGame(1);
  const systems = systemsOf(1);
  const target = systems.findIndex((s, i) => i !== g.system && distance(systems[g.system], s) <= g.fuel);
  const started = startJump(g, target, NOW, DEFAULT_SETTINGS);
  const done = advance(started.state, NOW + 24 * 3600 * 1000);
  assert.equal(done.state.system, target);
});

test('ошибки прыжка: та же система, слишком далеко, неверная цель', () => {
  const g = newGame(1);
  assert.equal(startJump(g, g.system, NOW, DEFAULT_SETTINGS).error, 'same-system');
  assert.equal(startJump(g, 999, NOW, DEFAULT_SETTINGS).error, 'bad-target');
  const systems = systemsOf(1);
  const far = systems.findIndex((s) => distance(systems[g.system], s) > g.fuel);
  assert.ok(far >= 0);
  assert.equal(startJump(g, far, NOW, DEFAULT_SETTINGS).error, 'too-far');
});

test('темп: ×5 в пять раз быстрее', () => {
  assert.equal(jumpDuration({ ...DEFAULT_SETTINGS, speed: 5, baseJumpMs: 900_000 }), 180_000);
});

test('детерминизм: одинаковое зерно даёт одинаковый рынок после прибытия', () => {
  const run = () => {
    const g = newGame(42);
    const systems = systemsOf(1);
    const target = systems.findIndex((s, i) => i !== g.system && distance(systems[g.system], s) <= g.fuel);
    const s = startJump(g, target, NOW, DEFAULT_SETTINGS).state;
    return advance(s, NOW + DEFAULT_SETTINGS.baseJumpMs).state;
  };
  assert.deepEqual(run(), run());
});

test('сохранение: JSON туда-обратно без потерь', () => {
  const g = buy(newGame(7), FOOD, 4).state;
  assert.deepEqual(deserialize(serialize(g)), g);
});

test('сохранение: неверная версия отвергается', () => {
  assert.throws(() => deserialize(JSON.stringify({ ...newGame(1), version: 999 })));
});

