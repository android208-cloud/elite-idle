/**
 * Парк кораблей и раскладка подписей на карте (§70).
 *
 * Модели 12 кораблей, кроме Cobra Mk III, в игре появились впервые.
 * Здесь проверяется то, что можно проверить без глаз: индексы вершин
 * в рёбрах и гранях существуют, грани не вырождены, габариты
 * конечны. Как это выглядит — смотрит `tools/render-fleet.mjs`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawShipModel, FLEET, shipSpan } from '../src/ui/ship-model.ts';
import { layoutLabels, placeSingle, type LabelItem } from '../src/ui/label-layout.ts';
import { ENEMIES } from '../src/core/ships.ts';

const IDS = Object.keys(FLEET);

test('в парке все 13 встречающихся кораблей', () => {
  assert.equal(IDS.length, 13, `в парке: ${IDS.join(', ')}`);
  for (const e of ENEMIES) {
    assert.ok(FLEET[e.id], `у ${e.name} (${e.id}) нет модели`);
  }
});

test('геометрия каждого корабля согласована', () => {
  for (const id of IDS) {
    const bp = FLEET[id];
    const n = bp.verts.length;
    assert.ok(n >= 4, `${id}: вершин ${n}`);
    assert.ok(bp.edges.length >= 6, `${id}: рёбер ${bp.edges.length}`);
    assert.ok(bp.faces.length >= 4, `${id}: граней ${bp.faces.length}`);

    for (const [a, b] of bp.edges) {
      assert.ok(a >= 0 && a < n, `${id}: ребро ссылается на вершину ${a} из ${n}`);
      assert.ok(b >= 0 && b < n, `${id}: ребро ссылается на вершину ${b} из ${n}`);
      assert.notEqual(a, b, `${id}: ребро ${a}-${b} вырождено`);
    }
    for (const f of bp.faces) {
      assert.ok(f.length >= 3, `${id}: грань из ${f.length} вершин`);
      for (const i of f) assert.ok(i >= 0 && i < n, `${id}: грань ссылается на вершину ${i} из ${n}`);
      assert.equal(new Set(f).size, f.length, `${id}: в грани повторяются вершины`);
    }
    // Каждая вершина должна быть хоть где-то задействована, иначе
    // модель содержит мусор из исходника.
    const used = new Set(bp.edges.flat());
    assert.equal(used.size, n, `${id}: задействовано ${used.size} вершин из ${n}`);
  }
});

test('габариты: Cobra Mk III — эталон 256 единиц, Python крупнее всех', () => {
  assert.equal(shipSpan(FLEET.cobra3), 256);
  assert.equal(shipSpan(FLEET.adder), 80);
  // Порядок размеров из оригинала: Adder — самый маленький, Python
  // и Anaconda — самые крупные. Если извлекатель перепутает корабли,
  // это сразу всплывёт.
  assert.ok(shipSpan(FLEET.python) > shipSpan(FLEET.cobra3));
  assert.ok(shipSpan(FLEET.anaconda) > shipSpan(FLEET.cobra3));
  assert.ok(shipSpan(FLEET.adder) < shipSpan(FLEET.sidewinder));
});

test('Cobra Mk III в парке совпадает с моделью из §69', () => {
  // 28 вершин / 38 рёбер / 13 граней — числа из независимого разбора
  // ZX-версии. Совпадение значит, что парсер BBC-исходников верен.
  assert.equal(FLEET.cobra3.verts.length, 28);
  assert.equal(FLEET.cobra3.edges.length, 38);
  assert.equal(FLEET.cobra3.faces.length, 13);
});

test('каждый корабль парка рисуется без исключений', () => {
  // Настоящий баг, пойманный этой проверкой: «нос» был жёстко привязан
  // к вершинам 20 и 21 — у Cobra это кончик, а у Sidewinder (10 вершин)
  // их нет, и рендер падал с «undefined.x». Падало 11 моделей из 13.
  for (const id of IDS) {
    const ops: string[] = [];
    const ctx = new Proxy({} as CanvasRenderingContext2D, {
      get(_t, key) {
        if (key === 'measureText') return () => ({ width: 6 });
        return (...args: unknown[]) => {
          ops.push(String(key));
          void args;
        };
      },
      set() {
        return true;
      },
    });
    assert.doesNotThrow(
      () => drawShipModel(ctx, { width: 300, height: 130, yaw: 0.7, ship: FLEET[id] }),
      `${id}: рендер упал`,
    );
    // Силуэт плюс хотя бы три грани: корпус не пустой.
    const fills = ops.filter((o) => o === 'fill').length;
    assert.ok(fills >= 4, `${id}: заливок ${fills}, корпус пуст`);
  }
});

/* ---------- Раскладка подписей ---------- */

const item = (x: number, y: number, text: string, sub?: string): LabelItem => ({
  x, y, text, sub, color: '#fff', subColor: '#aaa',
});

