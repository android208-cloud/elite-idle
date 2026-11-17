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
import { topValue, fmtCareer, fmtCash, SHIP_NAME } from '../src/ui/top-bar.ts';

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

test('§91: на каждой вкладке своё ЗНАЧЕНИЕ, без подписи', () => {
  const s = { ...newGame(1), cash: 12345 };
  assert.equal(topValue(s, 'ship'), SHIP_NAME);
  // Рынок и ангар — деньги, и только они.
  assert.equal(topValue(s, 'market'), '1234.5 CR');
  assert.equal(topValue(s, 'hangar'), '1234.5 CR');
  // Карта — место, журнал — время.
  assert.match(topValue(s, 'map'), /^[A-ZА-Я]/);
  assert.match(topValue(s, 'log'), /(< 1 мин|\d+ (мин|ч))/);
});

test('§91: имя корабля не появляется там, где его не просили', () => {
  const s = newGame(1);
  for (const tab of ['map', 'market', 'hangar', 'log'] as const) {
    assert.notEqual(topValue(s, tab), SHIP_NAME, `на «${tab}» не должно быть имени корабля`);
  }
});

test('§91: кредиты не показываются на «Корабле» — они уже в карточке', () => {
  const s = { ...newGame(1), cash: 99999 };
  assert.ok(!/CR/.test(topValue(s, 'ship')), 'на «Корабле» деньги живут в карточке');
});

test('fmtCash: деньги в десятых долях кредита', () => {
  assert.equal(fmtCash(0), '0.0 CR');
  assert.equal(fmtCash(1000), '100.0 CR');
  assert.equal(fmtCash(12345), '1234.5 CR');
});

test('шапка в полёте показывает цель', () => {
  const base = newGame(1);
  const to = (base.system + 3) % 256;
  assert.notEqual(topValue({ ...base, flight: { from: base.system, to, patrol: false } as never }, 'map'),
    topValue(base, 'map'), 'цель отличается от стоянки');
});

test('патруль не меняет место: to === from', () => {
  const base = newGame(1);
  assert.equal(topValue({ ...base, flight: { from: base.system, to: base.system, patrol: true } as never }, 'map'),
    topValue(base, 'map'));
});

test('§91: в бою и на обломках — место, а не кредиты', () => {
  const base = { ...newGame(1), cash: 5000 };
  const v = topValue(base, null);
  assert.ok(!/CR/.test(v), 'в бою кредиты в шапке не нужны');
  assert.equal(v, topValue(base, 'map'));
});
