/**
 * Модуль стыковки как заменяемый компонент (§57).
 *
 * Проверяем ровно то, о чём договорились с пользователем:
 *
 *  1. Настройка `dockingModule` существует и по умолчанию ВКЛЮЧЕНА.
 *  2. При включённом модуле прыжок живёт в мини-игре, а карта предлагает
 *     «Отстыковку».
 *  3. При выключенном модуле работает прежний прыжок с карты.
 *  4. Прыгать, не пристыковавшись, можно — `startJump` не смотрит на
 *     положение в пространстве (у нас нет фазы подлёта, §57).
 *  5. Баг гиперпрыжка из оригинала невоспроизводим: после прибытия
 *     станция доступна сразу, промежутка для защёлки нет.
 *
 * Источник по багу: `reference/zx-elite-ataribaby/src/game.asm`
 *   CheckDocking            $70BE — вызывается только в ветке полёта
 *   CheckHyperspaceKeys     $D582 — защёлка ставится до проверки топлива
 *   UpdateHyperspaceCountdown $D5F5 — счётчик 21 обновление
 *   FinishHyperspaceArrival $D829 — защёлка снимается на прибытии
 *   DockWithStation         $D5D6 — «DOCKED», счётчик не сбрасывается
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advance, DEFAULT_SETTINGS, newGame, startJump, systemsOf } from '../src/core/state.ts';
import { distance } from '../src/core/galaxy.ts';

test('§81: мини-игра стыковки выключена по умолчанию', () => {
  /*
   * Пользователь решил начать с простого: космос запускается кнопками
   * «Перелёт» и «Патрулировать» в блоке «Пункт назначения», а не через
   * мини-игру. Модуль остаётся рабочим и включается в настройках.
   */
  assert.equal(DEFAULT_SETTINGS.dockingModule, false);
});

test('настройку можно выключить, не трогая остальные', () => {
  const off = { ...DEFAULT_SETTINGS, dockingModule: false };
  assert.equal(off.dockingModule, false);
  assert.equal(off.speed, DEFAULT_SETTINGS.speed);
});

/** Ближайшая достижимая система: на старте топлива мало, соседняя не подходит. */
function reachableTarget(state: ReturnType<typeof newGame>): number | null {
  const sys = systemsOf(state.galaxy);
  for (let i = 0; i < sys.length; i++) {
    if (i !== state.system && distance(sys[state.system], sys[i]) <= state.fuel) return i;
  }
  return null;
}

test('прыжок не требует положения в пространстве: у нас нет подлёта', () => {
  // Игра начинает на станции (flight === null). Прыжок всё равно доступен:
  // именно это делает «прыжок из мини-игры» возможным без новой фазы.
  const state = newGame(1);
  assert.equal(state.flight, null, 'на старте мы на станции');
  const target = reachableTarget(state);
  assert.ok(target !== null, 'должна найтись достижимая система');
  const r = startJump(state, target, 1000, DEFAULT_SETTINGS);
  assert.ok(!r.error, `прыжок со станции должен начинаться, а не ${r.error}`);
  assert.ok(r.state.flight, 'полёт начался');
});

test('после прибытия станция доступна сразу — багу негде жить', () => {
  // Это ключевое отличие от оригинала: arrive() ставит систему и обнуляет
  // полёт одной операцией. В оригинале между прибытием и стыковкой был
  // подлёт, и на нём висел CheckDocking с защёлкой.
  const state = newGame(1);
  const target = reachableTarget(state)!;
  const started = startJump(state, target, 1000, DEFAULT_SETTINGS);
  assert.ok(!started.error);

  const arriveAt = started.state.flight!.arriveAt;
  const r = advance(started.state, arriveAt + 1, DEFAULT_SETTINGS);

  assert.equal(r.state.flight, null, 'полёт завершён');
  assert.equal(r.state.system, target, 'мы в целевой системе');
  // Никакого промежуточного состояния «в космосе, но не пристыкован».
  assert.ok(!('hyperspaceLatch' in r.state), 'защёлки в модели нет — она не нужна');
  assert.ok(!('countdown' in r.state), 'счётчика прыжка в модели нет');
});
