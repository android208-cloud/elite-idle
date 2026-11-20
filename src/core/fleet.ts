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

import { isContraband } from './cargo-canisters.ts';
import { distance, type StarSystem } from './galaxy.ts';
import { generateMarket, TONNE_MAX_INDEX } from './market.ts';
import { RANK_NAMES, type ShipId } from './ships.ts';

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

/* ---------- §107: роли пилота ---------- */

/**
 * Роль пилота. Шаг 2: три роли, полицейский — шаг 3.
 *
 * Роль — это не «профессия на всю жизнь»: она задаётся вместе с маршрутом
 * и меняется там же. Один и тот же пилот может быть торговцем на спокойной
 * линии и пиратом в анархии.
 */
export type PilotRole = 'trader' | 'smuggler' | 'pirate' | 'police';

export const PILOT_ROLE_NAMES: Record<PilotRole, string> = {
  trader: 'Торговец',
  smuggler: 'Контрабандист',
  pirate: 'Пират',
  police: 'Полицейский',
};

/**
 * §108: полицейский — шаг 3.
 *
 * Его дело не маршрут, а СИСТЕМА: он в ней дежурит. Отсюда два следствия,
 * и оба важны:
 *
 *   1. Надзор системы растёт на `POLICE_SURVEILLANCE_BONUS`. Через те же
 *      формулы, что уже работают (§107), это значит: вашим торговцам
 *      спокойнее, вашим контрабандистам — досмотры, вашим пиратам —
 *      перехват. То есть полицейский закрывает систему для ваших же
 *      пиратов, и это не баг, а выбор игрока.
 *
 *   2. Налёт на ваш торговый рейс, у которого один из концов под охраной,
 *      отбивается с шансом `POLICE_INTERCEPT`. Именно это и делает
 *      полицейского полезным: +2 надзора на линии — это всего полпроцента
 *      риска, а отбитый налёт — половина потерь.
 *
 * Платит ему не торговля, а награды: чем беззаконнее система, тем больше
 * там добычи. Поэтому патруль в анархии — самые большие деньги и самый
 * большой риск, а в демократии — почти ничего и почти безопасно.
 */
export const POLICE_SURVEILLANCE_BONUS = 2;

/** Награда за рейс: база плюс надбавка за каждый пункт беззакония. */
export const POLICE_BOUNTY_BASE = 400;
export const POLICE_BOUNTY_PER_LAWLESS = 200;

/** Погиб в бою с пиратами: `(7 − надзор) × 1%` за рейс. */
export const POLICE_DEATH_CHANCE = 0.01;

/** Потрёпан в бою: 4%, ремонт — четверть цены корабля. */
export const POLICE_DAMAGE_CHANCE = 0.04;
export const POLICE_REPAIR_SHARE = 0.25;

/** Шанс, что охрана отобьёт налёт на торговца (на каждый конец маршрута). */
export const POLICE_INTERCEPT = 0.5;

/**
 * Скупщик краденого берёт треть цены.
 *
 * Без этой доли пират был бы в восемь раз богаче торговца: он же забирает
 * товар даром. Треть оставляет ему двукратный перевес — доходность,
 * за которую стоит рисковать, но не ту, ради которой бросают торговлю.
 */
export const FENCE_SHARE = 0.3;

/** Сколько розыска добавляет каждый удачный пиратский рейс. */
export const PIRATE_LEGAL_PER_RUN = 2;

/**
 * Шанс, что добыча отобьётся: 4% на любом маршруте.
 *
 * Почему на любом: жертва вооружена сама, и в анархии полиции нет — если
 * бы риск был только от полиции, анархия стала бы бесплатным станком.
 * Итог трепки — ремонт, корабль и пилот целы.
 */
export const PIRATE_DAMAGE_CHANCE = 0.04;

/** Ремонт после трепки — четверть цены корабля. */
export const PIRATE_REPAIR_SHARE = 0.25;

/**
 * Шанс, что пирата возьмёт полиция — `надзор × 1.5%`.
 *
 * Здесь теряется всё: и корабль, и пилот. Поэтому в демократии пирату
 * делать нечего, а его дом — анархия и феодализм.
 */
export const PIRATE_POLICE_CHANCE = 0.015;

/** Досмотр контрабандиста: `надзор пункта назначения × 2%`. */
export const SMUGGLER_INSPECT_CHANCE = 0.02;

