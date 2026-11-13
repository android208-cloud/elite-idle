/**
 * Эталонный тест галактического гиперпрыжка.
 *
 * Источник: library/common/main/subroutine/ghy.asm и tt111.asm.
 *
 * Ghy:
 *
 *   LDX GHYP      \ если двигателя нет — выходим (GHYP = 0)
 *   INX           \ двигатель есть: $FF → 0
 *   STX GHYP      \ двигатель одноразовый
 *   STX FIST      \ смена галактики очищает криминальное дозье
 *   INC GCNT      \ номер галактики +1
 *   LDA GCNT / AND #7 / STA GCNT   \ 0..7 по кругу: после 8-й снова 1-я
 *   ... поворот сидов QQ21 ...
 *   LDA #96 / STA QQ9 / STA QQ10   \ всегда прибываем в (96, 96)
 *   JSR TT111                      \ и находим ближайшую к этой точке систему
 *
 * TT111: приблизительная дистанция |dx|/2 + |dy|/2, первая система с
 * минимальным значением выигрывает (сравнение строгое, с 0-й по 255-ю).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS,
  galacticJump,
  newGame,
  startJump,
  systemsOf,
  type GameState,
} from '../src/core/state.ts';
import {
  buildGalaxy,
  distance,
  GALACTIC_ARRIVAL,
  nearestSystem,
  tt111Distance,
} from '../src/core/galaxy.ts';
import { STARTER_SHIP } from '../src/core/ships.ts';

/** Корабль с галактическим гипердвигателем на станции */
function withDrive(): GameState {
  return { ...newGame(1), ship: { ...STARTER_SHIP, galacticHyperdrive: true } };
}

describe('поиск ближайшей системы (TT111)', () => {
  it('метрика — сумма половинок модулей разностей координат', () => {
    const a = { x: 100, y: 50 } as never;
    assert.equal(tt111Distance(a, 100, 50), 0);
    // |110-100|/2 = 5, |50-50|/2 = 0
    assert.equal(tt111Distance(a, 110, 50), 5);
    // |100-90|/2 = 5, |60-50|/2 = 5 → 10
    assert.equal(tt111Distance(a, 90, 60), 10);
    // округление вниз: |101-100|/2 = 0
    assert.equal(tt111Distance(a, 101, 50), 0);
    // отрицательные разности берутся по модулю
    assert.equal(tt111Distance(a, 80, 40), 15);
  });

  it('находит ближайшую систему к (96, 96) в каждой галактике', () => {
    for (let galaxy = 1; galaxy <= 8; galaxy++) {
      const systems = buildGalaxy(galaxy);
      const index = nearestSystem(systems, GALACTIC_ARRIVAL.x, GALACTIC_ARRIVAL.y);
      const best = tt111Distance(systems[index], GALACTIC_ARRIVAL.x, GALACTIC_ARRIVAL.y);
      for (const system of systems) {
        assert.ok(
          tt111Distance(system, GALACTIC_ARRIVAL.x, GALACTIC_ARRIVAL.y) >= best,
          `галактика ${galaxy}: система ${system.name} ближе найденной`,
        );
      }
    }
  });

  it('при равной дистанции выигрывает система с меньшим номером', () => {
    const systems = [
      { index: 0, name: 'A', x: 96, y: 96 },
      { index: 1, name: 'B', x: 96, y: 96 },
    ] as never;
    assert.equal(nearestSystem(systems, 96, 96), 0);
  });
});

describe('галактический гиперпрыжок (Ghy)', () => {
  it('без двигателя прыжок невозможен', () => {
    const g = newGame(1);
    assert.equal(galacticJump(g).error, 'no-drive');
    assert.equal(galacticJump(g).state.galaxy, g.galaxy, 'состояние не должно меняться');
  });

  it('в полёте прыжок невозможен', () => {
    const g = withDrive();
    const systems = systemsOf(g.galaxy);
    const target = systems.findIndex((s, i) => i !== g.system && distance(systems[g.system], s) <= g.fuel);
    const flying = startJump(g, target, 0, DEFAULT_SETTINGS).state;
    assert.equal(galacticJump(flying).error, 'in-flight');
  });

  it('переводит в следующую галактику, двигатель расходуется', () => {
    const g = withDrive();
    const result = galacticJump(g);
    assert.equal(result.error, undefined);
    assert.equal(result.state.galaxy, 2);
    assert.equal(result.state.ship.galacticHyperdrive, false, 'двигатель одноразовый (STX GHYP)');
  });

  it('прибытие — ближайшая система к (96, 96)', () => {
    const result = galacticJump(withDrive()).state;
    const systems = systemsOf(result.galaxy);
    assert.equal(result.system, nearestSystem(systems, GALACTIC_ARRIVAL.x, GALACTIC_ARRIVAL.y));
  });

  it('смена галактики очищает правовой статус (STX FIST)', () => {
    const g = { ...withDrive(), legal: 120 };
    const result = galacticJump(g).state;
    assert.equal(result.legal, 0);
  });

  it('галактики идут по кругу: после 8-й снова 1-я (INC GCNT / AND #7)', () => {
    let g: GameState = withDrive();
    const visited: number[] = [];
    for (let i = 0; i < 8; i++) {
      g = { ...g, ship: { ...g.ship, galacticHyperdrive: true } };
      g = galacticJump(g).state;
      visited.push(g.galaxy);
    }
    assert.deepEqual(visited, [2, 3, 4, 5, 6, 7, 8, 1]);
  });

  it('рынок новой системы соответствует новой галактике', () => {
    const result = galacticJump(withDrive()).state;
    assert.equal(result.market.length, 17);
    assert.equal(currentSystemName(result), systemsOf(result.galaxy)[result.system].name);
  });

  it('полёт и встреча сбрасываются, если прыжок всё же состоялся', () => {
    // Прыжок возможен только на станции, поэтому состояние полёта не сохраняется
    const result = galacticJump(withDrive()).state;
    assert.equal(result.flight, null);
    assert.equal(result.encounter, null);
    assert.equal(result.combat, null);
  });

  it('состояние ГПСЧ продвигается, но остаётся детерминированным', () => {
    const a = galacticJump(withDrive());
    const b = galacticJump(withDrive());
    assert.deepEqual(a.state, b.state, 'одинаковый вход — одинаковый выход');
    assert.notEqual(a.state.rng, withDrive().rng);
  });
});

function currentSystemName(g: GameState): string {
  return systemsOf(g.galaxy)[g.system].name;
}
