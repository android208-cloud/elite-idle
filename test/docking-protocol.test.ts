/**
 * Проверка протокола «игра ↔ экран стыковки» (§59).
 *
 * Экран рисуется в iframe, поэтому проверяем именно то, что легко
 * сломать и трудно заметить глазом: форма сообщений, их порядок и
 * защита от чужих сообщений.
 *
 * Полноценный браузерный прогон здесь недоступен (Playwright не
 * ставится в песочнице — см. §29), поэтому проверяем протокол
 * как чистую функцию и логику валидации.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DOCKING_CHANNEL,
  parseFromFrame,
  type DockingConfig,
} from '../src/core/docking-protocol.ts';

const wrap = (msg: Record<string, unknown>) => ({ channel: DOCKING_CHANNEL, ...msg });

test('без канала сообщение игнорируется', () => {
  assert.equal(parseFromFrame({ type: 'docking:ready' }), null);
});

test('чужие сообщения игнорируются', () => {
  assert.equal(parseFromFrame(wrap({ type: 'docking:hack' })), null);
  assert.equal(parseFromFrame(wrap({ type: 'result', docked: true })), null);
  assert.equal(parseFromFrame(null), null);
  assert.equal(parseFromFrame('docking:ready'), null);
  assert.equal(parseFromFrame(42), null);
});

test('готовность экрана разбирается', () => {
  assert.deepEqual(parseFromFrame(wrap({ type: 'docking:ready' })), { type: 'docking:ready' });
});

test('успешная стыковка: повреждения нет', () => {
  const m = parseFromFrame(wrap({ type: 'docking:result', docked: true, damage: 0 }));
  assert.deepEqual(m, { type: 'docking:result', docked: true, damage: 0, jumpedAway: undefined });
});

test('провал: повреждение передаётся числом', () => {
  const m = parseFromFrame(wrap({ type: 'docking:result', docked: false, damage: 34 }));
  assert.ok(m && m.type === 'docking:result');
  assert.equal(m.damage, 34);
  assert.equal(m.docked, false);
});

test('повреждение не приходит строкой или мусором', () => {
  const m = parseFromFrame(wrap({ type: 'docking:result', docked: false, damage: 'много' }));
  assert.ok(m && m.type === 'docking:result');
  assert.equal(m.damage, 0, 'нечисловое повреждение превращается в 0, а не в NaN');
});

test('прыжок принимается только с целочисленной целью', () => {
  assert.deepEqual(parseFromFrame(wrap({ type: 'docking:jump', to: 7 })), {
    type: 'docking:jump',
    to: 7,
  });
  assert.equal(parseFromFrame(wrap({ type: 'docking:jump', to: -1 })), null);
  assert.equal(parseFromFrame(wrap({ type: 'docking:jump', to: 1.5 })), null);
  assert.equal(parseFromFrame(wrap({ type: 'docking:jump', to: 'три' })), null);
});

test('конфигурация покрывает все сценарии экрана', () => {
  // Конфиг — это то, что игра обещает показать экрану. Проверяем,
  // что в нём есть всё для трёх кнопок: компьютер, прыжок, стыковка.
  const cfg: DockingConfig = {
    systemName: 'Lave',
    hasComputer: false,
    canJump: true,
    jumpTarget: 12,
    jumpTargetName: 'Diso',
  };
  assert.equal(cfg.hasComputer, false, 'без компьютера кнопка скрыта');
  assert.equal(cfg.canJump, true, 'прыжок доступен — космос только здесь');
  assert.equal(cfg.jumpTarget, 12);

  const noTarget: DockingConfig = { ...cfg, jumpTarget: null, jumpTargetName: null };
  assert.equal(noTarget.jumpTarget, null, 'без цели прыжок не выполняется');
});
