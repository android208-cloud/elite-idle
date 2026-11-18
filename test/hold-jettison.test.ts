/**
 * §98: «Трюм» — сброс груза в полёте.
 *
 * Пользователь попросил: в полёте вкладка рынка должна становиться «Трюмом»
 * со списком товаров, как на рынке, но с кнопкой сброса конкретного товара.
 *
 * Зачем это нужно на самом деле: контрабанда в трюме запрещает побег от
 * статуса (§80.1), а выбросить её было негде. Экран обломков — единственное
 * место со сбросом — появляется только после боя и только с тем грузом,
 * который выпал. Игрок с купленными рабами оказывался заперт.
 *
 * Эти тесты держат ядро сброса: количество, место в трюме, манифест и
 * журнальные записи. Сам вид экрана проверяет `verify-hold-tab.mjs`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  newGame, startJump, jettisonCargo, DEFAULT_SETTINGS, MAX_FUEL,
  SLAVES_INDEX, NARCOTICS_INDEX, FIREARMS_INDEX, contrabandLevel,
} from '../src/core/state.ts';
import { cargoManifest, contrabandGoods, contrabandValue } from '../src/core/cargo-origin.ts';

/**
 * Игра в полёте.
 *
 * Соседняя система может быть дальше полного бака — расстояние в этой
 * галактике не единица. Поэтому цель выбирается по факту: первая, до
 * которой топлива хватает.
 */
const flying = (): ReturnType<typeof newGame> => {
  const b = newGame(1);
  const ready = { ...b, fuel: MAX_FUEL, holdSpace: 17 };
  for (let to = 0; to < 256; to++) {
    if (to === b.system) continue;
    const r = startJump(ready, to, 1e6, DEFAULT_SETTINGS);
    if (r.state.flight) return r.state;
  }
  throw new Error('ни одна система не достижима на полном баке');
};

test('§98: сброс одной единицы освобождает тонну', () => {
  const s = { ...flying(), cargo: flying().cargo.map((n, i) => (i === 0 ? 5 : n)) };
  const r = jettisonCargo(s, 0, 1);
  assert.equal(r.dropped, 1);
  assert.equal(r.state.cargo[0], 4);
  assert.equal(r.state.holdSpace, s.holdSpace + 1, 'место возвращается');
});

test('§98: «Сбросить всё» выбрасывает всю позицию и не уходит в минус', () => {
  const base = flying();
  const s = { ...base, cargo: base.cargo.map((n, i) => (i === 0 ? 4 : n)) };
  const r = jettisonCargo(s, 0, s.cargo[0]);
  assert.equal(r.state.cargo[0], 0);
  assert.equal(r.state.holdSpace, s.holdSpace + 4);
  // Повторный сброс пустой позиции ничего не делает — и это важно: кнопка
  // остаётся в разметке, но нажать её можно только когда груз есть.
  const again = jettisonCargo(r.state, 0, 10);
  assert.equal(again.dropped, 0);
  assert.equal(again.state.cargo[0], 0);
});

test('§98: сброс запрещёнки снимает запрет на побег', () => {
  const base = flying();
  const withSlaves = { ...base, cargo: base.cargo.map((n, i) => (i === SLAVES_INDEX ? 2 : n)) };
  assert.ok(contrabandLevel(withSlaves.cargo) > 0, 'запрещёнка в трюме есть');
  assert.match(contrabandGoods(withSlaves.cargo), /Рабы/);
  const r = jettisonCargo(withSlaves, SLAVES_INDEX, 2);
  assert.equal(contrabandLevel(r.state.cargo), 0, 'побег снова возможен');
  assert.equal(cargoManifest(r.state).length, 0, 'манифест догоняет трюм');
});

test('§98: сброс уменьшает манифест, но не стирает историю', () => {
  const base = flying();
  const s = {
    ...base,
    cargo: base.cargo.map((n, i) => (i === NARCOTICS_INDEX ? 3 : n)),
    cargoOrigin: [{ commodity: NARCOTICS_INDEX, amount: 3, added: 5, byPath: { bought: 5, salvage: 0, drifting: 0 } }],
  };
  const r = jettisonCargo(s, NARCOTICS_INDEX, 1);
  const m = cargoManifest(r.state);
  assert.equal(m.length, 1);
  assert.equal(m[0].amount, 2, 'остаток честный');
  assert.equal(m[0].added, 5, 'история поступления не переписывается');
});

test('§98: чистый товар в манифест не попадает', () => {
  const base = flying();
  const s = { ...base, cargo: base.cargo.map((n, i) => (i === 0 ? 5 : n)) };
  assert.deepEqual(cargoManifest(s), []);
});

test('§98: цена запрещёнки считается по рынку системы', () => {
  const base = flying();
  const s = { ...base, cargo: base.cargo.map((n, i) => (i === FIREARMS_INDEX ? 2 : n)) };
  const price = s.market[FIREARMS_INDEX].price;
  assert.ok(price > 0, 'в этой системе у оружия должна быть цена');
  assert.equal(contrabandValue(s.cargo, s.market), 2 * price);
});
