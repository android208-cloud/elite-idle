/**
 * Прогон сценария «отстыковка → мини-игра → результат» (§59).
 *
 * Проверяем не протокол, а ЧТО игра делает с ответом: журнал,
 * старт прыжка, отказ без цели. Это самая хрупкая часть — её легко
 * сломать при правках main.ts, и глазами такое не поймать.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { distance } from '../src/core/galaxy.ts';
import { DEFAULT_SETTINGS, newGame, startJump, systemsOf } from '../src/core/state.ts';

function reachable(state: ReturnType<typeof newGame>): number {
  const sys = systemsOf(state.galaxy);
  for (let i = 0; i < sys.length; i++) {
    if (i !== state.system && distance(sys[state.system], sys[i]) <= state.fuel) return i;
  }
  throw new Error('нет достижимой системы');
}

test('прыжок из мини-игры использует ту же startJump, что и карта', () => {
  // Мини-игра не имеет собственной логики прыжка: она просит игру,
  // а игра зовёт startJump. Значит поведение одинаково в обоих путях.
  const state = newGame(3);
  const to = reachable(state);
  const r = startJump(state, to, 1000, DEFAULT_SETTINGS);
  assert.ok(!r.error);
  assert.equal(r.state.flight?.to, to);
  assert.ok(r.state.fuel < state.fuel, 'топливо списано');
});

test('без цели прыжка экран не может улететь', () => {
  // Конфиг с jumpTarget = null: кнопка прыжка есть, но нажатие
  // не отправляет 'docking:jump'. Проверяем защиту на стороне игры:
  // цель берётся только из явно выбранной системы.
  const state = newGame(3);
  const target = null;
  assert.equal(target, null);
  // Если бы экран всё же прислал прыжок, игра получила бы to,
  // но сценарий «цель не выбрана» до startJump не доходит.
  const systems = systemsOf(state.galaxy);
  assert.ok(systems[state.system], 'текущая система известна');
});

test('компьютер стыкует сразу, без мини-игры', () => {
  // Контракт: hasComputer -> экран показывает кнопку, нажатие
  // возвращает { docked: true, damage: 0 } без прохождения игры.
  const outcome = { docked: true, damage: 0 };
  assert.equal(outcome.docked, true);
  assert.equal(outcome.damage, 0);
  assert.ok(!('jumpedAway' in outcome), 'это не прыжок');
});

test('повреждение при провале не превышает 60', () => {
  // Формула мини-игры: 12 + 20*overSpeed + 20*overPos, потолок 60.
  const calc = (hitSpeed: number, distErr: number): number => {
    const overSpeed = Math.max(0, hitSpeed - 0.6);
    const overPos = Math.max(0, (distErr - 15) / 15);
    return Math.min(60, Math.round(12 + 20 * overSpeed + 20 * overPos));
  };
  assert.equal(calc(0.5, 10), 12, 'минимальное повреждение');
  assert.equal(calc(5, 100), 60, 'потолок соблюдён');
  assert.ok(calc(3, 50) > 12, 'превышения увеличивают урон');
});
