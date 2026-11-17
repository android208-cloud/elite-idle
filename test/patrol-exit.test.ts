/**
 * Выход из патруля (§82).
 *
 * Пользователь: «жму патруль — прибытие через Infinity ч, вернуться вручную
 * невозможно». Патруль не должен быть ловушкой: нужен ручной возврат и
 * возможность улететь прямо из него.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  advance,
  DEFAULT_SETTINGS,
  newGame,
  returnFromPatrol,
  startJump,
  startPatrol,
  systemsOf,
  jumpFromPatrol,
  MAX_FUEL,
} from '../src/core/state.ts';
import { distance } from '../src/core/galaxy.ts';

const NOW = 1_000_000;
const NO_ENC = { ...DEFAULT_SETTINGS, encounterRate: 0 };

function patrolling() {
  const g = newGame(1);
  const ship = { ...g.ship, laser: 'military' as const, ecm: true, energyBomb: true, missiles: 4 };
  return startPatrol({ ...g, ship, fuel: MAX_FUEL }, NOW).state;
}

describe('§82: выход из патруля', () => {
  it('патруль не имеет времени прибытия — оно бесконечно', () => {
    // Причина «Прибытие через Infinity ч»: патруль кончается топливом,
    // а не временем. Интерфейс обязан это учитывать, а не печатать Infinity.
    const s = patrolling();
    assert.equal(s.flight?.patrol, true);
    assert.equal(s.flight?.arriveAt, Number.POSITIVE_INFINITY);
  });

  it('кнопка «Вернуться» завершает патруль сразу', () => {
    const s = patrolling();
    const r = returnFromPatrol(s, NOW + 60_000);
    assert.equal(r.state.flight, null, 'полёт закончен');
    assert.equal(r.state.encounter, null);
    assert.ok(r.events.some((e) => e.type === 'patrol-end'), 'событие возврата');
  });

  it('возврат не списывает топливо: станция рядом', () => {
    const s = patrolling();
    const before = s.fuel;
    const r = returnFromPatrol(s, NOW + 60_000);
    assert.equal(r.state.fuel, before, 'топливо не тронуто');
  });

  it('возврат из обычного полёта ничего не делает', () => {
    const systems = systemsOf(1);
    const g = newGame(1);
    const target = systems.findIndex((_, i) => i !== g.system && distance(systems[g.system], systems[i]) <= g.fuel);
    const flying = startJump(g, target, NOW, NO_ENC).state;
    const r = returnFromPatrol(flying, NOW + 1000);
    assert.equal(r.state.flight, flying.flight, 'полёт на месте');
    assert.equal(r.events.length, 0, 'событий нет');
  });

  it('из патруля можно улететь прямо', () => {
    const systems = systemsOf(1);
    const s = patrolling();
    const target = systems.findIndex((_, i) => i !== s.system && distance(systems[s.system], systems[i]) <= s.fuel);
    const r = jumpFromPatrol(s, target, NOW + 60_000, NO_ENC);
    assert.equal(r.error, undefined, 'прыжок начался');
    assert.equal(r.state.flight?.patrol, undefined, 'это уже не патруль');
    assert.equal(r.state.flight?.to, target, 'летим к цели');
  });

  it('перелёт из патруля тратит топливо на прыжок, а не дважды', () => {
    const systems = systemsOf(1);
    const s = patrolling();
    const target = systems.findIndex((_, i) => i !== s.system && distance(systems[s.system], systems[i]) <= s.fuel);
    const d = distance(systems[s.system], systems[target]);
    const r = jumpFromPatrol(s, target, NOW + 60_000, NO_ENC);
    assert.ok(Math.abs(r.state.fuel - (s.fuel - d)) < 0.001, `остаток ${r.state.fuel} при расходе ${d}`);
  });

  it('патруль после перелёта завершается сам', () => {
    const systems = systemsOf(1);
    const s = patrolling();
    const target = systems.findIndex((_, i) => i !== s.system && distance(systems[s.system], systems[i]) <= s.fuel);
    const flying = jumpFromPatrol(s, target, NOW + 60_000, NO_ENC).state;
    // Полёт доходит до конца — прибытие в цель, патруля нет.
    const r = advance(flying, NOW + 60_000 + 3_600_000, NO_ENC);
    assert.equal(r.state.flight, null, 'прибыли');
    assert.equal(r.state.system, target);
  });
});
