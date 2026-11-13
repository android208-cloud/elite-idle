/**
 * Эталонный тест контрабанды при взлёте.
 *
 * Источники:
 *   library/common/main/subroutine/bad.asm    — подпрограмма BAD
 *   library/common/main/subroutine/tt110.asm  — запуск со станции
 *
 * BAD:
 *
 *   LDA QQ20+3    \ количество рабов
 *   CLC
 *   ADC QQ20+6    \ + количество наркотиков
 *   ASL A         \ * 2
 *   ADC QQ20+10   \ + количество оружия
 *   RTS
 *
 * TT110:
 *
 *   JSR BAD       \ A = (slaves + narcotics) * 2 + firearms
 *   ORA FIST      \ побитовое ИЛИ с текущим статусом
 *   STA FIST
 *
 * Комментарий оригинала: «FIST of 50 or more gives us fugitive status, so
 * leaving a station carrying 25 tonnes of slaves/narcotics, or 50 tonnes of
 * firearms across multiple trips, is enough to make us a fugitive».
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  contrabandLevel,
  DEFAULT_SETTINGS,
  FIREARMS_INDEX,
  legalAfterLaunch,
  NARCOTICS_INDEX,
  newGame,
  SLAVES_INDEX,
  startJump,
  systemsOf,
  type GameState,
} from '../src/core/state.ts';
import { COMMODITIES } from '../src/core/market.ts';
import { distance } from '../src/core/galaxy.ts';
import { legalLabel } from '../src/core/ships.ts';

const NOW = 1_000_000;
/** Встречи выключены: тест про правовой статус, а не про бои */
const SETTINGS = { ...DEFAULT_SETTINGS, encounterRate: 0 };

/** Трюм с заданным количеством запрещённых товаров, денег хватает на топливо */
function shipWith(load: Partial<Record<'slaves' | 'narcotics' | 'firearms', number>>): GameState {
  const cargo = COMMODITIES.map(() => 0);
  cargo[SLAVES_INDEX] = load.slaves ?? 0;
  cargo[NARCOTICS_INDEX] = load.narcotics ?? 0;
  cargo[FIREARMS_INDEX] = load.firearms ?? 0;
  const tons = cargo.reduce((sum, n, i) => sum + (COMMODITIES[i].unit === 0 ? n : 0), 0);
  return { ...newGame(1), cargo, holdSpace: 20 - tons };
}

