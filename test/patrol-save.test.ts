/**
 * §96: патруль переживает сохранение.
 *
 * Найдено при проверке клика «Напасть»: после перезагрузки страницы патруль
 * пропадал, и игрок оказывался на станции. Причина не в кнопке, а в JSON:
 * `JSON.stringify(Infinity)` даёт `null`, а у патруля ровно два поля
 * бесконечны — `arriveAt` и `remainingBaseMs` (патруль кончается топливом,
 * а не временем). После загрузки они становились `null`/`0`, и первый же
 * тик считал полёт завершённым: `advance` писал «Прибытие» и высаживал на
 * станцию. Сохраняется игра каждые 10 секунд — то есть терялся почти
 * всегда.
 *
 * Эти тесты держат правило: бесконечность — это значение, а не «нет
 * значения». `null` уже занят смыслом «поля не было».
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  newGame, startPatrol, serialize, deserialize, advance,
  DEFAULT_SETTINGS, MAX_FUEL,
} from '../src/core/state.ts';

const pirateKit = (): ReturnType<typeof newGame> => {
  const b = newGame(1);
  return {
    ...b,
    fuel: MAX_FUEL,
    ship: { ...b.ship, laser: 'military' as const, missiles: 4, ecm: true, energyBomb: true },
  };
};

test('§96: бесконечность патруля выживает сохранение', () => {
  const s = startPatrol(pirateKit(), 1e6).state;
  assert.equal(s.flight?.arriveAt, Number.POSITIVE_INFINITY, 'до сохранения — бесконечность');
  const back = deserialize(serialize(s));
  assert.equal(back.flight?.arriveAt, Number.POSITIVE_INFINITY, 'после загрузки — снова бесконечность');
  assert.equal(back.flight?.remainingBaseMs, Number.POSITIVE_INFINITY);
  assert.equal(back.flight?.patrol, true, 'патруль остаётся патрулём');
});

test('§96: патруль идёт после загрузки, а не «прибывает»', () => {
  const s = startPatrol(pirateKit(), 1e6).state;
  const back = deserialize(serialize(s));
  // Десять минут вперёд: раньше здесь срабатывало «Прибытие» и полёт гас.
  const r = advance(back, 1e6 + 600_000, DEFAULT_SETTINGS);
  assert.ok(r.state.flight !== null, 'патруль не должен закончиться сам');
  assert.equal(r.state.flight?.patrol, true);
  assert.ok(!r.events.some((e) => e.type === 'arrived'), 'прибытия быть не должно');
});

test('§96: обычный перелёт сохраняется как прежде', () => {
  const b = pirateKit();
  const back = deserialize(serialize(b));
  assert.equal(back.flight, null, 'на стоянке полёта нет');
  assert.equal(back.fuel, b.fuel);
  assert.equal(back.cash, b.cash);
});

test('§96: двойной цикл сохранения не портит бесконечность', () => {
  const s = startPatrol(pirateKit(), 1e6).state;
  const once = deserialize(serialize(s));
  const twice = deserialize(serialize(once));
  assert.equal(twice.flight?.arriveAt, Number.POSITIVE_INFINITY);
  assert.equal(twice.flight?.patrol, true);
});
