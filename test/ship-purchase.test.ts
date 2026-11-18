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
  type PlayerShip,
} from '../src/core/ships.ts';
import { canBeat, hasBossKit, isWeak, toughnessOf } from '../src/core/one-decision.ts';
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
