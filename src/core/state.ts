/**
 * Состояние игры и действия капитана. Все функции чистые: принимают состояние
 * и возвращают новое, ничего не изменяя. Это упрощает тесты и досчёт времени.
 *
 * Единицы как в оригинале: деньги в десятых долях кредита, топливо в десятых
 * долях светового года.
 */

import { autoCombat, canDo, combatRound, startCombat, type CombatAction, type CombatState } from './combat.ts';
import { autoScoop, canisterCount, countContraband, isContraband, rollCanisters, scoopAll, scoopOne, type CargoCanister } from './cargo-canisters.ts';
import { noteCargo, reconcile, type CargoManifest } from './cargo-origin.ts';
import { buildGalaxy, distance, GALACTIC_ARRIVAL, GALAXY_COUNT, nearestSystem, type StarSystem } from './galaxy.ts';
import {
  COMMODITIES,
  generateMarket,
  INDIVIDUAL_ITEM_LIMIT,
  isTonneCargo,
  type MarketEntry,
} from './market.ts';
import { nextByte, nextFloat } from './rng.ts';
import {
  autoResolve,
  availableDecisions,
  bestLaserOf,
  canBeat,
  toughnessOf,
  enemyOf,
  isCriminal,
  isLegalTarget,
  needsMissile,
} from './one-decision.ts';
import { loneHunter, pirateFromGroup } from './spawn.ts';
import {
  ENEMIES,
  enemyById,
  EQUIPMENT,
  equipmentAvailable,
  holdCapacity,
  HOLD_BASE,
  maxMissiles,
  patrolMissilesRequired,
  STARTER_SHIP,
  type EquipmentId,
  type PlayerShip,
} from './ships.ts';

export { nextByte } from './rng.ts';

export const SAVE_VERSION = 3;
export const MAX_FUEL = 70;
/** Цена топлива: 0.2 CR за световой год, т. е. 2 десятых кредита за десятую св. года */
export const FUEL_COST_PER_UNIT = 2;
export const START_SYSTEM_LAVE = 7;
export const START_CASH = 1000;
export const START_HOLD = HOLD_BASE;
/** Прибавка к правовому статусу за убийство полицейского */
export const POLICE_KILL_LEGAL = 64;

/**
 * Прибавка за ограбление торговца (§79).
 *
 * Чуть меньше, чем за полицейского: торговец не защищает закон, но
 * нападение на мирного всё равно преступление. 32 — половина от
 * «убил полицейского», и порога «беглец» (50) достигается за два грабежа.
 */
export const RAID_LEGAL = 32;

/**
 * Побег от последствий (§84): чем тяжелее статус, тем дороже побег.
 *
 * Пользователь: «нарушитель — 6 планет, беглец — 12». Это и есть три
 * ступени, о которых шла речь ещё в §80: ступень выбирается по тяжести
 * статуса, а не по числу планет.
 *
 *   Нарушитель (1..49)  → 6 планет
 *   Беглец    (50..255) → 12 планет
 *
 * Статус гасится ДОЛЕЙ от снимка, а не по единице: от 255 вычитанием за
 * двенадцать планет не избавиться никогда.
 */
export const ESCAPE_PLANETS_OFFENDER = 6;
export const ESCAPE_PLANETS_FUGITIVE = 12;

/** Сколько планет нужно этому статусу, чтобы обнулиться. */
export function escapePlanetsFor(legal: number): number {
  return legal >= 50 ? ESCAPE_PLANETS_FUGITIVE : ESCAPE_PLANETS_OFFENDER;
}

/** Обратная совместимость: самый строгий порог. */
export const ESCAPE_PLANETS = ESCAPE_PLANETS_FUGITIVE;

/**
 * Ближайшая планета тоже считается? Нет.
 *
 * Побег начинается С ПЕРВОГО прыжка: если на старте маршрута статус уже
 * криминальный, то первый прыжок и открывает маршрут — он же и первый шаг.
 * Отдельного «порога входа» нет, и это важно: иначе преступник мог бы
 * бесконечно прыгать, не начиная побег.
 */
/**
 * Доля денег, остающаяся после проигранного боя.
 *
 * §77: смерти больше нет, поэтому константа перестала быть «страховкой»:
 * это просто цена неудачи. Имя оставлено, чтобы не плодить переименования
 * по всей кодовой базе, но смысл теперь единственный.
 */
export const INSURANCE_CASH_KEPT = 0.75;

export interface Settings {
  /** Множитель скорости времени: 1 = базовый, 2 = вдвое быстрее и т. д. */
  speed: number;
  /** Базовая длительность одного прыжка в миллисекундах при speed = 1 */
  baseJumpMs: number;
  /** Автоматический бой или с вмешательством игрока */
  combatMode: 'auto' | 'manual';
  /** Через сколько миллисекунд ненападающий корабль исчезает из радиуса */
  encounterTimeoutMs: number;
  /** Множитель частоты встреч: 0 отключает встречи */
  encounterRate: number;
  /**
   * Модуль стыковки включён.
   *
   * Когда включён — прыжок доступен только из мини-игры стыковки
   * (космос у нас есть только там), а на карте вместо «Прыжок»
   * показывается «Отстыковка». Когда выключен — прыжок на карте,
   * как в простом варианте.
   */
  dockingModule: boolean;
  /**
   * Забирать контейнеры после боя автоматически.
   *
   * Если выключено — после победы появляется список обломков и игрок сам
   * решает, что взять (и что выбросить, если места нет). Если включено —
   * берётся всё, что влезает, без вопросов, как в оригинале, где выбора
   * не было вовсе.
   */
  autoScoop: boolean;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  speed: 1,
  /**
   * Базовое время полёта в миллисекундах при ×1 для пути в MAX_FUEL (70 св. лет).
   *
   * 2000 секунд: на ×200 это 10 секунд — столько занимает полный бак.
   * На ×1 — 33 минуты. Референс пересчитан вместе с выбором пользователя:
   * сначала ориентировались на 5 секунд (§76), теперь на 10 (решение §77).
   */
  baseJumpMs: 2000 * 1000,
  combatMode: 'auto',
  /**
   * Сколько мирный корабль висит в радиусе, прежде чем исчезнуть.
   *
   * 60 секунд, а не 5 минут (§76): встречи не могут идти внахлёст, поэтому
   * долгий таймаут «запирает» полёт — новая встреча ждёт, пока уйдёт
   * предыдущая, и плотность падает втрое. Минуты хватает, чтобы заметить
   * корабль и решить, что делать.
   */
  encounterTimeoutMs: 60 * 1000,
  encounterRate: 1,
  /*
   * §81: мини-игра стыковки ОТКЛЮЧЕНА по умолчанию.
   *
   * Пользователь сказал: «начнём с простого, мини-игра стыковка
   * отключена». Космос теперь начинается кнопками в блоке «Пункт
   * назначения» — «Перелёт» и «Патрулировать», а не через мини-игру.
   *
   * Модуль остаётся: он рабочий, и включить его можно в настройках.
   * Выключать его совсем — значит выбрасывать готовую работу, а игрок
   * может захотеть ручную стыковку (она в списке желаний).
   */
  dockingModule: false,
  autoScoop: false,
};

export interface Flight {
  from: number;
  to: number;
  departAt: number;
  /**
   * Момент прибытия, рассчитанный по текущему темпу игры.
   *
   * Поле производное: истина хранится в `remainingBaseMs`, а `arriveAt`
   * пересчитывается при каждой смене темпа. Это позволяет менять скорость
   * на ходу — иначе прыжок, начатый при ×1, не ускорялся бы никогда.
   */
  arriveAt: number;
  fuelUsed: number;
  /**
   * Сколько «базовых» миллисекунд полёта осталось (при speed = 1).
   * Именно это значение живёт в сохранении; `arriveAt` из неё выводится.
   */
  remainingBaseMs: number;
  /**
   * Сколько «базовых» миллисекунд полёта уже пройдено (при speed = 1).
   * Вместе с `remainingBaseMs` даёт полную длительность в базовых единицах.
   */
  elapsedBaseMs: number;
  /** Момент, для которого посчитан `arriveAt` (чтобы не пересчитывать без нужды) */
  dueAt: number;
  /**
   * Сколько встреч уже случилось в этом полёте.
   *
   * Раньше встречи были СПИСКОМ моментов, раскатанным заранее на всё время
   * пути. Это плохо работало с темпом: список не пополнялся, поэтому
   * медленный полёт не давал больше встреч, а быстрый — меньше. С §76
   * встречи рождаются в процессе по РЕАЛЬНОМУ времени: чем дольше летишь,
   * тем больше встретишь. Счётчик нужен для пола (минимальное число встреч
   * за перелёт) и для показа прогресса.
   */
  encounters: number;
  /** Когда случилась последняя встреча (реальное время), — точка отсчёта. */
  lastEncounterAt: number;
  /**
   * Патруль (§78): полёт внутри системы, а не прыжок между ними.
   *
   * Чем отличается:
   * - топливо тратится НЕ авансом за путь, а по мере событий: 1 за встречу
   *   и ещё 1 за бой;
   * - время не кончается само — идёт, пока цел бак;
   * - `to` равен `from`: система не меняется, прыжка нет;
   * - темп ×N НЕ действует: патруль живёт по реальному времени.
   */
  patrol?: boolean;
  /** Сколько топлива ушло на патруль (для итогов в журнале). */
  patrolFuelUsed?: number;
}

export type EncounterRole = 'pirate' | 'police' | 'hunter' | 'trader';

export const ROLE_NAMES: Record<EncounterRole, string> = {
  pirate: 'Пират',
  police: 'Полиция',
  hunter: 'Охотник за головами',
  trader: 'Торговец',
};

/** Корабль в радиусе действия, пока ничего не предпринявший. */
export interface Encounter {
  role: EncounterRole;
  enemyId: string;
  detectedAt: number;
  /** Момент, когда корабль нападёт или исчезнет */
  resolveAt: number;
  outcome: 'attack' | 'leave';
}

export interface ActiveCombat {
  combat: CombatState;
  role: EncounterRole;
  /**
   * Когда полёт был поставлен на паузу. Именно этот момент (а не время хода
   * игрока) сдвигает прибытие: если игрок закрыл вкладку на три часа, полёт
   * не должен сдвигаться на три часа.
   */
  pausedAt: number;
  /** Сколько миллисекунд полёт уже простоял на паузе из-за ожидания игрока */
  pausedMs: number;
}

/**
 * Подбор груза из обломков после победы.
 *
 * Пока это поле не пусто, полёт стоит на паузе — ровно как во время боя.
 * Игрок либо забирает контейнеры по одному, либо закрывает подбор, и
 * игра продолжает путь. Автоподбор в настройках снимает вопрос вовсе.
 */
export interface Salvage {
  /** Что осталось в обломках после победы */
  canisters: CargoCanister[];
  /** Какие контейнеры уже взяты (для показа «взято») */
  taken: number;
  /** Сколько контейнеров пришлось бросить из-за нехватки места */
  left: number;
  /** Когда обломки появились — для сроков паузы, как у боя */
  pausedAt: number;
  pausedMs: number;
  /** Название уничтоженного корабля — в заголовке подбора */
  enemyName: string;
}

