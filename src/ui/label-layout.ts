/**
 * Раскладка подписей на карте.
 *
 * Вынесено из main.ts, чтобы это можно было проверить снимком (PNG) тем
 * же кодом, каким игра рисует на холсте. Чистая функция без состояния.
 *
 * Задача: вокруг точки системы поставить подпись — имя и, на местной
 * карте, характеристики планеты. Подписи не должны налезать друг на
 * друга, на точки и на край холста.
 *
 * Раскладка НЕ зависит от того, какая система выбрана. Иначе при
 * выборе подписи переезжали, и палец, только что попавший в название,
 * оказывался уже над другой системой. Порядок — от центра карты
 * наружу: чем ближе система к кораблю, тем важнее её подпись.
 *
 * Поэтому позиции перебираются по приоритету: сверху, снизу, потом
 * дальше. Первая свободная — выигрывает. Точки систем считаются
 * занятыми с самого начала: подпись поверх точки читается как грязь.
 */

export interface LabelItem {
  x: number;
  y: number;
  text: string;
  /**
   * Вторая строка — характеристики планеты. Не у всех карт есть:
   * на общей карте галактики 256 систем, там только имена.
   */
  sub?: string;
  color: string;
  subColor?: string;
}

export interface PlacedLabel {
  item: LabelItem;
  /** Центр блока с подписью. */
  cx: number;
  cy: number;
  /** Смещение второй строки относительно центра — 0, если её нет. */
  subDy: number;
  /**
   * Занимаемая площадь: имя И вторая строка, одним прямоугольником.
   *
   * Нужен не только раскладке, но и обработке касаний: по подписи
   * удобно попадать пальцем в систему, которую на карте не отделить
   * от соседней точки. Без списка под картой это единственный способ
   * выбрать QUATOR, а не RA (8 св. лет между ними — 19 px).
   *
   * Именно ОДИН прямоугольник на весь блок, а не по строке: палец
   * попадает то в «QUATOR», то в «пром. преим. · Т7» ниже, и если
   * области попадания разные, половина касаний по подписи мимо.
   */
  box: Box;
}

export interface Layout {
  placed: PlacedLabel[];
  /** Занятые прямоугольники: по ним ищется место для остальных. */
  occupied: Box[];
}

export interface LabelSizes {
  /** Ширина имени в пикселях. */
  tw: number;
  /** Ширина второй строки (0, если её нет). */
  sw: number;
}

export interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const overlaps = (a: Box, b: Box): boolean =>
  !(a.x2 < b.x1 || a.x1 > b.x2 || a.y2 < b.y1 || a.y1 > b.y2);

/**
 * Подбирает позиции подписей.
 *
 * sizes — измеренная ширина текста: измерять умеет только canvas,
 * а раскладка от него не зависит, поэтому ширины приходят снаружи.
 * Возвращает только те подписи, которые поместились; остальные
 * вызывающий код рисует отдельно, чтобы не потерять данные.
 */
