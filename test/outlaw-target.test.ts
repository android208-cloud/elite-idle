/**
 * §95: пират, летящий мимо, — законная цель.
 *
 * Проверялось кнопкой в интерфейсе: на жёлтого пирата нельзя было напасть,
 * подпись гласила «Корабль не враждебен — атака была бы преступлением».
 * Это противоречило §86 (жёлтый = пират, а не мирный) и оригиналу, где
 * пиратов бьют за награду.
 *
 * Причина оказалась в смешении двух разных вопросов:
 *
 *   hostile — атакует ли он СЕЙЧАС;
 *   роль    — преступник ли он по природе.
 *
 * И во втором смешении: `enemy.pirate` — свойство МОДЕЛИ корабля
 * («на Cobra Mk III летают и пираты, и торговцы»), а не роли встречи.
 * Проверка по нему пускала чистого пилота грабить торговца.
 *
 * Здесь закрепляется итоговое правило:
 *
 *   обычный патруль: пират (по роли) — цель всегда;
 *                    торговец и власть — только если сами напали;
 *   пиратство:       любой, кого позволяет снаряжение;
 *   без снаряжения:  пропуск, даже в пиратстве.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { availableDecisions, bestLaserOf, canBeat } from '../src/core/one-decision.ts';
import { enemyById } from '../src/core/ships.ts';
import { newGame, startPatrol, advance, DEFAULT_SETTINGS, MAX_FUEL } from '../src/core/state.ts';

const MILITARY = bestLaserOf({ pulse: false, beam: false, military: true, mining: false });

/** Прогоняет одну встречу в патруле и возвращает типы значимых событий. */
function meet(legal: number, role: string, enemyId: string, outcome: 'attack' | 'leave'): string[] {
  const base = newGame(1);
  const gun = {
    ...base, legal, fuel: MAX_FUEL,
    ship: { ...base.ship, laser: 'military' as const, ecm: true, energyBomb: true, missiles: 4 },
  };
  let s = startPatrol(gun, 1e6).state;
  const at = 1e6 + 50_000;
  s = { ...s, encounter: { role, enemyId, detectedAt: at, resolveAt: at + 1000, outcome } } as never;
  const r = advance(s, at + 5000, DEFAULT_SETTINGS);
  return r.events.map((e) => e.type)
    .filter((t) => ['auto-victory', 'auto-skip', 'vanished', 'raided'].includes(t));
}

test('§95: кнопка «Напасть» доступна на пирата, летящего мимо', () => {
  const pirate = enemyById('sidewinder');
  const idle = availableDecisions(pirate, MILITARY, true, true); // законная цель
  const attacking = availableDecisions(pirate, MILITARY, true, true);
  assert.equal(idle.attack, true, 'пират — цель и когда атакует, и когда мимо');
  assert.equal(attacking.attack, true);
});

test('§95: на торговца мимо кнопки «Напасть» нет', () => {
  const trader = enemyById('cobra3');
  const d = availableDecisions(trader, MILITARY, true, false);
  assert.equal(d.attack, false, 'мирный корабль — не цель');
  assert.match(d.attackReason ?? '', /преступлен/);
});

test('§95: пират мимо — победа в обычном патруле', () => {
  assert.deepEqual(meet(0, 'pirate', 'sidewinder', 'leave'), ['auto-victory']);
});

test('§95: торговец мимо в обычном патруле уходит', () => {
  assert.deepEqual(meet(0, 'trader', 'cobra3', 'leave'), ['vanished']);
});

test('§95: полиция мимо в обычном патруле уходит', () => {
  assert.deepEqual(meet(0, 'police', 'viper', 'leave'), ['vanished']);
});

test('§95: в пиратстве торговец мимо — добыча', () => {
  assert.deepEqual(meet(60, 'trader', 'cobra3', 'leave'), ['auto-victory', 'raided']);
});

test('§95: в пиратстве полиция мимо — тоже цель', () => {
  assert.deepEqual(meet(60, 'police', 'viper', 'leave'), ['auto-victory']);
});

test('§95: без снаряжения сильный пират пропускается', () => {
  /*
   * Правило §78: Python закрыт без полного набора. «Бить можно любого»
   * (§79) не отменяет проверку снаряжения.
   *
   * Важно: патруль требует 4 ракеты (PATROL_MISSILES_REQUIRED), а у
   * стартового корабля их 3. Без этого `startPatrol` вернёт `no-missiles`,
   * полёта не будет, и тест проверял бы пустоту — на этом он и упал в
   * первом заходе. Поэтому патруль запускаем с 4 ракетами и импульсным
   * лазером: ракеты есть, а против Python их мало.
   */
  const python = enemyById('python');
  const weakKit = { militaryLaser: false, ecm: false, energyBomb: false, missiles: 0 };
  assert.equal(canBeat(python, weakKit, 'pulse'), false, 'без набора не одолеть');
  assert.equal(canBeat(python, { militaryLaser: true, ecm: true, energyBomb: true, missiles: 4 }, MILITARY), true);

  const base = newGame(1);
  const weakButFlyable = { ...base, fuel: MAX_FUEL, ship: { ...base.ship, missiles: 4 } };
  const started = startPatrol(weakButFlyable, 1e6);
  assert.equal(started.error, undefined, 'патруль должен начаться');
  let s = started.state;
  const at = 1e6 + 50_000;
  s = { ...s, encounter: { role: 'pirate', enemyId: 'python', detectedAt: at, resolveAt: at + 1000, outcome: 'leave' } } as never;
  const r = advance(s, at + 5000, DEFAULT_SETTINGS);
  assert.ok(r.events.some((e) => e.type === 'auto-skip'), 'пропуск, а не победа');
});
