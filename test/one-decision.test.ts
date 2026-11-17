/**
 * Бой «одно решение» (§38.1, §39.1, §40).
 *
 * Решения пользователя, которые здесь зафиксированы:
 *  - раундов нет, решение принимается один раз;
 *  - «напасть» только на слабый корабль; сильный — только «пропустить»;
 *  - «бежать» требует купленной капсулы (§37), без неё — только напасть
 *    или пропустить;
 *  - смерти игрока в этом бою не может быть;
 *  - не решил вовремя: слабый враждебный → победа, сильный/нейтральный →
 *    пропуск, капсула не тратится.
 *
 * Порог «слабый» сверяется с §39.1, где он был выведен из DPS лазеров.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyDecision,
  autoResolve,
  availableDecisions,
  bestLaserOf,
  damageShare,
  isWeak,
  roundsToDie,
  roundsToKill,
} from '../src/core/one-decision.ts';
import { ENEMIES, enemyById } from '../src/core/ships.ts';

const PIRATES = ENEMIES.filter((e) => e.pirate);

test('§39.1: Python и Anaconda не проходят как слабые никогда', () => {
  // Ключевое требование пользователя: «Python и Thargoid — никогда».
  for (const laser of ['pulse', 'beam', 'military'] as const) {
    assert.equal(isWeak(enemyById('python'), laser), false, `Python при ${laser}`);
    assert.equal(isWeak(enemyById('anaconda'), laser), false, `Anaconda при ${laser}`);
  }
});

test('§39.1: Sidewinder и Krait слабые даже при импульсном', () => {
  for (const id of ['sidewinder', 'krait']) {
    assert.equal(isWeak(enemyById(id), 'pulse'), true, id);
  }
});

test('§39.1: расширение списка с ростом лазера', () => {
  // Пользователь: pulse → Sidewinder/Krait; beam → +Cobra-пират;
  // military → +Asp. Проверяем, что список не сужается.
  const weakAt = (laser: 'pulse' | 'beam' | 'military'): string[] =>
    PIRATES.filter((e) => isWeak(e, laser)).map((e) => e.id);

  const pulse = new Set(weakAt('pulse'));
  const beam = new Set(weakAt('beam'));
  const military = new Set(weakAt('military'));

  for (const id of pulse) assert.ok(beam.has(id), `${id} должен остаться при beam`);
  for (const id of beam) assert.ok(military.has(id), `${id} должен остаться при military`);
  // И список действительно растёт, а не пуст.
  assert.ok(pulse.size > 0, 'при импульсном кто-то должен быть слабым');
  assert.ok(military.size >= pulse.size);
});

test('без лазера нападать не на кого', () => {
  // С «none» урон нулевой: любой враг сильный.
  for (const e of PIRATES) {
    assert.equal(isWeak(e, 'none'), false, e.id);
  }
});

test('нейтральный корабль слабым не считается', () => {
  // Viper — полиция, pirate: false. Атака на него — преступление.
  const viper = enemyById('viper');
  assert.equal(viper.pirate, false);
  assert.equal(isWeak(viper, 'military'), false);
});

test('доля урона растёт с силой врага', () => {
  const side = damageShare(enemyById('sidewinder'), 'military');
  const asp = damageShare(enemyById('asp'), 'military');
  const python = damageShare(enemyById('python'), 'military');
  assert.ok(side < asp, 'Sidewinder легче Asp');
  assert.ok(asp < python, 'Asp легче Python');
  assert.ok(python > 0.4, 'Python пробивает порог');
});

test('напасть недоступно на сильного, но доступно на слабого', () => {
  const weak = availableDecisions(enemyById('sidewinder'), 'military', false, true);
  assert.equal(weak.attack, true);
  assert.equal(weak.skip, true);
  // §77: капсулы нет, поэтому бежать можно всегда — и с ней, и без неё.
  assert.equal(weak.flee, true, 'бегство не требует предметов');

  const strong = availableDecisions(enemyById('python'), 'military', true, true);
  assert.equal(strong.attack, false);
  assert.equal(strong.flee, true);
  assert.equal(strong.skip, true);
  assert.ok(strong.attackReason);
});

test('на невраждебный корабль напасть нельзя', () => {
  const d = availableDecisions(enemyById('sidewinder'), 'military', true, false);
  assert.equal(d.attack, false, 'слабый, но не враждебен');
  assert.match(d.attackReason ?? '', /преступлен/);
});

test('напасть на слабого — победа и награда', () => {
  const enemy = enemyById('sidewinder');
  const d = availableDecisions(enemy, 'military', false, true);
  const r = applyDecision(enemy, 'attack', d, true);
  assert.ok(r);
  assert.equal(r.outcome, 'won');
  assert.equal(r.bounty, enemy.bounty);
  assert.equal(r.podUsed, false);
});

test('§77: бегство — не капсула, а обычный уход от боя', () => {
  const enemy = enemyById('python');
  const d = availableDecisions(enemy, 'military', true, true);
  const r = applyDecision(enemy, 'flee', d, true);
  assert.ok(r);
  assert.equal(r.outcome, 'fled');
  assert.equal(r.podUsed, false, 'капсулы больше нет — и флаг не поднимается');
  assert.equal(r.legalCleared, true, 'правовой статус обнуляется, как раньше');
});

test('недоступное решение не применяется даже если его вызвать', () => {
  const enemy = enemyById('python');
  const d = availableDecisions(enemy, 'military', false, true);
  assert.equal(applyDecision(enemy, 'attack', d, true), null, 'сильный — напасть нельзя');
  // §77: раньше здесь проверялось, что без капсулы бежать нельзя. Капсулы
  // нет, бегство доступно всегда — недоступным осталось только нападение.
  assert.ok(applyDecision(enemy, 'flee', d, true), 'бегство доступно');
});

test('§40: не решил вовремя — слабый враждебный даёт победу', () => {
  const enemy = enemyById('sidewinder');
  const d = availableDecisions(enemy, 'military', false, true);
  const r = autoResolve(enemy, d, true);
  assert.equal(r.outcome, 'auto-victory');
  assert.equal(r.bounty, enemy.bounty);
  assert.equal(r.podUsed, false, 'капсула не тратится');
});

test('§40: не решил вовремя — сильный даёт пропуск', () => {
  const enemy = enemyById('python');
  const d = availableDecisions(enemy, 'military', true, true);
  const r = autoResolve(enemy, d, true);
  assert.equal(r.outcome, 'auto-skip');
  assert.equal(r.podUsed, false);
  assert.equal(r.bounty, 0);
});

test('§40: не решил вовремя — нейтральный даёт пропуск', () => {
  const enemy = enemyById('sidewinder');
  const d = availableDecisions(enemy, 'military', true, false);
  const r = autoResolve(enemy, d, false);
  assert.equal(r.outcome, 'auto-skip');
  assert.equal(r.bounty, 0);
});

test('лучший лазер выбирается по силе, а не по цене', () => {
  assert.equal(bestLaserOf({ pulse: true, beam: false, military: false, mining: false }), 'pulse');
  assert.equal(bestLaserOf({ pulse: true, beam: true, military: false, mining: false }), 'beam');
  assert.equal(
    bestLaserOf({ pulse: true, beam: true, military: true, mining: true }),
    'military',
  );
  assert.equal(bestLaserOf({ pulse: false, beam: false, military: false, mining: false }), 'none');
  // Добывающий сильнее импульсного по урону (50 против 15), но без
  // остальных он и остаётся.
  assert.equal(bestLaserOf({ pulse: false, beam: false, military: false, mining: true }), 'mining');
});

test('смерти игрока в этом бою нет по построению', () => {
  // Исходов всего четыре, и ни один не «погиб».
  const outcomes = new Set<string>();
  for (const e of PIRATES) {
    const d = availableDecisions(e, 'military', true, true);
    for (const dec of ['attack', 'flee', 'skip'] as const) {
      const r = applyDecision(e, dec, d, true);
      if (r) outcomes.add(r.outcome);
    }
    outcomes.add(autoResolve(e, d, true).outcome);
  }
  assert.ok(!outcomes.has('died'), 'исхода «погиб» быть не может');
  assert.deepEqual([...outcomes].sort(), ['auto-skip', 'auto-victory', 'fled', 'skipped', 'won']);
});

test('раунды считаются по модели combat.ts', () => {
  // Сверка: модель урона та же, что в основном бою.
  assert.ok(roundsToKill(70, 'pulse') > 0);
  assert.equal(roundsToKill(70, 'none'), Number.POSITIVE_INFINITY);
  assert.equal(roundsToDie(0), Number.POSITIVE_INFINITY);
  assert.ok(roundsToDie(8) > roundsToDie(31), 'под сильным огнём держишься меньше');
});
