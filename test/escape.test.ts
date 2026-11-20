/**
 * Побег от правового статуса (§80).
 *
 * Правила, принятые пользователем:
 * - каждая НОВАЯ планета гасит единицу статуса (накопление, а не подряд);
 * - вернулся на посещённую — откат к статусу на старте побега;
 * - 12 разных планет — статус чист, маршрут сгорает;
 * - новый грабёж обнуляет маршрут: начал грабить — беги заново.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  advance,
  DEFAULT_SETTINGS,
  ESCAPE_PLANETS,
  ESCAPE_PLANETS_OFFENDER,
  ESCAPE_PLANETS_FUGITIVE,
  escapePlanetsFor,
  escapeProgress,
  MAX_FUEL,
  newGame,
  startJump,
  startPatrol,
  systemsOf,
  galacticJump,
  deserialize,
  type GameState,
} from '../src/core/state.ts';
import { distance } from '../src/core/galaxy.ts';

const NOW = 1_000_000;
const HOUR = 3_600_000;
const NO_ENC = { ...DEFAULT_SETTINGS, encounterRate: 0 };
const sys = systemsOf(1);

/** Маршрут из `n` разных систем: каждый прыжок укладывается в полный бак. */
function route(start: number, n: number): number[] {
  const seen = new Set([start]);
  const path = [start];
  let cur = start;
  const walk = (): boolean => {
    if (path.length >= n) return true;
    const near = sys
      .map((_, j) => j)
      .filter((j) => !seen.has(j) && distance(sys[cur], sys[j]) <= MAX_FUEL)
      .sort((a, b) => distance(sys[cur], sys[a]) - distance(sys[cur], sys[b]));
    for (const j of near) {
      seen.add(j);
      path.push(j);
      cur = j;
      if (walk()) return true;
      path.pop();
      seen.delete(j);
      cur = path[path.length - 1]!;
    }
    return false;
  };
  assert.ok(walk(), `маршрут из ${n} систем не построился`);
  return path;
}

/** Один прыжок с полным баком на выходе — чтобы не зависеть от топлива. */
function jump(g: GameState, to: number, at: number): { state: GameState; events: GameState['stats'] extends never ? never : ReturnType<typeof advance>['events'] } {
  const started = startJump(g, to, at, NO_ENC);
  assert.ok(started.state.flight, `прыжок в ${to} не начался: ${started.error}`);
  const r = advance(started.state, at + HOUR, NO_ENC);
  return { state: { ...r.state, fuel: MAX_FUEL }, events: r.events };
}

/** Побег из `count` планет, возвращает состояние и тексты событий. */
function escapeRun(legal: number, count: number, from = 7) {
  const path = route(from, count + 1);
  let g: GameState = { ...newGame(1), system: from, legal, escapeRoute: [], escapeStatus: -1, fuel: MAX_FUEL };
  const texts: string[] = [];
  let at = NOW;
  for (const to of path.slice(1)) {
    const r = jump(g, to, at);
    g = r.state;
    at += HOUR;
    for (const e of r.events) if (e.type.startsWith('escape')) texts.push(e.text);
  }
  return { state: g, texts, path };
}

