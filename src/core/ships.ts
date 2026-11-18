/**
 * Корабли противников и оборудование игрока.
 *
 * Значения энергии, ракет и наград взяты из оригинального исходника
 * Elite (markmoxon/elite-beebasm) через tools/extract-ships.ts.
 *
 * Урон врага = byte#19 >> 1, где byte#19 = (laserPower << 3) | missiles
 * (tactics_part_6_of_7.asm, строки OOPS).
 *
 * Цены оборудования из таблицы PRXS (library/common/main/variable/prxs.asm),
 * даны в десятых долях кредита.
 *
 * Ранги из status.asm — TALLY 16-битный счётчик убийств:
 *   Harmless        0-3
 *   Mostly Harmless 4-15
 *   Poor            16-31
 *   Average         32-63
 *   Above Average   64-127
 *   Competent       128-255  (high byte = 0, low >= 128)
 *   Competent       256-511  (high byte = 1)
 *   Dangerous       512-2559 (high byte 2-9)
 *   Deadly          2560-6399 (high byte 10-24)
 *   Elite           6400+     (high byte >= 25)
 */

export type LaserType = 'none' | 'pulse' | 'beam' | 'military' | 'mining';

export interface EnemyType {
  id: string;
  name: string;
  energy: number;
  /** Урон за одно попадание */
  laser: number;
  missiles: number;
  /** Награда в десятых долях кредита */
  bounty: number;
  /** Минимум убийств игрока, с которого корабль встречается среди пиратов */
  minKills: number;
  /**
   * Может ли встречаться как пират. Примечание: в оригинале Moray помечен как
   * Hostile+pirate (e_per_cent.asm), но из-за бага спавна не появлялся никогда.
   * Мы применяем исправление Моксона, поэтому он доступен.
   */
  pirate: boolean;
  /** Доля энергии, ниже которой противник может бежать */
  fleeBelow: number;
  /**
   * Сколько грузовых контейнеров выпадает из уничтоженного корабля.
   *
   * Младший ниббл байта $00 блюпринта в оригинале. Значения — из
   * `docs/cargo-canisters.md` (BBC-исходник, `elite-ships-*.asm`).
   *
   * У торговцев и пиратов байт разный: гружёный торговец-Питон роняет
   * пять контейнеров, пиратский — два. Поэтому поле задаётся парой.
   */
  canisters: { trader: number; pirate: number };
}