export function layoutLabels(
  items: LabelItem[],
  sizes: LabelSizes[],
  width: number,
  height: number,
): Layout {
  const boxes: Box[] = [];

  /*
   * Порядок раскладки — по расстоянию до центра холста.
   *
   * Раньше порядок задавал вызывающий код (текущая, выбранная, потом
   * остальные), и при смене выбора подписи переезжали: на окрестностях
   * LAVE сдвигались 3 из 88. Для карты это плохо — палец, только что
   * попавший в название, оказывается над соседней системой. Теперь
   * порядок задаёт геометрия: он не меняется от выбора.
   *
   * Центр — корабль, он всегда в середине местной карты (и в центре
   * габарита на общей). Текущую и выбранную выделяет цвет, а не место.
   */
  const cx0 = width / 2;
  const cy0 = height / 2;
  const order = items
    .map((it, idx) => ({ idx, d: Math.hypot(it.x - cx0, it.y - cy0) }))
    .sort((a, b) => a.d - b.d)
    .map((o) => o.idx);

  // Точки систем считаем занятыми.
  for (const it of items) boxes.push({ x1: it.x - 5, y1: it.y - 5, x2: it.x + 5, y2: it.y + 5 });

  const placed: PlacedLabel[] = [];

  order.forEach((n) => {
    const it = items[n];
    const tw = sizes[n].tw;
    const sw = sizes[n].sw;
    const bw = Math.max(tw, sw);
    const th = it.sub ? 24 : 11;

    // Двухстрочный блок ставим только сверху или снизу: сбоку широкая
    // строка характеристик налезает на соседнюю точку системы.
    const spots: [number, number][] = it.sub
      ? [
          [0, 22],
          [0, -24],
          [0, 34],
          [0, -36],
        ]
      : [
          [0, 15],
          [0, -15],
          [tw / 2 + 8, 0],
          [-tw / 2 - 8, 0],
          [tw / 2 + 6, 13],
          [-tw / 2 - 6, 13],
          [tw / 2 + 6, -13],
          [-tw / 2 - 6, -13],
        ];

    for (const [dx, dy] of spots) {
      const cx = it.x + dx;
      const cy = it.y + dy;
      const box: Box = {
        x1: cx - bw / 2 - 2,
        y1: cy - th / 2 - 2,
        x2: cx + bw / 2 + 2,
        y2: cy + th / 2 + 2,
      };
      if (box.x1 < 1 || box.y1 < 1 || box.x2 > width - 1 || box.y2 > height - 1) continue;
      if (boxes.some((b) => overlaps(box, b))) continue;
      boxes.push(box);
      placed.push({ item: it, cx, cy, subDy: it.sub ? 0 : 0, box });
      break;
    }
  });

  // Возвращаем в исходном порядке — вызывающий код рисует по нему,
  // и порядок отрисовки не должен зависеть от порядка раскладки.
  placed.sort((a, b) => items.indexOf(a.item) - items.indexOf(b.item));

  /*
   * Куда легла однострочная подпись.
   *
   * Раньше вызывающий код проверял попадание по всему прямоугольнику
   * блока и округлял центр — а строка печатается по центру `cy`, не по
   * низу блока. Названия систем стоят близко (RA и QUATOR — соседи на
   * карте), и трёхпиксельный сдвиг отправлял тап по RA в QUATOR.
   *
   * Поэтому пишем и точную строку, и её высоту: попадание считается по
   * ним, а не по прямоугольнику раскладки.
   */
  const measure = (text: string): number => {
    const idx = items.findIndex((it) => it.text === text || it.sub === text);
    const n = idx >= 0 ? idx : 0;
    return text === items[n].sub ? sizes[n].sw : sizes[n].tw;
  };
  for (const p of placed) {
    const lineH = p.item.sub ? 22 : 10;
    p.box = {
      x1: p.cx - (p.item.sub ? Math.max(measure(p.item.text), measure(p.item.sub)) / 2 : measure(p.item.text) / 2) - 2,
      y1: p.cy - lineH / 2,
      x2: p.cx + (p.item.sub ? Math.max(measure(p.item.text), measure(p.item.sub)) / 2 : measure(p.item.text) / 2) + 2,
      y2: p.cy + lineH / 2,
    };
  }

  return { placed, occupied: boxes };
}

/**
 * Место для однострочной подписи, которой не хватило двух строк.
 *
 * Возвращает координаты центра или null, если и однострочно не влезает.
 * Одну строку можно поставить сбоку от точки — она узкая, и рядом с
 * соседней системой обычно остаётся просвет.
 */
export function placeSingle(
  x: number,
  y: number,
  textWidth: number,
  width: number,
  occupied: Box[],
): { cx: number; cy: number; box: Box } | null {
  const th = 9;
  // Порядок = приоритет: сначала рядом с точкой, потом дальше.
  // Список длинный намеренно: подпись, потерявшая место, уносит с
  // собой характеристики планеты, а пользователь просил их видеть.
  const spots: [number, number][] = [
    [textWidth / 2 + 9, 0],
    [-textWidth / 2 - 9, 0],
    [textWidth / 2 + 8, 11],
    [-textWidth / 2 - 8, 11],
    [textWidth / 2 + 8, -11],
    [-textWidth / 2 - 8, -11],
    [0, 16],
    [0, -16],
    [textWidth / 2 + 8, 21],
    [-textWidth / 2 - 8, 21],
    [textWidth / 2 + 8, -21],
    [-textWidth / 2 - 8, -21],
    [0, 26],
    [0, -26],
  ];
  for (const [dx, dy] of spots) {
    const cx = x + dx;
    const cy = y + dy;
    const box: Box = {
      x1: cx - textWidth / 2 - 1,
      y1: cy - th / 2 - 1,
      x2: cx + textWidth / 2 + 1,
      y2: cy + th / 2 + 1,
    };
    if (box.x1 < 1 || box.y1 < 1 || box.x2 > width - 1) continue;
    if (occupied.some((b) => overlaps(box, b))) continue;
    return { cx, cy, box };
  }
  return null;
}
