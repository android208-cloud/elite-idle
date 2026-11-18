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
import { maxFuel } from '../src/core/ships.ts';
import { distance } from '../src/core/galaxy.ts';

/** Встречи отключены: в этом файле проверяется только торговля и полёт */
const DEFAULT_SETTINGS = { ...BASE_SETTINGS, encounterRate: 0 };

const FOOD = 0;
const GOLD = 13;
const GEMS = 15;
const NOW = 1_000_000;

/*
 * §102.3: старт взят из Elite-A — командир NEWCOME на голом Аддере.
 * `elite-loader.asm`: CASH = 500, QQ14 = 60 (6.0 ly), cmdr_type = 0 (Adder),
 * LASER = 0, NOMSL = 0. Лазера и ракет нет вовсе: «minimal equipment».
 */
test('старт: Lave, 500 CR, 6.0 св. года, трюм 8 т, голый Аддер', () => {
  const g = newGame(1);
  assert.equal(currentSystem(g).name, 'LAVE');
  assert.equal(g.system, START_SYSTEM_LAVE);
  assert.equal(g.cash, 5000, '500 CR в десятых долях');
  assert.equal(g.fuel, 60);
  assert.equal(g.holdSpace, 8);
  assert.equal(g.ship.model, 'adder');
  assert.equal(g.ship.laser, 'none');
  assert.equal(g.ship.missiles, 0);
});

test('покупка: ограничена количеством, деньгами и трюмом', () => {
  const g = newGame(1);
  const price = g.market[FOOD].price;
  const r = buy(g, FOOD, 1000);
  const hold = g.holdSpace;
  const expected = Math.min(g.market[FOOD].quantity, hold, Math.floor(g.cash / price));
  assert.equal(r.amount, expected);
  assert.equal(r.state.cash, g.cash - expected * price);
  assert.equal(r.state.holdSpace, hold - expected);
  assert.equal(r.state.cargo[FOOD], expected);
  assert.equal(r.state.market[FOOD].quantity, g.market[FOOD].quantity - expected);
  // исходное состояние не изменилось
  assert.equal(g.cash, 5000, '500 CR в десятых долях');
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
  assert.equal(r1.state.holdSpace, g.holdSpace);
  const r2 = buy(r1.state, GEMS, 5);
  assert.equal(r2.state.holdSpace, g.holdSpace);
});

test('нельзя продать больше, чем есть', () => {
  const g = newGame(1);
  assert.equal(sell(g, FOOD, 5).amount, 0);
});

test('заправка: не больше бака и не больше денег', () => {
  // §102.3: бак — свойство корабля. У стартового Аддера он 60 (6.0 ly).
  const base = newGame(1);
  const tank = maxFuel(base.ship);
  assert.equal(tank, 60);
  let g = { ...base, fuel: 30, cash: 1000 };
  const r = refuel(g, 1000);
  assert.equal(r.amount, tank - 30);
  assert.equal(r.state.cash, 1000 - (tank - 30) * 2);
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
  // Время в пути зависит от расстояния (§70), а не от фиксированных 15 минут.
  assert.equal(started.state.flight?.arriveAt, NOW + jumpDuration(DEFAULT_SETTINGS, d));

  // §76: полный бак на ×1 — 17 минут, поэтому окно досчёта берём от самого
  // полёта, а не от старой константы: иначе тест проверял бы не прибытие,
  // а собственную арифметику.
  // во время полёта торговать нельзя
  assert.equal(buy(started.state, FOOD, 1).amount, 0);
  assert.equal(startJump(started.state, target, NOW, DEFAULT_SETTINGS).error, 'in-flight');

  // рано: ничего не происходит
  const early = advance(started.state, NOW + 1);
  assert.equal(early.events.length, 0);
  assert.ok(early.state.flight);

  // вовремя: прибытие.
  // §76: встречи теперь идут по реальному времени, и за 17 минут пути их
  // успевает случиться несколько. Тест про прибытие, поэтому встречи
  // выключаем настройкой — иначе проверяем не то.
  const noEncounters = { ...DEFAULT_SETTINGS, encounterRate: 0 };
  const done = advance(started.state, NOW + jumpDuration(DEFAULT_SETTINGS, d), noEncounters);
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
  // §76: базовое время относится к пути в MAX_FUEL, а не к «среднему» прыжку.
  // Поэтому ожидание выводим из самой функции, а не из зашитого числа:
  // проверяем ровно то, что обещает название теста — пятикратную разницу.
  const one = jumpDuration({ ...DEFAULT_SETTINGS, speed: 1, baseJumpMs: 900_000 }, 7);
  const five = jumpDuration({ ...DEFAULT_SETTINGS, speed: 5, baseJumpMs: 900_000 }, 7);
  assert.equal(five, Math.round(one / 5));
});

test('детерминизм: одинаковое зерно даёт одинаковый рынок после прибытия', () => {
  const run = () => {
    const g = newGame(42);
    const systems = systemsOf(1);
    const target = systems.findIndex((s, i) => i !== g.system && distance(systems[g.system], s) <= g.fuel);
    const s = startJump(g, target, NOW, DEFAULT_SETTINGS).state;
    // Запас с лихвой перекрывает любой прыжок: время теперь зависит от расстояния.
    return advance(s, NOW + DEFAULT_SETTINGS.baseJumpMs * 4).state;
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