// Значения из tools/extract-ships.ts (оригинальный исходник Elite):
// byte#19 = (laserPower << 3) | missiles
// Урон врага на игрока = byte#19 >> 1
// sidewinder:   byte#19=(2<<3)|0=16  → урон=8
// gecko:        byte#19=(2<<3)|0=16  → урон=8
// adder:        byte#19=(2<<3)|0=16  → урон=8
// cobra_mk_1:   byte#19=(2<<3)|2=18  → урон=9
// mamba:        byte#19=(2<<3)|2=18  → урон=9
// krait:        byte#19=(2<<3)|0=16  → урон=8
// moray:        byte#19=(2<<3)|0=16  → урон=8
// cobra_mk_3_p: byte#19=(2<<3)|2=18  → урон=9  bounty=175
// asp_mk_2:     byte#19=(5<<3)|1=41  → урон=20  bounty=200
// fer_de_lance: byte#19=(2<<3)|2=18  → урон=9  bounty=0 (оригинал!)
// python:       byte#19=(3<<3)|3=27  → урон=13  bounty=200
// anaconda:     byte#19=(7<<3)|7=63  → урон=31  bounty=0 (оригинал!)
// viper:        byte#19=(2<<3)|1=17  → урон=8  bounty=0
export const ENEMIES: readonly EnemyType[] = [
  //              id            name           energy  laser  missiles  bounty  minKills  pirate  fleeBelow
  { id: 'sidewinder',  name: 'Sidewinder',    energy: 70,  laser: 8,  missiles: 0, bounty: 50,  minKills: 0,   pirate: true,  fleeBelow: 0.3, canisters: { trader: 0, pirate: 0 } },
  { id: 'gecko',       name: 'Gecko',         energy: 70,  laser: 8,  missiles: 0, bounty: 55,  minKills: 0,   pirate: true,  fleeBelow: 0.3, canisters: { trader: 0, pirate: 0 } },
  { id: 'adder',       name: 'Adder',         energy: 85,  laser: 8,  missiles: 0, bounty: 40,  minKills: 4,   pirate: true,  fleeBelow: 0.25, canisters: { trader: 0, pirate: 0 } },
  { id: 'cobra1',      name: 'Cobra Mk I',    energy: 90,  laser: 9,  missiles: 2, bounty: 75,  minKills: 4,   pirate: true,  fleeBelow: 0.25, canisters: { trader: 3, pirate: 3 } },
  { id: 'mamba',       name: 'Mamba',         energy: 90,  laser: 9,  missiles: 2, bounty: 150, minKills: 16,  pirate: true,  fleeBelow: 0.2, canisters: { trader: 1, pirate: 1 } },
  { id: 'krait',       name: 'Krait',         energy: 80,  laser: 8,  missiles: 0, bounty: 100, minKills: 16,  pirate: true,  fleeBelow: 0.2, canisters: { trader: 1, pirate: 1 } },
  { id: 'moray',       name: 'Moray',         energy: 100, laser: 8,  missiles: 0, bounty: 50,  minKills: 16,  pirate: true,  fleeBelow: 0.2, canisters: { trader: 1, pirate: 1 } },
  { id: 'cobra3',      name: 'Cobra Mk III',  energy: 150, laser: 9,  missiles: 2, bounty: 175, minKills: 44,  pirate: true,  fleeBelow: 0.15, canisters: { trader: 3, pirate: 1 } },
  { id: 'asp',         name: 'Asp Mk II',     energy: 150, laser: 20, missiles: 1, bounty: 200, minKills: 44,  pirate: true,  fleeBelow: 0.15, canisters: { trader: 0, pirate: 0 } },
  { id: 'ferdelance',  name: 'Fer-de-Lance',  energy: 160, laser: 9,  missiles: 2, bounty: 0,   minKills: 130, pirate: true,  fleeBelow: 0.1, canisters: { trader: 0, pirate: 0 } },
  { id: 'python',      name: 'Python',        energy: 250, laser: 13, missiles: 3, bounty: 200, minKills: 130, pirate: true,  fleeBelow: 0.1, canisters: { trader: 5, pirate: 2 } },
  { id: 'anaconda',    name: 'Anaconda',      energy: 252, laser: 31, missiles: 7, bounty: 0,   minKills: 512, pirate: true,  fleeBelow: 0.1, canisters: { trader: 7, pirate: 7 } },
  { id: 'viper',       name: 'Viper',         energy: 120, laser: 8,  missiles: 1, bounty: 0,   minKills: 0,   pirate: false, fleeBelow: 0, canisters: { trader: 0, pirate: 0 } },
] as const;

export function enemyById(id: string): EnemyType {
  const e = ENEMIES.find((x) => x.id === id);
  if (!e) throw new Error(`Неизвестный корабль: ${id}`);
  return e;
}

/**
 * КУПЛЕННЫЕ КОРАБЛИ (§102).
 *
 * Числа взяты из дизассемблера Elite-A (markmoxon/elite-a-source-code-bbc-micro,
 * `elite-source-docked.asm`, таблица `new_details`): трюм, слоты ракет,
 * прочность и позиция в лестнице цен. Трюм и ракеты в оригинале хранятся
 * с минус единицей — здесь уже приведены.
 *
 * Оговорки:
 *
 *  * `rank` — позиция в таблице `new_ships` (1 — самая дешёвая модель).
 *    Elite-A продаёт первые `15 - 2 * экономика` позиций, поэтому ранг —
 *    это и есть доступность: чем он больше, тем в меньшем числе систем
 *    корабль вообще выставлен на продажу.
 *  * Трюм Кобры — наш, 20/35 т, а не 42 т из Elite-A: 20 т это стартовый
 *    баланс всей игры (§70–§103), и менять его вместе с покупкой кораблей
 *    значило бы переписать всё сразу. У остальных моделей — значения
 *    Elite-A до решения о масштабе.
 *  * `holdExtended` есть только у Кобры: в оригинале «большой трюм» —
 *    upgrade именно Кобры, крупным кораблям он не нужен и не предлагается.
 */
export const HOLD_BASE = 20;
export const HOLD_EXTENDED = 35;

/**
 * Максимум ракет у стартовой Кобры. С §102 предел — свойство модели
 * (`maxMissiles`), а константа осталась для совместимости и тестов.
 */
export const MAX_MISSILES = 4;


export type ShipId = 'adder' | 'cobra3' | 'ferdelance' | 'python' | 'asp' | 'anaconda';