describe('контрабанда при взлёте (BAD + TT110)', () => {
  it('индексы товаров совпадают с QQ20+3, QQ20+6, QQ20+10', () => {
    // QQ20 — количество товаров в трюме, порядок совпадает с таблицей QQ23
    assert.equal(SLAVES_INDEX, 3);
    assert.equal(NARCOTICS_INDEX, 6);
    assert.equal(FIREARMS_INDEX, 10);
    assert.equal(COMMODITIES[SLAVES_INDEX].name, 'Рабы / роботы-рабы');
    assert.equal(COMMODITIES[NARCOTICS_INDEX].name, 'Наркотики');
    assert.equal(COMMODITIES[FIREARMS_INDEX].name, 'Оружие');
  });

  it('формула: (рабы + наркотики) * 2 + оружие', () => {
    const levels: [Partial<Record<'slaves' | 'narcotics' | 'firearms', number>>, number][] = [
      [{}, 0],
      [{ slaves: 1 }, 2],
      [{ narcotics: 3 }, 6],
      [{ firearms: 5 }, 5],
      [{ slaves: 2, narcotics: 3 }, 10],
      [{ slaves: 1, narcotics: 1, firearms: 1 }, 5],
      // «25 тонн рабов/наркотиков хватает для статуса беглеца» — 25 * 2 = 50
      [{ slaves: 12, narcotics: 13 }, 50],
    ];
    for (const [load, expected] of levels) {
      assert.equal(contrabandLevel(shipWith(load).cargo), expected, JSON.stringify(load));
    }
  });

  it('статус объединяется побитовым ИЛИ, а не сложением', () => {
    // 0 | 5 = 5
    assert.equal(legalAfterLaunch(0, [0, 0, 0, 1, 0, 0, 0]), 2);
    // 2 | 2 = 2 (сложение дало бы 4)
    assert.equal(legalAfterLaunch(2, [0, 0, 0, 1, 0, 0, 0]), 2);
    // 1 | 4 = 5 (сложение дало бы 5 — совпадает случайно)
    assert.equal(legalAfterLaunch(1, [0, 0, 0, 2, 0, 0, 0]), 5);
    // 8 | 1 = 9, а не 9? проверим случай, где различие очевидно:
    // 5 (0101) | 2 (0010) = 7 (0111), сложение тоже 7
    // 4 (0100) | 2 (0010) = 6, сложение тоже 6
    // 4 | 4 = 4 (сложение дало бы 8) — ключевой случай
    assert.equal(legalAfterLaunch(4, [0, 0, 0, 2, 0, 0, 0]), 4);
    // 64 | 2 = 66
    assert.equal(legalAfterLaunch(64, [0, 0, 0, 1, 0, 0, 0]), 66);
  });

  it('чистый трюм не меняет статус', () => {
    assert.equal(legalAfterLaunch(0, COMMODITIES.map(() => 0)), 0);
    assert.equal(legalAfterLaunch(17, COMMODITIES.map(() => 0)), 17);
  });

  it('25 тонн рабов или наркотиков дают статус беглеца', () => {
    const fugitive = { slaves: 12, narcotics: 13 } as const;
    assert.ok(contrabandLevel(shipWith(fugitive).cargo) >= 50);
    assert.equal(legalLabel(legalAfterLaunch(0, shipWith(fugitive).cargo)), 'Беглец');
  });

  it('результат остаётся в 8-битном диапазоне оригинала', () => {
    // Полный трюм наркотиков и рабов: (35 + 35) * 2 + 35 = 175 — влезает в байт
    const max = shipWith({ slaves: 35, narcotics: 35, firearms: 35 });
    const level = contrabandLevel(max.cargo);
    assert.equal(level, 175);
    assert.ok(legalAfterLaunch(255, max.cargo) <= 255);
  });
});

describe('применение контрабанды при старте прыжка', () => {
  const target = (g: GameState): number => {
    const systems = systemsOf(g.galaxy);
    const t = systems.findIndex((s, i) => i !== g.system && distance(systems[g.system], s) <= g.fuel);
    assert.ok(t >= 0);
    return t;
  };

  it('взлёт с контрабандой поднимает правовой статус', () => {
    const g = shipWith({ slaves: 2, firearms: 3 });
    assert.equal(g.legal, 0);
    const r = startJump(g, target(g), NOW, SETTINGS);
    assert.equal(r.error, undefined);
    assert.equal(r.state.legal, (2 + 0) * 2 + 3);
  });

  it('взлёт с пустым трюмом статус не меняет', () => {
    const g = { ...newGame(1), legal: 13 };
    const r = startJump(g, target(g), NOW, SETTINGS);
    assert.equal(r.state.legal, 13);
  });

  it('статус не может уменьшиться при взлёте', () => {
    for (const legal of [0, 1, 2, 4, 8, 16, 32, 64, 100, 128, 200, 255]) {
      for (const load of [{}, { slaves: 1 }, { firearms: 1 }, { slaves: 3, firearms: 2 }]) {
        const g = { ...shipWith(load), legal };
        const after = legalAfterLaunch(g.legal, g.cargo);
        assert.ok(after >= legal, `статус упал с ${legal} до ${after}`);
      }
    }
  });

  it('неудачный прыжок (нет топлива) не применяет контрабанду', () => {
    const g = { ...shipWith({ slaves: 5 }), fuel: 0 };
    const systems = systemsOf(1);
    const far = systems.findIndex((s) => distance(systems[g.system], s) > 0);
    const r = startJump(g, far, NOW, SETTINGS);
    assert.equal(r.error, 'too-far');
    assert.equal(r.state.legal, 0, 'статус не должен меняться без взлёта');
  });
});