export interface GameState {
  version: number;
  galaxy: number;
  /** Индекс текущей системы (при полёте: система вылета) */
  system: number;
  cash: number;
  fuel: number;
  /** Свободное место в трюме, тонны */
  holdSpace: number;
  /** Содержимое трюма по товарам (в единицах товара) */
  cargo: number[];
  /**
   * §98: откуда в трюме запрещённый товар.
   *
   * Справка о происхождении, а не второй источник правды: количество
   * по-прежнему живёт в `cargo`. Нужна журналу, чтобы называть товар и путь,
   * а не только «статус вырос».
   */
  cargoOrigin: CargoManifest;
  market: MarketEntry[];
  /** Состояние генератора случайных чисел (32 бита) */
  rng: number;
  flight: Flight | null;
  ship: PlayerShip;
  kills: number;
  /** 0 = чист, 1..49 = нарушитель, 50+ = беглец */
  legal: number;
  encounter: Encounter | null;
  combat: ActiveCombat | null;
  /** Обломки после победы, ждущие решения игрока. */
  salvage: Salvage | null;
  /** Статистика за игру — для журнала. */
  stats: GameStats;
  /**
   * Средняя цена покупки по каждому товару — чтобы посчитать, удачной
   * ли была сделка. В оригинале такого учёта нет; без него «удачная
   * сделка» не определить, ведь продажа не знает, за сколько куплено.
   *
   * Хранится в десятых кредита, как и все цены. 0 = товара не покупали.
   */
  cargoBasis: number[];
  /**
   * §89: время карьеры — сколько миллисекунд игрок реально провёл в игре.
   *
   * Начисляет его UI (`tickCareer` в `main.ts`), а не `advance`. Причина
   * принципиальная: `advance` — чистая функция досчёта, и инвариант
   * «досчёт одинаков, разбит он на много вызовов или сделан одним»
   * ломается, если внутри считать ещё и настенное время. Карьера — не
   * правило мира, а счётчик присутствия, её место в слое, который знает
   * про `Date.now()`.
   *
   * Необязательное: в сохранениях до §89 поля нет, тогда считается с нуля.
   */
  careerMs?: number;
  /**
   * Момент последнего начисления `careerMs` — чтобы считать разницу.
   * `0` = точки отсчёта нет: следующий тик только выставит её, не начислив
   * время, пока вкладка была закрыта.
   */
  careerAt?: number;

  /*
   * §80: ПОБЕГ ОТ СТАТУСА.
   *
   * Накопление, а не «подряд»: каждая НОВАЯ планета гасит единицу статуса.
   * Вернулся на уже посещённую — маршрут откатывается к началу, статус
   * возвращается к тому, что был на старте побега.
   *
   * `escapeStatus` — статус на момент старта маршрута. Это и есть точка
   * отката: возвращаться «на +1 за прыжок» не нужно, достаточно вернуть
   * снимок. Так не надо хранить историю — только начало.
   */
  escapeRoute: number[];
  escapeStatus: number;
}

/**
 * Статистика командира.
 *
 * Считается накопительно и переживает сохранение. Сделка «удачная»,
 * если продано дороже, чем куплено; в оригинале такого понятия нет,
 * это наше дополнение — иначе журнал не о чем рассказывать.
 */
export interface GameStats {
  /** Сколько кораблей уничтожено (совпадает с рангом, но отдельно). */
  kills: number;
  /** Сколько раз бежали на капсуле. */
  fled: number;
  /** Сколько встреч просто пропущено. */
  skipped: number;
  /** Удачные сделки: продано дороже покупки. */
  goodTrades: number;
  /** Неудачные: продано дешевле или в убыток. */
  badTrades: number;
  /** Суммарная прибыль от торговли (может быть отрицательной). */
  tradeProfit: number;
  /** Прыжков совершено. */
  jumps: number;
  /** Стыковок выполнено. */
  dockings: number;
  /** Провалов стыковки. */
  dockingFails: number;
  /** Удачных грабежей торговцев (§79). */
  raided: number;
  /** Патрулей проведено (§78). */
  patrols: number;
}

export const ZERO_STATS: GameStats = {
  kills: 0,
  fled: 0,
  skipped: 0,
  goodTrades: 0,
  badTrades: 0,
  tradeProfit: 0,
  jumps: 0,
  dockings: 0,
  dockingFails: 0,
  patrols: 0,
  raided: 0,
};

export type GameEventType =
  | 'arrived'
  | 'detected'
  | 'vanished'
  | 'combat-start'
  | 'combat-end'
  | 'canister'
  | 'contraband'
  /**
   * Корабль повреждён и отбуксирован на станцию. §77: заменил 'death' —
   * смерти в игре больше нет, есть только неудача.
   */
  | 'damaged'
  | 'won'
  | 'skipped'
  | 'fled'
  | 'auto-victory'
  | 'auto-skip'
  /** §78: патруль окончен — топливо на возврат. */
  | 'patrol-end'
  /** §79: ограблен торговец. */
  | 'raided'
  /** §80: прыжок в рамках побега от статуса (новая планета). */
  | 'escape-step'
  /** §80: побег провален — вернулся на посещённую планету. */
  | 'escape-reset'
  /** §80: побег удался — статус чист. */
  | 'escape-clean'
  /** §98.1: посадка с контрабандой — доля статуса не применяется. */
  | 'escape-blocked';

export interface GameEvent {
  type: GameEventType;
  at: number;
  text: string;
  /** Для 'arrived' */
  system?: number;
  name?: string;
  /** Для 'combat-start': требуется решение игрока */
  manual?: boolean;
}

const galaxyCache = new Map<number, StarSystem[]>();

/** Системы галактики с кэшем: их построение детерминировано. */
export function systemsOf(galaxy: number): StarSystem[] {
  let systems = galaxyCache.get(galaxy);
  if (!systems) {
    systems = buildGalaxy(galaxy);
    galaxyCache.set(galaxy, systems);
  }
  return systems;
}

/** Новая игра: как в оригинале, старт в Lave, рынок с колебанием 0. */
export function newGame(rngSeed: number): GameState {
  const lave = systemsOf(1)[START_SYSTEM_LAVE];
  return {
    version: SAVE_VERSION,
    galaxy: 1,
    system: START_SYSTEM_LAVE,
    cash: START_CASH,
    fuel: MAX_FUEL,
    holdSpace: START_HOLD,
    cargo: COMMODITIES.map(() => 0),
    cargoOrigin: [],
    market: generateMarket(lave, 0),
    rng: rngSeed >>> 0,
    flight: null,
    ship: { ...STARTER_SHIP },
    kills: 0,
    legal: 0,
    encounter: null,
    combat: null,
    salvage: null,
    stats: { ...ZERO_STATS },
    cargoBasis: COMMODITIES.map(() => 0),
    escapeRoute: [],
    escapeStatus: -1,
    // §89: время карьеры. `careerAt: 0` — «точки отсчёта ещё нет»:
    // первый `advance` только выставит её, не начислив разницу.
    careerMs: 0,
    careerAt: 0,
  };
}

export function currentSystem(state: GameState): StarSystem {
  return systemsOf(state.galaxy)[state.system];
}

/**
 * Русское склонение по числу: 1 контейнер, 2 контейнера, 5 контейнеров.
 * Вынесено отдельно, потому что журнал печатает числа постоянно, а
 * «5 контейнер» в тексте выглядит как ошибка.
 */
export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs >= 11 && abs <= 19) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

export function cargoTons(state: GameState): number {
  return cargoTonsOf(state.cargo);
}

/**
 * §98: записать в манифест подбор из обломков.
 *
 * `autoScoop` и `scoopAll` возвращают только трюм, а не то, какие именно
 * контейнеры взяты. Но запрещёнку автоподбор не трогает вовсе (§93), так
 * что для автоподбора подойдёт любой контейнер: noteCargo сам отбросит
 * чистый товар. Для ручного «Взять всё» правило то же.
 */
function noteFromCanisters(manifest: CargoManifest, canisters: readonly CargoCanister[]): CargoManifest {
  let next = manifest;
  for (const c of canisters) next = noteCargo(next, c.commodity, c.amount, 'salvage');
  return next;
}

export interface TradeResult {
  state: GameState;
  /** Сколько единиц реально куплено или продано */
  amount: number;
}

/**
 * Сколько ещё единиц товара влезет в трюм — аналог `tnpr`.
 *
 * В оригинале две ветки:
 *   * индексы 0–12  — по свободному тоннажу (CRGO = 22 или 37);
 *   * индексы 13–16 — по 200 штук каждого вида, тоннаж не учитывается
 *     (`CMP #200` в `tnpr`).
 *
 * Единица измерения тут не помощник: «Предметы пришельцев» печатаются
 * в тоннах, но лимит у них всё равно 200, как в ветке `kg`.
 */
export function cargoRoom(state: GameState, index: number): number {
  if (isTonneCargo(index)) return Math.max(0, state.holdSpace);
  return Math.max(0, INDIVIDUAL_ITEM_LIMIT - state.cargo[index]);
}

/** Сколько тонн занимает груз: только индексы 0–12, как в `tnpr`. */
const cargoTonsOf = (cargo: readonly number[]): number =>
  cargo.reduce((sum, n, i) => sum + (isTonneCargo(i) ? n : 0), 0);

/** Покупка: не больше, чем есть на рынке, влезает в трюм и хватает денег. */
export function buy(state: GameState, index: number, amount: number): TradeResult {
  if (state.flight || amount <= 0) return { state, amount: 0 };
  const entry = state.market[index];
  let t = Math.min(entry.quantity, Math.floor(amount), cargoRoom(state, index));
  if (entry.price > 0) t = Math.min(t, Math.floor(state.cash / entry.price));
  if (t <= 0) return { state, amount: 0 };

  const cargo = state.cargo.slice();
  cargo[index] += t;
  const market = state.market.slice();
  market[index] = { price: entry.price, quantity: entry.quantity - t };
  return {
    amount: t,
    state: {
      ...state,
      cargo,
      // §98: запоминаем путь — «куплено на рынке».
      cargoOrigin: noteCargo(state.cargoOrigin, index, t, 'bought'),
      market,
      cash: state.cash - t * entry.price,
      holdSpace: isTonneCargo(index) ? state.holdSpace - t : state.holdSpace,
    },
  };
}

/** Продажа: не больше, чем в трюме. */
export function sell(state: GameState, index: number, amount: number): TradeResult {
  if (state.flight || amount <= 0) return { state, amount: 0 };
  const t = Math.min(state.cargo[index], Math.floor(amount));
  if (t <= 0) return { state, amount: 0 };

  const entry = state.market[index];
  const cargo = state.cargo.slice();
  cargo[index] -= t;
  const market = state.market.slice();
  market[index] = { price: entry.price, quantity: entry.quantity + t };
  return {
    amount: t,
    state: {
      ...state,
      cargo,
      // §98: проданного в трюме больше нет — манифест догоняет.
      cargoOrigin: reconcile(state.cargoOrigin, cargo),
      market,
      cash: state.cash + t * entry.price,
      holdSpace: isTonneCargo(index) ? state.holdSpace + t : state.holdSpace,
    },
  };
}

/** Заправка (в десятых долях св. года): не больше, чем влезает и чем хватает денег. */
export function refuel(state: GameState, amount: number): TradeResult {
  if (state.flight || amount <= 0) return { state, amount: 0 };
  const t = Math.min(MAX_FUEL - state.fuel, Math.floor(amount), Math.floor(state.cash / FUEL_COST_PER_UNIT));
  if (t <= 0) return { state, amount: 0 };
  return {
    amount: t,
    state: { ...state, fuel: state.fuel + t, cash: state.cash - t * FUEL_COST_PER_UNIT },
  };
}

/* ---------- Оборудование ---------- */

export type EquipmentError = 'in-flight' | 'tech' | 'cash' | 'owned' | 'full';

export interface EquipmentResult {
  state: GameState;
  error?: EquipmentError;
}

/** Уже есть ли такое оборудование (для ракет: полный ли боекомплект). */
export function owns(ship: PlayerShip, id: EquipmentId): boolean {
  switch (id) {
    case 'missile':
      // §102: предел ракет — свойство корабля (у Аспа один слот).
      return ship.missiles >= maxMissiles(ship);
    case 'cargoBay':
      return ship.cargoBayExtended;
    case 'ecm':
      return ship.ecm;
    case 'pulse':
    case 'beam':
    case 'military':
    case 'mining':
      return ship.laser === id;
    case 'scoops':
      return ship.fuelScoops;
    case 'bomb':
      return ship.energyBomb;
    case 'energyUnit':
      return ship.energyUnit;
    case 'dockingComputer':
      return ship.dockingComputer;
    case 'galacticHyperdrive':
      return ship.galacticHyperdrive;
  }
}

