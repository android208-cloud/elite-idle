/**
 * Эталонный тест доступности оборудования по EQSHP.
 *
 * Источник: library/common/main/subroutine/eqshp.asm (версия с диска / enhanced).
 *
 * Логика оригинала:
 *
 *   LDA tek            \ технологический уровень системы, 0..14
 *   CLC
 *   ADC #3             \ QQ25 = tek + 3
 *   CMP #14            \ но не больше 14 (в кассетной версии было 12)
 *   LDA #14
 *   STA QQ25           \ последний номер, который печатается на верфи
 *
 *   LDX #1             \ счётчик XX13 идёт от 1 до QQ25
 * .EQL1
 *   ...                \ печать номера, названия и цены предмета
 *   LDA XX13
 *   JSR prx-3          \ цена предмета номер XX13 - 1 в таблице PRXS
 *
 * Ключевой момент: XX13 — это ЭКРАННЫЙ номер, где 1 = FUEL, потому что
 * prx-3(XX13) читает PRXS[XX13 - 1], а PRXS[0] — топливо. Отсюда:
 *
 *   экранный 1 = топливо, 2 = ракета, 3 = трюм, 4 = ECM, 5 = импульсный,
 *   6 = лучевой, 7 = топливосборщик, 8 = капсула, 9 = бомба, 10 = энергоблок,
 *   11 = стыковочный компьютер, 12 = гипердвигатель, 13 = военный, 14 = добывающий
 *
 * Предмет доступен, если его экранный номер ≤ QQ25, т.е. tek ≥ номер − 3.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  EQUIPMENT,
  equipmentAvailable,
  maxEquipmentNumber,
  QQ25_MAX,
  EQSHP_TECH_OFFSET,
} from '../src/core/ships.ts';
import { buildGalaxy } from '../src/core/galaxy.ts';

/** Экранные номера XX13 из EQSHP (1 — топливо, покупок в таблице — 2..14). */
const REFERENCE_SCREEN_NUMBERS: Record<string, number> = {
  missile: 2,
  cargoBay: 3,
  ecm: 4,
  pulse: 5,
  beam: 6,
  scoops: 7,
  pod: 8,
  bomb: 9,
  energyUnit: 10,
  dockingComputer: 11,
  galacticHyperdrive: 12,
  military: 13,
  mining: 14,
};

describe('доступность оборудования по EQSHP', () => {
  it('номера предметов совпадают с порядком PRXS в оригинале', () => {
    for (const [id, screen] of Object.entries(REFERENCE_SCREEN_NUMBERS)) {
      const item = EQUIPMENT.find((e) => e.id === id);
      assert.ok(item, `предмет ${id} не найден`);
      assert.equal(item.screenNumber, screen, `${id}: номер на верфи должен быть ${screen}`);
    }
    // В оригинале после гипердвигателя (12) идут военный (13) и добывающий (14)
    assert.equal(EQUIPMENT.length, REFERENCE_SCREEN_NUMBERS.mining - 1);
  });

  it('QQ25 = min(tek + 3, 14)', () => {
    assert.equal(QQ25_MAX, 14);
    assert.equal(EQSHP_TECH_OFFSET, 3);
    for (let tek = 0; tek <= 14; tek++) {
      assert.equal(maxEquipmentNumber(tek), Math.min(tek + 3, 14), `tek ${tek}`);
    }
    // Нижняя граница: при tek = 0 на верфи уже есть ракета (номер 2)
    assert.equal(maxEquipmentNumber(0), 3);
  });

  it('пороги по техуровню совпадают с оригиналом', () => {
    // tek, начиная с которого предмет появляется на верфи (номер − 3)
    const expected: [string, number][] = [
      ['missile', 0],
      ['cargoBay', 0],
      ['ecm', 1],
      ['pulse', 2],
      ['beam', 3],
      ['scoops', 4],
      ['pod', 5],
      ['bomb', 6],
      ['energyUnit', 7],
      ['dockingComputer', 8],
      ['galacticHyperdrive', 9],
      ['military', 10],
      ['mining', 11],
    ];
    for (const [id, minTek] of expected) {
      const item = EQUIPMENT.find((e) => e.id === id)!;
      if (minTek > 0) {
        assert.equal(equipmentAvailable(item, minTek - 1), false, `${id} не должен быть доступен при tek ${minTek - 1}`);
      }
      assert.equal(equipmentAvailable(item, minTek), true, `${id} должен быть доступен при tek ${minTek}`);
    }
  });

  it('военный и добывающий лазеры появляются позже всех', () => {
    const military = EQUIPMENT.find((e) => e.id === 'military')!;
    const mining = EQUIPMENT.find((e) => e.id === 'mining')!;
    for (let tek = 0; tek <= 9; tek++) {
      assert.equal(equipmentAvailable(military, tek), false, `военный лазер не должен быть при tek ${tek}`);
      assert.equal(equipmentAvailable(mining, tek), false, `добывающий лазер не должен быть при tek ${tek}`);
    }
    assert.equal(equipmentAvailable(military, 10), true);
    assert.equal(equipmentAvailable(mining, 10), false, 'добывающий лазер позже военного');
    assert.equal(equipmentAvailable(mining, 11), true);
  });

  it('в галактике нет систем, где верфь пуста', () => {
    let empty = 0;
    for (let galaxy = 1; galaxy <= 8; galaxy++) {
      for (const system of buildGalaxy(galaxy)) {
        if (!EQUIPMENT.some((e) => equipmentAvailable(e, system.techLevel))) empty++;
      }
    }
    assert.equal(empty, 0, 'в каждой системе должно быть хотя бы что-то на продажу');
  });

  it('набор на верфи растёт монотонно с техуровнем', () => {
    for (let tek = 0; tek < 14; tek++) {
      const here = EQUIPMENT.filter((e) => equipmentAvailable(e, tek));
      const next = EQUIPMENT.filter((e) => equipmentAvailable(e, tek + 1));
      assert.ok(next.length >= here.length, `при tek ${tek + 1} предметов меньше, чем при ${tek}`);
      for (const item of here) {
        assert.ok(next.includes(item), `${item.id} пропал при росте техуровня до ${tek + 1}`);
      }
    }
  });

  it('ключевые системы: что можно купить', () => {
    const galaxy = buildGalaxy(1);
    const count = (name: string): number => {
      const s = galaxy.find((x) => x.name === name)!;
      return EQUIPMENT.filter((e) => equipmentAvailable(e, s.techLevel)).length;
    };
    // Значения зафиксированы по генератору: tek LAVE = 4 → QQ25 = 7 → 6 покупок
    assert.equal(count('LAVE'), 6);
    assert.equal(count('DISO'), 9);
    // LEESTI: tek 10 → QQ25 = 13, добывающий (14) ещё не продаётся
    assert.equal(count('LEESTI'), 12);
  });
});
