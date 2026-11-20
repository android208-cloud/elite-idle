/**
 * §125: цена станции.
 *
 * Пользователь: «сколько может стоить классическая станция (не планета)»,
 * затем — «увязать все вводные станции без привязки к кораблям» и
 * «добавим „0“ к цене, ведь это станция, а не корабль».
 *
 * Проверяем:
 *   1. цена — чистая функция от системы (два вызова дают одно число);
 *   2. порядок цен соответствует размеру мира;
 *   3. правило пользователя: станция дороже своего имущества в десять раз;
 *   4. ни одна станция не дешевле самого дорогого корабля.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { systemsOf } from '../src/core/state.ts';
import { stationPrice, stationStockValue, STATION_SCALE } from '../src/core/station.ts';
import { shipPrice } from '../src/core/ships.ts';

const GALAXY = systemsOf(1);
const byName = (name: string) => {
  const s = GALAXY.find((x) => x.name === name);
  assert.ok(s, `система ${name} не найдена`);
  return s;
};

describe('§125: цена станции', () => {
  it('LAVE: склад и цена', () => {
    const lave = byName('LAVE');
    assert.ok(Math.abs(stationStockValue(lave) - 7407.6) < 1e-9, String(stationStockValue(lave)));
    assert.equal(stationPrice(lave), 477_400);
  });

  it('цена растёт вместе с миром', () => {
    const order = ['ZALERIZA', 'LAVE', 'REORTE', 'TIRAOR', 'CEESXE'].map((n) =>
      stationPrice(byName(n)),
    );
    for (let i = 1; i < order.length; i++) {
      assert.ok(order[i] > order[i - 1], `цена не выросла: ${order.join(' · ')}`);
    }
    // CEESXE — самый крупный мир галактики, ZALERIZA — карлик.
    assert.equal(order[4], 2_962_500);
    assert.equal(order[0], 261_900);
  });

  it('станция стоит не меньше десяти своих складов', () => {
    for (const s of GALAXY) {
      assert.ok(
        stationPrice(s) >= STATION_SCALE * stationStockValue(s),
        `${s.name}: ${stationPrice(s)} против склада ${stationStockValue(s)}`,
      );
    }
  });

  it('ни одна станция не дешевле Анаконды', () => {
    const anaconda = shipPrice('anaconda') / 10;
    for (const s of GALAXY) {
      assert.ok(stationPrice(s) > anaconda, `${s.name}: ${stationPrice(s)} ≤ ${anaconda}`);
    }
  });

  it('цена не зависит от порядка вызовов и от игрока', () => {
    const s = byName('CEESXE');
    const first = stationPrice(s);
    stationPrice(byName('LAVE'));
    assert.equal(stationPrice(s), first);
    assert.equal(stationPrice({ ...s }), first);
  });

  it('цена округлена до сотни кредитов', () => {
    for (const s of GALAXY) assert.equal(stationPrice(s) % 100, 0, s.name);
  });
});