export interface ShipSpec {
  id: ShipId;
  name: string;
  /** Трюм, тонн */
  hold: number;
  /** Трюм с расширением; null — расширение не ставится */
  holdExtended: number | null;
  /** Слоты ракет на корпусе */
  missiles: number;
  /** Прочность корпуса (поле Shields из new_details) */
  shields: number;
  /** Бак, в десятых светового года: 60 = 6.0 ly (поле Hyperspace range) */
  range: number;
  /** Позиция в таблице new_ships, 1 — самый дешёвый */
  rank: number;
  /**
   * Цена из таблицы `new_ships` (вариант `_RELEASED`), в десятых долях
   * кредита: у Кобры 2 870 000 = 287 000.0 Cr.
   */
  elitePrice: number;
}

export const SHIPS: Record<ShipId, ShipSpec> = {
  adder:      { id: 'adder',      name: 'Adder',        hold: 8,         holdExtended: null,          missiles: 1,  shields: 4,  range: 60,  rank: 1,  elitePrice: 310000 },
  cobra3:     { id: 'cobra3',     name: 'Cobra Mk III', hold: HOLD_BASE, holdExtended: HOLD_EXTENDED, missiles: 4,  shields: 7,  range: 70,  rank: 8,  elitePrice: 2870000 },
  ferdelance: { id: 'ferdelance', name: 'Fer-de-Lance', hold: 9,         holdExtended: null,          missiles: 3,  shields: 8,  range: 85,  rank: 9,  elitePrice: 3595000 },
  python:     { id: 'python',     name: 'Python',       hold: 106,       holdExtended: null,          missiles: 4,  shields: 11, range: 80,  rank: 12, elitePrice: 7620000 },
  asp:        { id: 'asp',        name: 'Asp Mk II',    hold: 6,         holdExtended: null,          missiles: 1,  shields: 10, range: 125, rank: 14, elitePrice: 10120000 },
  anaconda:   { id: 'anaconda',   name: 'Anaconda',     hold: 253,       holdExtended: null,          missiles: 16, shields: 13, range: 100, rank: 15, elitePrice: 18695000 },
};

/**
 * ВО СКОЛЬКО РАЗ НАШИ ЦЕНЫ МЕНЬШЕ ЦЕН ELITE-A (§102.4).
 *
 * В оригинале корабль купить было нельзя, поэтому канонической цены не
 * существует: таблицу в Elite-A Дагган придумал как сток денег для игроков
 * с миллионами на счету. Проверка на нашей экономике: Кобра за 287 000 CR
 * — это 512 рейсов по 560 CR, Анаконда — 3300 рейсов, то есть 139 часов
 * торговли. Мы сжали время полёта примерно в 30 раз, значит и цены должны
 * сжаться так же.
 *
 * Отсюда делитель 31. Он не «на глаз»: экономика игры измерена, и на этом
 * масштабе карьера от Аддера до Анаконды занимает ~150 рейсов, а Питон
 * стоит 24 600 — ровно «25 000, наторгованных за три дня» пользователя.
 *
 * ВАЖНО: это одна ручка на всю верфь. Когда появятся флот и планеты,
 * цена кораблей должна оставить им место сверху — и менять её надо здесь,
 * а не в пяти местах.
 */
export const SHIP_PRICE_DIVISOR = 31;

/**
 * Цена корабля в наших деньгах (десятые доли кредита).
 *
 * Округляем до целого кредита: «9 258.1 CR» на витрине читается как
 * бухгалтерская выписка, а не как цена.
 */
export const shipPrice = (id: ShipId): number =>
  Math.round(SHIPS[id].elitePrice / SHIP_PRICE_DIVISOR / 10) * 10;

/**
 * Сколько моделей продаётся в системе — формула Elite-A: `15 - 2 * экономика`.
 *
 * В коде оригинала (`n_buyship`): `SEC : LDA #15 : SBC QQ28 : SBC QQ28`.
 * Таблица `new_ships` отсортирована по цене, и продаются первые QQ25
 * записей — то есть дело не в «какой корабль в какой системе», а в длине
 * списка. В бедной аграрной системе (экономика 7) остаётся одна модель,
 * как и в Elite-A оставался один Adder.
 */
export const shipsForSaleCount = (economy: number): number =>
  Math.max(1, 15 - 2 * Math.max(0, Math.min(7, Math.round(economy))));

/** Какие корабли этой экономики выставлены на продажу. */
export const shipsForSale = (economy: number): ShipId[] => {
  const count = shipsForSaleCount(economy);
  return (Object.keys(SHIPS) as ShipId[])
    .filter((id) => SHIPS[id].rank <= count)
    .sort((a, b) => SHIPS[a].rank - SHIPS[b].rank);
};

