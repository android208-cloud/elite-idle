/**
 * §133.15: ФЛОТ ПОСЛЕ ГАЛАКТИЧЕСКОГО ПРЫЖКА.
 *
 * Пользователь: «пилоты, оставшиеся в старой галактике, не должны быть видны в
 * ангаре новой и кредиты от них не должны поступать (но должны копиться и быть
 * зачислены на счёт игрока по возвращении)». И отдельно: «после перехода в
 * другую галактику на карте остались старые маршруты пилотов».
 *
 * Здесь проверяется ядро:
 *  1. прыжок не уносит флот: пилот остаётся в своей галактике;
 *  2. в чужой галактике он летает по СВОИМ системам, а деньги копятся у него,
 *     а не на счёте;
 *  3. при возвращении накопленное зачисляется, и пилот снова работает напрямую;
 *  4. полиция чужой галактики не поднимает надзор в этой;
 *  5. пирату в чужой галактике нечего делать с вашим розыском;
 *  6. маршрут пилоту из другой галактики отсюда не назначить.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS,
  advance,
  assignPilotRoute,
  awayFleetOutstanding,
  creditAwayFleet,
  galacticJump,
  hirePilot,
  nextGalaxyArrival,
  newGame,
  pilotGalaxy,
  serialize,
  deserialize,
  surveillanceMap,
  type GameState,
} from '../src/core/state.ts';
import { PILOT_MIN_KILLS } from '../src/core/fleet.ts';

const HOUR = 3_600_000;

/** Игрок ранга «Опытный» с одним пилотом на маршруте (LVAVE → REORTE). */
function fleet(): GameState {
  const base = newGame(1);
  const veteran: GameState = { ...base, kills: PILOT_MIN_KILLS, cash: 500_000, pilots: [], nextPilotId: 1 };
  const hired = hirePilot(veteran, 'adder', 1_000_000);
  assert.equal(hired.error, undefined);
  const routed = assignPilotRoute(hired.state, 1, 39, 1_000_000);
  assert.equal(routed.error, undefined);
  return {
    ...routed.state,
    ship: { ...routed.state.ship, galacticHyperdrive: true },
  };
}

describe('§133.15 прыжок не уносит флот', () => {
  it('пилот остаётся в старой галактике, а игрок улетает', () => {
    const before = fleet();
    const r = galacticJump(before, 2_000_000);
    assert.equal(r.error, undefined);
    assert.equal(before.galaxy, 1);
    assert.equal(r.state.galaxy, 2);
    assert.equal(r.state.pilots.length, 1);
    assert.equal(pilotGalaxy(r.state, r.state.pilots[0]), 1, 'пилот не переехал вместе с кораблём');
    assert.notEqual(r.state.pilots[0].route, null, 'и маршрут свой сохранил');
  });

  it('старый сейв без поля галактики считается местным', () => {
    const s = fleet();
    const raw = JSON.parse(serialize(s)) as Record<string, unknown>;
    (raw.pilots as Record<string, unknown>[])[0].galaxy = undefined;
    delete (raw.pilots as Record<string, unknown>[])[0].galaxy;
    const back = deserialize(JSON.stringify(raw));
    assert.equal(back.pilots[0].galaxy, back.galaxy, 'миграция подставила текущую галактику');
    assert.equal(back.pilots[0].pending, 0);
  });
});

describe('§133.15 деньги копятся у пилота', () => {
  it('в чужой галактике счёт не растёт, а копится долг флота', () => {
    const away = galacticJump(fleet(), 2_000_000).state;
    const cash = away.cash;
    const later = advance(away, 2_000_000 + 200 * HOUR, DEFAULT_SETTINGS);
    assert.equal(later.state.cash, cash, 'на счёт ничего не пришло');
    const pending = awayFleetOutstanding(later.state, 1);
    assert.ok(pending > 0, `накоплено ${pending}`);
    assert.equal(later.state.pilots[0].pending, pending);
    assert.equal(awayFleetOutstanding(later.state, 2), 0, 'в новой галактике флота нет');
  });

  it('возвращение зачисляет накопленное и обнуляет счёт пилота', () => {
    const away = galacticJump(fleet(), 2_000_000).state;
    const later = advance(away, 2_000_000 + 200 * HOUR, DEFAULT_SETTINGS).state;
    const pending = awayFleetOutstanding(later, 1);
    assert.ok(pending > 0);

    // Возвращаемся в галактику 1: она идёт после 8-й.
    const back = nextGalaxyArrival({ ...later, galaxy: 8, system: later.system }, 3_000_000);
    assert.equal(back.galaxy, 1);
    assert.equal(back.cash, later.cash + pending, 'все сбережения на счёте');
    assert.equal(back.pilots[0].pending, 0);
  });

  it('creditAwayFleet без накоплений ничего не меняет', () => {
    const s = fleet();
    const r = creditAwayFleet(s, 1);
    assert.equal(r.credited, 0);
    assert.equal(r.state, s);
  });
});

describe('§133.15 чужая галактика — чужой мир', () => {
  it('полиция другой галактики не поднимает надзор здесь', () => {
    const base = newGame(3);
    const police = {
      id: 1, name: 'Тест Тестов', ship: 'adder' as const, home: 7,
      route: { from: 7, to: 7 }, nextRunAt: 0, role: 'police' as const,
      runs: 0, failures: 0, transfer: null, galaxy: 2, pending: 0,
    };
    const s: GameState = { ...base, galaxy: 1, pilots: [police] };
    const mapHere = surveillanceMap(s);
    const mapThere = surveillanceMap(s, 2);
    assert.deepEqual(mapHere, surveillanceMap({ ...s, pilots: [] }), 'здесь надзор как без полиции');
    assert.ok(mapThere[7] > mapHere[7], 'а в своей галактике он дежурит');
  });

  it('маршрут пилоту из другой галактики отсюда не назначить', () => {
    const away = galacticJump(fleet(), 2_000_000).state;
    const r = assignPilotRoute(away, 1, 10, 3_000_000);
    assert.equal(r.error, 'none');
  });
});
