/**
 * §105: ФЛОТ — пилоты, которые летают сами.
 *
 * Шаг 1: только торговые рейсы. Что здесь проверяется:
 *   - наём только с ранга «Опытный» (128 убийств) и только с кораблём,
 *     который продаётся на этой верфи, плюс задаток 500 CR;
 *   - маршрут — из системы найма, в пределах бака корабля;
 *   - один маршрут — один пилот (это и есть потолок флота);
 *   - цикл = настоящий перелёт туда-обратно + 2 часа отдыха;
 *   - выручка рейса считается по полке источника, четверть забирает пилот;
 *   - досчёт переживает долгое отсутствие: 30 суток — это 253 рейса, а не
 *     один, и не триста тысяч итераций.
 *
 * Числа взяты из настоящей галактики 1: LAVE(7) → REORTE(39), 4.4 св. года.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assignPilotRoute,
  deserialize,
  hirePilot,
  newGame,
  pilotCycleMs,
  pilotRouteProfit,
  serialize,
  systemsOf,
  advance,
  DEFAULT_SETTINGS,
  type GameState,
} from '../src/core/state.ts';
import {
  PILOT_HIRE_FEE,
  PILOT_MIN_KILLS,
  PILOT_REST_MS,
  formatSpan,
  pilotRunIncome,
  pilotWageShare,
  routeProfit,
} from '../src/core/fleet.ts';
import { distance } from '../src/core/galaxy.ts';
import { SHIPS, shipPrice } from '../src/core/ships.ts';

const LAVE = 7;
const REORTE = 39;
const HOUR = 3_600_000;

/** Игрок к «Опытному»: 128 убийств и деньги. */
const veteran = (cash = 200_000): GameState => {
  const s = newGame(1);
  return { ...s, kills: PILOT_MIN_KILLS, cash, pilots: [], nextPilotId: 1 };
};

const hired = (model: 'adder' | 'cobra3' = 'adder', cash = 200_000): GameState => {
  const r = hirePilot(veteran(cash), model, 1_000_000);
  assert.equal(r.error, undefined);
  return r.state;
};

describe('§105 наём', () => {
  it('задаток и корабль списываются сразу', () => {
    const s = veteran();
    const r = hirePilot(s, 'adder', 1_000_000);
    assert.equal(r.error, undefined);
    assert.equal(s.cash - r.state.cash, shipPrice('adder') + PILOT_HIRE_FEE);
    assert.equal(PILOT_HIRE_FEE, 5000, 'задаток — 500 CR');
  });

  it('пилот приходит без маршрута: сначала корабль, потом дело', () => {
    const r = hirePilot(veteran(), 'adder', 1_000_000);
    assert.equal(r.state.pilots.length, 1);
    assert.equal(r.state.pilots[0].route, null);
    assert.equal(r.state.pilots[0].home, LAVE);
    assert.equal(r.state.pilots[0].runs, 0);
    assert.ok(r.pilot!.name.includes(' '), 'у пилота есть имя и фамилия');
  });

  it('номер пилота не переиспользуется', () => {
    let s = hired();
    const r = hirePilot(s, 'adder', 1_000_000);
    s = r.state;
    assert.deepEqual(s.pilots.map((p) => p.id), [1, 2]);
    assert.equal(s.nextPilotId, 3);
  });

  it('рангом ниже «Опытного» не нанимают', () => {
    const s = { ...veteran(), kills: PILOT_MIN_KILLS - 1 };
    assert.equal(hirePilot(s, 'adder', 1_000_000).error, 'rank');
  });

  it('корабль берётся из того, что продаёт эта верфь', () => {
    // LAVE — экономика 5, на верфи только Аддер.
    assert.equal(hirePilot(veteran(), 'python', 1_000_000).error, 'unavailable');
  });

  it('без денег на корабль и задаток — отказ', () => {
    assert.equal(hirePilot(veteran(1000), 'adder', 1_000_000).error, 'cash');
  });

  it('в полёте не нанимают', () => {
    const s = {
      ...veteran(),
      flight: {
        from: LAVE, to: REORTE, dueAt: 2_000_000, arriveAt: 2_000_000,
        remainingBaseMs: 1_000, encounters: 0, lastEncounterAt: 0, patrol: false,
        patrolFuelUsed: 0,
      },
    } as unknown as GameState;
    assert.equal(hirePilot(s, 'adder', 1_000_000).error, 'in-flight');
  });
});

