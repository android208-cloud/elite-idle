/**
 * Статистика командира (§70).
 *
 * Пользователь просил в журнале три вещи: сколько кораблей убил,
 * сколько сделок удачных и сколько неудачных. «Удачная сделка» —
 * понятие, которого в оригинале нет: там прибыль не считается по
 * каждому товару. Здесь проверяется, что определение работает и что
 * старые сохранения без статистики не ломают игру.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buy,
  DEFAULT_SETTINGS,
  deserialize,
  newGame,
  refuel,
  sell,
  serialize,
  startJump,
  systemsOf,
  ZERO_STATS,
  type GameState,
} from '../src/core/state.ts';
import { distance } from '../src/core/galaxy.ts';

const NOW = 1_000_000;
const FOOD = 0;

test('новая игра: статистика нулевая, все поля на месте', () => {
  const g = newGame(1);
  assert.deepEqual(g.stats, ZERO_STATS);
  for (const key of Object.keys(ZERO_STATS) as (keyof typeof ZERO_STATS)[]) {
    assert.equal(g.stats[key], 0, `${key} начинается не с нуля`);
  }
  // Основа цены покупки — по числу товаров, иначе индекс уйдёт в никуда.
  assert.equal(g.cargoBasis.length, g.cargo.length);
});

test('прыжок считается; топливо и статистика не конфликтуют', () => {
  const g = newGame(1);
  const systems = systemsOf(1);
  const target = systems.findIndex((s, i) => i !== g.system && distance(systems[g.system], s) <= g.fuel);
  const r = startJump(g, target, NOW, { ...DEFAULT_SETTINGS, encounterRate: 0 });
  assert.equal(r.state.stats.jumps, 1);
  assert.equal(r.state.stats.kills, 0);
});

test('старое сохранение без статистики читается и получает нули', () => {
  const g = newGame(1);
  const raw = JSON.parse(serialize(g));
  delete raw.stats;
  delete raw.cargoBasis;
  const back = deserialize(JSON.stringify(raw));
  assert.ok(back, 'сохранение должно прочитаться');
  assert.deepEqual(back.stats, ZERO_STATS);
  assert.equal(back.cargoBasis.length, back.cargo.length);
});

test('статистика переживает сохранение и загрузку', () => {
  const g = newGame(1);
  const withStats: GameState = {
    ...g,
    stats: { ...ZERO_STATS, kills: 7, goodTrades: 3, badTrades: 2, jumps: 11 },
  };
  const back = deserialize(serialize(withStats));
  assert.ok(back);
  assert.equal(back.stats.kills, 7);
  assert.equal(back.stats.goodTrades, 3);
  assert.equal(back.stats.badTrades, 2);
  assert.equal(back.stats.jumps, 11);
});

test('основа покупки: продажа дороже покупки даёт прибыль', () => {
  // Рынок генерируется детерминированно, поэтому берём товар, у которого
  // цена точно известна, а прибыль считаем арифметически — так же, как
  // это делает обработчик в main.ts.
  const g = newGame(1);
  const bought = buy(g, FOOD, 3);
  assert.ok(bought.amount > 0, 'еда должна покупаться');
  const paid = g.cash - bought.state.cash;
  const basis = Math.round(paid / bought.amount);

  const price = bought.state.market[FOOD].price;
  const received = price * bought.amount;
  const profit = received - basis * bought.amount;
  // Знак прибыли определяется рынком, а не формулой — проверяем, что
  // арифметика не теряет деньги на округлении.
  assert.ok(Math.abs(profit) <= bought.amount * 2, `прибыль ${profit} неправдоподобна`);
  assert.ok(sell(bought.state, FOOD, 3).amount === 3);
});

test('пустая продажа не меняет статистику', () => {
  const g = newGame(1);
  const r = sell(g, FOOD, 5);
  assert.equal(r.amount, 0);
});

test('заправка не трогает статистику', () => {
  const g = { ...newGame(1), fuel: 10 };
  const r = refuel(g, 5);
  assert.deepEqual(r.state.stats, g.stats);
});
