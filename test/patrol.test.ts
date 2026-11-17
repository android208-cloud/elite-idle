/**
 * Патруль (§78) — полёт внутри системы с расходом топлива.
 *
 * Решения пользователя, которые здесь проверяются:
 * - топливо: 1 за встречу и ещё 1 за бой;
 * - на старт нужно 4 ракеты, тратятся они по факту боя;
 * - ×200 на патруль не действует;
 * - резерв на возврат: патруль не начинается и прекращается, если бака
 *   хватает только в одну сторону;
 * - победа решается СНАРЯЖЕНИЕМ, без симуляции раундов;
 * - Python и Анаконда — только с полным боекомплектом.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  advance,
  DEFAULT_SETTINGS,
  newGame,
  startPatrol,
  startJump,
  PATROL_MISSILES_REQUIRED,
  PATROL_RETURN_RESERVE,
  type GameState,
} from '../src/core/state.ts';
import { canBeat, hasBossKit } from '../src/core/one-decision.ts';
import { ENEMIES, STARTER_SHIP, type PlayerShip } from '../src/core/ships.ts';
import { distance } from '../src/core/galaxy.ts';
import { systemsOf } from '../src/core/state.ts';

const NOW = 1_000_000;
const MIN = 60_000;

const armed = (over: Partial<PlayerShip> = {}): PlayerShip => ({ ...STARTER_SHIP, missiles: 4, ...over });

/** Гоняет патруль до конца, отдавая все события. */
function runPatrol(state: GameState, settings = DEFAULT_SETTINGS) {
  let s = state;
  const events: { type: string; text: string }[] = [];
  let t = NOW;
  for (let i = 0; i < 5000 && s.flight; i++) {
    t += MIN;
    const r = advance(s, t, settings);
    s = r.state;
    for (const e of r.events) events.push({ type: e.type, text: e.text });
  }
  return { state: s, events, ms: t - NOW };
}

describe('патруль: старт', () => {
  it('не начинается без четырёх ракет', () => {
    const g = { ...newGame(1), ship: armed({ missiles: 3 }) };
    const r = startPatrol(g, NOW);
    assert.equal(r.error, 'no-missiles');
    assert.equal(r.state.flight, null, 'полёт не начат');
  });

  it('не начинается, если топлива хватает только на возврат', () => {
    const g = { ...newGame(1), ship: armed(), fuel: PATROL_RETURN_RESERVE };
    const r = startPatrol(g, NOW);
    assert.equal(r.error, 'no-fuel');
  });

  it('начинается и не меняет систему', () => {
    const g = { ...newGame(1), ship: armed() };
    const r = startPatrol(g, NOW);
    assert.ok(!r.error);
    assert.equal(r.state.flight!.patrol, true, 'это патруль');
    assert.equal(r.state.flight!.from, g.system);
    assert.equal(r.state.flight!.to, g.system, 'система та же — прыжка нет');
  });

  it('топливо НЕ списывается авансом', () => {
    const g = { ...newGame(1), ship: armed() };
    const r = startPatrol(g, NOW);
    assert.equal(r.state.fuel, g.fuel, 'бак полный: платим по мере событий');
  });

  it('в полёте патруль не начинается', () => {
    const g = { ...newGame(1), ship: armed() };
    const sys = systemsOf(1);
    const target = sys.findIndex((s, i) => i !== g.system && distance(sys[g.system], s) <= g.fuel);
    const flying = startJump(g, target, NOW, DEFAULT_SETTINGS).state;
    assert.equal(startPatrol(flying, NOW).error, 'in-flight');
  });
});

describe('патруль: расход топлива', () => {
  it('встречи и бои тратят бак, патруль кончается по топливу', () => {
    const g = { ...newGame(1), ship: armed() };
    const { state, events, ms } = runPatrol(startPatrol(g, NOW).state);
    assert.equal(state.flight, null, 'патруль окончен');
    assert.ok(events.some((e) => e.type === 'patrol-end'), 'событие завершения');
    assert.ok(state.fuel <= PATROL_RETURN_RESERVE + 2, `бак почти пуст: ${state.fuel}`);
    // 70 единиц, по 1 на встречу и 1 на бой: часовой патруль, не вечность.
    assert.ok(ms > 10 * MIN && ms < 6 * 60 * MIN, `длительность разумна: ${ms / MIN} мин`);
  });

  it('патруль никогда не оставляет игрока без топлива на возврат', () => {
    const g = { ...newGame(1), ship: armed() };
    let s = startPatrol(g, NOW).state;
    let t = NOW;
    for (let i = 0; i < 5000 && s.flight; i++) {
      t += MIN;
      s = advance(s, t, DEFAULT_SETTINGS).state;
      assert.ok(s.fuel >= 0, 'топливо не уходит в минус');
    }
    assert.ok(s.fuel >= PATROL_RETURN_RESERVE - 2, `остаток на возврат: ${s.fuel}`);
  });

  it('×200 на патруль не действует', () => {
    const g = { ...newGame(1), ship: armed() };
    const slow = runPatrol(startPatrol(g, NOW).state, { ...DEFAULT_SETTINGS, speed: 1 });
    const fast = runPatrol(startPatrol(g, NOW).state, { ...DEFAULT_SETTINGS, speed: 200 });
    const ratio = fast.ms / slow.ms;
    assert.ok(ratio > 0.9 && ratio < 1.1, `длительность не зависит от темпа (${slow.ms / MIN} против ${fast.ms / MIN} мин)`);
  });

  it('пропуск встречи топлива не тратит, бой — тратит', () => {
    // Проверяем через счётчик: он растёт только на победу и на встречу.
    const g = { ...newGame(1), ship: armed() };
    const { state } = runPatrol(startPatrol(g, NOW).state);
    const used = state.stats.patrols;
    assert.equal(used, 1, 'один патруль засчитан');
  });
});