describe('§105 маршрут', () => {
  it('ставится в пределах бака и от системы найма', () => {
    const s = hired();
    const r = assignPilotRoute(s, 1, REORTE, 1_000_000);
    assert.equal(r.error, undefined);
    assert.deepEqual(r.state.pilots[0].route, { from: LAVE, to: REORTE });
    const ly = distance(systemsOf(1)[LAVE], systemsOf(1)[REORTE]);
    assert.ok(ly <= SHIPS.adder.range, 'маршрут влезает в бак');
  });

  it('дальше бака — отказ', () => {
    const s = hired();
    const far = systemsOf(1).findIndex(
      (sys, i) => i !== LAVE && distance(systemsOf(1)[LAVE], sys) > SHIPS.adder.range,
    );
    assert.equal(assignPilotRoute(s, 1, far, 1_000_000).error, 'range');
  });

  it('в свою же систему — отказ', () => {
    assert.equal(assignPilotRoute(hired(), 1, LAVE, 1_000_000).error, 'self');
  });

  it('один маршрут — один пилот', () => {
    let s = hired();
    s = { ...hirePilot(s, 'adder', 1_000_000).state };
    s = assignPilotRoute(s, 1, REORTE, 1_000_000).state;
    assert.equal(assignPilotRoute(s, 2, REORTE, 1_000_000).error, 'taken');
  });

  it('другой маршрут из того же порта — можно', () => {
    let s = hired();
    s = { ...hirePilot(s, 'adder', 1_000_000).state };
    s = assignPilotRoute(s, 1, REORTE, 1_000_000).state;
    const second = systemsOf(1)
      .map((sys, i) => ({ i, d: distance(systemsOf(1)[LAVE], sys) }))
      .filter((o) => o.i !== LAVE && o.i !== REORTE && o.d <= SHIPS.adder.range);
    assert.ok(second.length > 0, 'у LAVE есть другие соседи');
    assert.equal(assignPilotRoute(s, 2, second[0].i, 1_000_000).error, undefined);
  });
});

describe('§105 цикл и деньги', () => {
  it('цикл — перелёт туда-обратно плюс два часа отдыха', () => {
    const s = assignPilotRoute(hired(), 1, REORTE, 1_000_000).state;
    const cycle = pilotCycleMs(s, s.pilots[0]);
    assert.ok(cycle > PILOT_REST_MS, 'полёт добавляется к отдыху');
    assert.ok(cycle < PILOT_REST_MS + 2 * HOUR, 'полёт на 4.4 св. года — меньше часа в обе стороны');
  });

  it('выручка рейса — по полке источника, Аддер грузит 8 тонн', () => {
    const systems = systemsOf(1);
    const profit = routeProfit(1, systems, { from: LAVE, to: REORTE }, SHIPS.adder.hold);
    assert.equal(profit, 1856, '185.6 CR за рейс на LAVE → REORTE');
    // Полка не пускает загрузить больше, чем есть.
    const lots = routeProfit(1, systems, { from: LAVE, to: REORTE }, 500);
    assert.ok(lots < 500 * 30 * 10, 'даже с безразмерным трюмом выручка ограничена полкой');
  });

  it('пилот забирает четверть, вам три четверти', () => {
    assert.equal(pilotWageShare(0), 0.25);
    assert.equal(pilotRunIncome(1856, 0), 1392, '139.2 CR из 185.6');
  });

  it('за сутки Аддер делает восемь рейсов', () => {
    let s = assignPilotRoute(hired(), 1, REORTE, 1_000_000).state;
    const cash0 = s.cash;
    const r = advance(s, 1_000_000 + 24 * HOUR, DEFAULT_SETTINGS);
    assert.equal(r.state.pilots[0].runs, 8);
    assert.equal(r.state.cash - cash0, 8 * 1392);
    assert.ok(r.events.some((e) => e.type === 'fleet'), 'в журнале есть строка флота');
  });

  it('месяц отсутствия досчитывается одним умножением', () => {
    const s = assignPilotRoute(hired(), 1, REORTE, 1_000_000).state;
    const cash0 = s.cash;
    const r = advance(s, 1_000_000 + 30 * 24 * HOUR, DEFAULT_SETTINGS);
    const runs = r.state.pilots[0].runs;
    assert.ok(runs > 200 && runs < 300, `рейсов за 30 суток: ${runs}`);
    assert.equal(r.state.cash - cash0, runs * 1392);
  });

  it('пилот без маршрута не приносит ничего', () => {
    const s = hired();
    const r = advance(s, 1_000_000 + 100 * HOUR, DEFAULT_SETTINGS);
    assert.equal(r.state.cash, s.cash);
    assert.equal(r.state.pilots[0].runs, 0);
  });

  it('чужой рейс не сдвигает ваше время', () => {
    const s = assignPilotRoute(hired(), 1, REORTE, 1_000_000).state;
    const half = advance(s, 1_000_000 + 1 * HOUR, DEFAULT_SETTINGS);
    assert.equal(half.state.pilots[0].runs, 0, 'за час пилот ещё не вернулся');
  });

  it('время показывается по-человечески', () => {
    assert.equal(formatSpan(2 * HOUR + 50 * 60_000), '2 ч 50 мин');
    assert.equal(formatSpan(8 * 60_000), '8 мин');
    assert.equal(formatSpan(3 * HOUR), '3 ч');
  });
});

describe('§105 сохранение', () => {
  it('пилоты переживают запись и чтение', () => {
    const s = assignPilotRoute(hired(), 1, REORTE, 1_000_000).state;
    const back = deserialize(serialize(s));
    assert.deepEqual(back.pilots, s.pilots);
    assert.equal(back.nextPilotId, s.nextPilotId);
  });

  it('сохранение без флота читается как пустой ангар', () => {
    const s = hired();
    const raw = JSON.parse(serialize(s));
    delete raw.pilots;
    delete raw.nextPilotId;
    const back = deserialize(JSON.stringify(raw));
    assert.deepEqual(back.pilots, []);
    assert.equal(back.nextPilotId, 1);
  });

  it('счётчик восстанавливается по номерам пилотов', () => {
    const s = hired();
    const raw = JSON.parse(serialize(s));
    delete raw.nextPilotId;
    const back = deserialize(JSON.stringify(raw));
    assert.equal(back.nextPilotId, 2);
  });
});