/** Покупка оборудования на станции. Нужен достаточный технологический уровень системы. */
export function buyEquipment(state: GameState, id: EquipmentId): EquipmentResult {
  if (state.flight) return { state, error: 'in-flight' };
  const item = EQUIPMENT.find((e) => e.id === id)!;
  // Доступность по EQSHP: предмет виден на верфи, если его номер ≤ min(tek + 3, 14)
  if (!equipmentAvailable(item, currentSystem(state).techLevel)) return { state, error: 'tech' };
  if (owns(state.ship, id)) return { state, error: id === 'missile' ? 'full' : 'owned' };
  if (state.cash < item.price) return { state, error: 'cash' };

  const ship: PlayerShip = { ...state.ship };
  let holdSpace = state.holdSpace;
  switch (id) {
    case 'missile':
      ship.missiles += 1;
      break;
    case 'cargoBay':
      ship.cargoBayExtended = true;
      holdSpace += holdCapacity(ship) - holdCapacity(state.ship);
      break;
    case 'ecm':
      ship.ecm = true;
      break;
    case 'pulse':
    case 'beam':
    case 'military':
    case 'mining':
      ship.laser = id;
      break;
    case 'scoops':
      ship.fuelScoops = true;
      break;
    case 'bomb':
      ship.energyBomb = true;
      break;
    case 'energyUnit':
      ship.energyUnit = true;
      break;
    case 'dockingComputer':
      ship.dockingComputer = true;
      break;
    case 'galacticHyperdrive':
      ship.galacticHyperdrive = true;
      break;
  }
  return { state: { ...state, ship, holdSpace, cash: state.cash - item.price } };
}

/* ---------- Контрабанда ---------- */

/** Индексы запрещённых товаров в таблице QQ23 (и в массиве cargo). */
export const SLAVES_INDEX = 3;
export const NARCOTICS_INDEX = 6;
export const FIREARMS_INDEX = 10;

/**
 * Насколько «плохо» мы выглядим по грузу в трюме — подпрограмма BAD из оригинала
 * (library/common/main/subroutine/bad.asm):
 *
 *   (slaves + narcotics) * 2 + firearms
 *
 * «Рабы и наркотики вдвое незаконнее оружия». Возвращает 0 для пустого трюма.
 */
export function contrabandLevel(cargo: readonly number[]): number {
  const slaves = cargo[SLAVES_INDEX] ?? 0;
  const narcotics = cargo[NARCOTICS_INDEX] ?? 0;
  const firearms = cargo[FIREARMS_INDEX] ?? 0;
  return (slaves + narcotics) * 2 + firearms;
}

/**
 * Правовой статус после взлёта со станции (TT110):
 *
 *   JSR BAD      \ A = (slaves + narcotics) * 2 + firearms
 *   ORA FIST     \ именно побитовое ИЛИ, а не сложение
 *   STA FIST
 *
 * Поэтому статус никогда не падает при взлёте с грузом: он только «поднимается»
 * до контрабандного уровня. Результат в 8-битном диапазоне оригинала (0..255).
 */
export function legalAfterLaunch(legal: number, cargo: readonly number[]): number {
  const bad = contrabandLevel(cargo) & 0xff;
  return (legal | bad) & 0xff;
}

/* ---------- Прыжок ---------- */

/** Отказы при старте прыжка или патруля. */
export type JumpError =
  | 'in-flight'
  | 'same-system'
  | 'too-far'
  | 'bad-target'
  /** §78: для патруля нужно четыре ракеты. */
  | 'no-missiles'
  /** §78: топлива не хватает даже на резерв возврата. */
  | 'no-fuel';

export type GalacticJumpError = 'in-flight' | 'no-drive';

export interface GalacticJumpResult {
  state: GameState;
  error?: GalacticJumpError;
}

export interface JumpResult {
  state: GameState;
  error?: JumpError;
}

/** Темп не может быть нулевым или отрицательным: защита от деления на 0. */
const safeSpeed = (settings: Settings): number => Math.max(settings.speed, 0.0001);

/**
 * Базовая длительность прыжка (при speed = 1), миллисекунды.
 *
 * Зависит от расстояния. В оригинале ZX Elite прыжок занимал примерно
 * 8 секунд независимо от дистанции — там нечего было растягивать,
 * космос шёл в реальном времени. У нас прыжок — абстрактный отрезок,
 * и привязка ко времени делает долгий перелёт осмысленным: лететь
 * 30 световых лет интереснее, чем 4, и это влияет на решение.
 *
 * Формула: `baseJumpMs` — время на средний прыжок (≈7 св. лет,
 * столько на старте доступно). Дальше прирост как корень из отношения:
 *
 *   t = baseJumpMs * (d / 7) ^ 0.6
 *
 * Корень, а не линейка, потому что гиперпрыжок в Elite — не «полёт со
 * скоростью», а переход через гиперпространство: дальность почти не
 * влияет на время. Показатель 0.6 — компромисс: 4 св. года ≈ 12 мин,
 * 7 ≈ 15, 17 (весь полный бак) ≈ 27 мин при базовых настройках.
 *
 * У ближних прыжков есть нижняя граница (40% от базовой): совсем
 * мгновенных перелётов быть не должно, иначе теряется смысл встреч.
 */
export function baseJumpDuration(distanceLy: number, settings: Settings): number {
  /*
   * Опорная точка (выбрана пользователем): полный бак на ×200 — десять секунд.
   *
   * Полный бак — это MAX_FUEL = 70 св. лет, значит базовое время для любого
   * прыжка выводится из него: `baseJumpMs` относится к пути в 70 св. лет.
   * На ×1 такой путь займёт 2000 секунд ≈ 33 минуты, на ×200 — 10 секунд.
   *
   * Показатель 0.6 подобран в §71: короткий прыжок занимает не ноль времени,
   * длинный растёт медленнее линейного, но всё же заметно растёт.
   */
  const reference = MAX_FUEL;
  const ratio = Math.max(distanceLy, 0.5) / reference;
  const scaled = settings.baseJumpMs * Math.pow(ratio, 0.6);
  // Не короче 10% базовой и не длиннее базовой: путь не может занять больше
  // времени, чем полный бак топлива, — это была бы ошибка в расчётах.
  const clamped = Math.min(Math.max(scaled, settings.baseJumpMs * 0.1), settings.baseJumpMs);
  return Math.max(0, Math.round(clamped));
}

/** Длительность прыжка в миллисекундах с учётом темпа и расстояния. */
export function jumpDuration(settings: Settings, distanceLy = 7): number {
  return Math.max(0, Math.round(baseJumpDuration(distanceLy, settings) / safeSpeed(settings)));
}

/** Переводит «базовые» миллисекунды полёта в реальные при текущем темпе. */
export function baseToReal(baseMs: number, settings: Settings): number {
  return Math.round(baseMs / safeSpeed(settings));
}

/**
 * Через сколько РЕАЛЬНОГО времени после прошлой встречи наступит следующая.
 *
 * Плотность встреч задана в реальном времени, а не в базовом: это ключевое
 * решение §76. Смысл простой — встреча это корабль, который вы проходите
 * мимо, а не событие «на пути». Значит, чем дольше вы в пути, тем больше
 * проходите. Медленная скорость растягивает время в пути, быстрая — сжимает.
 *
 * `encounterRate` из настроек работает множителем: «часто» — вдвое плотнее,
 * «нет встреч» — отключает их вовсе.
 */
export const ENCOUNTER_PERIOD_MS = 120 * 1000;

/* ---------- Патруль (§78) ---------- */

/** Сколько топлива стоит одна встреча в патруле. */
export const PATROL_FUEL_PER_ENCOUNTER = 1;
/** Сколько топлива стоит бой (победа над враждебным). */
export const PATROL_FUEL_PER_FIGHT = 1;
/**
 * Резерв на возврат домой.
 *
 * Патруль не начинается и прекращается, если бака не хватает на дорогу
 * обратно. Игрок не должен застрять в космосе без топлива — это его
 * прямое условие.
 */
export const PATROL_RETURN_RESERVE = 3;

export function nextEncounterAt(flight: Flight, now: number, settings: Settings): number {
  // Единственная точка, где решается «встречи отключены». Раньше это
  // проверялось ещё и при генерации списка в startJump; списка больше нет,
  // поэтому проверка должна жить только здесь — иначе `encounterRate: 0`
  // перестанет отключать встречи (что и случилось при первом заходе §76).
  if (settings.encounterRate <= 0) return Infinity;
  const period = ENCOUNTER_PERIOD_MS / settings.encounterRate;
  /*
   * Точка отсчёта — момент последней встречи, и НИЧЕГО больше.
   *
   * Соблазнительно взять `Math.max(lastEncounterAt, now)`, чтобы встреча не
   * назначалась в прошлое. Но `now` здесь — это `dueAt`, который цикл
   * досчёта двигает вперёд на каждом шаге. Получалось, что назначенная
   * встреча всё время отодвигается на один шаг и не наступает никогда:
   * при досчёте одним вызовом встречи были, при досчёте по минутам — ни
   * одной. Встреча в прошлом безопасна: цикл всё равно не отправится
   * раньше, чем позволит `t > now`.
   */
  const natural = flight.lastEncounterAt + period;
  /*
   * ПОЛ: хотя бы одна встреча за перелёт.
   *
   * Без него быстрый полёт пустой: на ×200 полный бак проходится за 10 секунд,
   * и при плотности раз в 90 секунд не случается ничего. Пользователь выбрал
   * для ×200 ровно одну встречу — отсюда этот пол. Медленный темп получает
   * много встреч, быстрый — одну: разница в добыче остаётся, но быстрый
   * полёт не выглядит сломанным.
   *
   * Момент — за секунду до прибытия, чтобы встреча успела состояться до
   * конца пути и не наложилась на прибытие.
   */
  /*
   * §78: в патруле пола нет — там `arriveAt` бесконечно, и «середина пути»
   * не имеет смысла. Патруль кончается по топливу, а не по времени,
   * поэтому отсчёт всегда обычный: `lastEncounterAt + период`.
   */
  if (flight.patrol) return natural;
  if (flight.encounters === 0) {
    /*
     * Момент — в середине пути, но не позже, чем за 20 секунд до прибытия:
     * встреча должна успеть ОБНАРУЖИТЬСЯ до конца полёта, иначе игрок её
     * не увидит, а счётчик покажет ноль. На очень коротких полётах (полный
     * бак на ×200 — десять секунд) середина пути и есть эти десять секунд.
     */
    /*
     * Половина пути — единственная точка, которая работает на ЛЮБОЙ
     * длительности. Попытка взять «за 20 секунд до прибытия» на коротком
     * перелёте (полный бак на ×200 — 3.8 секунды) уводила в отрицательное
     * время, а обрезка до момента старта давала ровно начало полёта — и
     * встреча не наступала, потому что цикл ждёт строго `t > now`.
     */
    return flight.departAt + (flight.arriveAt - flight.departAt) / 2;
  }
  return natural;
}

export function syncFlightToSpeed(flight: Flight, now: number, settings: Settings): Flight {
  // Сколько реального времени прошло с прошлой синхронизации
  const realMs = Math.max(0, now - flight.dueAt);
  // …и сколько это «базовых» миллисекунд при текущем темпе
  const baseMs = realMs * safeSpeed(settings);
  const elapsedBase = flight.elapsedBaseMs + baseMs;
  const remainingBase = Math.max(0, flight.remainingBaseMs - baseMs);
  const arriveAt = now + baseToReal(remainingBase, settings);
  // Ничего не изменилось (тот же момент и тот же темп) — возвращаем исходный
  // объект. Это важно для UI: `tick` сравнивает ссылки и при «пустом» тике
  // не перерисовывает экран целиком.
  if (
    arriveAt === flight.arriveAt &&
    elapsedBase === flight.elapsedBaseMs &&
    remainingBase === flight.remainingBaseMs &&
    now === flight.dueAt
  ) {
    return flight;
  }
  return {
    ...flight,
    elapsedBaseMs: elapsedBase,
    remainingBaseMs: remainingBase,
    dueAt: now,
    arriveAt,
    // `pending` не трогаем: встречи хранятся в базовой шкале от вылета
    // и от смены темпа не зависят — двигается только точка отсчёта `dueAt`.
  };
}

/**
 * Сколько времени есть на решение при нападении: от минимума до максимума.
 *
 * В оригинале на решение отводилось ограниченное время, и оно не зависело от
 * длины пути. Здесь так же — 6–30 секунд реального времени.
 */
const ENCOUNTER_RESOLVE_MIN_MS = 6 * 1000;
const ENCOUNTER_RESOLVE_MAX_MS = 30 * 1000;

/**
 * Начало прыжка: топливо списывается сразу, прибытие по таймеру.
 *
 * Здесь же применяется проверка контрабанды из TT110: взлёт со станции с
 * запрещённым грузом поднимает правовой статус (`FIST = FIST OR BAD`).
 */