describe('§80: побег от статуса', () => {
  it('каждая планета гасит ДОЛЮ статуса', () => {
    /*
     * §80.1: деление при прибытии отменено — гасит только маршрут.
     * 60 × (12 − 5) / 12 = 35. Раньше гасило по единице (55), но от 255
     * так не избавиться за 12 планет.
     */
    const r = escapeRun(60, 5);
    assert.equal(r.state.legal, 35, '60 × 7/12');
    assert.equal(r.state.escapeRoute.length, 5);
    assert.equal(r.state.escapeStatus, 60, 'снимок — статус на старте побега');
    assert.ok(r.texts[0]!.includes('1/12'));
  });

  it('ступени 6-8-12 оживают сами', () => {
    // На 6 планетах статус уже не «беглец», на 9 — почти чист.
    assert.equal(escapeRun(60, 6).state.legal, 30, 'половина');
    assert.equal(escapeRun(60, 9).state.legal, 15, 'четверть');
    assert.equal(escapeRun(60, 11).state.legal, 5, 'почти чист');
  });

  it(`набрал ${ESCAPE_PLANETS} разных планет — статус чист`, () => {
    const r = escapeRun(60, ESCAPE_PLANETS);
    assert.equal(r.state.legal, 0, 'статус обнулён');
    assert.equal(r.state.escapeRoute.length, 0, 'маршрут сгорел');
    assert.equal(r.state.escapeStatus, -1, 'маршрута нет');
    assert.ok(r.texts.some((t) => t.includes('Побег удался')));
  });

  it('возврат на посещённую планету откатывает статус к началу побега', () => {
    const path = route(7, 5);
    let g: GameState = { ...newGame(1), system: 7, legal: 60, escapeRoute: [], escapeStatus: -1, fuel: MAX_FUEL };
    let at = NOW;
    for (const to of path.slice(1, 4)) {
      const r = jump(g, to, at);
      g = r.state;
      at += HOUR;
    }
    assert.equal(g.legal, 45, '60 × 9/12');

    // Возвращаемся на первую планету маршрута — побег провален.
    const back = jump(g, path[1]!, at);
    assert.equal(back.state.legal, 60, 'статус вернулся к началу побега');
    assert.equal(back.state.escapeRoute.length, 0, 'маршрут сгорел');
    assert.ok(back.events.some((e) => e.type === 'escape-reset'));
  });

  it('у чистого пилота статус не растёт сам', () => {
    // Деление при прибытии сохранилось для чистых: делить нуль нечего.
    const r = escapeRun(0, 3);
    assert.equal(r.state.legal, 0);
    assert.equal(r.state.escapeRoute.length, 0, 'маршрут не ведётся');
    assert.equal(r.texts.length, 0, 'событий побега нет');
  });

  it('новый грабёж обнуляет маршрут', () => {
    const r = escapeRun(60, 3);
    assert.equal(r.state.escapeRoute.length, 3);
    assert.equal(r.state.legal, 45, '60 × 9/12');

    const gun = { ...r.state.ship, laser: 'military' as const, ecm: true, energyBomb: true, missiles: 4 };
    const patrolled = startPatrol({ ...r.state, ship: gun }, NOW + 10 * HOUR).state;
    const raided = advance(
      {
        ...patrolled,
        encounter: { role: 'trader', enemyId: 'cobra3', detectedAt: NOW + 10 * HOUR, resolveAt: NOW + 10 * HOUR + 30_000, outcome: 'attack' },
      },
      NOW + 11 * HOUR,
      DEFAULT_SETTINGS,
    ).state;

    assert.ok(raided.legal > 45, 'статус вырос от грабежа');
    assert.equal(raided.escapeRoute.length, 0, 'маршрут сгорел');
    assert.equal(raided.escapeStatus, -1, 'побег надо начинать заново');
  });

  it('галактический прыжок — полная амнистия', () => {
    const g: GameState = { ...newGame(1), legal: 200, escapeRoute: [1, 2, 3], escapeStatus: 205 };
    const jumped = galacticJump({ ...g, ship: { ...g.ship, galacticHyperdrive: true } }).state;
    assert.equal(jumped.legal, 0);
    assert.equal(jumped.escapeRoute.length, 0);
    assert.equal(jumped.escapeStatus, -1);
  });

  it('§80.1: контрабанда в трюме не даёт бежать', () => {
    // 5 рабов — вес 10. Маршрут не начинается: везёшь контрабанду —
    // не бежишь от закона, а продолжаешь преступление.
    const path = route(7, 3);
    const cargo = Array.from({ length: 17 }, (_, i) => (i === 3 ? 5 : 0));
    const g: GameState = { ...newGame(1), system: 7, legal: 60, escapeRoute: [], escapeStatus: -1, fuel: MAX_FUEL, cargo };
    const r = jump(g, path[1]!, NOW);
    assert.equal(r.state.escapeRoute.length, 0, 'маршрут не начался');
    assert.ok(r.state.legal > 60, 'контрабанда добавила статуса');
  });

  it('§80.1: контрабанда посреди побега сжигает маршрут', () => {
    const path = route(7, 5);
    const cargo = Array.from({ length: 17 }, (_, i) => (i === 3 ? 5 : 0));
    const g: GameState = {
      ...newGame(1),
      system: path[3]!,
      legal: 45,
      escapeRoute: [path[1]!, path[2]!, path[3]!],
      escapeStatus: 60,
      fuel: MAX_FUEL,
      cargo,
    };
    const r = jump(g, path[4]!, NOW);
    assert.equal(r.state.escapeRoute.length, 0, 'маршрут сгорел');
    assert.equal(r.state.legal, 60, 'статус вернулся к началу побега');
    assert.ok(r.events.some((e) => e.type === 'escape-reset'));
  });

  it('§84: нарушитель откупается 6 планетами', () => {
    const r = escapeRun(30, 6);
    assert.equal(r.state.legal, 0, '30 → 25 → 20 → 15 → 10 → 5 → 0');
    assert.equal(r.state.escapeRoute.length, 0, 'маршрут сгорел');
  });

  it('§84: беглец откупается 12 планетами', () => {
    const r = escapeRun(60, 12);
    assert.equal(r.state.legal, 0);
    assert.equal(r.state.escapeRoute.length, 0);
  });

  it('§84: на шестой планете беглец ещё НЕ чист', () => {
    // Разница ступеней: у нарушителя шестая планета закрывает побег,
    // у беглеца — только половина пути.
    const r = escapeRun(60, 6);
    assert.equal(r.state.legal, 30, '60 × 6/12');
    assert.equal(r.state.escapeRoute.length, 6, 'маршрут продолжается');
  });

  it('§84: граница ступеней — 49 и 50', () => {
    assert.equal(escapePlanetsFor(1), ESCAPE_PLANETS_OFFENDER);
    assert.equal(escapePlanetsFor(49), ESCAPE_PLANETS_OFFENDER, 'ещё нарушитель');
    assert.equal(escapePlanetsFor(50), ESCAPE_PLANETS_FUGITIVE, 'уже беглец');
    assert.equal(escapePlanetsFor(255), ESCAPE_PLANETS_FUGITIVE);
  });

  it('старый файл без полей побега загружается', () => {
    const g = newGame(1);
    const { escapeRoute: _r, escapeStatus: _s, ...old } = g;
    const s = deserialize(JSON.stringify({ ...old, version: 2 }));
    assert.deepEqual(s.escapeRoute, [], 'маршрут пуст');
    assert.equal(s.escapeStatus, -1, 'побега нет');
  });

  /*
   * §121: СЧЁТЧИК ПОБЕГА.
   *
   * Правила не менялись — менялась только видимость. Пользователь второй
   * раз оказался «Беглецом» и не знал, что с этим делать: маршрут побега
   * был пуст, а в интерфейсе о нём не было ни слова.
   */
  it('§121: до старта счётчик называет нужное число планет', () => {
    const fugitive: GameState = { ...newGame(1), legal: 255, escapeRoute: [], escapeStatus: -1 };
    assert.deepEqual(escapeProgress(fugitive), { done: 0, need: 12 }, '65535 не бывает: 12 планет');
    const offender: GameState = { ...fugitive, legal: 20 };
    assert.deepEqual(escapeProgress(offender), { done: 0, need: 6 }, 'нарушителю хватит шести');
  });

  it('§121: в пути счётчик показывает пройденное', () => {
    const r = escapeRun(255, 5);
    assert.deepEqual(escapeProgress(r.state), { done: 5, need: 12 }, '5 из 12');
  });

  it('§121: после победы счётчик пуст', () => {
    const r = escapeRun(255, 12);
    assert.deepEqual(escapeProgress(r.state), { done: 0, need: 0 }, 'статус чист — бежать не от чего');
    assert.equal(r.state.legal, 0);
  });
});