test('подписи не налезают друг на друга и не уезжают за холст', () => {
  // Тесно, как в окрестностях LAVE: 12 систем на 360×360.
  const items = [
    item(180, 180, 'LAVE', 'агро богатая · Т5'),
    item(180, 120, 'REORTE', 'агро бедная · Т6'),
    item(120, 200, 'DISO', 'агро средняя · Т8'),
    item(150, 260, 'LEESTI', 'пром. бедная · Т11'),
    item(40, 210, 'RIEDQUAT', 'пром. преим. · Т4'),
    item(60, 150, 'USZAA', 'пром. средняя · Т8'),
    item(200, 90, 'QUATOR', 'пром. преим. · Т7'),
    item(120, 300, 'ORRERE', 'пром. преим. · Т6'),
    item(330, 230, 'ZAONCE', 'агро бедная · Т12'),
    item(320, 300, 'TIONISLA', 'агро средняя · Т12'),
  ];
  const sizes = items.map((it) => ({
    tw: it.text.length * 6,
    sw: it.sub ? it.sub.length * 5.2 : 0,
  }));
  const { placed, occupied } = layoutLabels(items, sizes, 360, 360);

  assert.ok(placed.length > 0, 'хоть что-то размещено');

  // Ни одна пара прямоугольников не пересекается.
  for (let i = 0; i < occupied.length; i++) {
    for (let j = i + 1; j < occupied.length; j++) {
      const a = occupied[i];
      const b = occupied[j];
      const clash = !(a.x2 < b.x1 || a.x1 > b.x2 || a.y2 < b.y1 || a.y1 > b.y2);
      assert.ok(!clash, `прямоугольники ${i} и ${j} пересекаются`);
    }
  }
  // И всё внутри холста.
  for (const b of occupied) {
    assert.ok(b.x1 >= 0 && b.y1 >= 0 && b.x2 <= 360 && b.y2 <= 360, 'подпись уехала за холст');
  }
});

test('раскладка не зависит от того, какая система выбрана', () => {
  // Была регрессия: порядок раскладки задавал вызывающий код
  // (текущая → выбранная → прочие), и при выборе подписи переезжали.
  // Палец, только что попавший в название, оказывался над другой
  // системой. Теперь порядок задаёт расстояние до центра — он от
  // выбора не меняется.
  const items = [
    item(180, 180, 'LAVE', 'агро богатая · Т5'),
    item(180, 120, 'REORTE', 'агро бедная · Т6'),
    item(120, 200, 'DISO', 'агро средняя · Т8'),
    item(150, 260, 'LEESTI', 'пром. бедная · Т11'),
    item(60, 150, 'USZAA', 'пром. средняя · Т8'),
    item(200, 90, 'QUATOR', 'пром. преим. · Т7'),
  ];
  const sizes = items.map((it) => ({ tw: it.text.length * 6, sw: it.sub ? it.sub.length * 5.2 : 0 }));
  const a = layoutLabels(items, sizes, 360, 360);
  // Меняем порядок входа — как если бы выбранной стала другая система.
  const shuffled = [...items].reverse();
  const b = layoutLabels(shuffled, shuffled.map((it) => ({ tw: it.text.length * 6, sw: it.sub ? it.sub.length * 5.2 : 0 })), 360, 360);
  const posOf = (l: { placed: { item: LabelItem; cx: number; cy: number }[] }) =>
    new Map(l.placed.map((p) => [p.item.text, `${Math.round(p.cx)},${Math.round(p.cy)}`]));
  const pa = posOf(a);
  const pb = posOf(b);
  for (const [name, pos] of pa) {
    if (!pb.has(name)) continue;
    assert.equal(pb.get(name), pos, `${name} переехала при смене выбора`);
  }
});

test('касание по подписи считается по её реальной строке', () => {
  // Двухстрочная подпись занимает 22 px, однострочная — 10.
  // Точные границы нужны потому, что соседние подписи стоят в
  // нескольких пикселях и приблизительный прямоугольник уводит тап.
  const items = [item(100, 100, 'RA'), item(140, 100, 'QUATOR')];
  const sizes = [
    { tw: 12, sw: 0 },
    { tw: 36, sw: 0 },
  ];
  const { placed } = layoutLabels(items, sizes, 360, 200);
  for (const p of placed) {
    const h = p.box.y2 - p.box.y1;
    assert.equal(h, 10, `высота области ${h} вместо 10 для однострочной`);
  }
});

test('однострочная подпись находит место там, где двухстрочная не влезла', () => {
  const taken = [{ x1: 100, y1: 100, x2: 260, y2: 130 }];
  const spot = placeSingle(180, 115, 80, 360, taken);
  assert.ok(spot, 'место должно найтись');
  // Не поверх занятого прямоугольника.
  const box = { x1: spot!.cx - 40, y1: spot!.cy - 5, x2: spot!.cx + 40, y2: spot!.cy + 5 };
  assert.ok(
    !(box.x2 >= 100 && box.x1 <= 260 && box.y2 >= 100 && box.y1 <= 130),
    'подпись легла поверх занятого места',
  );
});

test('если места нет вовсе — возвращается null, а не подпись поверх', () => {
  const wall = [{ x1: -10, y1: -10, x2: 1000, y2: 1000 }];
  assert.equal(placeSingle(180, 180, 90, 360, wall), null);
});

/* ---------- Формат длительности ---------- */

/*
 * fmtDur — не экспортируется, но правило простое и важное: единицы
 * подписаны, нули не печатаются. Проверяем через собранную игру в
 * tools/verify-destination.mjs; здесь — чтобы зафиксировать решение
 * в тестах, дублируем правило как документ.
 */
test('длительность печатается с подписью единиц', () => {
  const fmt = (ms: number): string => {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const sec = total % 60;
    const pad = (n: number): string => String(n).padStart(2, '0');
    if (h > 0) return m > 0 ? `${h} ч ${pad(m)} мин` : `${h} ч`;
    if (m > 0) return sec > 0 ? `${m} мин ${pad(sec)} с` : `${m} мин`;
    return `${sec} с`;
  };
  // Главное: «1 ч» вместо «1:00», которое читается как минута.
  assert.equal(fmt(3600_000), '1 ч');
  assert.equal(fmt(3661_000), '1 ч 01 мин');
  assert.equal(fmt(15 * 60_000), '15 мин');
  assert.equal(fmt(96_000), '1 мин 36 с');
  assert.equal(fmt(42_000), '42 с');
  assert.equal(fmt(0), '0 с');
});