/**
 * §82: перелёт прямо из патруля.
 *
 * Игрок в патруле не должен быть заперт: увидел на карте цель — улетел.
 * Патруль при этом заканчивается сам, потому что `startJump` сменит
 * `flight` на обычный прыжок.
 *
 * Топливо: патруль тратил по факту, а прыжок стоит как обычно. Двойного
 * списания нет — патрульный `fuelUsed` остаётся в истории.
 */
export function jumpFromPatrol(state: GameState, target: number, now: number, settings: Settings): JumpResult {
  if (!state.flight?.patrol) return startJump(state, target, now, settings);
  return startJump({ ...state, flight: null, encounter: null }, target, now, settings);
}

export function startJump(state: GameState, target: number, now: number, settings: Settings): JumpResult {
  if (state.flight) return { state, error: 'in-flight' };
  const systems = systemsOf(state.galaxy);
  if (!Number.isInteger(target) || target < 0 || target >= systems.length) return { state, error: 'bad-target' };
  if (target === state.system) return { state, error: 'same-system' };
  const d = distance(systems[state.system], systems[target]);
  if (d > state.fuel) return { state, error: 'too-far' };

  // Длительность хранится в «базовых» миллисекундах (при speed = 1),
  // поэтому смена темпа потом влияет и на уже начатый полёт.
  // Зависит от расстояния: долгий перелёт занимает больше времени.
  const baseDuration = baseJumpDuration(d, settings);

  return {
    state: {
      ...state,
      stats: { ...state.stats, jumps: state.stats.jumps + 1 },
      fuel: state.fuel - d,
      legal: legalAfterLaunch(state.legal, state.cargo),
      flight: {
        from: state.system,
        to: target,
        departAt: now,
        arriveAt: now + baseToReal(baseDuration, settings),
        fuelUsed: d,
        remainingBaseMs: baseDuration,
        elapsedBaseMs: 0,
        dueAt: now,
        // Встречи рождаются в процессе (§76), а не раскладываются заранее.
        // Отсчёт первой — от момента вылета.
        encounters: 0,
        lastEncounterAt: now,
      },
    },
  };
}

/**
 * Начало патруля: полёт внутри текущей системы (§78).
 *
 * Отличия от прыжка, которые надо держать в голове:
 * - топливо НЕ списывается авансом: платим по мере встреч и боёв;
 * - `to === from`: система не меняется;
 * - время течёт по реальным часам, темп ×N не действует;
 * - патруль кончается сам, когда топлива остаётся только на возврат.
 *
 * Ракеты: нужно 4, чтобы вообще начать. Тратить их будем по факту боя,
 * а не все сразу — игрок должен видеть, на что уходят деньги.
 */
export function startPatrol(state: GameState, now: number): JumpResult {
  if (state.flight) return { state, error: 'in-flight' };
  /*
   * §102: «полный боекомплект» — это боекомплект КОРАБЛЯ, а не 4 ракеты.
   * У Аспа слотов один, и требование четырёх запирало перехватчик на
   * станции навсегда: в патруль он выйти не мог вообще.
   */
  if (state.ship.missiles < patrolMissilesRequired(state.ship)) {
    return { state, error: 'no-missiles' };
  }
  // Возврат домой бесплатный — станция рядом, но резерв нужен, чтобы
  // патруль не начался «на последних каплях».
  if (state.fuel <= PATROL_RETURN_RESERVE) return { state, error: 'no-fuel' };

  return {
    state: {
      ...state,
      stats: { ...state.stats, patrols: state.stats.patrols + 1 },
      flight: {
        from: state.system,
        to: state.system,
        departAt: now,
        // Патруль не имеет конца по времени: `arriveAt` = бесконечность,
        // а прекращает его топливо. Иначе досчёт ждал бы прибытия.
        arriveAt: Number.POSITIVE_INFINITY,
        fuelUsed: 0,
        remainingBaseMs: Number.POSITIVE_INFINITY,
        elapsedBaseMs: 0,
        dueAt: now,
        encounters: 0,
        lastEncounterAt: now,
        patrol: true,
        patrolFuelUsed: 0,
      },
    },
  };
}

/**
 * Сколько ракет нужно, чтобы выйти в патруль (§78), для стартовой Кобры.
 * С §102 требование считается по кораблю: `patrolMissilesRequired`.
 */
export const PATROL_MISSILES_REQUIRED = 4;

/* ---------- Галактический гиперпрыжок ---------- */

/**
 * Переход в следующую галактику по подпрограмме Ghy.
 *
 * Что делает оригинал:
 *   1. Требует установленный галактический гипердвигатель (GHYP).
 *   2. Двигатель одноразовый: `STX GHYP` сразу после срабатывания.
 *   3. `STX FIST` — смена галактики очищает криминальное дозье.
 *   4. `INC GCNT / AND #7` — галактика идёт по кругу 0..7 (после 8-й — снова 1-я).
 *   5. Координаты прибытия всегда (96, 96), затем TT111 ищет ближайшую систему.
 *
 * Мы не моделируем таймер обратного отсчёта: как и обычный прыжок, переход
 * мгновенный (или, в idle-режиме, может быть растянут настройками темпа).
 */
export function galacticJump(state: GameState): GalacticJumpResult {
  if (state.flight || state.combat) return { state, error: 'in-flight' };
  if (!state.ship.galacticHyperdrive) return { state, error: 'no-drive' };

  // GCNT идёт по кругу: 1..8 → снова 1
  const galaxy = (state.galaxy % GALAXY_COUNT) + 1;
  const systems = systemsOf(galaxy);
  const system = nearestSystem(systems, GALACTIC_ARRIVAL.x, GALACTIC_ARRIVAL.y);
  const [fluct, rng] = nextByte(state.rng);

  return {
    state: {
      ...state,
      galaxy,
      system,
      market: generateMarket(systems[system], fluct),
      rng,
      // Галактический гипердвигатель одноразовый
      ship: { ...state.ship, galacticHyperdrive: false },
      // Смена галактики очищает криминальное дозье
      legal: 0,
      escapeRoute: [],
      escapeStatus: -1,
      encounter: null,
      combat: null,
      flight: null,
    },
  };
}

/* ---------- Встречи ---------- */

/** Вероятность пирата по типу правительства (анархия … корпоративное государство) */
const PIRATE_CHANCE = [0.55, 0.45, 0.35, 0.3, 0.25, 0.2, 0.12, 0.08];
/** Вероятность патруля полиции по типу правительства */
const POLICE_CHANCE = [0.0, 0.1, 0.15, 0.2, 0.2, 0.3, 0.4, 0.5];
/**
 * Охотники за головами (§84).
 *
 * Пользователь: «награда охотникам увеличена». По смыслу это значит, что
 * на беглеца охотятся СИЛЬНЕЕ, чем на мелкого нарушителя: чем больше
 * награда, тем больше желающих.
 *
 *   Чист        → 10% (как было)
 *   Нарушитель  → 18%
 *   Беглец      → 30%
 *
 * Числа взяты из тех же соображений, что и в оригинале: там охотник
 * появлялся при высоком статусе заметно чаще. Базовые 10% оставлены для
 * чистых — иначе наградной промысел исчез бы вовсе.
 */
const HUNTER_CHANCE_CLEAN = 0.1;
const HUNTER_CHANCE_OFFENDER = 0.18;
const HUNTER_CHANCE_FUGITIVE = 0.3;

function hunterChance(legal: number): number {
  if (legal >= 50) return HUNTER_CHANCE_FUGITIVE;
  if (legal >= 1) return HUNTER_CHANCE_OFFENDER;
  return HUNTER_CHANCE_CLEAN;
}
const CANISTER_CHANCE = 0.12;

/** Удобная обёртка над детерминированным генератором. */
class Dice {
  rng: number;
  constructor(rng: number) {
    this.rng = rng;
  }
  next(): number {
    const [v, n] = nextFloat(this.rng);
    this.rng = n;
    return v;
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.min(items.length - 1, Math.floor(this.next() * items.length))];
  }
}

function pickPirate(kills: number, dice: Dice): string {
  // Корабль из группы пиратов по таблице оригинала: (A AND T) AND #7 + PACK.
  // Порог minKills — наше дополнение: редкие тяжёлые корабли появляются позже.
  const a = Math.floor(dice.next() * 256);
  const t = Math.floor(dice.next() * 256);
  const id = pirateFromGroup(a, t);
  const enemy = enemyById(id);
  return enemy.minKills <= kills ? id : 'sidewinder';
}

function pickLoneHunter(kills: number, dice: Dice): string {
  // Исправление Моксона: LSR A / AND #3 / ADC #CYL2 → 24..28, Moray на 28.
  const id = loneHunter(Math.floor(dice.next() * 256));
  const enemy = enemyById(id);
  return enemy.minKills <= kills ? id : 'cobra1';
}

function spawnEncounter(state: GameState, at: number, settings: Settings, events: GameEvent[]): GameState {
  const flight = state.flight!;
  const dice = new Dice(state.rng);
  const gov = systemsOf(state.galaxy)[flight.to].government;
  const rest: Flight = { ...flight, encounters: flight.encounters + 1, lastEncounterAt: at };

  let r = dice.next();
  let role: EncounterRole;
  if (r < PIRATE_CHANCE[gov]) {
    role = 'pirate';
  } else if ((r -= PIRATE_CHANCE[gov]) < POLICE_CHANCE[gov]) {
    role = 'police';
  } else if ((r -= POLICE_CHANCE[gov]) < hunterChance(state.legal)) {
    role = 'hunter';
  } else if ((r -= hunterChance(state.legal)) < CANISTER_CHANCE) {
    /*
     * Дрейфующий контейнер: забирается только топливосборщиком.
     *
     * `flight` здесь — БЕЗ отметки о встрече: контейнер не корабль и не
     * должен тратить слот. Иначе на быстрых перелётах пол «одна встреча за
     * полёт» срабатывал на канистре, и кораблей не появлялось вовсе.
     */
    const index = Math.floor(dice.next() * 16);
    const amount = 1 + Math.floor(dice.next() * 3);
    const name = COMMODITIES[index].name;
    let next: GameState = { ...state, rng: dice.rng, flight };
    let text = `Дрейфующий контейнер: ${name}. Топливосборщика нет, проходим мимо`;
    if (state.ship.fuelScoops) {
      /*
       * §97: запрещёнку дрейфующий контейнер НЕ берёт — по тому же правилу,
       * что автоподбор обломков (§93).
       *
       * Найдено пользователем: в патруле смог забрать запрещёнку. §93
       * закрыл подбор из обломков после боя, а этот путь остался открыт,
       * потому что он вообще не про обломки: канистра попадается в полёте,
       * берётся влёт, без экрана и без вопроса. Причём товар здесь любой из
       * шестнадцати — рабы (3), наркотики (6) и оружие (10) в том числе.
       *
       * Хуже всего было то, что статус при этом не рос: игрок вёз рабов с
       * `legal = 0`, то есть формально оставался чистым, а контрабанда в
       * трюме запрещает побег (§80.1). Автоматика снова решала за игрока —
       * ровно то, что §93 запретил.
       *
       * Взять такой контейнер осознанно нельзя: подбор влётный, экрана
       * решения у него нет. Поэтому единственное честное поведение —
       * пройти мимо и сказать об этом.
       */
      if (isContraband(index)) {
        text = `Дрейфующий контейнер: ${name}. Запрещённый товар — проходим мимо, он делает преступником`;
      } else {
        const room = Math.min(amount, cargoRoom(state, index));
        if (room > 0) {
          const cargo = state.cargo.slice();
          cargo[index] += room;
          next = {
            ...next,
            cargo,
            // §98: даже закрытый §97 путь остаётся в манифесте: правило
            // может измениться, а запись обязана быть честной.
            cargoOrigin: noteCargo(next.cargoOrigin, index, room, 'drifting'),
            holdSpace: isTonneCargo(index) ? state.holdSpace - room : state.holdSpace,
          };
          text = `Подобран контейнер: ${name}, ${room}`;
        } else {
          text = `Дрейфующий контейнер: ${name}. В трюме нет места`;
        }
      }
    }
    events.push({ type: 'canister', at, text });
    return next;
  } else {
    role = 'trader';
  }

  const enemyId =
    role === 'police'
      ? 'viper'
      : role === 'trader'
        ? 'cobra3'
        : role === 'hunter'
          ? pickLoneHunter(state.kills, dice)
          : pickPirate(state.kills, dice);
  const hostile = role === 'pirate' ? dice.next() < 0.8 : role === 'trader' ? false : state.legal >= 1;

  /*
   * Через сколько встреча разрешится — считается ОТ МОМЕНТА ОБНАРУЖЕНИЯ.
   *
   * Было: доля от всей длительности полёта (`arriveAt - departAt`). Это
   * годилось, пока встреча назначалась заранее в `startJump` и `at` был
   * точкой на шкале пути. §76 рождает встречи в процессе, и старая формула
   * давала `resolveAt` в ПРОШЛОМ: полёт длиной 13 минут, встреча на 5-й
   * минуте, а «разрешить» её надо через 2% от 13 минут — то есть раньше,
   * чем её увидели. События шли в неправильном порядке, а прибытие
   * наступало раньше срока.
   *
   * Теперь: 6–30 секунд на решение для нападающего (было столько же в
   * пересчёте на короткий прыжок), таймаут ожидания для мирного.
   */
  const resolveAt = hostile
    ? Math.round(at + ENCOUNTER_RESOLVE_MIN_MS + (ENCOUNTER_RESOLVE_MAX_MS - ENCOUNTER_RESOLVE_MIN_MS) * dice.next())
    : at + settings.encounterTimeoutMs;

  /*
   * Отмечаем встречу: следующая отсчитывается от этого момента (§76).
   *
   * Здесь, а не в начале функции: дрейфующий контейнер — НЕ встреча, это
   * находка на пути. Раньше он считался встречей и «съедал» слот, из-за
   * чего на быстрых скоростях перелёт оставался без кораблей вовсе — пол
   * срабатывал на канистре, а не на пирате. Эта ветка до контейнера не
   * доходит: контейнер возвращает состояние выше, со своим `flight`.
   */
  /*
   * §79: в режиме пиратства торговец — тоже цель.
   *
   * `outcome` означает «что происходит во встрече»: мирный корабль просто
   * уходит (`leave`), и это автоматически исключало его из разбора. Но
   * пирату неважно, что торговец летит мимо, — именно его и грабят.
   * Поэтому при криминальном статусе помечаем встречу как `attack`:
   * не торговец нападает, а НА НЕГО нападают.
   */
  const raidable = role === 'trader' && isCriminal(state.legal);
  const encounter: Encounter = {
    role,
    enemyId,
    detectedAt: at,
    resolveAt,
    outcome: hostile || raidable ? 'attack' : 'leave',
  };
  const shipName = enemyById(enemyId).name;
  events.push({
    type: 'detected',
    at,
    text: `В радиусе действия корабль: ${ROLE_NAMES[role]} (${shipName})`,
  });
  /*
   * §78: в патруле каждая встреча стоит топлива.
   *
   * Списываем здесь, при обнаружении, а не при разрешении: если игрок
   * уйдёт из игры между этими моментами, «долг» не потеряется. Бой
   * оплачивается отдельно, при победе.
   */
  let charged = state;
  let restCharged = rest;
  if (rest.patrol) {
    const cost = PATROL_FUEL_PER_ENCOUNTER;
    restCharged = {
      ...rest,
      patrolFuelUsed: (rest.patrolFuelUsed ?? 0) + cost,
    };
    charged = { ...state, fuel: Math.max(0, state.fuel - cost) };
  }
  return { ...charged, rng: dice.rng, flight: restCharged, encounter };
}

