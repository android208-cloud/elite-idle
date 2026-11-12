/**
 * Эталонный тест: сверяет ENEMIES и EQUIPMENT с данными оригинального
 * исходника Elite (tools/extract-ships.ts → reference/elite-source-code-library-main/).
 *
 * Запуск: node --test test/reference-ships.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ENEMIES, EQUIPMENT } from '../src/core/ships.ts';

// ---------------------------------------------------------------------------
// Эталонные данные из tools/extract-ships.ts (extract-ships запустить нельзя
// в тесте — читаем reference напрямую через grep/RegExp, как делает extract-ships,
// но здесь используем жёсткие константы, верифицированные вручную)
// ---------------------------------------------------------------------------

/** Данные из оригинала: { id, energy, laserPower, missiles, bounty } */
const REFERENCE_SHIPS: Record<string, { energy: number; laser: number; missiles: number; bounty: number }> = {
  //  Значения energy, laserPower, missiles взяты из extract-ships.ts (оригинал ASM).
  //  laser в ENEMIES = byte#19 >> 1 = ((laserPower << 3) | missiles) >> 1
  sidewinder:  { energy: 70,  laser: 8,  missiles: 0, bounty: 50  },
  gecko:       { energy: 70,  laser: 8,  missiles: 0, bounty: 55  },
  adder:       { energy: 85,  laser: 8,  missiles: 0, bounty: 40  },
  cobra1:      { energy: 90,  laser: 9,  missiles: 2, bounty: 75  },
  mamba:       { energy: 90,  laser: 9,  missiles: 2, bounty: 150 },
  krait:       { energy: 80,  laser: 8,  missiles: 0, bounty: 100 },
  moray:       { energy: 100, laser: 8,  missiles: 0, bounty: 50  },
  cobra3:      { energy: 150, laser: 9,  missiles: 2, bounty: 175 },  // cobra_mk_3_p
  asp:         { energy: 150, laser: 20, missiles: 1, bounty: 200 },
  ferdelance:  { energy: 160, laser: 9,  missiles: 2, bounty: 0   },  // оригинал: bounty=0!
  python:      { energy: 250, laser: 13, missiles: 3, bounty: 200 },
  anaconda:    { energy: 252, laser: 31, missiles: 7, bounty: 0   },  // оригинал: bounty=0!
  viper:       { energy: 120, laser: 8,  missiles: 1, bounty: 0   },
};

/** Эталонные цены оборудования из таблицы PRXS (library/common/main/variable/prxs.asm) */
const REFERENCE_EQUIPMENT: Record<string, number> = {
  missile:            300,
  cargoBay:           4000,
  ecm:                6000,
  pulse:              4000,
  beam:               10000,
  scoops:             5250,
  pod:                10000,
  bomb:               9000,
  energyUnit:         15000,
  dockingComputer:    10000,  // PRXS: 10000 (не 15000!)
  galacticHyperdrive: 50000,
  military:           60000,
  mining:             8000,
};

// ---------------------------------------------------------------------------
// Тесты
// ---------------------------------------------------------------------------

describe('сверка кораблей с оригиналом (reference-ships)', () => {
  for (const [id, ref] of Object.entries(REFERENCE_SHIPS)) {
    it(`${id}: энергия, урон, ракеты и награда совпадают с оригиналом`, () => {
      const e = ENEMIES.find((x) => x.id === id);
      assert.ok(e, `Корабль ${id} не найден в ENEMIES`);
      assert.equal(e.energy,   ref.energy,   `${id}: energy должна быть ${ref.energy}, получено ${e.energy}`);
      assert.equal(e.laser,    ref.laser,     `${id}: laser (урон) должен быть ${ref.laser}, получено ${e.laser}`);
      assert.equal(e.missiles, ref.missiles,  `${id}: missiles должны быть ${ref.missiles}, получено ${e.missiles}`);
      assert.equal(e.bounty,   ref.bounty,    `${id}: bounty должна быть ${ref.bounty}, получено ${e.bounty}`);
    });
  }
});

describe('сверка оборудования с PRXS (reference-ships)', () => {
  for (const [id, refPrice] of Object.entries(REFERENCE_EQUIPMENT)) {
    it(`${id}: цена = ${refPrice / 10} CR`, () => {
      const item = EQUIPMENT.find((x) => x.id === id);
      assert.ok(item, `Оборудование ${id} не найдено в EQUIPMENT`);
      assert.equal(item.price, refPrice, `${id}: цена должна быть ${refPrice}, получено ${item.price}`);
    });
  }
});

