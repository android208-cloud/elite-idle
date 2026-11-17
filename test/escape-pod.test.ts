/**
 * Побег из боя и потеря груза (§37 → §77).
 *
 * §37 описывал побег как катапультирование в купленной спасательной
 * капсуле. §77 убрал капсулу: смерти в игре нет, спасать нечего.
 *
 * Но правило про ГРУЗ осталось и оно не про капсулу, а про бегство:
 * уходя от боя, игрок сбрасывает всё, кроме предметов пришельцев.
 * Источник правила — `UpdateEscapePod` ($A7A3–$A7C7, game.asm): там
 * затираются 17 байт (флуктуация рынка + CargoHold+0..15), а индекс 16
 * в диапазон не входит и потому сохраняется.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cargoAfterPod, applyPodLoss, applyDecision, availableDecisions } from '../src/core/one-decision.ts';
import { ALIEN_ITEMS_INDEX, COMMODITIES } from '../src/core/market.ts';
import { enemyById, EQUIPMENT } from '../src/core/ships.ts';

const emptyCargo = () => COMMODITIES.map(() => 0);

test('индекс предметов пришельцев — 16, как в оригинале', () => {
  assert.equal(ALIEN_ITEMS_INDEX, 16);
  assert.equal(COMMODITIES.length, 17);
});

test('бегство обнуляет груз, кроме предметов пришельцев', () => {
  const cargo = emptyCargo();
  cargo[0] = 5;   // еда
  cargo[6] = 10;  // наркотики
  cargo[15] = 2;  // драгоценные камни
  cargo[ALIEN_ITEMS_INDEX] = 3; // предметы пришельцев

  const after = cargoAfterPod(cargo);

  assert.equal(after[0], 0, 'еда потеряна');
  assert.equal(after[6], 0, 'наркотики потеряны');
  assert.equal(after[15], 0, 'камни потеряны');
  assert.equal(after[ALIEN_ITEMS_INDEX], 3, 'предметы пришельцев сохранены');
});

test('пустой трюм остаётся пустым', () => {
  const after = cargoAfterPod(emptyCargo());
  assert.ok(after.every((t) => t === 0));
});

test('вместимость трюма не меняется — это свойство корабля', () => {
  const cargo = emptyCargo();
  cargo[0] = 20;
  const r = applyPodLoss({ cargo, holdSpace: 20 });
  assert.equal(r.holdSpace, 20, 'трюм не сжимается, он просто освобождается');
  assert.equal(r.cargo[0], 0);
});

test('побег обнуляет правовой статус целиком', () => {
  const enemy = enemyById('python');
  const d = availableDecisions(enemy, 'military', true, true);
  const r = applyDecision(enemy, 'flee', d, true);
  assert.ok(r);
  assert.equal(r.legalCleared, true, '$A7A4: PlayerLegalScore = 0');
});

test('§77: бежать можно всегда — капсула больше не требуется', () => {
  // До §77 здесь проверялось обратное: без купленной капсулы побег
  // недоступен. Капсулы нет, а уйти от боя надо уметь всегда, иначе
  // сильный противник превращается в тупик.
  const enemy = enemyById('python');
  const d = availableDecisions(enemy, 'military', false, true);
  assert.equal(d.flee, true, 'бегство доступно и без капсулы');
  const r = applyDecision(enemy, 'flee', d, true);
  assert.ok(r, 'побег разрешён');
  assert.equal(r.outcome, 'fled');
  assert.equal(r.bounty, 0, 'за побег награды нет');
});

test('§77: капсулы нет ни в магазине, ни в снаряжении', () => {
  assert.equal(
    EQUIPMENT.find((e) => (e.id as string) === 'pod'),
    undefined,
    'в списке верфи капсулы быть не должно',
  );
  // Номер 8 в таблице верфи пропущен осознанно: это координата из
  // оригинала, и сдвигать её нельзя — поедет доступность по техуровню.
  const numbers = EQUIPMENT.map((e) => e.screenNumber).sort((a, b) => a - b);
  assert.ok(!numbers.includes(8), 'номер 8 остаётся пропущенным');
});

test('побег не зависит от прочих решений', () => {
  const enemy = enemyById('sidewinder');
  const hostile = availableDecisions(enemy, 'military', true, true);
  assert.equal(hostile.attack, true, 'на слабого можно напасть');
  assert.equal(hostile.skip, true, 'пропустить можно всегда');
  assert.equal(hostile.flee, true, 'уйти можно всегда');
});