/**
 * Разрешает встречу автобоем, когда игрок не успел решить (§40).
 *
 * Безопасный режим: слабый враждебный → победа, иначе → пропуск.
 * Смерти игрока быть не может, капсула не тратится.
 */
function autoDecision(
  state: GameState,
  at: number,
  _settings: Settings,
  events: GameEvent[],
): GameState {
  const enc = state.encounter!;
  const enemy = enemyOf(enc.enemyId);
  const hostile = enc.outcome === 'attack';
  const lasers = {
    pulse: state.ship.laser === 'pulse',
    beam: state.ship.laser === 'beam',
    military: state.ship.laser === 'military',
    mining: state.ship.laser === 'mining',
  };
  // §78: в патруле решает СНАРЯЖЕНИЕ, а не симуляция раундов.
  // Игрок не смотрит на экран — разыгранный бой с шансом провала там
  // неуместен. Правило простое: «есть ли чем справиться».
  const best = bestLaserOf(lasers);
  const kit = {
    militaryLaser: state.ship.laser === 'military',
    ecm: state.ship.ecm,
    energyBomb: state.ship.energyBomb,
    missiles: state.ship.missiles,
  };
  const patrol = state.flight?.patrol === true;

  /*
   * §79: РЕЖИМ ПИРАТСТВА.
   *
   * Если правовой статус криминальный, патруль превращается в пиратство:
   * в зачёт идут ВСЕ встречные корабли, а не только пираты. Торговец —
   * законная добыча, полиция — тоже, если осмелишься (и это добавит
   * розыска). Смысл: игрок сам выбрал путь и живёт по его правилам.
   *
   * ВХОД В ПИРАТСТВО ОДИН — ГРУЗ (§87).
   *
   * Чистый пилот грабить не может: торговец для него просто уходит, и
   * `raidable` ниже это закрепляет. Преступником становятся не от налёта,
   * а от запрещённого товара в трюме: взлёт со станции поднимает статус
   * до контрабандного уровня (TT110, `legalAfterLaunch`). Только после
   * этого патруль превращается в пиратство.
   *
   * Так вышло не случайно: нападение — уже следствие преступного груза,
   * а не способ им стать. Обратный порядок («нажал грабёж — стал пиратом»)
   * был бы бесплатным входом в криминал прямо из мирного полёта.
   */
  const criminal = isCriminal(state.legal);
  const raiding = patrol && criminal;
  const can = availableDecisions(enemy, best, true, hostile, toughnessOf(state.ship));
  const beat = canBeat(enemy, kit, best, state.ship.model);
  // Пиратство: бить можно любого. Обычный патруль: только враждебных
  // (пират, а также полиция и охотник, если статус уже криминальный).
  /*
   * §95: КОГО БЬЁМ В ПАТРУЛЕ.
   *
   * Три случая, и раньше они смешивались в `raiding ? beat : hostile && beat`:
   *
   *   пиратство (криминал)  — любой, кого можем одолеть;
   *   обычный патруль       — враждебных И пиратов, даже летящих мимо;
   *   торговец, полиция     — только если сами напали (hostile).
   *
   * Середина — суть правки: пират остаётся законной целью, даже когда
   * `outcome === 'leave'`. Он преступник, за него платят награду, и §86
   * именно поэтому сделал его жёлтым. А торговец и власть не становятся
   * целями от того, что рядом пролетели.
   *
   * `beat` — «есть чем справиться» (снаряжение), а не «враждебен».
   */
  /*
   * ВАЖНО: `enemy.pirate` — свойство МОДЕЛИ корабля («на таком летают
   * пираты»), а не роли в этой встрече. Cobra Mk III пиратская И
   * торговая одновременно. Поэтому цель определяется РОЛЬЮ встречи,
   * а не флагом корабля: иначе чистый пилот грабил торговца на Cobra.
   */
  /*
   * §96: правило законной цели — ОДНО, в `isLegalTarget`. Здесь его
   * дублировать нельзя: именно расхождение копий дало «это решение
   * сейчас недоступно» в интерфейсе.
   *
   * `beat` обязателен для ЛЮБОЙ атаки, включая пиратство: «бить можно
   * любого» §79 не отменяет проверку снаряжения. Python и Анаконда
   * требуют полного набора (§78), и правило «нельзя — значит пропуск»
   * остаётся и здесь.
   */
  const mayAttack = (raiding || isLegalTarget(enc.role, hostile)) && beat;
  const r = autoResolve(enemy, { ...can, attack: mayAttack }, hostile);
  events.push({ type: r.outcome, at, text: r.text });
  // Статистика: победа считается убийством ровно так же, как и при
  // ручном решении, иначе журнал расходится с рангом.
  const won = r.outcome === 'won' || r.outcome === 'auto-victory';
  const skipped = r.outcome === 'skipped' || r.outcome === 'auto-skip';

  /*
   * §78: бой в патруле стоит топлива, а бой с БОЛЬШИМ кораблём — ещё и
   * ракеты.
   *
   * Ракета уходит только на тех, кому она нужна: Python и Анаконду. Первый
   * заход тратил её на любую победу — замер показал абсурд: четыре ракеты
   * сгорали на Sidewinder'ах за четыре боя, и после этого большие корабли
   * закрывались до конца патруля. Ракеты нужны как раз для них, а не
   * наоборот.
   *
   * Пропуск стоит ноль: не дрались — не платим.
   */
  let fuel = state.fuel;
  let ship = state.ship;
  let flight = state.flight;
  if (flight?.patrol && won) {
    fuel = Math.max(0, fuel - PATROL_FUEL_PER_FIGHT);
    flight = { ...flight, patrolFuelUsed: (flight.patrolFuelUsed ?? 0) + PATROL_FUEL_PER_FIGHT };
    if (needsMissile(enemyOf(state.encounter!.enemyId))) {
      ship = { ...ship, missiles: Math.max(0, ship.missiles - 1) };
    }
  }

  /*
   * §79: ДОБЫЧА С ГРАБЕЖА.
   *
   * Победа над торговцем даёт не награду (он не преступник), а ГРУЗ. Он
   * уходит в трюм; что не поместилось — теряется. Это и есть смысл
   * пиратства: не деньги за голову, а товар.
   *
   * Статус растёт: нападение на мирного — преступление. За убийство
   * полицейского — сильнее (POLICE_KILL_LEGAL).
   */
  let cash = state.cash + r.bounty;
  let legal = state.legal;
  let cargo = state.cargo;
  let holdSpace = state.holdSpace;
  let looted = 0;

  if (won && enc.role === 'trader') {
    /*
     * Груз торговца. Сколько контейнеров — по блюпринту корабля, товар —
     * из ассортимента системы, как и в обычных обломках (§73). Разница
     * только в том, что это не «выпало», а «отобрано».
     */
    const count = canisterCount(enc.enemyId, 'trader');
    if (count > 0) {
      const rolled = rollCanisters(count, state.market, state.rng);
      legal = Math.min(255, legal + RAID_LEGAL);
      const got = autoScoop(cargo, holdSpace, rolled.canisters);
      cargo = got.cargo;
      holdSpace = got.holdSpace;
      looted = got.taken;
      state = { ...state, cargoOrigin: noteFromCanisters(state.cargoOrigin, rolled.canisters) };
      /*
       * §93: запрещёнку автоподбор не берёт — говорим об этом прямо.
       *
       * Молчаливое «подобрано 1 контейнер» при трёх выпавших выглядело бы
       * потерей груза. Причина другая: рабы и наркотики в трюме сделали бы
       * преступником без выбора игрока, а контрабанда ещё и запрещает
       * побег (§80.1). Поэтому пишем, что осталось и почему.
       */
      const banned = countContraband(rolled.canisters);
      const why = banned > 0
        ? `. В обломках был${banned === 1 ? '' : 'о'} ${banned} ${plural(banned, 'контейнер', 'контейнера', 'контейнеров')} с запрещённым товаром — оставлен${banned === 1 ? '' : 'о'}: такой груз делает преступником`
        : '';
      events.push({
        type: 'raided',
        at,
        text:
          looted > 0
            ? `Ограблен торговец: в трюм ${looted} ${plural(looted, 'контейнер', 'контейнера', 'контейнеров')}. Вы стали преступником${why}`
            : `Торговец уничтожен, но груз не взят — трюм полон${why}`,
      });
    }
  } else if (won && enc.role === 'police') {
    legal = Math.min(255, legal + POLICE_KILL_LEGAL);
  }

  /*
   * §80: новый грабёж обнуляет маршрут побега. Начал грабить — беги
   * заново. Иначе выходило бы, что пират копит планеты и тратит их
   * на будущие преступления, то есть «откладывает долг».
   */
  const escaped = legal > state.legal ? { route: [], status: -1 } : { route: state.escapeRoute, status: state.escapeStatus };

  return {
    ...state,
    cash,
    fuel,
    ship,
    flight,
    legal,
    escapeRoute: escaped.route,
    escapeStatus: escaped.status,
    cargo,
    holdSpace,
    kills: state.kills + (won ? 1 : 0),
    stats: {
      ...state.stats,
      kills: state.stats.kills + (won ? 1 : 0),
      skipped: state.stats.skipped + (skipped ? 1 : 0),
      raided: state.stats.raided + (looted > 0 ? 1 : 0),
    },
    encounter: null,
    combat: null,
  };
}

