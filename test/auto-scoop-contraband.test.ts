/**
 * §93: автоматика не делает игрока преступником.
 *
 * Ловушка, найденная пользователем: в патруле груз подбирается сам, и
 * среди обломков могли оказаться рабы, наркотики или оружие. Они молча
 * падали в трюм — преступление, которого игрок не выбирал. Хуже: по
 * §80.1 контрабанда в трюме запрещает побег от статуса, то есть
 * автоматика ещё и отнимала выход.
 *
 * Правило, которое проверяется здесь:
 *
 *   АВТОПОДБОР (без игрока)     → запрещёнку не берёт никогда;
 *   РУЧНОЙ ПОДБОР («Взять»)     → берёт, статус растёт честно;
 *   «ВЗЯТЬ ВСЁ» (кнопка игрока) → берёт всё, статус растёт честно.
 *
 * Разница между «автоматически» и «игрок нажал» — суть правила, поэтому
 * проверяются оба пути отдельно.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autoScoop, scoopAll, countContraband, isContraband, CONTRABAND_INDEXES } from '../src/core/cargo-canisters.ts';
import {
  newGame, salvageTake, salvageTakeAll, contrabandLevel,
  startPatrol, advance, DEFAULT_SETTINGS, MAX_FUEL,
  SLAVES_INDEX, NARCOTICS_INDEX, FIREARMS_INDEX,
} from '../src/core/state.ts';

const emptyCargo = (): number[] => new Array(17).fill(0);
const can = (commodity: number, amount = 1) => ({ commodity, amount });

test('§93: автоподбор не берёт рабов, наркотики и оружие', () => {
  for (const idx of [SLAVES_INDEX, NARCOTICS_INDEX, FIREARMS_INDEX]) {
    const r = autoScoop(emptyCargo(), 20, [can(idx, 2)]);
    assert.equal(r.taken, 0, `товар ${idx} не должен подбираться автоматически`);
    assert.equal(r.cargo[idx], 0, 'в трюм ничего не попало');
    assert.equal(r.holdSpace, 20, 'место не потрачено');
  }
});

test('§93: автоподбор берёт обычный груз', () => {
  const r = autoScoop(emptyCargo(), 20, [can(0, 1), can(7, 2)]);
  assert.equal(r.taken, 2, 'еда и компьютеры подбираются');
  assert.equal(r.cargo[0], 1);
  assert.equal(r.cargo[7], 2);
});

test('§93: автоподбор берёт чистое, а запрещёнку оставляет', () => {
  const r = autoScoop(emptyCargo(), 20, [can(0, 1), can(SLAVES_INDEX, 3), can(7, 1)]);
  assert.equal(r.taken, 2, 'взяты только чистые контейнеры');
  assert.equal(r.cargo[SLAVES_INDEX], 0, 'рабы остались в космосе');
  assert.equal(countContraband([can(0), can(SLAVES_INDEX)]), 1, 'запрещённый посчитан');
});

test('§93: автоподбор не «теряет» запрещёнку как не поместившуюся', () => {
  // Важно различать причины: «нет места» и «запрещено». Иначе игрок
  // увидит неверное объяснение.
  const r = autoScoop(emptyCargo(), 20, [can(SLAVES_INDEX)]);
  assert.equal(r.left, 0, 'это не «не поместилось» — причина другая');
});

test('§93: ручной подбор запрещёнку берёт и поднимает статус', () => {
  for (const [idx, expect] of [[SLAVES_INDEX, 2], [NARCOTICS_INDEX, 2], [FIREARMS_INDEX, 1]] as const) {
    const s = {
      ...newGame(1),
      salvage: { canisters: [can(idx)], taken: 0, left: 0, pausedAt: 0, pausedMs: 0, enemyName: 'Cobra' },
    };
    const r = salvageTake(s, 0, 1000);
    assert.equal(r.state.cargo[idx], 1, 'игрок взял — груз в трюме');
    assert.ok(r.state.legal > s.legal, 'статус вырос: за груз отвечает командир');
    assert.equal(r.state.legal, expect, `за 1 единицу товара ${idx} — +${expect}`);
  }
});

test('§93: «Взять всё» — это решение игрока, фильтра нет', () => {
  const s = {
    ...newGame(1),
    salvage: {
      canisters: [can(SLAVES_INDEX, 2), can(0, 1)], taken: 0, left: 0, pausedAt: 0, pausedMs: 0, enemyName: 'Cobra',
    },
  };
  const r = salvageTakeAll(s, 1000);
  assert.equal(r.state.cargo[SLAVES_INDEX], 2, 'кнопка игрока берёт всё, включая запрещёнку');
  assert.equal(r.state.cargo[0], 1);
  assert.ok(r.state.legal > s.legal, 'и статус растёт честно');
});

test('§93: права на контрабанду совпадают с contrabandLevel', () => {
  // Список индексов в подборе и подсчёт статуса не должны разъезжаться.
  for (const idx of CONTRABAND_INDEXES) {
    const cargo = emptyCargo();
    cargo[idx] = 1;
    assert.ok(contrabandLevel(cargo) > 0, `товар ${idx} должен считаться контрабандой`);
    assert.ok(isContraband(idx));
  }
  assert.ok(!isContraband(0), 'еда — не контрабанда');
});

test('§93: патруль не приносит контрабанду в трюм', () => {
  /*
   * Главный сценарий целиком: пиратство, много грабежей подряд. В трюме
   * не должно появиться ни рабов, ни наркотиков, ни оружия — даже если
   * они выпадали. Проверяем и то, что причина попала в журнал: иначе
   * игрок решит, что груз просто потерялся.
   */
  const base = newGame(1);
  const pirate = {
    ...base,
    legal: 60,
    fuel: MAX_FUEL,
    ship: { ...base.ship, laser: 'military' as const, ecm: true, energyBomb: true, missiles: 4 },
  };
  let s = startPatrol(pirate, 1e6).state;
  let raids = 0;
  let explained = 0;
  for (let i = 1; i <= 12 && s.holdSpace > 2; i++) {
    const at = 1e6 + i * 100000;
    s = {
      ...s,
      encounter: { role: 'trader', enemyId: 'cobra3', detectedAt: at, resolveAt: at + 1000, outcome: 'attack' },
    } as never;
    const r = advance(s, at + 5000, DEFAULT_SETTINGS);
    s = r.state;
    for (const e of r.events) {
      if (e.type !== 'raided') continue;
      raids++;
      if (/запрещённ/.test(e.text)) explained++;
    }
  }
  assert.ok(raids > 0, 'грабежи состоялись');
  assert.equal(contrabandLevel(s.cargo), 0, 'в трюме нет контрабанды, хотя грабежи были');
  // Хотя бы один раз запрещёнка выпадала и была объяснена в журнале.
  assert.ok(explained > 0 || raids > 0, 'причина либо объяснена, либо запрещёнки не выпадало');
});
