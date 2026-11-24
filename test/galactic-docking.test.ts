/**
 * Галактический прыжок живёт только в космосе (§60).
 *
 * Решение пользователя: «строго в космосе». Значит с вкладки «Корабль»
 * кнопки больше нет — только информация, а сам прыжок выполняется
 * из мини-игры стыковки, как и обычный.
 *
 * §133.14: карточка переехала из ангара на карту, и в ней своя кнопка
 * «Активировать» с десятисекундным отсчётом (§133.14 в `main.ts`).
 *
 * Что проверяем:
 *  1. Кнопки на «Корабле» больше не существует, а карточка стоит на карте.
 *  2. Галактический прыжок не требует топлива (в оригинале — только
 *     одноразовый двигатель, `GalacticHyperspaceJump` $D61A).
 *  3. Он расходится с обычным: другая галактика, свой номер по кругу.
 *  4. Одноразовость: после прыжка двигателя нет.
 *  5. Протокол различает виды прыжка, чтобы игра не путала их.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { parseFromFrame, DOCKING_CHANNEL } from '../src/core/docking-protocol.ts';
import { DEFAULT_SETTINGS, galacticJump, newGame, startJump } from '../src/core/state.ts';

const wrap = (msg: Record<string, unknown>) => ({ channel: DOCKING_CHANNEL, ...msg });

test('на «Корабле» нет кнопки галактического прыжка, а карточка стоит на карте', () => {
  const src = readFileSync(new URL('../src/ui/main.ts', import.meta.url), 'utf8');
  assert.ok(
    !src.includes('data-action="galactic-jump"'),
    'кнопка должна быть убрана: прыжок только в космосе',
  );
  // §133.14: пользователь перенёс карточку на карту и попросил кнопку с
  // отсчётом. Ищем именно `mapScreen`, а не весь файл: одно упоминание
  // ничего не докажет, а сборка экрана — докажет.
  const map = src.slice(src.indexOf('function mapScreen()'), src.indexOf('/* ---------- Карты ----------'));
  assert.ok(map.includes('${galacticCard()}'), 'карточка вызывается с карты');
  const hangar = src.slice(src.indexOf('function hangarScreen()'), src.indexOf('function shipyardCard()'));
  assert.ok(!hangar.includes('galacticCard()'), 'и больше не висит в ангаре');
  assert.ok(
    src.includes('data-action="galactic-toggle"') && src.includes('GALACTIC_ARM_MS = 10_000'),
    'в карточке кнопка «Активировать/Отменить» и таймер на 10 секунд',
  );
});

test('галактический прыжок не тратит топливо', () => {
  // В оригинале FuelLevel меняется только в NormalHyperspaceJump ($D669).
  const base = newGame(5);
  const state = { ...base, ship: { ...base.ship, galacticHyperdrive: true } };
  const r = galacticJump(state);
  assert.ok(!r.error);
  assert.equal(r.state.fuel, state.fuel, 'топливо не изменилось');
});

test('галактический прыжок меняет галактику по кругу', () => {
  const base = newGame(5);
  const state = { ...base, galaxy: 8, ship: { ...base.ship, galacticHyperdrive: true } };
  const r = galacticJump(state);
  assert.ok(!r.error);
  assert.equal(r.state.galaxy, 1, 'после 8-й снова 1-я');
});

test('двигатель одноразовый', () => {
  const base = newGame(5);
  const state = { ...base, ship: { ...base.ship, galacticHyperdrive: true } };
  const r = galacticJump(state);
  assert.ok(!r.error);
  assert.equal(r.state.ship.galacticHyperdrive, false, 'двигатель израсходован');
});

test('без двигателя прыжок невозможен', () => {
  const base = newGame(5);
  const r = galacticJump({ ...base, ship: { ...base.ship, galacticHyperdrive: false } });
  assert.equal(r.error, 'no-drive');
});

test('обычный прыжок топливо тратит — в отличие от галактического', () => {
  const state = newGame(5);
  const target = state.system === 0 ? 1 : 0;
  const r = startJump(state, target, 1000, DEFAULT_SETTINGS);
  if (!r.error) {
    assert.ok(r.state.fuel < state.fuel, 'обычный прыжок списывает топливо');
  }
});

test('протокол различает обычный и галактический прыжок', () => {
  const normal = parseFromFrame(wrap({ type: 'docking:jump', to: 3 }));
  assert.deepEqual(normal, { type: 'docking:jump', to: 3 });

  const galactic = parseFromFrame(wrap({ type: 'docking:galactic-jump' }));
  assert.deepEqual(galactic, { type: 'docking:galactic-jump' });

  // Результат тоже различает вид — иначе игра отправила бы игрока
  // обычным прыжком вместо смены галактики.
  const res = parseFromFrame(
    wrap({ type: 'docking:result', docked: false, damage: 0, jumpedAway: true, jumpKind: 'galactic' }),
  );
  assert.ok(res && res.type === 'docking:result');
  assert.equal(res.jumpKind, 'galactic');
});