/** Начинает бой и, в автоматическом режиме, сразу доигрывает его. */
function beginCombat(state: GameState, at: number, settings: Settings, events: GameEvent[]): GameState {
  const enc = state.encounter!;
  const combat = startCombat(enc.enemyId, state.ship, cargoTons(state), state.rng);
  const startText =
    enc.role === 'police' ? 'Полиция требует остановиться и открывает огонь' : `${ROLE_NAMES[enc.role]} атакует`;
  const next: GameState = {
    ...state,
    encounter: null,
    combat: { combat, role: enc.role, pausedAt: at, pausedMs: 0 },
  };
  if (settings.combatMode === 'manual') {
    events.push({ type: 'combat-start', at, text: startText, manual: true });
    return next;
  }
  events.push({ type: 'combat-start', at, text: startText, manual: false });
  const finished = autoCombat(combat);
  return finishCombat({ ...next, combat: { ...next.combat!, combat: finished } }, at, settings, events);
}

/** Применяет итог закончившегося боя и снимает паузу полёта. */
function finishCombat(state: GameState, at: number, settings: Settings, events: GameEvent[]): GameState {
  const active = state.combat!;
  const c = active.combat;
  const enemy = enemyById(c.enemyId);
  const flight = state.flight;
  // Сколько полёт реально простоял на паузе. Учитываем только время, которое
  // игра успела «увидеть» онлайн-тиками (его копит advance). Календарный
  // разрыв между ходами — это офлайн-время, оно полёт не откладывает.
  const pausedMs = Math.max(0, active.pausedMs);
  let s: GameState = { ...state, rng: c.rng, combat: null, encounter: null };

  // расход ресурсов в бою
  s = {
    ...s,
    ship: { ...s.ship, missiles: c.playerMissiles, energyBomb: s.ship.energyBomb && !c.bombUsed },
  };

  if (c.cargoDumped) {
    s = { ...s, cargo: s.cargo.map(() => 0), cargoOrigin: [], holdSpace: holdCapacity(s.ship) };
  }

  /** Полёт продолжается: простой боя добавляется к прибытию и ожидающим встречам. */
  const resume = (st: GameState): GameState => {
    if (!st.flight || pausedMs <= 0) return st;
    // Сдвиг через `dueAt`, а не правкой одного `arriveAt`: иначе следующий
    // досчёт пересчитает прибытие из остатка и сотрёт сдвиг (§73).
    return { ...st, flight: shiftFlightBy(st.flight, pausedMs) };
  };

  /** Возврат на станцию вылета: полёт отменяется, рынок обновляется. */
  const returnToStation = (st: GameState): GameState => {
    const from = flight ? flight.from : st.system;
    const [fluct, rng] = nextByte(st.rng);
    return {
      ...st,
      flight: null,
      system: from,
      market: generateMarket(systemsOf(st.galaxy)[from], fluct),
      rng,
    };
  };

  const say = (text: string): void => {
    events.push({ type: 'combat-end', at, text });
  };

  switch (c.outcome) {
    case 'won': {
      let next: GameState = { ...s, kills: s.kills + 1, cash: s.cash + enemy.bounty };
      let text = `${enemy.name} уничтожен`;
      if (enemy.bounty > 0) text += `, награда ${(enemy.bounty / 10).toFixed(1)} CR`;
      if (active.role === 'police') {
        next = { ...next, legal: Math.min(255, next.legal + POLICE_KILL_LEGAL) };
        text += '. Вы стали беглецом';
      }

      /*
       * Обломки. Сколько контейнеров выпало — из блюпринта корабля
       * (docs/cargo-canisters.md), товар — из ассортимента системы.
       * Контейнеров нет, если их нет по блюпринту или некуда положить:
       * пустой трюм без скупов в оригинале означал бы разбитые канистры.
       */
      const count = canisterCount(c.enemyId, active.role);
      const dice = new Dice(next.rng);
      let leftovers: CargoCanister[] = [];
      next = { ...next, rng: dice.rng };

      if (count > 0) {
        const rolled = rollCanisters(count, next.market, next.rng);
        next = { ...next, rng: rolled.rng };
        leftovers = rolled.canisters;

        if (!next.ship.fuelScoops) {
          // Без топливосборщика контейнеры не подобрать — ровно как в
          // оригинале, где канистра при касании разбивалась.
          text += `. В обломках ${count} ${plural(count, 'контейнер', 'контейнера', 'контейнеров')}, но без топливосборщика их не взять`;
          say(text);
          return resume(next);
        }

        if (settings.autoScoop) {
          /*
           * §93: автоподбор берёт только чистый груз. Запрещёнку игрок
           * может взять сам — на экране обломков, осознанно, и тогда
           * статус вырастет честно (`salvageTake`). Автоматика такого
           * решения принимать не должна.
           */
          const got = autoScoop(next.cargo, next.holdSpace, leftovers);
          next = {
            ...next,
            cargo: got.cargo,
            cargoOrigin: noteFromCanisters(next.cargoOrigin, leftovers),
            holdSpace: got.holdSpace,
          };
          const banned = countContraband(leftovers);
          if (got.taken > 0) {
            text += `. Подобрано контейнеров: ${got.taken}`;
          }
          if (got.left > 0) text += `, ${got.left} не поместилось`;
          if (banned > 0) {
            text += `. ${banned} с запрещённым товаром оставлены: такой груз делает преступником`;
          }
          /*
           * Запрещённый груз остался — значит есть что решать. Показываем
           * экран обломков только с ним, даже при включённом автоподборе:
           * выбор «взять рабов или нет» — не тот, что делается за игрока.
           */
          if (banned > 0) {
            say(text);
            return {
              ...resume(next),
              salvage: {
                canisters: leftovers.filter((c) => countContraband([c]) > 0),
                taken: 0,
                left: 0,
                pausedAt: at,
                pausedMs: 0,
                enemyName: enemy.name,
              },
            };
          }
          say(text);
          return resume(next);
        }

        // Ручной подбор: полёт встаёт на паузу до решения игрока.
        say(text);
        return {
          ...resume(next),
          salvage: {
            canisters: leftovers,
            taken: 0,
            left: 0,
            pausedAt: at,
            pausedMs: 0,
            enemyName: enemy.name,
          },
        };
      }

      say(text);
      return resume(next);
    }
    case 'fled':
      say('Вы ушли от боя');
      return resume(s);
    case 'enemy-fled':
      say(`${enemy.name} сбежал`);
      return resume(s);
    case 'enemy-left':
      say(`${enemy.name} потерял интерес и ушёл`);
      return resume(s);
    /*
     * Корабль повреждён. §77: смерти нет — это единственный «плохой» исход.
     *
     * Раньше здесь был выбор из двух ветвей по настройке `deathMode`
     * («Страховка» / «Без смерти»), а до них — капсула. Капсулу убрали
     * вместе со смертью, настройку тоже: осталась одна честная цена
     * проигрыша.
     *
     * Цена выбрана не «с нуля»: груз и четверть денег — это ровно то,
     * что терялось при страховке. Но корабль и всё купленное оборудование
     * остаются: отбирать их значило бы наказывать за один неудачный бой
     * всем, что нажито.
     *
     * Почему теряется именно четверть денег, а не груз целиком: без
     * этого проигрыш в бою на пустом трюме не стоил бы ничего, и игрок
     * мог бы таранить Анаконду без последствий.
     */
    default: {
      const next = returnToStation({
        ...s,
        cargo: s.cargo.map(() => 0),
        cargoOrigin: [],
        holdSpace: holdCapacity(s.ship),
        cash: Math.floor(s.cash * INSURANCE_CASH_KEPT),
      });
      events.push({
        type: 'damaged',
        at,
        text: 'Корабль повреждён и отбуксирован на станцию вылета. Груз и часть денег потеряны',
      });
      return next;
    }
  }
}

/**
 * §80: Побег от последствий.
 *
 * Правила, принятые пользователем:
 * - каждая НОВАЯ планета гасит единицу правового статуса;
 * - вернулся на уже посещённую — маршрут откатывается к началу,
 *   статус возвращается к тому, что был на старте побега;
 * - набрал 12 разных планет — статус чист, маршрут сгорает;
 * - новый грабёж обнуляет маршрут: начал грабить — беги заново.
 *
 * Возвращается новая пара значений (статус, маршрут, снимок), а события
 * складываются в переданный массив — так же, как это делает `arrive`.
 */
function escapeStep(
  state: GameState,
  /** Статус после взлёта — с контрабандой он уже вырос (TT110). */
  legalAtDeparture: number,
  to: number,
  name: string,
  at: number,
  events: GameEvent[],
): { legal: number; route: number[]; status: number } {
  const carriers = contrabandLevel(state.cargo);

  /*
   * §80.1: КОНТРАБАНДА В ТРЮМЕ — ПОБЕГ НЕВОЗМОЖЕН.
   *
   * Везёшь рабов или наркотики — ты не бежишь от закона, ты продолжаешь
   * преступление. Маршрут не начинается, а уже начатый сгорает.
   *
   * Это единственное наказание за контрабанду во время побега, и оно
   * работает без новых чисел: игрок видит, что трюм не пуст, и понимает,
   * почему побег стоит.
   */
  if (carriers > 0) {
    if (state.escapeRoute.length > 0) {
      /*
       * Откат к началу побега — как при возврате на посещённую планету.
       * Сама контрабанда статус уже подняла (на взлёте, TT110), и это
       * остаётся: трюм не опустел, розыск не отменился.
       */
      events.push({
        type: 'escape-reset',
        at,
        text: `Побег провален: в трюме контрабанда (${carriers}). Маршрут сгорел, статус ${state.escapeStatus}`,
      });
      return { legal: state.escapeStatus, route: [], status: -1 };
    }
    /*
     * §98.1: посадка с контрабандой при чистом маршруте.
     *
     * Здесь раньше не было ни одной записи — и это выглядело поломкой:
     * статус на взлёте вырос (TT110), на посадке не изменился, а причину
     * игрок видел только в момент взлёта. Владелец спросил прямо: «как
     * меняется статус при именно возврате на станцию с запрещёнкой?» —
     * значит, из игры это было непонятно.
     *
     * Числа не меняем: доля от снимка не применяется, потому что везёшь
     * контрабанду — бежать не от чего. Но сказать об этом надо.
     */
    events.push({
      type: 'escape-blocked',
      at,
      text: `Посадка с запрещённым грузом (${carriers}): статус не снижается — с таким трюмом побег невозможен, доля не применяется`,
    });
    return { legal: state.legal, route: [], status: -1 };
  }

  /*
   * Статус гасится ДОЛЕЙ, а не по единице. Снимок — статус на старте
   * маршрута: после N планет остаётся `снимок × (12 − N) / 12`.
   *
   * Доля, а не вычитание, потому что статус бывает 255, а планет максимум
   * двенадцать: вычитанием от 255 не избавиться никогда.
   */
  /*
   * Бежать не от чего: статус нулевой и маршрута нет. Это не «побег
   * удался» — просто нечего гасить. Важно проверить ДО создания маршрута,
   * иначе чистый пилот после первого же прыжка получал бы «побег удался».
   */
  if (legalAtDeparture === 0 && state.escapeRoute.length === 0) {
    return { legal: 0, route: [], status: -1 };
  }

  const starting = state.escapeStatus < 0 || state.escapeRoute.length === 0;
  const route = starting ? [] : state.escapeRoute;
  const startLegal = starting ? legalAtDeparture : state.escapeStatus;

  // Вернулся туда, где уже был, — откат к началу побега.
  if (route.includes(to)) {
    events.push({
      type: 'escape-reset',
      at,
      text: `Побег провален: ${name} уже посещена. Статус вернулся к ${startLegal}`,
    });
    return { legal: startLegal, route: [], status: -1 };
  }

  const grown = [...route, to];
  /*
   * §84: ступень выбирается по тяжести статуса на старте побега.
   * Нарушитель откупается шестью планетами, беглец — двенадцатью.
   */
  const need = escapePlanetsFor(startLegal);
  const legal = grown.length >= need ? 0 : Math.floor((startLegal * (need - grown.length)) / need);

  /*
   * Доля может дать нуль раньше порога — если статус был мал. Но это не
   * «побег удался»: маршрут ещё не пройден, и объявлять амнистию рано.
   * Побег считается состоявшимся только на пороге 12 планет.
   */
  if (grown.length >= need) {
    events.push({
      type: 'escape-clean',
      at,
      text: `Побег удался: ${grown.length} разных планет, статус чист`,
    });
    return { legal: 0, route: [], status: -1 };
  }

  // Статус обнулился долей раньше порога — маршрут продолжается.
  if (legal === 0) {
    return { legal: 0, route: grown, status: startLegal };
  }

  events.push({
    type: 'escape-step',
    at,
    text: `Побег: ${name} (${grown.length}/${need}), статус ${legal}`,
  });
  return { legal, route: grown, status: startLegal };
}