/** Штраф за конфискованную запрещёнку, в десятых кредита: 100 CR. */
export const SMUGGLER_FINE = 1000;

/** Сколько розыска даёт пойманная контрабанда. */
export const SMUGGLER_LEGAL = 2;

/**
 * Нападение на торговца: `(7 − надзор) × 0.5%`.
 *
 * Это ответ на вопрос «зачем полиция торговцу»: в демократии пираты к
 * торговцу не суются, в анархии — 3.5% за рейс.
 */
export const TRADER_RAID_CHANCE = 0.005;

/** Надзор системы — строгость её правительства (0 — анархия, 7 — корпорация). */
export const surveillanceOf = (system: StarSystem): number => system.government;

/** Надзор маршрута: среднее двух концов. */
export function laneSurveillance(systems: readonly StarSystem[], route: PilotRoute): number {
  return (surveillanceOf(systems[route.from]) + surveillanceOf(systems[route.to])) / 2;
}

/**
 * Награда полицейскому за рейс — в десятых кредита.
 *
 * Считается по правительству патрулируемой системы, а не по маршруту:
 * полицейский не торгует, он ловит. В анархии добычи больше всего.
 */
export function policeBounty(government: number): number {
  return POLICE_BOUNTY_BASE + POLICE_BOUNTY_PER_LAWLESS * (7 - government);
}

/** Шансы провала за один рейс — их видно в карточке ДО назначения. */
export interface PilotRisk {
  /** Пират: полиция взяла — корабль и пилот потеряны. */
  police: number;
  /** Пират: добыча отбилась — ремонт. */
  damage: number;
  /** Контрабандист: досмотр — запрещёнка и штраф. */
  inspect: number;
  /** Торговец: пираты отняли груз рейса. */
  raid: number;
  /** Полицейский: погиб в бою. */
  death: number;
  /** Полицейский: потрёпан, нужен ремонт. */
  beaten: number;
}

export function pilotRisk(
  role: PilotRole,
  lane: number,
  destinationSurveillance: number,
): PilotRisk {
  return {
    police: role === 'pirate' ? lane * PIRATE_POLICE_CHANCE : 0,
    damage: role === 'pirate' ? PIRATE_DAMAGE_CHANCE : 0,
    inspect: role === 'smuggler' ? destinationSurveillance * SMUGGLER_INSPECT_CHANCE : 0,
    raid: role === 'trader' ? Math.max(0, 7 - lane) * TRADER_RAID_CHANCE : 0,
    // Полицейский воюет не с торговцами, а с пиратами — и потому рискует
    // ровно там, где их много.
    death: role === 'police' ? Math.max(0, 7 - destinationSurveillance) * POLICE_DEATH_CHANCE : 0,
    beaten: role === 'police' ? POLICE_DAMAGE_CHANCE : 0,
  };
}

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
  /** Роль: торговец, контрабандист или пират (§107). */
  role: PilotRole;
  /** Удачных рейсов — для карточки. */
  runs: number;
  /** Провалов: досмотр, трепка, перехват, ограбление. */
  failures: number;
  /**
   * §128: перелёт на новую планету — откуда и когда прибудет.
   *
   * Пока пилот в пути, он не летает рейсы: `route` сброшен, а `home` уже
   * новая. Поле необязательное — в сохранениях до §128 его нет, и старые
   * фикстуры проверок создают пилотов без него.
   */
  transfer?: { from: number; until: number } | null;
}

/* ---------- §120: ранги пилота ---------- */

/**
 * РАНГ ПИЛОТА — ТА ЖЕ ЛЕСТНИЦА, ЧТО У ИГРОКА, НО СЧИТАЕТСЯ ПО РЕЙСАМ.
 *
 * Пользователь: «ранги пилота — такие же, как у нас (дань игре)». Имена
 * берутся прямо из `RANKS` в `ships.ts` (Безобидный … ЭЛИТА), никакого
 * второго списка тут нет.
 *
 * Пороги пришлось пересчитать, и вот почему. У игрока ключ — убийства, и до
 * ЭЛИТЫ их 6400. Пилот за сутки делает около десяти рейсов, то есть 6400
 * рейсов — это два года реального времени; при таком пороге ранги пилота
 * существовали бы только в теории. Поэтому шаг лестницы — рейсы, а не
 * убийства: 0 / 1 / 2 / 4 / 8 / 16 / 32 / 64 / 128. Форма сохранена
 * (удвоение), смысл тоже: ЭЛИТА — талант, который растёт годами, просто
 * здесь это две недели работы одного пилота с отдыхом 2 часа.
 */
