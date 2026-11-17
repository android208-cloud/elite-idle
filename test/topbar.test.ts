/**
 * §89: время карьеры и шапка.
 *
 * Время карьеры считается в UI, а не в `advance` (там оно ломало инвариант
 * «досчёт не зависит от разбиения»). Поэтому проверяем:
 *
 *  - накопленное время переживает сохранение;
 *  - старые файлы без поля читаются, карьера начинается с нуля;
 *  - `fmtCareer` не врёт на границах часа;
 *  - шапка: три сегмента, корабль назван, кредитов нет;
 *  - в полёте — цель и подпись «Курс», в патруле место не меняется.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newGame, serialize, deserialize } from '../src/core/state.ts';
import { topSegments, fmtCareer, SHIP_NAME } from '../src/ui/top-bar.ts';

test('время карьеры переживает сохранение', () => {
  const s = { ...newGame(1), careerMs: 5 * 3600_000, careerAt: 123456 };
  const back = deserialize(serialize(s));
  assert.equal(back.careerMs, 5 * 3600_000, 'накопленное время не теряется');
});

test('старое сохранение без времени карьеры читается', () => {
  const s = newGame(1) as unknown as Record<string, unknown>;
  delete s.careerMs;
  delete s.careerAt;
  const back = deserialize(JSON.stringify(s));
  assert.equal(back.careerMs, 0, 'в сохранениях до §89 время начинается с нуля');
});

test('новая игра начинает карьеру с нуля', () => {
  const s = newGame(1);
  assert.equal(s.careerMs, 0);
  // careerAt = 0 — «точки отсчёта нет»: первый тик её только выставит.
  assert.equal(s.careerAt, 0);
});

test('fmtCareer: до часа — минуты, дальше — часы', () => {
  assert.equal(fmtCareer(0), '< 1 мин');
  assert.equal(fmtCareer(59_000), '< 1 мин');
  assert.equal(fmtCareer(60_000), '1 мин');
  assert.equal(fmtCareer(59 * 60_000), '59 мин');
  assert.equal(fmtCareer(3600_000), '1 ч');
  assert.equal(fmtCareer(3600_000 + 12 * 60_000), '1 ч 12 мин');
  assert.equal(fmtCareer(10 * 3600_000 + 30 * 60_000), '10 ч 30 мин');
});

test('шапка: три сегмента, корабль назван, кредитов нет', () => {
  const segs = topSegments(newGame(1));
  assert.equal(segs.length, 3);
  assert.deepEqual(segs.map((s) => s.key), ['Корабль', 'Карта', 'Журнал']);
  assert.equal(segs[0].value, SHIP_NAME);
  // Кредиты из шапки убраны (§89): они есть на «Корабле», «Рынке», «Ангаре».
  assert.ok(!segs.some((s) => /CR/.test(s.value)), 'кредитов в шапке быть не должно');
});

test('шапка в полёте показывает цель и подпись «Курс»', () => {
  const base = newGame(1);
  const to = (base.system + 3) % 256;
  const segs = topSegments({ ...base, flight: { from: base.system, to, patrol: false } as never });
  assert.equal(segs[1].key, 'Курс');
  assert.notEqual(segs[1].value, topSegments(base)[1].value, 'цель отличается от стоянки');
});

test('патруль не меняет место: to === from', () => {
  const base = newGame(1);
  const segs = topSegments({ ...base, flight: { from: base.system, to: base.system, patrol: true } as never });
  assert.equal(segs[1].value, topSegments(base)[1].value);
  // Подпись при этом «Курс»: корабль в полёте, пусть и внутри системы.
  assert.equal(segs[1].key, 'Курс');
});
