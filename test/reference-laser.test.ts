/**
 * Эталонный тест мощности лазеров игрока.
 *
 * Источники (disc-версия, `versions/disc/` в elite-source-code-library):
 *
 *   elite-source-docked.asm:
 *     POW    = 15                    \\ Pulse laser power
 *     Mlas   = 50                    \\ Mining laser power
 *     Armlas = INT(128.5 + 1.5*POW)  \\ Military laser power = 151
 *
 *   eqshp.asm, покупка лазеров:
 *     LDA #POW          : STA LASER,X   \\ импульсный — байт 15
 *     LDA #POW+128      : STA LASER,X   \\ луч        — байт 143
 *     LDA #Armlas       : STA LASER,X   \\ военный    — байт 151
 *     LDA #Mlas         : STA LASER,X   \\ добывающий — байт 50
 *
 *   main_flight_loop_part_3_of_16.asm, выстрел:
 *     PHA                    \\ сохранить байт LASER текущего вида
 *     AND #%01111111         \\ LAS = биты 0-6  (бит 7 = «луч, а не импульс»)
 *     STA LAS
 *
 *   main_flight_loop_part_11_of_16.asm, попадание:
 *     LDA INWK+35            \\ энергия цели
 *     SEC : SBC LAS          \\ минус сила удара
 *
 * Ключевой вывод: байт LASER — это НЕ мощность. Мощность — его биты 0-6.
 * Поэтому у луча (143) мощность 15, а у военного (151) — 23.
 *
 * Независимое подтверждение из того же файла: оригинал отличает военный
 * лазер сравнением `CMP #(Armlas AND 127)`, то есть с 23 — если бы сила
 * удара была 151, это сравнение никогда бы не сработало.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LASER_POWER } from '../src/core/combat.ts';

/** Значения констант из elite-source-docked.asm. */
const POW = 15;
const Mlas = 50;
const Armlas = Math.floor(128.5 + 1.5 * POW);

/** Байт LASER, который пишется при покупке (eqshp.asm). */
const LASER_BYTE = {
  pulse: POW,
  beam: POW + 128,
  military: Armlas,
  mining: Mlas,
} as const;

/** Сила удара = биты 0-6 байта LASER (main_flight_loop_part_3_of_16.asm). */
const lasOf = (laserByte: number): number => laserByte & 0x7f;

describe('константы оригинала', () => {
  it('POW, Mlas и Armlas совпадают с elite-source-docked.asm', () => {
    assert.equal(POW, 15);
    assert.equal(Mlas, 50);
    assert.equal(Armlas, 151, 'INT(128.5 + 1.5*15) = 151');
  });

  it('байты LASER при покупке: 15, 143, 151, 50', () => {
    assert.equal(LASER_BYTE.pulse, 15);
    assert.equal(LASER_BYTE.beam, 143, 'POW + 128');
    assert.equal(LASER_BYTE.military, 151);
    assert.equal(LASER_BYTE.mining, 50);
  });
});

describe('сила удара = биты 0-6 байта LASER', () => {
  it('импульсный: 15 → 15', () => {
    assert.equal(lasOf(LASER_BYTE.pulse), 15);
  });

  it('луч: 143 → 15, а не 47 и не 143', () => {
    assert.equal(lasOf(LASER_BYTE.beam), 15);
    // Бит 7 — это признак «луч», а не добавка к мощности
    assert.equal(LASER_BYTE.beam & 0x80, 0x80);
  });

  it('военный: 151 → 23, а не 151', () => {
    assert.equal(lasOf(LASER_BYTE.military), 23);
    assert.equal(LASER_BYTE.military & 0x80, 0x80);
  });

  it('добывающий: 50 → 50 (бит 7 не установлен)', () => {
    assert.equal(lasOf(LASER_BYTE.mining), 50);
    assert.equal(LASER_BYTE.mining & 0x80, 0);
  });
});

describe('мощность лазеров в бою совпадает с оригиналом', () => {
  it('Pulse = 15', () => {
    assert.equal(LASER_POWER.pulse, lasOf(LASER_BYTE.pulse));
  });

  it('Beam = 15 (луч не мощнее импульсного, он «непрерывный»)', () => {
    assert.equal(LASER_POWER.beam, lasOf(LASER_BYTE.beam));
    assert.equal(LASER_POWER.beam, LASER_POWER.pulse);
  });

  it('Military = 23', () => {
    assert.equal(LASER_POWER.military, lasOf(LASER_BYTE.military));
  });

  it('Mining = 50', () => {
    assert.equal(LASER_POWER.mining, lasOf(LASER_BYTE.mining));
  });

  it('без лазера урона нет', () => {
    assert.equal(LASER_POWER.none, 0);
  });

  it('порядок мощности: нет < импульсный = луч < военный < добывающий', () => {
    assert.ok(LASER_POWER.none < LASER_POWER.pulse);
    assert.equal(LASER_POWER.pulse, LASER_POWER.beam);
    assert.ok(LASER_POWER.beam < LASER_POWER.military);
    assert.ok(LASER_POWER.military < LASER_POWER.mining);
  });
});

describe('проверка на ошибку, которую мы исправляли', () => {
  it('ни одно значение не равно сырым константам Armlas или POW+32', () => {
    // Раньше стояло 151 (Armlas как есть) и 47 (POW + 32) — обе величины неверны
    for (const v of Object.values(LASER_POWER)) {
      assert.notEqual(v, 151, 'Armlas без маски');
      assert.notEqual(v, 47, 'POW + 32');
    }
  });

  it('все значения влезают в 7 бит (бит 7 — не мощность)', () => {
    for (const v of Object.values(LASER_POWER)) {
      assert.ok(v >= 0 && v <= 127, `значение ${v} выходит за биты 0-6`);
    }
  });
});
