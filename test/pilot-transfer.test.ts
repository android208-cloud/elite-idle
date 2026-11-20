/**
 * §128: пилот переезжает и меняет корабль.
 *
 * Пользователь: «нам ещё нужна возможность менять пилотам планеты и менять
 * им корабли… внутри будут маршруты планеты расположения игрока. Пилот будет
 * добираться туда сам, честно. Топливо ему за перелёт оплатим мы».
 *
 * Проверяется:
 *   1. топливо считается по цене игры (0.2 CR за св. год) и платит его игрок;
 *   2. время в пути — по формуле прыжка; если путь длиннее бака, время
 *      складывается из отрезков (короткий бак действительно медленнее);
 *   3. переезд снимает маршрут, а до прилёта маршрут не назначается;
 *   4. по прилёту пилот снова свободен и летает уже из новой системы;
 *   5. смена корабля идёт по правилу верфи: новый по своей цене, старый в зачёт.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  advance,
  assignPilotRoute,
  DEFAULT_SETTINGS,
  hirePilot,
  movePilot,
  newGame,
  pilotTransferCost,
  pilotTransferMs,
  refitPilot,
  serialize,
  systemsOf,
  FUEL_COST_PER_UNIT,
  baseJumpDuration,
  START_SYSTEM_LAVE,
  type GameState,
} from '../src/core/state.ts';
import { distance } from '../src/core/galaxy.ts';
import { SHIPS, shipPrice } from '../src/core/ships.ts';

const LAVE = START_SYSTEM_LAVE;
const REORTE = 39;
const HOUR = 3_600_000;
const NOW = 1_000_000;

/** Ветеран с одним пилотом на Аддере, без маршрута. */
const withPilot = (cash = 200_000, model: 'adder' | 'cobra3' = 'adder'): GameState => {
  const base: GameState = { ...newGame(1), kills: 128, cash, pilots: [], nextPilotId: 1 };
  const r = hirePilot(base, model, NOW);
  assert.equal(r.error, undefined);
  return r.state;
};

const systems = systemsOf(1);

describe('§128: перелёт пилота', () => {
  const d = distance(systems[LAVE], systems[REORTE]);

  it('топливо — по цене игры, за счёт командира', () => {
    const state = withPilot();
    const cost = pilotTransferCost(state, state.pilots[0], REORTE);
    assert.equal(cost, d * FUEL_COST_PER_UNIT);
    const r = movePilot(state, 1, REORTE, NOW);
    assert.equal(r.error, undefined);
    assert.equal(state.cash - r.state.cash, cost);
  });

  it('время в пути — формула прыжка', () => {
    const state = withPilot();
    const ms = pilotTransferMs(state, state.pilots[0], REORTE, DEFAULT_SETTINGS);
    assert.equal(ms, baseJumpDuration(d, DEFAULT_SETTINGS));
  });

  it('дальше бака — несколько прыжков, и это дольше', () => {
    const state = withPilot();
    const pilot = state.pilots[0];
    const tank = SHIPS.adder.range;
    // Точка на три бака: время = сумма трёх отрезков, а не один длинный.
    const far = systems.find((s) => distance(systems[LAVE], s) > tank * 2.5);
    assert.ok(far, 'нужна система дальше двух баков');
    const index = systems.indexOf(far);
    const dist = distance(systems[LAVE], far);
    const legs = Math.ceil(dist / tank);
    const ms = pilotTransferMs(state, pilot, index, DEFAULT_SETTINGS);
    assert.equal(ms, Math.round(legs * baseJumpDuration(dist / legs, DEFAULT_SETTINGS)));
    assert.ok(ms > baseJumpDuration(dist, DEFAULT_SETTINGS), 'дробление пути не ускоряет');
  });

  it('переезд снимает маршрут и закрывает маршруты до прилёта', () => {
    const state = withPilot();
    const routed = assignPilotRoute(state, 1, REORTE, NOW, 'trader');
    assert.equal(routed.error, undefined);

    const moved = movePilot(routed.state, 1, REORTE + 1, NOW);
    assert.equal(moved.error, undefined);
    const pilot = moved.state.pilots[0];
    assert.equal(pilot.home, REORTE + 1);
    assert.equal(pilot.route, null);
    assert.ok(pilot.transfer && pilot.transfer.from === LAVE);
    assert.equal(assignPilotRoute(moved.state, 1, REORTE, NOW + HOUR).error, 'busy');
  });

  it('второй переезд во время пути — «busy»', () => {
    const moved = movePilot(withPilot(), 1, REORTE, NOW).state;
    assert.equal(movePilot(moved, 1, REORTE + 1, NOW + 1000).error, 'busy');
  });

  it('после прилёта пилот свободен и летает из новой системы', () => {
    const moved = movePilot(withPilot(), 1, REORTE, NOW).state;
    const until = moved.pilots[0].transfer!.until;
    const arrived = advance(moved, until + 1, DEFAULT_SETTINGS).state;
    assert.equal(arrived.pilots[0].transfer, null);
    const r = assignPilotRoute(arrived, 1, LAVE, until + HOUR, 'trader');
    assert.equal(r.error, undefined);
    assert.deepEqual(r.pilot!.route, { from: REORTE, to: LAVE });
  });

  it('без денег на топливо — отказ, пилот не летит', () => {
    const poor = { ...withPilot(), cash: 0 };
    const r = movePilot(poor, 1, REORTE, NOW);
    assert.equal(r.error, 'cash');
    assert.equal(r.state.pilots[0].home, LAVE);
  });

  it('своя же система — «self»', () => {
    assert.equal(movePilot(withPilot(), 1, LAVE, NOW).error, 'self');
  });

  it('перелёт переживает сохранение', () => {
    const moved = movePilot(withPilot(), 1, REORTE, NOW).state;
    const back = JSON.parse(serialize(moved));
    assert.deepEqual(back.pilots[0].transfer, moved.pilots[0].transfer);
  });
});

describe('§128: смена корабля пилота', () => {
  // LAVE — экономика 5: на верфи только Аддер, значит для проверки цены
  // ставим пилота в систему с богатой верфью.
  const rich = (): GameState => {
    const state = withPilot(2_000_000);
    const cobra = systems.findIndex((s) => s.economy === 0);
    return { ...state, system: cobra };
  };

  it('новый корабль — по цене верфи, старый в зачёт', () => {
    const state = rich();
    state.pilots[0] = { ...state.pilots[0], ship: 'adder' };
    const r = refitPilot(state, 1, 'cobra3', NOW);
    assert.equal(r.error, undefined);
    assert.equal(r.state.pilots[0].ship, 'cobra3');
    assert.equal(state.cash - r.state.cash, shipPrice('cobra3') - shipPrice('adder'));
  });

  it('маршрут снимается: у нового корабля свой бак', () => {
    const state = rich();
    const moved = refitPilot(state, 1, 'cobra3', NOW).state;
    assert.equal(moved.pilots[0].route, null);
  });

  it('тот же корабль и нехватка денег — разные отказы', () => {
    const state = rich();
    assert.equal(refitPilot(state, 1, 'adder', NOW).error, 'same');
    const poor = { ...state, cash: 0 };
    assert.equal(refitPilot(poor, 1, 'cobra3', NOW).error, 'cash');
  });
});
