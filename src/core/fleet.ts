/**
 * §105: ФЛОТ — пилоты, которые летают сами.
 *
 * Идея пользователя: «они сами летают и приносят пассивный доход». Шаг 1 —
 * только торговцы; роли (контрабандист, пират, полицейский) придут потом.
 *
 * ## Что здесь решено и почему именно так
 *
 * **Пилот — не вы.** Он не ищет лучшую сделку и не торгуется: летает по
 * назначенному маршруту и берёт то, что даёт полка. Поэтому его выручка
 * считается по рынку с нулевым колебанием (`fluct = 0`), а не по живым
 * ценам. Причина не в лени: рынок пересоздаётся при КАЖДОМ прибытии, и
 * «живой» рынок чужой системы игроку всё равно не показан. Ровный рынок
 * делает рейс предсказуемым — игрок видит ту цифру, которую получит.
 *
 * **Полка — предел загрузки.** Товар на источнике конечен (`quantity`,
 * 0..63 т), поэтому большой трюм не вычерпывает мир целиком: Питон грузит
 * 106 т из нескольких линий, Анаконда упирается в ~220 т.
 *
 * **Цикл = полёт туда-обратно + отдых.** Пользователь: «не 30 минут, а
 * реальное расстояние», и «что ещё честнее — время отдыха пилота».
 * Отдых 2 часа — это и есть тормоз флота: без него окупаемость выходит
 * 4–21 час, и планеты за миллионы теряют смысл.
 *
 * **Доля пилота 25%** (§105, решение пользователя). Рост доли с размером
 * флота пока выключен: `PILOT_WAGE_STEP = 0`. Если понадобится — одна
 * правка здесь, и весь флот пересчитается.
 *
 * **Один пилот на маршрут.** Двум своим кораблям на одной линии делать
 * нечего — они сбивают друг другу цену. Это же и потолок дохода: флот
 * растёт от числа разведанных маршрутов, а не от денег на счету.
 */

import { distance, type StarSystem } from './galaxy.ts';
import { generateMarket, TONNE_MAX_INDEX } from './market.ts';
import type { ShipId } from './ships.ts';

/** Задаток при найме, в десятых кредита: 500 CR. */
export const PILOT_HIRE_FEE = 5000;

/**
 * Отдых пилота между рейсами, миллисекунды реального времени.
 *
 * Два часа: полёт туда-обратно занимает 12–24 минуты, а до и после —
 * погрузка, оформление, сон. За сутки выходит около десяти рейсов —
 * ровно смена дальнобойщика. При часе Аддер окупался бы за сутки, при
 * четырёх Кобра — за девять дней, и её бы просто не покупали.
 */
export const PILOT_REST_MS = 2 * 3_600_000;

/** Доля пилота от выручки рейса. */
export const PILOT_WAGE = 0.25;

/**
 * Прибавка к доле за каждого следующего пилота (0 = выключено).
 *
 * Это единственная ручка против экспоненты: при 0.05 одиннадцатый пилот
 * берёт уже 75%, и каждый следующий окупается всё хуже. Пользователь пока
 * не решил — поэтому 0, но код к этому готов.
 */
export const PILOT_WAGE_STEP = 0;

/** Потолок доли — выше 75% пилоту работать незачем. */
export const PILOT_MAX_WAGE = 0.75;

/**
 * Ранг, с которого можно нанимать. «Опытный» — 128 убийств.
 *
 * Пользователь: «не ранее ранга опытный или далее выше». Ограничение по
 * числу пилотов при этом отсутствует: «ограничение — мой кошелёк»,
 * потому что впереди ещё планеты.
 */
export const PILOT_MIN_KILLS = 128;

/** Маршрут пилота: откуда и куда. Оба конца — в его галактике. */
export interface PilotRoute {
  from: number;
  to: number;
}

export interface Pilot {
  id: number;
  name: string;
  ship: ShipId;
  /** Система, где пилота наняли: оттуда он и летает. */
  home: number;
  /** `null` — нанят, но маршрут ещё не назначен: стоит в ангаре. */
  route: PilotRoute | null;
  /** Момент, когда пилот вернётся с грузом (следующий рейс). */
  nextRunAt: number;
  /** Сколько рейсов сделано — для карточки. */
  runs: number;
}

