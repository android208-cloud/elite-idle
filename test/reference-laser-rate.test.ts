/**
 * Эталонный тест ТЕМПА ОГНЯ лазеров.
 *
 * Дополняет `reference-laser.test.ts`, который проверяет силу одного удара.
 * Здесь — как часто лазер вообще стреляет. Механика в оригинале составная,
 * и без второй половины получается неверный баланс.
 *
 * --- Половина 1: счётчик LASCT ---
 *
 * main_flight_loop_part_3_of_16.asm:
 *
 *   LDA LASCT              \\ если не ноль — лазер «между импульсами»
 *   BNE MA3                \\ (пропустить выстрел)
 *   ...
 *   AND #%01111111         \\ LAS = сила удара
 *   STA LAS
 *   STA LAS2
 *   ...
 *   AND #%11111010         \\ LASCT = 0 у лазеров с битом 7 (луч, военный),
 *   STA LASCT              \\ иначе power & %11111010
 *
 * irq1.asm:
 *
 *   LDA LASCT : BEQ P%+5 : DEC LASCT   \\ декремент на каждый VSYNC (50 Гц)
 *
 * --- Половина 2: перегрев GNTMP ---
 *
 * main_flight_loop_part_3_of_16.asm:
 *
 *   LDA GNTMP : CMP #242 : BCS MA3     \\ перегрет — не стрелять
 *
 * lasli.asm (при выстреле):
 *
 *   LDA GNTMP : ADC #8 : STA GNTMP     \\ +8 за выстрел
 *
 * main_game_loop_part_5_of_6.asm (охлаждение):
 *
 *   LDX GNTMP : BEQ EE20 : DEC GNTMP   \\ −1 за проход главного цикла
 *
 * --- Почему нельзя взять только LASCT ---
 *
 * У луча и военного `LASCT = 0` постоянно, то есть по одному счётчику они
 * стреляли бы 50 раз в секунду — в 10 раз чаще импульсного. Именно перегрев
 * приводит темп к реальному: +8 за выстрел против −1 за кадр, порог 242.
 *
 * Итоговые отношения (импульсный = 1):
 *   луч/военный  ≈ x1.39
 *   добывающий   ≈ x0.22
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LASER_POWER, LASER_RATE } from '../src/core/combat.ts';

const POW = 15;
const Mlas = 50;
const Armlas = Math.floor(128.5 + 1.5 * POW);

/** Байты LASER из eqshp.asm. */
const BYTE = { pulse: POW, beam: POW + 128, military: Armlas, mining: Mlas } as const;

describe('LASCT: счётчик импульсов', () => {
  it('после выстрела LASCT = power & %11111010 (не просто power)', () => {
    // main_flight_loop_part_3_of_16.asm: AND #%11111010
    assert.equal(POW & 0xfa, 10, 'импульсный: 15 (00001111) → 10 (00001010)');
    assert.equal(Mlas & 0xfa, 50, 'добывающий: младший бит и так 0, остаётся 50');
  });

  it('у лазеров с битом 7 LASCT = 0, они не пульсируют', () => {
    assert.equal(BYTE.beam & 0x80, 0x80);
    assert.equal(BYTE.military & 0x80, 0x80);
    assert.equal(BYTE.pulse & 0x80, 0);
    assert.equal(BYTE.mining & 0x80, 0);
  });
});

describe('перегрев ограничивает непрерывные лазеры', () => {
  it('луч не стреляет в 10 раз чаще импульсного, хотя LASCT у него 0', () => {
    // Если бы учитывался только LASCT, вышло бы 50/5 = x10
    const naiveRatio = 10;
    const realRatio = LASER_RATE.beam / LASER_RATE.pulse;
    assert.ok(
      realRatio < naiveRatio / 2,
      `учёт перегрева должен сильно снижать темп луча: ${realRatio.toFixed(2)} против ${naiveRatio}`,
    );
  });

  it('луч быстрее импульсного, но не в разы', () => {
    const ratio = LASER_RATE.beam / LASER_RATE.pulse;
    assert.ok(ratio > 1, 'луч должен стрелять чаще импульсного');
    assert.ok(ratio < 2, `отношение ${ratio.toFixed(2)} выходит за разумные рамки`);
  });

  it('луч и военный имеют одинаковый темп (оба с LASCT = 0)', () => {
    assert.equal(LASER_RATE.beam, LASER_RATE.military);
  });

  it('добывающий лазер медленнее импульсного', () => {
    assert.ok(LASER_RATE.mining < LASER_RATE.pulse);
  });
});

describe('порядок лазеров по урону в секунду', () => {
  const dps = (k: keyof typeof LASER_RATE): number => LASER_POWER[k] * LASER_RATE[k];

  it('нет < добывающий < импульсный < луч < военный', () => {
    assert.equal(dps('none'), 0);
    assert.ok(dps('mining') < dps('pulse'));
    assert.ok(dps('pulse') < dps('beam'));
    assert.ok(dps('beam') < dps('military'));
  });

  it('военный лазер — самый мощный, как и задумано в оригинале', () => {
    const all = (['pulse', 'beam', 'military', 'mining'] as const).map(dps);
    assert.equal(dps('military'), Math.max(...all));
  });

  it('луч заметно сильнее импульсного (за счёт темпа, а не удара)', () => {
    // Сила удара у них одинаковая (15), разница только в темпе
    assert.equal(LASER_POWER.beam, LASER_POWER.pulse);
    assert.ok(dps('beam') / dps('pulse') > 1.2);
  });
});

describe('граничные случаи', () => {
  it('без лазера темпа нет', () => {
    assert.equal(LASER_RATE.none, 0);
  });

  it('все темпы конечны и положительны', () => {
    for (const [k, v] of Object.entries(LASER_RATE)) {
      if (k === 'none') continue;
      assert.ok(Number.isFinite(v), `${k}: не число`);
      assert.ok(v > 0 && v <= 50, `${k}: ${v} вне диапазона 0..50`);
    }
  });
});
