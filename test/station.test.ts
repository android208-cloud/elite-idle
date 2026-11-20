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
 *   4. ни одна станция не дешевле самого дорогого корабля;
 *   5. §127: покупка с рынка — деньги уходят, станция остаётся своя,
 *      при нехватке денег и при повторной покупке — разные отказы.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buyStation, deserialize, newGame, serialize, systemsOf } from '../src/core/state.ts';
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

describe('§127: покупка станции', () => {
  const LAVE_STATION = stationPrice(byName('LAVE')) * 10;
  const rich = () => ({ ...newGame(1), cash: LAVE_STATION + 1000 });

  it('деньги уходят, станция становится своей', () => {
    const before = rich();
    const r = buyStation(before);
    assert.equal(r.error, undefined);
    assert.equal(r.state.cash, 1000);
    assert.deepEqual(r.state.stations, [before.system]);
    assert.equal(r.paid, LAVE_STATION);
  });

  it('без денег — отказ «cash», состояние не меняется', () => {
    const poor = { ...newGame(1), cash: LAVE_STATION - 10 };
    const r = buyStation(poor);
    assert.equal(r.error, 'cash');
    assert.equal(r.state, poor);
    assert.deepEqual(r.state.stations, []);
  });

  it('второй раз ту же станцию не купить', () => {
    const first = buyStation(rich()).state;
    assert.equal(buyStation(first).error, 'owned');
  });

  it('в полёте покупать нечего', () => {
    const flying = {
      ...rich(),
      flight: {
        from: 7, to: 8, departAt: 0, arriveAt: 1e9,
        remainingBaseMs: 1e9, elapsedBaseMs: 0, dueAt: 0, pending: [],
      },
    } as ReturnType<typeof rich>;
    assert.equal(buyStation(flying).error, 'in-flight');
  });

  it('владение переживает сохранение', () => {
    const bought = buyStation(rich()).state;
    const back = deserialize(serialize(bought));
    assert.deepEqual(back.stations, bought.stations);
  });

  it('старый сейв без поля читается как «станций нет»', () => {
    const old = { ...newGame(1) } as Record<string, unknown>;
    delete old.stations;
    assert.deepEqual(deserialize(JSON.stringify(old)).stations, []);
  });
});
