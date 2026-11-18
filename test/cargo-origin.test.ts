/**
 * §98: журнал говорит, ОТКУДА взялась запрещёнка.
 *
 * Пользователь: «В журнале нет записей о происхождении запрещёнки».
 *
 * Так и было. Записи о росте статуса существовали, но они говорили «что
 * стало» и молчали «откуда». Пример из игры:
 *
 *   «Контрабанда в трюме: правовой статус 32 → 64 (Нарушитель)»
 *
 * Что именно легло в трюм — рабы? наркотики? оружие? куплено на рынке,
 * подобрано из обломков или взято в дрейфующем контейнере? Игрок не мог
 * понять, за что его наказывают, а без этого нельзя решить, что выбрасывать.
 *
 * Правило: любая запись о росте статуса из-за груза называет товар и путь.
 * Товар — потому что выбрасывать надо конкретный; путь — потому что от него
 * зависит, можно ли было этого избежать.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  newGame, buy, startJump, DEFAULT_SETTINGS, MAX_FUEL,
  SLAVES_INDEX, NARCOTICS_INDEX, FIREARMS_INDEX, contrabandLevel,
} from '../src/core/state.ts';
import { contrabandGoods, cargoManifest, handoverLine, contrabandValue } from '../src/core/cargo-origin.ts';

const rich = (): ReturnType<typeof newGame> => {
  const b = newGame(1);
  // Денег и места вдоволь: тест про статьи, а не про торговлю.
  return { ...b, cash: 10_000_000, fuel: MAX_FUEL, holdSpace: 100, ship: { ...b.ship, cargoBayExtended: true } };
};

test('§98: товары называются по именам, а не «контрабанда»', () => {
  const cargo = newGame(1).cargo.slice();
  cargo[SLAVES_INDEX] = 3;
  cargo[FIREARMS_INDEX] = 1;
  cargo[0] = 10;
  const line = contrabandGoods(cargo);
  assert.match(line, /Рабы/);
  assert.match(line, /Оружие/);
  assert.ok(!/Наркотики/.test(line), 'чего нет в трюме — того нет и в записи');
  assert.ok(!/контрабанд/i.test(line), 'слово «контрабанда» в записи не используется');
  assert.match(line, /3 т/);
});

test('§98: один товар — без перечисления через запятую', () => {
  const cargo = newGame(1).cargo.slice();
  cargo[NARCOTICS_INDEX] = 2;
  assert.equal(contrabandGoods(cargo), 'Наркотики (2 т)');
});

test('§98: покупка запрещёнки на рынке попадает в манифест как «куплено»', () => {
  // Свежая игра начинается на станции: рынок доступен.
  const s = rich();
  let st = s;
  let bought = 0;
  for (const i of [SLAVES_INDEX, NARCOTICS_INDEX, FIREARMS_INDEX]) {
    const r = buy(st, i, 2);
    if (r.amount > 0) bought += r.amount;
    st = r.state;
  }
  assert.ok(bought > 0, 'в этой системе запрещёнку должны продавать — иначе тест пуст');
  const goods = cargoManifest(st).filter((e) => e.byPath.bought > 0);
  assert.ok(goods.length > 0, 'купленное должно быть в манифесте');
  const line = handoverLine(goods);
  assert.match(line, /куплено/, `путь не назван: ${line}`);
  assert.match(line, /Наркотики|Рабы|Оружие/, `товар не назван: ${line}`);
  // Цена — отдельная строка: манифест отвечает «что и откуда», а не «сколько стоит».
  assert.ok(contrabandValue(st.cargo, st.market) > 0, 'цена запрещёнки должна считаться');
});

test('§98: взлёт с контрабандой называет товар и путь', () => {
  let st = rich();
  for (const i of [SLAVES_INDEX, NARCOTICS_INDEX, FIREARMS_INDEX]) st = buy(st, i, 2).state;
  assert.ok(contrabandLevel(st.cargo) > 0, 'запрещёнка в трюме должна быть');
  const to = [...Array(256).keys()].find((i) => i !== st.system)!;
  const r = startJump({ ...st, fuel: MAX_FUEL, holdSpace: 100 }, to, 1e6, DEFAULT_SETTINGS);
  assert.ok(r.state, 'прыжок должен начаться');
  assert.ok(r.state.legal >= st.legal, 'статус не падает при взлёте');

  // То, что UI пишет в журнал, собирается из того же манифеста.
  const line = handoverLine(cargoManifest(st).filter((e) => e.amount > 0));
  assert.match(line, /Рабы|Наркотики|Оружие/, `без товара: ${line}`);
  assert.match(line, /куплено/, `без пути: ${line}`);
});

test('§98: пустой трюм — пустой манифест', () => {
  assert.deepEqual(cargoManifest(newGame(1)), []);
  assert.equal(handoverLine([]), '');
});