/** Прибытие в систему: обновляется рынок со случайным колебанием. */
function arrive(state: GameState, at: number, events: GameEvent[]): GameState {
  const flight = state.flight!;
  const system = systemsOf(state.galaxy)[flight.to];
  const [fluct, rng] = nextByte(state.rng);
  if (state.encounter) events.push({ type: 'vanished', at, text: 'Корабль остался позади' });
  events.push({ type: 'arrived', at, name: system.name, text: `Прибытие: ${system.name}` });

  /*
   * §80.1: ПОБЕГ ОТМЕНЯЕТ ДЕЛЕНИЕ.
   *
   * В оригинале каждый прыжок делит статус пополам (`SRL (HL)`). Пока
   * статус не криминальный, ниже нуля не уйти — делить нечего, и это
   * правило работает как раньше.
   *
   * Но у преступника первый же прыжок открывает маршрут побега, и тогда
   * действует СВОЁ правило: доля от снимка. Два наказания одновременно
   * (деление + планеты) давали непонятную арифметику и, что хуже,
   * стирали контрабанду, набранную в пути.
   *
   * Поэтому: идёт побег — деления нет, только планеты.
   */
  const escaping = isCriminal(state.legal) || state.escapeRoute.length > 0;
  const legalAtArrival = escaping ? state.legal : state.legal >> 1;
  const escape = escapeStep(state, legalAtArrival, flight.to, system.name, at, events);

  return {
    ...state,
    system: flight.to,
    market: generateMarket(system, fluct),
    rng,
    flight: null,
    encounter: null,
    combat: null,
    legal: escape.legal,
    escapeRoute: escape.route,
    escapeStatus: escape.status,
  };
}

/**
 * Конец патруля (§78): корабль возвращается на станцию.
 *
 * Причина всегда одна — топливо. Не «время вышло», не «игрок устал»:
 * бака хватает ровно на столько встреч, сколько в нём помещается.
 * Так «поставил и забыл» получает встроенный предел, и игрок никогда
 * не застревает в космосе пустым.
 */
/**
 * §82: досрочный выход из патруля по кнопке «Вернуться».
 *
 * `endPatrol` вызывается таймером топлива, а здесь игрок решает сам.
 * Разницы в результате нет: патруль заканчивается, корабль на станции.
 * Топливо не списывается — возврат бесплатный, станция рядом.
 */
export function returnFromPatrol(state: GameState, at: number): { state: GameState; events: GameEvent[] } {
  if (!state.flight?.patrol) return { state, events: [] };
  const events: GameEvent[] = [];
  const flight = state.flight;
  events.push({
    type: 'patrol-end',
    at,
    text: `Возврат с патруля: ${flight.encounters} ${plural(flight.encounters, 'встреча', 'встречи', 'встреч')}, израсходовано ${flight.patrolFuelUsed ?? 0} ед. топлива`,
  });
  return { state: { ...state, flight: null, encounter: null }, events };
}

function endPatrol(state: GameState, at: number, events: GameEvent[]): GameState {
  const flight = state.flight!;
  const used = flight.patrolFuelUsed ?? 0;
  events.push({
    type: 'patrol-end',
    at,
    text: `Патруль окончен: топливо на возврат. Израсходовано ${used} ед. за ${flight.encounters} ${plural(flight.encounters, 'встречу', 'встречи', 'встреч')}`,
  });
  return {
    ...state,
    // Бак не обнуляем: резерв на возврат потрачен «на дорогу», но это
    // отдельная строка. Показываем остаток честно.
    flight: null,
    encounter: null,
  };
}

/**
 * Досчитывает игру до момента now: появляются и исчезают встречи, идёт бой,
 * затем прибытие. Если бой ручной и ждёт игрока, досчёт останавливается.
 */
export function advance(
  state: GameState,
  now: number,
  settings: Settings = DEFAULT_SETTINGS,
): { state: GameState; events: GameEvent[] } {
  let s = state;
  const events: GameEvent[] = [];

  // Ручной бой ждёт игрока. Каждый вызов advance «закрывает» прошедший
  // отрезок ожидания и копит его в pausedMs, чтобы прибытие сдвинулось
  // ровно на время, когда игра действительно стояла на паузе.
  if (s.combat && !s.combat.combat.outcome && now > s.combat.pausedAt) {
    s = { ...s, combat: { ...s.combat, pausedAt: now, pausedMs: s.combat.pausedMs + (now - s.combat.pausedAt) } };
  }

  // Подбор из обломков тоже держит полёт: пока игрок решает, что взять,
  // время пути не идёт — иначе обломки «уедут» вместе с прибытием.
  if (s.salvage && now > s.salvage.pausedAt) {
    s = { ...s, salvage: { ...s.salvage, pausedAt: now, pausedMs: s.salvage.pausedMs + (now - s.salvage.pausedAt) } };
  }

  /*
   * Предел итераций — защита от вечного цикла, а не от длинного досчёта.
   *
   * §76 сделал встречи частыми: при encounterRate=100 и двух сутках
   * отсутствия событий набирается несколько тысяч. Старые 500 обрывали
   * досчёт до прибытия, и игрок возвращался «в пути» спустя сутки. Берём
   * запас на порядок, сохраняя защиту от зацикливания.
   */
  for (let guard = 0; guard < 20000; guard++) {
    if (s.combat || s.salvage || !s.flight) break;
    const f = s.flight;
    // Следующее событие полёта в реальном времени — по ТЕКУЩЕМУ темпу.
    // Так смена темпа действует на уже начатый полёт, но события посреди
    // интервала не теряются при досчёте одним вызовом.
    const tArrive = f.dueAt + baseToReal(f.remainingBaseMs, settings);
    const tEnc = s.encounter ? s.encounter.resolveAt : Infinity;
    const tSpawn = s.encounter ? Infinity : nextEncounterAt(f, f.dueAt, settings);
    const t = Math.min(tArrive, tEnc, tSpawn);
    if (t > now) break;
    /*
     * Событие не может случиться РАНЬШЕ, чем уже пройденный путь.
     *
     * Встреча, назначенная в момент, который досчёт уже прошёл (например,
     * пол, поставленный на середину короткого перелёта), подтягивает
     * `syncFlightToSpeed` к прошлому. Там `realMs` обрезается нулём, но
     * остаток пути уже уменьшен в предыдущем вызове — и полёт «теряет»
     * отрезок. Замер §76: прибытие наступало на 100 секунд раньше срока,
     * ровно по 20 секунд за событие. Досчитываем всё до момента `now`.
     */
    const tEvent = Math.max(t, f.dueAt);

    // Подводим полёт ровно к моменту события: начисляем прошедшие базовые
    // миллисекунды и заново выводим `arriveAt` из остатка.
    const advanced = syncFlightToSpeed(f, tEvent, settings);
    if (advanced !== f) s = { ...s, flight: advanced };

    if (s.encounter && tEnc <= tArrive) {
      /*
       * Точка отсчёта следующих встреч — момент ОБНАРУЖЕНИЯ этой.
       *
       * Он уже записан в `spawnEncounter`. Здесь ничего не трогаем: если
       * сдвигать отсчёт на момент разрешения, плотность падает вдвое-втрое —
       * следующая встреча ждёт, пока разберётся предыдущая. Именно так и
       * вышло в первом заходе §76: на ×1 получалось 3.8 встречи вместо 6.
       */
      /*
       * §95: ПИРАТ, ЛЕТЯЩИЙ МИМО, ТОЖЕ ИДЁТ В АВТОБОЙ.
       *
       * `outcome === 'leave'` значит «этот корабль сейчас не атакует». Для
       * торговца, полиции и охотника это и есть «ушёл»: драться не с кем.
       *
       * Но пират — законная цель: за него дают награду, и §86 уже сделал
       * его жёлтым именно потому, что он ПРЕСТУПНИК, а не мирный прохожий.
       * Раньше он уходил безнаказанно, а игрок не мог ничего сделать —
       * ни напасть вручную (кнопка была закрыта), ни получить награду.
       *
       * Поэтому невраждебный ПИРАТ проходит в `autoDecision`, где правило
       * простое: слабый — победа, сильный — пропуск. Торговец и власть
       * по-прежнему тихо уходят.
       */
      /*
       * §95: кто не «уходит бесследно», а попадает в автобой:
       *
       *   пират по роли                 — законная цель (§86: жёлтый);
       *   любой корабль в пиратстве     — режим «бью всех» (§79).
       *
       * Торговец и полиция в обычном патруле по-прежнему уходят: чистой
       * власть не грабит.
       */
      const piracyMode = s.flight?.patrol === true && isCriminal(s.legal);
      const goesToCombat = s.encounter.outcome === 'leave'
        && (s.encounter.role === 'pirate' || piracyMode);
      const outlawLeaving = goesToCombat;
      if (s.encounter.outcome === 'leave' && !outlawLeaving) {
        events.push({ type: 'vanished', at: tEnc, text: 'Корабль покинул радиус действия' });
        s = { ...s, encounter: null };
      } else {
        // §38.1: раундов нет. Игрок не решил за отведённое время —
        // слабый враждебный даёт победу, сильный или нейтральный пропуск.
        // Смерти нет, капсула не тратится (§40).
        s = autoDecision(s, tEnc, settings, events);
      }
    } else if (!s.encounter && tSpawn < tArrive) {
      /*
       * §78: топливо кончилось — патруль окончен, корабль возвращается.
       *
       * Проверка стоит ПЕРЕД появлением встречи, а не после: так игрок
       * никогда не окажется без топлива в бою. Нужен запас на саму встречу
       * и бой плюс резерв на дорогу домой.
       */
      if (s.flight?.patrol && s.fuel < PATROL_FUEL_PER_ENCOUNTER + PATROL_FUEL_PER_FIGHT + PATROL_RETURN_RESERVE) {
        s = endPatrol(s, tSpawn, events);
        break;
      }
      s = spawnEncounter(s, tSpawn, settings, events);
    } else {
      s = arrive(s, tArrive, events);
    }
  }

  // После разбора событий подтягиваем остаток полёта к текущему моменту —
  // именно здесь темп применяется к ещё не наступившему прибытию.
  // Условие `>=`: если темп сменили в тот же момент, когда полёт уже
  // синхронизирован, `arriveAt` всё равно надо пересчитать по-новому.
  if (s.flight && !s.combat && now >= s.flight.dueAt) {
    const synced = syncFlightToSpeed(s.flight, now, settings);
    // Ссылочное равенство сохраняем: холостой тик не должен менять состояние
    if (synced !== s.flight) s = { ...s, flight: synced };
  }
  return { state: s, events };
}

/** Действие игрока в ручном бою. */
export function combatAction(
  state: GameState,
  action: CombatAction,
  now: number,
  settings: Settings = DEFAULT_SETTINGS,
): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  if (!state.combat || state.combat.combat.outcome) return { state, events };
  if (!canDo(state.combat.combat, action)) return { state, events };
  const combat = combatRound(state.combat.combat, action);
  const s: GameState = { ...state, combat: { ...state.combat, combat } };
  // Бой продолжается: ход сам по себе паузу не удлиняет, её копит advance
  // по онлайн-тикам. Бой закончился: применяем итог.
  return { state: combat.outcome ? finishCombat(s, now, settings, events) : s, events };
}

/* ---------- Подбор груза из обломков ---------- */

