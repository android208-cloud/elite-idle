/**
 * Спасательная капсула (§37) — логика побега.
 *
 * Все правила взяты из `UpdateEscapePod` ($A77B, game.asm), а не выведены
 * из общих соображений:
 *
 *   $A78B  BIT 6, KeyFlagsCombat   — клавиша Q
 *   $A78E  EscapePodFitted         — нужна купленная капсула
 *   $A793  WitchspaceFlag          — **в witchspace капсула не работает**
 *   $A7A4  PlayerLegalScore = 0    — правовой статус обнуляется
 *   $A7A7  EscapePodFitted = 0     — капсула расходуется
 *   $A7AA  обнуляются 17 байт: флуктуация рынка и CargoHold+0..15
 *   $A7B3  AND $DF                 — теряются беженцы (бит 5 флагов)
 *   $A7C7  трюм снова пуст
 *   $A784  через 24 кадра — StartDockingSequence, то есть стыковка
 *          **в текущей системе** (курсор карты сбрасывается на неё, $A7CD)
 *
 * Что это значит по смыслу: индекс 16 (предметы пришельцев) в диапазон
 * 0..15 не входит и потому **сохраняется**. Это же следует из §46.4:
 * предметы пришельцев не теряются.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cargoAfterPod, applyPodLoss, applyDecision, availableDecisions } from '../src/core/one-decision.ts';
import { ALIEN_ITEMS_INDEX, COMMODITIES } from '../src/core/market.ts';
import { enemyById } from '../src/core/ships.ts';

const emptyCargo = () => COMMODITIES.map(() => 0);

test('индекс предметов пришельцев — 16, как в оригинале', () => {
  assert.equal(ALIEN_ITEMS_INDEX, 16);
  assert.equal(COMMODITIES.length, 17);
});

test('капсула обнуляет груз, кроме предметов пришельцев', () => {
  // В оригинале затираются индексы 0..15, индекс 16 остаётся.
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

test('побег тратит капсулу, даже если груз пуст', () => {
  const enemy = enemyById('sidewinder');
  const d = availableDecisions(enemy, 'military', true, true);
  const r = applyDecision(enemy, 'flee', d, true);
  assert.ok(r);
  assert.equal(r.podUsed, true);
  assert.equal(r.bounty, 0, 'за побег награды нет');
});

test('без капсулы бежать нельзя — только напасть или пропустить', () => {
  // §37: капсула только покупаемая, встроенной нет.
  const enemy = enemyById('sidewinder');
  const d = availableDecisions(enemy, 'military', false, true);
  assert.equal(d.flee, false);
  assert.equal(d.attack, true, 'на слабого можно напасть');
  assert.equal(d.skip, true, 'пропустить можно всегда');
  assert.equal(applyDecision(enemy, 'flee', d, true), null, 'побег недопустим');
});

test('капсула не меняет исход других решений', () => {
  // Наличие капсулы не должно влиять на «напасть» и «пропустить».
  const enemy = enemyById('sidewinder');
  const withPod = availableDecisions(enemy, 'military', true, true);
  const withoutPod = availableDecisions(enemy, 'military', false, true);
  assert.equal(withPod.attack, withoutPod.attack);
  assert.equal(withPod.skip, withoutPod.skip);

  const a1 = applyDecision(enemy, 'attack', withPod, true);
  const a2 = applyDecision(enemy, 'attack', withoutPod, true);
  assert.equal(a1!.outcome, a2!.outcome);
  assert.equal(a1!.bounty, a2!.bounty);
  assert.equal(a1!.podUsed, false, 'нападение капсулу не тратит');
});

/* ---------- Покупка (§37: только покупаемая, встроенной нет) ---------- */

test('на старте капсулы нет — она только покупаемая', async () => {
  const { newGame } = await import('../src/core/state.ts');
  const g = newGame(7);
  assert.equal(g.ship.escapePod, false, '§37: встроенной капсулы быть не может');
});

test('капсула покупается и стоит 1000 CR', async () => {
  const { newGame, buyEquipment, systemsOf } = await import('../src/core/state.ts');
  const g = newGame(7);
  const systems = systemsOf(1);
  const idx = systems.findIndex((s) => s.techLevel >= 5);
  assert.ok(idx >= 0, 'должна найтись станция с достаточным техуровнем');

  const s = { ...g, system: idx, cash: 2_000_000 }; // 200 000 CR
  const r = buyEquipment(s, 'pod');
  assert.ok(!r.error, `покупка не прошла: ${r.error}`);
  assert.equal(r.state.ship.escapePod, true);
  assert.equal(s.cash - r.state.cash, 10000, 'списано 1000 CR (внутренние единицы 0.1 CR)');
});

test('капсулу нельзя купить на слабой станции', async () => {
  // Капсула — экран №8, нужно tek + 3 >= 8, то есть tek >= 5.
  const { newGame, buyEquipment, systemsOf } = await import('../src/core/state.ts');
  const g = newGame(7);
  const systems = systemsOf(1);
  const idx = systems.findIndex((s) => s.techLevel < 5);
  assert.ok(idx >= 0, 'должна найтись слабая станция');
  const s = { ...g, system: idx, cash: 2_000_000 };
  const r = buyEquipment(s, 'pod');
  assert.equal(r.error, 'tech', 'доступность зависит от техуровня');
});