/** Характеристики корабля игрока. */
export const shipSpec = (ship: PlayerShip): ShipSpec => SHIPS[ship.model];

/** Сколько ракет влезает в ЭТОТ корабль (§102: у Аспа один слот). */
export const maxMissiles = (ship: PlayerShip): number => shipSpec(ship).missiles;

/**
 * Бак ЭТОГО корабля, в десятых св. года (§102.3).
 *
 * До этого топливо было общей константой MAX_FUEL = 70. В Elite-A бак —
 * свойство модели: Аддер 6.0 ly (самый короткий прыжок в игре), Асп 12.5 ly
 * (самый длинный). Без этого стартовый Аддер обещал бы 6 св. лет, а летал
 * на семи, как Кобра.
 */
export const maxFuel = (ship: PlayerShip): number => shipSpec(ship).range;

/** Сколько ракет нужно для патруля: полный боекомплект корабля (§102). */
export const patrolMissilesRequired = (ship: PlayerShip): number => maxMissiles(ship);

export interface PlayerShip {
  /** Модель корабля. До §102 все летали на Кобре, и поля не было. */
  model: ShipId;
  laser: LaserType;
  missiles: number;
  ecm: boolean;
  energyBomb: boolean;
  energyUnit: boolean;
  fuelScoops: boolean;
  dockingComputer: boolean;
  galacticHyperdrive: boolean;
  cargoBayExtended: boolean;
}

/** Cobra Mk III с завода: один импульсный лазер и три ракеты. */
/*
 * СТАРТОВЫЙ КОРАБЛЬ (§102.3).
 *
 * В Elite 1984 выдавали Кобру с импульсным лазером и тремя ракетами.
 * В Elite-A — голый Аддер: `cmdr_type = 0`, `LASER = 0`, `NOMSL = 0`.
 * Проверено по `elite-loader.asm`, блок default commander.
 *
 * Мы берём вариант Elite-A: он и делает лестницу кораблей осмысленной.
 * Кобра перестаёт быть данностью и становится первой покупкой, а покупка
 * лазера — первым действием в игре.
 */
export const STARTER_SHIP: Readonly<PlayerShip> = {
  model: 'adder',
  laser: 'none',
  missiles: 0,
  ecm: false,
  energyBomb: false,
  energyUnit: false,
  fuelScoops: false,
  dockingComputer: false,
  galacticHyperdrive: false,
  cargoBayExtended: false,
};

/**
 * Вместимость трюма ЭТОГО корабля (§102).
 *
 * До §102 трюм зависел только от «расширен» ли он. Теперь — от модели:
 * у Питона 106 т, у Аспа 6 т, и расширение бывает только у Кобры.
 */
/**
 * Корабль из сохранений до §102.3.
 *
 * Тогда все летали на Кобре с импульсным лазером и тремя ракетами, и в файле
 * модели не было. Подставлять такому игроку Аддера нельзя: он потерял бы
 * корабль, которого не продавал.
 */
export const LEGACY_COBRA_SHIP: Readonly<PlayerShip> = {
  ...STARTER_SHIP,
  model: 'cobra3',
  laser: 'pulse',
  missiles: 3,
};

export const holdCapacity = (ship: PlayerShip): number => {
  const spec = SHIPS[ship.model];
  return ship.cargoBayExtended && spec.holdExtended !== null ? spec.holdExtended : spec.hold;
};

export type EquipmentId =
  | 'missile'
  | 'cargoBay'
  | 'ecm'
  | 'pulse'
  | 'beam'
  | 'scoops'
  | 'bomb'
  | 'energyUnit'
  | 'dockingComputer'
  | 'galacticHyperdrive'
  | 'military'
  | 'mining';

export interface EquipmentItem {
  id: EquipmentId;
  name: string;
  /** Цена в десятых долях кредита */
  price: number;
  /**
   * Номер предмета в списке верфи по EQSHP (XX13), где 1 — топливо.
   * Доступность определяется так же, как в оригинале:
   *   screenNumber <= min(tek + 3, QQ25_MAX)
   * где tek — технологический уровень системы (0..14).
   */
  screenNumber: number;
}

/** Максимум QQ25 в оригинале для версии с диска/улучшенных версий (14 предметов). */
export const QQ25_MAX = 14;
/** Смещение из EQSHP: QQ25 = tek + 3, но не больше QQ25_MAX. */
export const EQSHP_TECH_OFFSET = 3;