describe('патруль: ракеты', () => {
  /** Подкладывает встречу и доводит её до разрешения. */
  function fight(state: GameState, enemyId: string, at: number) {
    const s: GameState = {
      ...state,
      encounter: { role: 'pirate', enemyId, detectedAt: at, resolveAt: at + 30_000, outcome: 'attack' },
    };
    return advance(s, at + 60_000, DEFAULT_SETTINGS);
  }

  it('на старте все четыре ракеты на месте', () => {
    const g = { ...newGame(1), ship: armed() };
    assert.equal(startPatrol(g, NOW).state.ship.missiles, 4);
  });

  it('на обычного пирата ракета не тратится', () => {
    const g = { ...newGame(1), ship: armed({ laser: 'military', ecm: true, energyBomb: true }) };
    const r = fight(startPatrol(g, NOW).state, 'sidewinder', NOW + 1000);
    assert.equal(r.state.ship.missiles, 4, 'Sidewinder бьётся лазером');
    assert.ok(r.events.some((e) => e.type === 'auto-victory'));
  });

  it('на Python и Анаконду уходит по ракете', () => {
    const g = { ...newGame(1), ship: armed({ laser: 'military', ecm: true, energyBomb: true }) };
    let s = startPatrol(g, NOW).state;
    const first = fight(s, 'anaconda', NOW + 1000);
    assert.equal(first.state.ship.missiles, 3, 'Анаконда: минус ракета');
    s = first.state;
    const second = fight(s, 'python', NOW + 200_000);
    assert.equal(second.state.ship.missiles, 2, 'Python: ещё одна');
  });

  it('без полного набора ракета не тратится — большой просто пропускается', () => {
    // Нет бомбы → Анаконда не по зубам. Ракету на неё не жжём.
    const g = { ...newGame(1), ship: armed({ laser: 'military', ecm: true }) };
    const r = fight(startPatrol(g, NOW).state, 'anaconda', NOW + 1000);
    assert.equal(r.state.ship.missiles, 4, 'ракета цела');
    assert.ok(r.events.some((e) => e.type === 'auto-skip'), 'пропуск');
  });

  it('§78: кончились ракеты — большие пропускаются', () => {
    // Это прямое требование пользователя: «если ракет уже нет и анаконда,
    // то пропуск».
    const g = { ...newGame(1), ship: armed({ laser: 'military', ecm: true, energyBomb: true }) };
    let s = startPatrol(g, NOW).state;
    for (let i = 0; i < 4; i++) s = fight(s, 'anaconda', NOW + 1000 + i * 200_000).state;
    assert.equal(s.ship.missiles, 0, 'все четыре израсходованы');
    const fifth = fight(s, 'anaconda', NOW + 1_000_000);
    assert.ok(fifth.events.some((e) => e.type === 'auto-skip'), 'пятая Анаконда пропущена');
  });
});

describe('§78: победа по снаряжению', () => {
  const kit = (over = {}) => ({
    militaryLaser: false,
    ecm: false,
    energyBomb: false,
    missiles: 0,
    ...over,
  });
  const enemy = (id: string) => ENEMIES.find((e) => e.id === id)!;

  it('обычного пирата бьёт любой лазер', () => {
    for (const id of ['sidewinder', 'gecko', 'adder', 'cobra1', 'mamba', 'krait', 'moray']) {
      assert.equal(canBeat(enemy(id), kit(), 'pulse'), true, `${id}: импульсного достаточно`);
    }
  });

  it('Cobra Mk III, Asp и Fer-de-Lance требуют военного лазера', () => {
    for (const id of ['cobra3', 'asp', 'ferdelance']) {
      assert.equal(canBeat(enemy(id), kit(), 'pulse'), false, `${id}: с импульсным пропуск`);
      assert.equal(canBeat(enemy(id), kit({ militaryLaser: true }), 'military'), true, `${id}: с военным победа`);
    }
  });

  it('Python и Анаконда — только с полным боекомплектом', () => {
    for (const id of ['python', 'anaconda']) {
      assert.equal(canBeat(enemy(id), kit({ militaryLaser: true }), 'military'), false, `${id}: одного лазера мало`);
      assert.equal(canBeat(enemy(id), kit({ militaryLaser: true, ecm: true }), 'military'), false, `${id}: без бомбы мало`);
      assert.equal(
        canBeat(enemy(id), kit({ militaryLaser: true, ecm: true, energyBomb: true, missiles: 4 }), 'military'),
        true,
        `${id}: полный набор — победа`,
      );
    }
  });

  it('без ракет большие снова пропускаются', () => {
    const noMissiles = kit({ militaryLaser: true, ecm: true, energyBomb: true, missiles: 0 });
    assert.equal(hasBossKit(noMissiles), false);
    assert.equal(canBeat(enemy('anaconda'), noMissiles, 'military'), false);
  });

  it('§79: canBeat больше не смотрит на «пират ли» — это решает режим', () => {
    // До §79 здесь проверялось, что полицию не бьёт никто. Теперь правило
    // «кого можно одолеть» отделено от правила «на кого можно напасть»:
    // в пиратстве в зачёт идут все, и режим решает вызывающая сторона.
    const full = kit({ militaryLaser: true, ecm: true, energyBomb: true, missiles: 4 });
    assert.equal(canBeat(enemy('viper'), full, 'military'), true, 'полицию можно одолеть');
  });
});
