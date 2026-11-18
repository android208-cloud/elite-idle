/**
 * §102: корабль как данные, а не константа.
 *
 * (Не путать с `ship-model.test.ts` — там геометрия модели и карты.)
 *
 * До этого раздела игра знала ровно один корабль игрока — Cobra Mk III:
 * трюм 20/35 т и четыре ракеты были глобальными константами, а прочность
 * в бою (`MAX_SHIELDS + MAX_ENERGY` = 383) — общей для всех.
 *
 * Здесь проверяется то, на чём держится покупка кораблей:
 *   - трюм и слоты ракет берутся из модели;
 *   - прочность корпуса — из поля Shields дизассемблера Elite-A;
 *   - «полный боекомплект» для патруля — боекомплект КОРАБЛЯ (у Аспа один);
 *   - гейт на Питона и Анаконду ступенчатый по классу корабля.
 *
 * Числа сверены с `elite-a-source-code-bbc-micro` (new_details, new_ships).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SHIPS,
  maxMissiles,
  patrolMissilesRequired,
  shipSpec,
  shipPrice,
  shipsForSale,
  SHIP_PRICE_DIVISOR,
  type PlayerShip,
} from '../src/core/ships.ts';
import { canBeat, hasBossKit, isWeak, toughnessOf } from '../src/core/one-decision.ts';
import { buyEquipment, buyShip, newGame } from '../src/core/state.ts';
import { enemyById } from '../src/core/ships.ts';

const ship = (model: keyof typeof SHIPS, extra: Partial<PlayerShip> = {}): PlayerShip => ({
  model,
  laser: 'pulse',
  missiles: 0,
  ecm: false,
  energyBomb: false,
  energyUnit: false,
  fuelScoops: false,
  dockingComputer: false,
  galacticHyperdrive: false,
  cargoBayExtended: false,
  ...extra,
});

const fullKit = { militaryLaser: true, ecm: true, energyBomb: true, missiles: 4 };

describe('§102 модель корабля', () => {
  it('трюм — свойство модели, а не одна константа', () => {
    assert.equal(SHIPS.cobra3.hold, 20);
    assert.equal(SHIPS.python.hold, 106);
    assert.equal(SHIPS.anaconda.hold, 253);
    assert.equal(SHIPS.asp.hold, 6);
  });

  it('расширение трюма есть только у Кобры', () => {
    assert.equal(SHIPS.cobra3.holdExtended, 35);
    // У крупных кораблей «большой трюм» не продаётся: им он не нужен.
    assert.equal(SHIPS.python.holdExtended, null);
    assert.equal(SHIPS.anaconda.holdExtended, null);
  });

  it('слоты ракет — от модели', () => {
    assert.equal(maxMissiles(ship('cobra3')), 4);
    assert.equal(maxMissiles(ship('asp')), 1);
    assert.equal(maxMissiles(ship('anaconda')), 16);
  });

  it('патруль требует полный боекомплект КОРАБЛЯ, а не четыре ракеты', () => {
    // §102: с прежним «нужно 4» перехватчик Асп не мог выйти в патруль
    // никогда — у него один слот.
    assert.equal(patrolMissilesRequired(ship('asp')), 1);
    assert.equal(patrolMissilesRequired(ship('anaconda')), 16);
  });
});

describe('§102 прочность корпуса', () => {
  it('Кобра сохраняет прежние 383 очка', () => {
    assert.equal(toughnessOf(ship('cobra3')), 383);
  });

  it('крупнее корпус — больше прочности', () => {
    assert.equal(toughnessOf(ship('ferdelance')), 438);
    assert.equal(toughnessOf(ship('asp')), 547);
    assert.equal(toughnessOf(ship('python')), 602);
    assert.equal(toughnessOf(ship('anaconda')), 711);
  });

  it('порог §39.1 держится на Кобре: Питона не взять, Анаконду тоже', () => {
    const cobra = toughnessOf(ship('cobra3'));
    assert.equal(isWeak(enemyById('python'), 'military', cobra), false);
    assert.equal(isWeak(enemyById('anaconda'), 'military', cobra), false);
    assert.equal(isWeak(enemyById('sidewinder'), 'military', cobra), true);
  });

  it('на Анаконде Питон уже «слабый» по расчёту', () => {
    // Это не баг: 22 % против порога 40 %. Именно поэтому гейт для босса
    // задаётся снаряжением, а не только прочностью.
    const ana = toughnessOf(ship('anaconda'));
    assert.equal(isWeak(enemyById('python'), 'military', ana), true);
    // А сама Анаконда не проходит ни на себе, ни на чём-либо ещё.
    assert.equal(isWeak(enemyById('anaconda'), 'military', ana), false);
  });
});

describe('§102 ступенчатый гейт', () => {
  it('Кобре нужен полный набор', () => {
    assert.equal(hasBossKit(fullKit, 'cobra3'), true);
    assert.equal(hasBossKit({ ...fullKit, energyBomb: false }, 'cobra3'), false);
  });

  it('Питону, Аспу и ФдЛ бомба больше не нужна', () => {
    const kit = { ...fullKit, energyBomb: false };
    assert.equal(hasBossKit(kit, 'python'), true);
    assert.equal(hasBossKit(kit, 'asp'), true);
    assert.equal(hasBossKit(kit, 'ferdelance'), true);
    // ECM всё ещё обязателен.
    assert.equal(hasBossKit({ ...kit, ecm: false }, 'python'), false);
  });

  it('Анаконде хватает военного лазера и ракеты', () => {
    const kit = { militaryLaser: true, ecm: false, energyBomb: false, missiles: 1 };
    assert.equal(hasBossKit(kit, 'anaconda'), true);
    assert.equal(hasBossKit({ ...kit, missiles: 0 }, 'anaconda'), false);
    assert.equal(hasBossKit({ ...kit, militaryLaser: false }, 'anaconda'), false);
  });

  it('canBeat передаёт модель в гейт', () => {
    const python = enemyById('python');
    const withoutBomb = { ...fullKit, energyBomb: false };
    assert.equal(canBeat(python, withoutBomb, 'military', 'cobra3'), false);
    assert.equal(canBeat(python, withoutBomb, 'military', 'anaconda'), true);
  });

  it('малый корабль по-прежнему требует военный лазер', () => {
    const asp = enemyById('asp');
    assert.equal(canBeat(asp, fullKit, 'pulse', 'anaconda'), false);
    assert.equal(canBeat(asp, fullKit, 'military', 'anaconda'), true);
  });
});

describe('§102.3 большой трюм — только для Кобры', () => {
  it('Аддеру большой трюм не продаётся', () => {
    const g = { ...newGame(1), cash: 100000 };
    assert.equal(buyEquipment(g, 'cargoBay').error, 'model');
  });

  it('Кобре — продаётся и добавляет 15 т', () => {
    const g = {
      ...newGame(1),
      cash: 100000,
      holdSpace: 20,
      ship: { ...newGame(1).ship, model: 'cobra3' as const, cargoBayExtended: false },
    };
    const r = buyEquipment(g, 'cargoBay');
    assert.equal(r.error, undefined);
    assert.equal(r.state.holdSpace, 35);
  });
});

describe('§102 данные Elite-A', () => {
  it('ранги совпадают с порядком цен в new_ships', () => {
    // В RELEASED порядок: Кобра 287 < ФдЛ 359.5 < Питон 762 < Асп 1012 < Анаконда 1869.5
    assert.deepEqual(
      (['cobra3', 'ferdelance', 'python', 'asp', 'anaconda'] as const).map((m) => SHIPS[m].rank),
      [8, 9, 12, 14, 15],
    );
  });

  it('щиты совпадают с new_details', () => {
    assert.deepEqual(
      (['cobra3', 'ferdelance', 'asp', 'python', 'anaconda'] as const).map((m) => SHIPS[m].shields),
      [7, 8, 10, 11, 13],
    );
  });
});

describe('§102.4 верфь', () => {
  const rich = (seed = 1) => ({ ...newGame(seed), system: 23, cash: 400000 });

  it('цена — цена Elite-A, сжатая делителем', () => {
    assert.equal(SHIP_PRICE_DIVISOR, 31);
    assert.equal(shipPrice('adder'), 10000);      // 1 000 CR
    assert.equal(shipPrice('cobra3'), 92580);     // 9 258 CR
    assert.equal(shipPrice('python'), 245810);    // 24 581 CR
    assert.equal(shipPrice('anaconda'), 603060);  // 60 306 CR
  });

  it('список зависит от экономики: 15 - 2 * экономика', () => {
    // Богатая промышленная — всё; аграрная — только самый дешёвый.
    assert.equal(shipsForSale(0).length, 6);
    assert.deepEqual(shipsForSale(5), ['adder']);
    assert.deepEqual(shipsForSale(7), ['adder']);
    // Кобра (ранг 8) видна только в системах с экономикой <= 3.
    assert.ok(shipsForSale(3).includes('cobra3'));
    assert.ok(!shipsForSale(4).includes('cobra3'));
  });

  it('зачёт по полной цене: платится только разница', () => {
    const g = rich();
    const r = buyShip(g, 'cobra3');
    assert.equal(r.error, undefined);
    assert.equal(r.state.cash, 400000 + 10000 - 92580);
    assert.equal(r.state.ship.model, 'cobra3');
  });

  it('новый корабль приходит голым, ГГД остаётся, статус не сбрасывается', () => {
    const ship = { ...newGame(1).ship, ecm: true, energyBomb: true, fuelScoops: true, galacticHyperdrive: true };
    const g = { ...rich(), ship, legal: 30 };
    const r = buyShip(g, 'python');
    assert.equal(r.state.ship.model, 'python');
    assert.equal(r.state.ship.laser, 'none');
    assert.equal(r.state.ship.missiles, 0);
    assert.equal(r.state.ship.ecm, false);
    assert.equal(r.state.ship.energyBomb, false);
    assert.equal(r.state.ship.fuelScoops, false);
    assert.equal(r.state.ship.galacticHyperdrive, true, 'ГГД привязан к карте, а не к корпусу');
    assert.equal(r.state.legal, 30, 'отмывание статуса устроено иначе');
  });

  it('трюм нового корабля и груз', () => {
    const g = { ...rich(), holdSpace: 4, cargo: newGame(1).cargo.map((_, i) => (i === 0 ? 4 : 0)) };
    const r = buyShip(g, 'python');
    assert.equal(r.state.holdSpace, 106 - 4);
  });

  it('груз, который не влезает, — отказ, а не молчаливая потеря', () => {
    const g = { ...rich(), holdSpace: 0, cargo: newGame(1).cargo.map((_, i) => (i === 0 ? 8 : 0)) };
    assert.equal(buyShip(g, 'asp').error, 'cargo');
  });

  it('в бедной системе модель не продаётся', () => {
    const g = { ...newGame(1), system: 7, cash: 400000 }; // LAVE, экономика 5
    assert.equal(buyShip(g, 'python').error, 'unavailable');
    assert.equal(buyShip(g, 'adder').error, 'owned');
  });

  it('без денег — отказ', () => {
    const g = { ...rich(), cash: 0 };
    assert.equal(buyShip(g, 'python').error, 'cash');
  });
});