/**
 * Сколько последний предмет на верфи доступен в системе с данным техуровнем.
 * Точно по EQSHP: QQ25 = min(tek + 3, 14) для disc/enhanced версий.
 * (В кассетной версии было 12 — отсюда отсутствие военного и добывающего лазеров.)
 */
export function maxEquipmentNumber(tek: number): number {
  return Math.min(tek + EQSHP_TECH_OFFSET, QQ25_MAX);
}

/**
 * Доступен ли предмет на верфи системы с техуровнем tek (0..14).
 * В оригинале это просто проверка «номер предмета не больше QQ25».
 */
export function equipmentAvailable(item: EquipmentItem, tek: number): boolean {
  return item.screenNumber <= maxEquipmentNumber(tek);
}

// Номера соответствуют XX13 в EQSHP: 1 = FUEL (топливо продаётся всегда и
// отдельно), 2 = ракета … 13 = военный лазер, 14 = добывающий лазер.
export const EQUIPMENT: readonly EquipmentItem[] = [
  { id: 'missile', name: 'Ракета', price: 300, screenNumber: 2 },
  { id: 'cargoBay', name: 'Увеличенный трюм (35 т)', price: 4000, screenNumber: 3 },
  { id: 'ecm', name: 'ECM (РЭБ)', price: 6000, screenNumber: 4 },
  { id: 'pulse', name: 'Импульсный лазер', price: 4000, screenNumber: 5 },
  { id: 'beam', name: 'Лучевой лазер', price: 10000, screenNumber: 6 },
  { id: 'scoops', name: 'Топливосборщик', price: 5250, screenNumber: 7 },
  /*
   * №8 в оригинале — спасательная капсула. В §77 убрана из игры: смертей
   * нет, спасать нечего. Номер пропущен осознанно: `screenNumber` это
   * координата в таблице верфи оригинала, и сдвигать её нельзя — иначе
   * поехала бы доступность остальных предметов по техуровню.
   */
  { id: 'bomb', name: 'Энергобомба', price: 9000, screenNumber: 9 },
  { id: 'energyUnit', name: 'Доп. энергоблок', price: 15000, screenNumber: 10 },
  { id: 'dockingComputer', name: 'Стыковочный компьютер', price: 10000, screenNumber: 11 },
  { id: 'galacticHyperdrive', name: 'Галактический гипердвигатель', price: 50000, screenNumber: 12 },
  { id: 'military', name: 'Военный лазер', price: 60000, screenNumber: 13 },
  { id: 'mining', name: 'Добывающий лазер', price: 8000, screenNumber: 14 },
] as const;

export const LASER_NAMES: Record<LaserType, string> = {
  none: 'нет',
  pulse: 'импульсный',
  beam: 'лучевой',
  military: 'военный',
  mining: 'добывающий',
};

/**
 * Ранги по числу убийств (точно по status.asm оригинала).
 *
 * TALLY — 16-битный счётчик. Алгоритм:
 * - Если TALLY[высокий байт] == 0: смотрим TALLY[низкий] >> 2 и считаем
 *   позицию старшего бита (0→Harmless, 1→Mostly Harmless, 2→Poor,
 *   3→Average, 4→Above Average, 5+→Competent)
 *   Пороги: 0-3, 4-15, 16-31, 32-63, 64-127, 128-255
 * - Если TALLY[высокий байт] == 1: Competent  (256-511)
 * - Если 2-9:  Dangerous (512-2559)
 * - Если 10-24: Deadly   (2560-6399)
 * - Если >=25:  Elite    (6400+)
 */
const RANKS: readonly [number, string][] = [
  [0,    'Безобидный'],          // Harmless        0-3
  [4,    'Почти безобидный'],    // Mostly Harmless 4-15
  [16,   'Слабый'],              // Poor            16-31
  [32,   'Средний'],             // Average         32-63
  [64,   'Выше среднего'],       // Above Average   64-127
  [128,  'Опытный'],             // Competent       128-511
  [512,  'Опасный'],             // Dangerous       512-2559
  [2560, 'Смертельный'],         // Deadly          2560-6399
  [6400, 'ЭЛИТА'],               // Elite           6400+
];

export function rankOf(kills: number): string {
  let name = RANKS[0][1];
  for (const [min, label] of RANKS) if (kills >= min) name = label;
  return name;
}

/** Правовой статус по числовому значению. */
export function legalLabel(legal: number): string {
  if (legal >= 50) return 'Беглец';
  if (legal >= 1) return 'Нарушитель';
  return 'Чист';
}