/** Доля n-го пилота (нумерация с нуля). */
export function pilotWageShare(index: number): number {
  return Math.min(PILOT_MAX_WAGE, PILOT_WAGE + PILOT_WAGE_STEP * index);
}

/**
 * Кэш рынков с нулевым колебанием.
 *
 * `generateMarket` — чистая функция от системы и байта, но считается она
 * по 17 товарам, а флот спрашивает её каждый час на каждого пилота.
 * Ключ включает галактику: индексы систем в разных галактиках совпадают.
 */
const calmMarkets = new Map<string, ReturnType<typeof generateMarket>>();

function calmMarket(galaxy: number, systems: readonly StarSystem[], index: number): ReturnType<typeof generateMarket> {
  const key = `${galaxy}:${index}`;
  let m = calmMarkets.get(key);
  if (!m) {
    m = generateMarket(systems[index], 0);
    calmMarkets.set(key, m);
  }
  return m;
}

/** Забыть кэш — нужно тестам, чтобы не тащить рынки между галактиками. */
export function forgetCalmMarkets(): void {
  calmMarkets.clear();
}

/**
 * Сколько тонн пилот загрузит на источнике и сколько на этом заработает.
 *
 * Жадный выбор: сначала самая выгодная линия, потом следующая, пока не
 * кончится трюм или полка. Именно так поступил бы и игрок, но у пилота
 * ещё и полка — она и ограничивает крупные корабли.
 *
 * Возврат — в десятых кредита, как вся экономика игры.
 */
export function routeProfit(
  galaxy: number,
  systems: readonly StarSystem[],
  route: PilotRoute,
  hold: number,
): number {
  const from = calmMarket(galaxy, systems, route.from);
  const to = calmMarket(galaxy, systems, route.to);

  const lines: { margin: number; qty: number }[] = [];
  for (let i = 0; i <= TONNE_MAX_INDEX; i++) {
    // Маржа в десятых кредита за тонну — сразу в тех же единицах, что и цена.
    const margin = to[i].price - from[i].price;
    if (margin > 0 && from[i].quantity > 0) lines.push({ margin, qty: from[i].quantity });
  }
  lines.sort((a, b) => b.margin - a.margin);

  let room = hold;
  let profit = 0;
  for (const line of lines) {
    if (room <= 0) break;
    const tonnes = Math.min(room, line.qty);
    room -= tonnes;
    profit += tonnes * line.margin;
  }
  return profit;
}

/** Расстояние маршрута в световых годах. */
export function routeDistance(systems: readonly StarSystem[], route: PilotRoute): number {
  return distance(systems[route.from], systems[route.to]);
}

/**
 * Сколько пилоту платят за рейс: выручка минус его доля.
 *
 * Считается один раз на маршрут (выручка ровная), поэтому досчёт после
 * долгого отсутствия — это умножение, а не цикл по тысяче рейсов.
 */
export function pilotRunIncome(profit: number, index: number): number {
  return Math.round(profit * (1 - pilotWageShare(index)));
}

/** Имена пилотов: имя и фамилия собираются из двух байтов. */
const FIRST_NAMES = [
  'Вэл', 'Джо', 'Мира', 'Рэй', 'Олаф', 'Нина', 'Кир', 'Сэм',
  'Лира', 'Тор', 'Ада', 'Йен', 'Зоя', 'Макс', 'Уна', 'Бор',
] as const;

const LAST_NAMES = [
  'Кроу', 'Харт', 'Векс', 'Сорн', 'Райд', 'Мор', 'Талл', 'Брин',
  'Кейн', 'Дорн', 'Финч', 'Грей', 'Холл', 'Ларк', 'Нэш', 'Стоун',
] as const;

/** Имя пилота по двум байтам — детерминированно, без своего ГПСЧ. */
export function pilotName(a: number, b: number): string {
  return `${FIRST_NAMES[a % FIRST_NAMES.length]} ${LAST_NAMES[b % LAST_NAMES.length]}`;
}

/** Человеческая запись длительности: «2 ч 5 мин», «8 мин». */
export function formatSpan(ms: number): string {
  const total = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h <= 0) return `${m} мин`;
  return m === 0 ? `${h} ч` : `${h} ч ${m} мин`;
}