export const PILOT_RANK_RUNS: readonly number[] = [0, 1, 2, 4, 8, 16, 32, 64, 128];

/** Прибавка к выручке рейса за каждый ранг: +4% (ЭЛИТА +32%). */
export const PILOT_RANK_INCOME = 0.04;

/** Снижение риска за каждый ранг: −5% (ЭЛИТА −40%). */
export const PILOT_RANK_RISK = 0.05;

/** Номер ранга по числу удачных рейсов, 0..8. */
export function pilotRank(runs: number): number {
  let rank = 0;
  for (let i = 0; i < PILOT_RANK_RUNS.length; i++) if (runs >= PILOT_RANK_RUNS[i]) rank = i;
  return rank;
}

/** Название ранга пилота — из общей таблицы. */
export function pilotRankName(runs: number): string {
  return RANK_NAMES[pilotRank(runs)] ?? RANK_NAMES[0];
}

/** Множитель выручки по рангу. */
export function pilotSkillIncome(runs: number): number {
  return 1 + PILOT_RANK_INCOME * pilotRank(runs);
}

/** Множитель риска по рангу: опытный пилот теряет реже. */
export function pilotSkillRisk(runs: number): number {
  return Math.max(0, 1 - PILOT_RANK_RISK * pilotRank(runs));
}

/**
 * Риски с поправкой на ранг — то, что видит игрок и по чему считает досчёт.
 *
 * Отдельной функцией, а не внутри `pilotRisk`: `pilotRisk` описывает
 * ЛИНИЮ (надзор, беззаконие), а ранг — ПИЛОТА. Смешав их, мы потеряли бы
 * возможность показать риск маршрута до выбора пилота.
 */
export function pilotRiskRanked(risk: PilotRisk, runs: number): PilotRisk {
  const k = pilotSkillRisk(runs);
  return {
    police: risk.police * k,
    damage: risk.damage * k,
    inspect: risk.inspect * k,
    raid: risk.raid * k,
    death: risk.death * k,
    beaten: risk.beaten * k,
  };
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
  role: PilotRole = 'trader',
): number {
  const from = calmMarket(galaxy, systems, route.from);
  const to = calmMarket(galaxy, systems, route.to);

  const lines: { margin: number; qty: number }[] = [];
  for (let i = 0; i <= TONNE_MAX_INDEX; i++) {
    /*
     * §107: торговец запрещёнку не берёт вообще — решение пользователя.
     * Раньше маршрут считался по всем товарам сразу, и «торговец» тихо
     * возил рабов, стоило им оказаться выгодными. Теперь роль на входе.
     */
    if (role === 'trader' && isContraband(i)) continue;
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

/**
 * Добыча пирата: чужой товар, продаётся скупщику за треть.
 *
 * Пират не покупает груз, а берёт — поэтому его выручка считается не от
 * маржи, а от продажной цены в пункте назначения. Полку он не уважает:
 * обирает корабли, а не магазин.
 */
export function pirateLoot(
  galaxy: number,
  systems: readonly StarSystem[],
  route: PilotRoute,
  hold: number,
): number {
  const to = calmMarket(galaxy, systems, route.to);
  let best = 0;
  for (let i = 0; i <= TONNE_MAX_INDEX; i++) best = Math.max(best, to[i].price);
  return Math.round(hold * best * FENCE_SHARE);
}

/** Расстояние маршрута в световых годах. */
export function routeDistance(systems: readonly StarSystem[], route: PilotRoute): number {
  return distance(systems[route.from], systems[route.to]);
}

/**
 * Сколько пилоту платят за рейс: выручка минус его доля, плюс надбавка
 * за ранг (§120). `runs` — сколько пилот уже отлетал: путь, а не убийства.
 *
 * Считается один раз на маршрут (выручка ровная), поэтому досчёт после
 * долгого отсутствия — это умножение, а не цикл по тысяче рейсов.
 */
export function pilotRunIncome(profit: number, index: number, runs = 0): number {
  return Math.round(profit * (1 - pilotWageShare(index)) * pilotSkillIncome(runs));
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
