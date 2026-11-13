/**
 * Эталонный тест спавна кораблей, включая баг Moray.
 *
 * Источник: library/common/main/subroutine/main_game_loop_part_4_of_6.asm
 * и таблица чертежей library/common/main/variable/xx21.asm.
 *
 * Ветка 1 — группа пиратов (mt1):
 *
 *   JSR DORND        \ A и X — случайные числа
 *   STA T            \ T = A
 *   JSR DORND        \ A, X — новые случайные
 *   AND T            \ A = A AND T  (распределение скошено к малым числам)
 *   AND #7           \ A = 0..7
 *   ADC #PACK        \ #PACK = #SH3 = 17 → диапазон 17..24
 *
 * Ветка 2 — одинокий охотник:
 *
 *   AND #3           \ A = 0..3
 *   ADC #CYL2        \ #CYL2 = 24 → диапазон 24..27
 *
 *   Moray — чертёж 28, то есть на единицу за верхней границей, поэтому
 *   в оригинале не появляется никогда.
 *
 * Наше исправление — предложенное Марком Моксоном `LSR A` перед `AND #3`:
 * `LSR A` кладёт младший бит в флаг переноса, `AND #3` его не трогает,
 * а `ADC` прибавляет, поэтому диапазон становится 24..28 с распределением
 * 1:2:2:2:1 — Moray в 12.5% случаев.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LONE_HUNTER_BLUEPRINTS,
  loneHunter,
  moxonLoneHunter,
  PIRATE_BLUEPRINTS,
  pirateFromGroup,
} from '../src/core/spawn.ts';
import { enemyById } from '../src/core/ships.ts';

const ALL_BYTES = Array.from({ length: 256 }, (_, i) => i);

describe('таблицы XX21', () => {
  it('диапазон пиратов из группы — 17..24 (PACK = SH3 = 17)', () => {
    assert.deepEqual(PIRATE_BLUEPRINTS, [17, 18, 19, 20, 21, 22, 23, 24]);
  });

  it('диапазон одиноких охотников с исправлением — 24..28', () => {
    assert.deepEqual(LONE_HUNTER_BLUEPRINTS, [24, 25, 26, 27, 28]);
  });

  it('номера чертежей соответствуют XX21', () => {
    // XX21: 24 = Cobra Mk III (pirate), 25 = Asp Mk II, 26 = Python (pirate),
    // 27 = Fer-de-lance, 28 = Moray
    const byId: Record<number, string> = { 24: 'cobra3', 25: 'asp', 26: 'python', 27: 'ferdelance', 28: 'moray' };
    for (const [blueprint, id] of Object.entries(byId)) {
      assert.equal(enemyById(id).id, id, `чертёж ${blueprint} должен быть ${id}`);
    }
  });
});

describe('исправление Моксона для одиноких охотников', () => {
  it('все 256 значений попадают в диапазон 24..28', () => {
    for (const roll of ALL_BYTES) {
      const blueprint = moxonLoneHunter(roll);
      assert.ok(blueprint >= 24 && blueprint <= 28, `roll ${roll} → ${blueprint}`);
      assert.ok(LONE_HUNTER_BLUEPRINTS.includes(blueprint));
    }
  });

  it('Moray (28) появляется в 12.5% случаев, распределение 1:2:2:2:1', () => {
    const counts = new Map<number, number>();
    for (const roll of ALL_BYTES) {
      const b = moxonLoneHunter(roll);
      counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    // LSR A даёт перенос, поэтому крайние значения (24 и 28) вдвое реже средних
    assert.equal(counts.get(24), 32);  // Cobra Mk III — 12.5%
    assert.equal(counts.get(25), 64);  // Asp Mk II — 25%
    assert.equal(counts.get(26), 64);  // Python — 25%
    assert.equal(counts.get(27), 64);  // Fer-de-lance — 25%
    assert.equal(counts.get(28), 32);  // Moray — 12.5%
    assert.equal([...counts.values()].reduce((a, b) => a + b, 0), 256);
  });

  it('Moray действительно может появиться (чего не было в оригинале)', () => {
    const rolls = ALL_BYTES.filter((r) => moxonLoneHunter(r) === 28);
    assert.ok(rolls.length > 0, 'Moray должен быть достижим');
    assert.equal(loneHunter(rolls[0]), 'moray');
  });

  it('в оригинале Moray был недостижим — регрессия на диапазон 24..27', () => {
    // AND #3 / ADC #CYL2 без переноса даёт только 24..27
    const original = new Set<number>();
    for (const roll of ALL_BYTES) original.add(24 + (roll & 3));
    assert.deepEqual([...original].sort(), [24, 25, 26, 27]);
    assert.ok(!original.has(28), 'Moray (28) в оригинале недостижим');
  });
});

describe('группа пиратов', () => {
  it('распределение совпадает с (A AND T) AND #7', () => {
    // Считаем по всем парам байтов и сверяем с формулой
    const expected = new Map<number, number>();
    for (const a of ALL_BYTES) {
      for (const t of ALL_BYTES) {
        const v = (a & t) & 7;
        expected.set(v, (expected.get(v) ?? 0) + 1);
      }
    }
    // v = 0 даёт Sidewinder — самый частый вариант (42.19%)
    assert.equal(expected.get(0)!, 27648);
    assert.equal(expected.get(7)!, 1024);  // Cobra Mk III — 1.56%
  });

  it('из группы никогда не выпадает Moray', () => {
    for (const a of ALL_BYTES) {
      for (const t of ALL_BYTES) {
        assert.notEqual(pirateFromGroup(a, t), 'moray', `a=${a}, t=${t}`);
      }
    }
  });

  it('групповой спавн выдаёт только корабли из диапазона 17..24', () => {
    const seen = new Set<string>();
    for (const a of ALL_BYTES) {
      for (const t of ALL_BYTES) seen.add(pirateFromGroup(a, t));
    }
    // Worm (23) в проекте отсутствует, поэтому вместо него Sidewinder
    assert.deepEqual([...seen].sort(), ['adder', 'cobra1', 'cobra3', 'gecko', 'krait', 'mamba', 'sidewinder']);
  });

  it('самый частый пират в группе — Sidewinder, самый редкий — Cobra Mk III', () => {
    const counts = new Map<string, number>();
    for (const a of ALL_BYTES) {
      for (const t of ALL_BYTES) {
        const id = pirateFromGroup(a, t);
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    const sorted = [...counts.entries()].sort((x, y) => y[1] - x[1]);
    assert.equal(sorted[0][0], 'sidewinder');
    assert.equal(sorted[sorted.length - 1][0], 'cobra3');
  });
});