/**
 * Отодвигает полёт на `realMs` реальных миллисекунд — «время на паузе не
 * считается».
 *
 * Как это работает. Истина о пути — пара `dueAt` + `remainingBaseMs`:
 * `dueAt` это момент, на который посчитан остаток. Досчёт берёт
 * `realMs = now − dueAt` и вычитает из остатка `realMs · темп`. Значит,
 * чтобы полёт не продвинулся за время паузы, достаточно сдвинуть `dueAt`
 * вперёд на длину паузы: тот же `now` окажется «раньше» на эту величину,
 * и вычтется меньше.
 *
 * `arriveAt` сдвигаем на ту же величину для согласованности — он
 * производный и пересчитается из остатка при следующем досчёте.
 *
 * `pending` (встречи) трогать не надо: они хранятся в базовой шкале и
 * отсчитываются от `dueAt`, поэтому сдвиг `dueAt` отодвигает и их —
 * ровно так же, как отодвигает прибытие.
 */
function shiftFlightBy(flight: Flight, realMs: number): Flight {
  return {
    ...flight,
    dueAt: flight.dueAt + realMs,
    arriveAt: flight.arriveAt + realMs,
  };
}

/**
 * Продлевает полёт на время, которое он простоял на паузе из-за подбора.
 *
 * Та же логика, что в `finishCombat` после боя: время, пока игрок решал,
 * не должно съедать путь. Без этого «подождал три минуты у обломков» =
 * «прилетел на три минуты раньше» — то есть выбор был бы не бесплатным,
 * а крадущим дорогу, и чем внимательнее игрок, тем хуже.
 */
function resumeAfterSalvage(state: GameState): GameState {
  const sv = state.salvage;
  const flight = state.flight;
  if (!sv || !flight || sv.pausedMs <= 0) return state;
  return { ...state, flight: shiftFlightBy(flight, sv.pausedMs) };
}

export type SalvageError = 'none' | 'no-room';

/**
 * Взять один контейнер из обломков по индексу.
 *
 * Если в трюме не хватает места, контейнер остаётся лежать: игрок может
 * сначала выбросить что-нибудь ненужное и вернуться к нему. Именно ради
 * этого выбор и ручной, а не автоматический, — в тесноте надо решать,
 * что дороже.
 */
export function salvageTake(
  state: GameState,
  index: number,
  at: number,
): { state: GameState; error: SalvageError } {
  const sv = state.salvage;
  if (!sv || index < 0 || index >= sv.canisters.length) return { state, error: 'none' };
  const canister = sv.canisters[index];
  const got = scoopOne(state.cargo, state.holdSpace, canister);
  if (!got) return { state, error: 'no-room' };
  const rest = sv.canisters.filter((_, i) => i !== index);
  const closed = rest.length === 0 ? resumeAfterSalvage(state) : state;
  const next: GameState = {
    ...closed,
    cargo: got.cargo,
    cargoOrigin: noteCargo(state.cargoOrigin, canister.commodity, canister.amount, 'salvage'),
    holdSpace: got.holdSpace,
    salvage: rest.length > 0 ? { ...sv, canisters: rest, taken: sv.taken + 1, pausedAt: at } : null,
    // Контейнер с контрабандой повышает правовой статус так же, как
    // покупка на рынке: за груз отвечает командир, а не продавец.
    legal: Math.min(255, state.legal + contrabandLevel(got.cargo) - contrabandLevel(state.cargo)),
  };
  return { state: next, error: 'none' };
}

/**
 * Взять всё, что влезает, и закрыть подбор.
 *
 * §93: здесь `autoScoop` НЕ годится. Он не берёт запрещёнку, потому что
 * создан для автоподбора без игрока. А эта кнопка — нажатие ИГРОКА на
 * экране обломков: он явно сказал «беру всё», и молча оставить рабов в
 * космосе было бы обманом. Поэтому здесь подбор полный, а статус растёт
 * честно — как при ручном «Взять».
 *
 * Если игрок не хочет криминала, он видит запрещённый товар в списке и
 * жмёт «Оставить».
 */
export function salvageTakeAll(state: GameState, at: number): { state: GameState; taken: number; left: number } {
  const sv = state.salvage;
  if (!sv) return { state, taken: 0, left: 0 };
  const got = scoopAll(state.cargo, state.holdSpace, sv.canisters);
  return {
    taken: got.taken,
    left: got.left,
    state: {
      ...resumeAfterSalvage(state),
      cargo: got.cargo,
      cargoOrigin: noteFromCanisters(state.cargoOrigin, sv.canisters),
      holdSpace: got.holdSpace,
      legal: Math.min(255, state.legal + contrabandLevel(got.cargo) - contrabandLevel(state.cargo)),
      salvage: null,
    },
  };
}

/** Закрыть подбор, ничего не взяв (или бросив остаток). */
export function salvageClose(state: GameState): GameState {
  if (!state.salvage) return state;
  return { ...resumeAfterSalvage(state), salvage: null };
}

/**
 * Выбросить товар из трюма, пока идёт подбор.
 *
 * В оригинале сброс груза — боевое действие (`dump`), которое иногда
 * отпугивает пирата. Здесь это ещё и способ освободить место под более
 * дорогой контейнер: трюм 20 тонн, а с Питона падает пять канистр.
 */
export function jettisonCargo(
  state: GameState,
  index: number,
  amount = 1,
): { state: GameState; dropped: number } {
  if (index < 0 || index >= state.cargo.length) return { state, dropped: 0 };
  const have = state.cargo[index];
  const drop = Math.min(have, Math.max(0, Math.floor(amount)));
  if (drop <= 0) return { state, dropped: 0 };
  const cargo = state.cargo.slice();
  cargo[index] -= drop;
  return {
    state: {
      ...state,
      cargo,
      cargoOrigin: reconcile(state.cargoOrigin, cargo),
      holdSpace: isTonneCargo(index) ? state.holdSpace + drop : state.holdSpace,
    },
    dropped: drop,
  };
}

/** Передать бой автопилоту: доигрывает до конца. */
export function combatAutoplay(
  state: GameState,
  now: number,
  settings: Settings = DEFAULT_SETTINGS,
): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  if (!state.combat) return { state, events };
  const combat = autoCombat(state.combat.combat);
  const s = finishCombat({ ...state, combat: { ...state.combat, combat } }, now, settings, events);
  return { state: s, events };
}

/* ---------- Сохранение ---------- */

/**
 * Сериализация состояния.
 *
 * §96: `Infinity` НЕ ВЫЖИВАЕТ `JSON.stringify` — он превращается в `null`.
 * А у патруля ровно два поля бесконечны:
 *
 *     flight.arriveAt        = Infinity   (патруль кончается топливом, не временем)
 *     flight.remainingBaseMs = Infinity
 *
 * После загрузки они становились `null`/`0`, и первый же тик считал полёт
 * завершённым: `advance` писал «Прибытие» и высаживал игрока на станцию.
 * То есть патруль не переживал сохранение — а сохраняется игра каждые
 * 10 секунд и при каждом событии.
 *
 * Решение: помечаем бесконечность явным маркером и восстанавливаем её при
 * чтении. Не `null` и не `-1`: путать «нет значения» с «бесконечно» нельзя,
 * это разные вещи, и `null` уже используется как «поля нет».
 */
const INF = 'Infinity';

export function serialize(state: GameState): string {
  return JSON.stringify(state, (_key, value) =>
    value === Number.POSITIVE_INFINITY ? INF : value,
  );
}

/** Загрузка с проверкой версии. Версия 1 (до боёв) дополняется значениями по умолчанию. */
export function deserialize(json: string): GameState {
  const data = JSON.parse(json) as Partial<GameState> & { version: number };
  if (data.version === 1) {
    const migrated = {
      ...newGame(data.rng ?? 1),
      ...data,
      version: SAVE_VERSION,
      ship: { ...STARTER_SHIP },
      kills: 0,
      legal: 0,
      encounter: null,
      combat: null,
      stats: { ...ZERO_STATS },
      cargoBasis: COMMODITIES.map(() => 0),
      escapeRoute: [],
      escapeStatus: -1,
    } as GameState;
    if (migrated.flight) migrated.flight = { ...migrated.flight, encounters: 0, lastEncounterAt: 0 };
    return migrated;
  }
  if (data.version !== SAVE_VERSION && data.version !== 2) {
    throw new Error(`Неподдерживаемая версия сохранения: ${data.version}`);
  }
  const state = data as GameState;
  // Совместимость: в сохранениях до §70 статистики ещё не было.
  // Без этого старый файл даст undefined там, где читается stats.kills.
  if (!state.stats) state.stats = { ...ZERO_STATS };
  if (!state.cargoBasis) state.cargoBasis = COMMODITIES.map(() => 0);
  /*
   * §102: модель корабля. В сохранениях до неё поля нет — все летали на
   * Кобре, поэтому именно она и подставляется. Без этого старый файл
   * падал бы на первом же `holdCapacity`.
   */
  if (!state.ship.model) state.ship.model = 'cobra3';
  /*
   * §89: время карьеры. В сохранениях до §89 поля нет — начинаем с нуля.
   * `careerAt` НЕ трогаем: сохранение обязано читаться обратно байт в байт
   * (это проверяют инварианты), а «точку отсчёта» сбрасывает UI при загрузке.
   */
  if (typeof state.careerMs !== 'number') state.careerMs = 0;
  /*
   * §96: восстановление бесконечностей патруля. `serialize` пишет их
   * строкой 'Infinity', потому что JSON не умеет бесконечность. Без
   * обратного преобразования патруль «прибывал» сразу после загрузки.
   */
  if (state.flight) {
    const f = state.flight as unknown as Record<string, unknown>;
    if (f.arriveAt === INF) f.arriveAt = Number.POSITIVE_INFINITY;
    if (f.remainingBaseMs === INF) f.remainingBaseMs = Number.POSITIVE_INFINITY;
  }
  /*
   * §98: манифест происхождения груза. В сохранениях до §98 поля нет —
   * начинаем с пустого. Старый трюм при этом остаётся как был: манифест
   * описывает только то, что произойдёт ПОСЛЕ загрузки, и ничего не теряет.
   */
  if (!Array.isArray(state.cargoOrigin)) state.cargoOrigin = [];
  // Совместимость с сохранениями до §73: поля обломков тогда не было.
  if (state.salvage === undefined) state.salvage = null;
  /*
   * Совместимость с сохранениями до §80: маршрута побега не было.
   * `escapeStatus: -1` — признак «маршрута нет»: побег начнётся заново.
   */
  if (!Array.isArray(state.escapeRoute)) state.escapeRoute = [];
  if (typeof state.escapeStatus !== 'number' || state.escapeStatus < 0) {
    state.escapeStatus = state.escapeRoute.length > 0 ? state.legal : -1;
  }
  /*
   * Совместимость с сохранениями до §76: у полёта был СПИСОК встреч
   * (`pending`), а не счётчик. Без этого `encounters` остаётся undefined и
   * первая же встреча превращается в NaN, «отравляя» полёт навсегда.
   * Считаем, что в старом полёте встреч ещё не было, и отсчитываем от его
   * начала.
   */
  if (state.flight && typeof state.flight.encounters !== 'number') {
    const f = state.flight;
    state.flight = {
      ...f,
      encounters: 0,
      lastEncounterAt: typeof f.departAt === 'number' ? f.departAt : Date.now(),
    };
  }
  // Совместимость с сохранениями, сделанными до появления накопленного простоя.
  if (state.combat && typeof state.combat.pausedMs !== 'number') {
    state.combat = { ...state.combat, pausedMs: 0 };
  }
  // Совместимость с сохранениями, где полёт хранил только абсолютный arriveAt
  // (до появления базовых миллисекунд — нужно для смены темпа на ходу).
  if (state.flight && typeof state.flight.remainingBaseMs !== 'number') {
    const f = state.flight;
    // Считаем, что на момент сохранения темп был базовым: восстанавливаем
    // остаток из разницы arriveAt и departAt, а встречи переводим в остаток
    // от текущего момента.
    const total = Math.max(0, f.arriveAt - f.departAt);
    state.flight = {
      ...f,
      remainingBaseMs: total,
      elapsedBaseMs: 0,
      dueAt: f.departAt,
      encounters: 0,
      lastEncounterAt: f.departAt,
    };
  }
  return state;
}
