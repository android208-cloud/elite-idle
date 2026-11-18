/**
 * §97: дрейфующий контейнер не делает игрока преступником.
 *
 * §93 закрыл автоподбор из обломков: автоматика не берёт рабов и наркотики.
 * Но нашёлся третий путь — контейнер, который попадается прямо в полёте и
 * подбирается влёт, без экрана и без вопроса. Он брал ЛЮБОЙ из шестнадцати
 * товаров, включая рабов (3), наркотики (6) и оружие (10).
 *
 * Две беды сразу:
 *   1. запрещёнка попадала в трюм без решения игрока (то же, что §93);
 *   2. правовой статус при этом не рос — игрок вёз рабов, оставаясь
 *      «чистым», а контрабанда в трюме запрещает побег от статуса (§80.1).
 *
 * Правило: у влётного подбора нет экрана, значит и осознанного выбора нет.
 * Не берём — и говорим почему, чтобы это не выглядело потерей груза.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  newGame, startPatrol, advance, salvageTakeAll,
  DEFAULT_SETTINGS, MAX_FUEL, SLAVES_INDEX, NARCOTICS_INDEX, FIREARMS_INDEX,
} from '../src/core/state.ts';
import { isContraband } from '../src/core/cargo-canisters.ts';

const scopper = (rng: number): ReturnType<typeof newGame> => {
  const b = newGame(rng);
  return {
    ...b,
    fuel: MAX_FUEL,
    ship: { ...b.ship, laser: 'military' as const, missiles: 4, ecm: true, energyBomb: true, fuelScoops: true, cargoBayExtended: true },
  };
};

/** Контейнеры с запрещённым товаром, которые реально попали в трюм. */
const contrabandInHold = (cargo: readonly number[]): number =>
  cargo.reduce((n, v, i) => n + (isContraband(i) ? v : 0), 0);

test('§97: за 300 патрулей запрещёнка не попадает в трюм ни разу', () => {
  let hits = 0;
  let drifting = 0;
  for (const autoScoop of [false, true]) {
    for (let seed = 1; seed <= 150; seed++) {
      let s = startPatrol(scopper(seed), 1000).state;
      let t = 1000;
      for (let i = 0; i < 300 && s.flight; i++) {
        t += 3000;
        const r = advance(s, t, { ...DEFAULT_SETTINGS, autoScoop });
        s = r.state;
        drifting += r.events.filter((e) => e.type === 'canister').length;
        // Как живой игрок: любой экран обломков закрываем «Взять всё».
        while (s.salvage) s = salvageTakeAll(s, t).state;
      }
      if (contrabandInHold(s.cargo) > 0) hits += 1;
    }
  }
  assert.ok(drifting > 100, `контейнеры должны были попадаться, а их ${drifting}`);
  assert.equal(hits, 0, `запрещёнка попала в трюм в ${hits} прогонах из 300`);
});

test('§97: пройденный контейнер с запрещёнкой объяснён в журнале', () => {
  let explained = 0;
  for (let seed = 1; seed <= 60 && explained === 0; seed++) {
    let s = startPatrol(scopper(seed), 1000).state;
    let t = 1000;
    for (let i = 0; i < 300 && s.flight; i++) {
      t += 3000;
      const r = advance(s, t, { ...DEFAULT_SETTINGS, autoScoop: true });
      s = r.state;
      for (const e of r.events) {
        if (e.type !== 'canister') continue;
        if (!/Рабы|Наркотики|Оружие/.test(e.text)) continue;
        // Не «нет места» и не «нет топливосборщика» — именно отказ по закону.
        assert.ok(/проходим мимо/.test(e.text), `без причины: ${e.text}`);
        assert.ok(/преступник/.test(e.text), `без объяснения: ${e.text}`);
        explained += 1;
      }
      while (s.salvage) s = salvageTakeAll(s, t).state;
    }
  }
  assert.ok(explained > 0, 'ни одного контейнера с запрещёнкой за 60 патрулей — проверка ничего не проверила');
});

test('§97: чистый контейнер по-прежнему подбирается', () => {
  // Правило не должно превратиться в «ничего не подбираем».
  let clean = 0;
  for (let seed = 1; seed <= 30; seed++) {
    let s = startPatrol(scopper(seed), 1000).state;
    let t = 1000;
    for (let i = 0; i < 300 && s.flight; i++) {
      t += 3000;
      const r = advance(s, t, { ...DEFAULT_SETTINGS, autoScoop: true });
      s = r.state;
      for (const e of r.events) if (e.type === 'canister' && /^Подобран контейнер/.test(e.text)) clean += 1;
      while (s.salvage) s = salvageTakeAll(s, t).state;
    }
  }
  assert.ok(clean > 0, 'чистые контейнеры перестали подбираться');
});

test('§97: контрабанда определяется по тем же трём товарам', () => {
  for (const i of [SLAVES_INDEX, NARCOTICS_INDEX, FIREARMS_INDEX]) assert.equal(isContraband(i), true);
  for (const i of [0, 1, 4, 5, 7, 8, 12, 13]) assert.equal(isContraband(i), false, `товар ${i} не запрещён`);
});
