/**
 * §98.1: что происходит со статусом при ВОЗВРАТЕ на станцию с запрещёнкой.
 *
 * Пользователь спросил прямо: «Как меняется статус при именно возврате на
 * станцию с запрещёнкой?» Вопрос законный — из игры это было непонятно,
 * потому что на посадке с контрабандой не писалось НИ ОДНОЙ записи.
 *
 * Как это работает (числа не менялись, только объяснение):
 *
 *   1. ВЗЛЁТ (TT110, оригинал). Статус = `legal | уровень`, где уровень =
 *      (рабы + наркотики) × 2 + оружие. Побитовое ИЛИ, а не сумма: два
 *      прыжка с одним и тем же грузом не поднимают статус дважды. С двумя
 *      рабами это 4, поэтому «чистый» летит уже с четырьмя.
 *
 *   2. В ПОЛЁТЕ статус не трогается.
 *
 *   3. ПОСАДКА. Обычный прыжок делит статус пополам (`legal >> 1`) — так в
 *      оригинале. Но с контрабандой в трюме деления нет (§80.1): побег от
 *      статуса невозможен, значит и доля не применяется. Статус остаётся
 *      каким был. Теперь об этом пишется запись.
 *
 *   4. ВОЗВРАТ ИЗ ПАТРУЛЯ статус не трогает вовсе — там вообще нет
 *      прибытия в новую систему.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  newGame, startJump, startPatrol, advance, returnFromPatrol, systemsOf,
  DEFAULT_SETTINGS, MAX_FUEL, SLAVES_INDEX, FIREARMS_INDEX, contrabandLevel, legalAfterLaunch,
} from '../src/core/state.ts';

/** Настройки без встреч: проверяем посадку, а не бой. */
const calm = { ...DEFAULT_SETTINGS, encounterRate: 0 };

/** Достижимая цель на полном баке. */
function reachable(base: ReturnType<typeof newGame>): number {
  const sys = systemsOf(1);
  const here = sys[base.system];
  for (let i = 0; i < 256; i++) {
    if (i === base.system) continue;
    const d = Math.hypot(here.x - sys[i].x, (here.y - sys[i].y) / 2) * 4;
    if (d <= MAX_FUEL) return i;
  }
  throw new Error('нет достижимой системы');
}

const withCargo = (base: ReturnType<typeof newGame>, index: number, n: number) => ({
  ...base,
  fuel: MAX_FUEL,
  holdSpace: 20 - n,
  cargo: base.cargo.map((v, i) => (i === index ? n : v)),
});

test('§98.1: с контрабандой посадка НЕ делит статус', () => {
  const base = newGame(3);
  const s = { ...withCargo(base, SLAVES_INDEX, 2), legal: 40 };
  const started = startJump(s, reachable(base), 1000, calm);
  const afterLaunch = started.state.legal;
  assert.ok(afterLaunch > 40, 'на взлёте статус вырос (TT110)');
  const landed = advance(started.state, 1000 + 3600_000, calm).state;
  assert.equal(landed.legal, afterLaunch, 'доля не применяется: статус остаётся');
  assert.deepEqual(landed.escapeRoute, [], 'маршрут побега не начинается');
});

test('§98.1: посадка с контрабандой объяснена в журнале', () => {
  const base = newGame(3);
  const s = { ...withCargo(base, SLAVES_INDEX, 2), legal: 40 };
  const started = startJump(s, reachable(base), 1000, calm);
  const events = advance(started.state, 1000 + 3600_000, calm).events;
  const blocked = events.find((e) => e.type === 'escape-blocked');
  assert.ok(blocked, 'без записи игрок не понимает, почему статус не упал');
  assert.match(blocked!.text, /запрещённ/, blocked!.text);
  assert.match(blocked!.text, /не снижается|невозможен/, blocked!.text);
});

test('§98.1: без контрабанды статус по-прежнему делится пополам', () => {
  const base = newGame(3);
  const s = { ...base, fuel: MAX_FUEL, legal: 40 };
  const started = startJump(s, reachable(base), 1000, calm);
  assert.equal(started.state.legal, 40, 'чистый взлёт статус не меняет');
  const landed = advance(started.state, 1000 + 3600_000, calm).state;
  assert.ok(landed.legal < 40, 'без контрабанды доля работает');
  assert.ok(landed.escapeRoute.length > 0, 'и открывается маршрут побега');
});

test('§98.1: с контрабандой статус при взлёте считается как ИЛИ, а не сложение', () => {
  const base = newGame(3);
  // Два раба: уровень 4. У чистого 0 | 4 = 4. У нарушителя 40 | 4 = 44.
  // Сложение дало бы 44 во втором случае тоже, но при статусе 4 второй
  // прыжок с тем же грузом НЕ поднимает статус до 8 — это и проверяем.
  const two = withCargo(base, SLAVES_INDEX, 2);
  assert.equal(contrabandLevel([0, 0, 0, 2, 0, 0, 0]), 4);
  assert.equal(legalAfterLaunch(0, two.cargo), 4);
  assert.equal(legalAfterLaunch(4, two.cargo), 4, 'повторный взлёт с тем же грузом статус не удваивает');
  assert.equal(legalAfterLaunch(40, two.cargo), 44);
});

test('§98.1: оружие незаконнее в два раза меньше, чем рабы', () => {
  // (рабы + наркотики) × 2 + оружие — подпрограмма BAD из оригинала.
  const base = newGame(3);
  assert.equal(legalAfterLaunch(0, withCargo(base, FIREARMS_INDEX, 2).cargo), 2);
  assert.equal(legalAfterLaunch(0, withCargo(base, SLAVES_INDEX, 1).cargo), 2);
});

test('§98.1: возврат из патруля статус не трогает', () => {
  const base = newGame(3);
  const ship = { ...base.ship, laser: 'military' as const, missiles: 4, ecm: true, energyBomb: true };
  const s = { ...withCargo(base, SLAVES_INDEX, 2), legal: 40, ship };
  const patrol = startPatrol(s, 1000);
  assert.ok(!patrol.error, `патруль не начался: ${patrol.error}`);
  const back = returnFromPatrol(patrol.state, 5000);
  assert.equal(back.state.legal, 40, 'патруль — не прибытие в новую систему');
  assert.deepEqual(back.state.escapeRoute, []);
});
