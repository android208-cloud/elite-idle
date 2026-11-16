/**
 * Состояние игры и действия капитана. Все функции чистые: принимают состояние
 * и возвращают новое, ничего не изменяя. Это упрощает тесты и досчёт времени.
 *
 * Единицы как в оригинале: деньги в десятых долях кредита, топливо в десятых
 * долях светового года.
 */

import { autoCombat, canDo, combatRound, startCombat, type CombatAction, type CombatState } from './combat.ts';
import { autoScoop, canisterCount, rollCanisters, scoopOne, type CargoCanister } from './cargo-canisters.ts';
import { buildGalaxy, distance, GALACTIC_ARRIVAL, GALAXY_COUNT, nearestSystem, type StarSystem } from './galaxy.ts';
import {
  COMMODITIES,
  generateMarket,
  INDIVIDUAL_ITEM_LIMIT,
  isTonneCargo,
  type MarketEntry,
} from './market.ts';
import { nextByte, nextFloat } from './rng.ts';
import { autoResolve, availableDecisions, bestLaserOf, enemyOf } from './one-decision.ts';
import { loneHunter, pirateFromGroup } from './spawn.ts';
import {
  ENEMIES,
  enemyById,
  EQUIPMENT,
  equipmentAvailable,
  holdCapacity,
  HOLD_BASE,
  MAX_MISSILES,
  STARTER_SHIP,
  type EquipmentId,
  type PlayerShip,
} from './ships.ts';

export { nextByte } from './rng.ts';

export const SAVE_VERSION = 2;
export const MAX_FUEL = 70;
/** Цена топлива: 0.2 CR за световой год, т. е. 2 десятых кредита за десятую св. года */
export const FUEL_COST_PER_UNIT = 2;
export const START_SYSTEM_LAVE = 7;
export const START_CASH = 1000;
export const START_HOLD = HOLD_BASE;
/** Прибавка к правовому статусу за убийство полицейского */
export const POLICE_KILL_LEGAL = 64;
/** Доля денег, остающаяся после гибели при режиме «страховка» */
export const INSURANCE_CASH_KEPT = 0.75;

export interface Settings {
  /** Множитель скорости времени: 1 = базовый, 2 = вдвое быстрее и т. д. */
  speed: number;
  /** Базовая длительность одного прыжка в миллисекундах при speed = 1 */
  baseJumpMs: number;
  /** Автоматический бой или с вмешательством игрока */
  combatMode: 'auto' | 'manual';
  /** «Страховка»: потери при гибели. «Без смерти»: корабль только возвращается на станцию */
  deathMode: 'insurance' | 'none';
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
  baseJumpMs: 15 * 60 * 1000,
  combatMode: 'auto',
  deathMode: 'insurance',
  encounterTimeoutMs: 5 * 60 * 1000,
  encounterRate: 1,
  dockingModule: true,
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
   * Моменты встреч в «базовых» миллисекундах ОТ ВЫЛЕТА (`departAt`).
   *
   * Базовая шкала не зависит от текущего темпа: при его смене двигается
   * только `dueAt`/`arriveAt`, а встречи остаются на своих местах полёта
   * и потому наступают раньше или позже вместе с прибытием.
   */
  pending: number[];
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
};

export type GameEventType =
  | 'arrived'
  | 'detected'
  | 'vanished'
  | 'combat-start'
  | 'combat-end'
  | 'canister'
  | 'contraband'
  | 'death'
  | 'won'
  | 'skipped'
  | 'fled'
  | 'auto-victory'
  | 'auto-skip';

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
      return ship.missiles >= MAX_MISSILES;
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
    case 'pod':
      return ship.escapePod;
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
    case 'pod':
      ship.escapePod = true;
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

export type JumpError = 'in-flight' | 'same-system' | 'too-far' | 'bad-target';

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
  const reference = 7; // св. лет — «средний» прыжок
  const ratio = Math.max(distanceLy, 0.5) / reference;
  const scaled = settings.baseJumpMs * Math.pow(ratio, 0.6);
  // Не короче 40% базовой и не длиннее 4× базовой.
  const clamped = Math.min(Math.max(scaled, settings.baseJumpMs * 0.4), settings.baseJumpMs * 4);
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
 * Реальный момент следующей встречи полёта, либо Infinity.
 *
 * Встречи хранятся в базовой шкале от вылета, а игра живёт в реальном
 * времени, поэтому остаток базовых миллисекунд переводится по текущему темпу.
 */
export function nextEncounterAt(flight: Flight, settings: Settings): number {
  const elapsedBase = flight.elapsedBaseMs;
  for (const at of flight.pending) {
    if (at > elapsedBase) {
      // Сколько базовых миллисекунд осталось до встречи, переводим в реальные
      return flight.dueAt + baseToReal(at - elapsedBase, settings);
    }
  }
  return Infinity;
}

/**
 * Приводит полёт к текущему темпу: пересчитывает `arriveAt` из остатка
 * базового времени, сохраняя при этом уже прошедшую часть пути.
 *
 * Вызывается перед каждым досчётом, поэтому смена темпа действует сразу,
 * в том числе посреди полёта.
 */
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

/** Попыток встречи за прыжок и шанс каждой (до умножения на encounterRate) */
const ENCOUNTER_ATTEMPTS = 2;
const ENCOUNTER_CHANCE = 0.35;

/**
 * Начало прыжка: топливо списывается сразу, прибытие по таймеру.
 *
 * Здесь же применяется проверка контрабанды из TT110: взлёт со станции с
 * запрещённым грузом поднимает правовой статус (`FIST = FIST OR BAD`).
 */
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
  let rng = state.rng;
  const pending: number[] = [];
  for (let k = 0; k < ENCOUNTER_ATTEMPTS; k++) {
    const [roll, r1] = nextFloat(rng);
    const [when, r2] = nextFloat(r1);
    rng = r2;
    if (roll < ENCOUNTER_CHANCE * settings.encounterRate) {
      // Встречи — тоже в базовых миллисекундах от начала полёта
      pending.push(Math.round(baseDuration * (0.1 + 0.8 * when)));
    }
  }
  pending.sort((a, b) => a - b);

  return {
    state: {
      ...state,
      rng,
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
        pending,
      },
    },
  };
}

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
const HUNTER_CHANCE = 0.1;
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
  // Сработавшую встречу убираем из базовой шкалы
  const rest: Flight = {
    ...flight,
    pending: flight.pending.filter((at) => at > flight.elapsedBaseMs),
  };

  let r = dice.next();
  let role: EncounterRole;
  if (r < PIRATE_CHANCE[gov]) {
    role = 'pirate';
  } else if ((r -= PIRATE_CHANCE[gov]) < POLICE_CHANCE[gov]) {
    role = 'police';
  } else if ((r -= POLICE_CHANCE[gov]) < HUNTER_CHANCE) {
    role = 'hunter';
  } else if ((r -= HUNTER_CHANCE) < CANISTER_CHANCE) {
    // Дрейфующий контейнер: забирается только топливосборщиком
    const index = Math.floor(dice.next() * 16);
    const amount = 1 + Math.floor(dice.next() * 3);
    let next: GameState = { ...state, rng: dice.rng, flight: rest };
    let text = `Дрейфующий контейнер: ${COMMODITIES[index].name}. Топливосборщика нет, проходим мимо`;
    if (state.ship.fuelScoops) {
      const room = Math.min(amount, cargoRoom(state, index));
      if (room > 0) {
        const cargo = state.cargo.slice();
        cargo[index] += room;
        next = { ...next, cargo, holdSpace: isTonneCargo(index) ? state.holdSpace - room : state.holdSpace };
        text = `Подобран контейнер: ${COMMODITIES[index].name}, ${room}`;
      } else {
        text = `Дрейфующий контейнер: ${COMMODITIES[index].name}. В трюме нет места`;
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

  const duration = flight.arriveAt - flight.departAt;
  const resolveAt = hostile
    ? Math.round(at + duration * (0.02 + 0.06 * dice.next()))
    : at + settings.encounterTimeoutMs;

  const encounter: Encounter = {
    role,
    enemyId,
    detectedAt: at,
    resolveAt,
    outcome: hostile ? 'attack' : 'leave',
  };
  const shipName = enemyById(enemyId).name;
  events.push({
    type: 'detected',
    at,
    text: `В радиусе действия корабль: ${ROLE_NAMES[role]} (${shipName})`,
  });
  return { ...state, rng: dice.rng, flight: rest, encounter };
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
  const can = availableDecisions(enemy, bestLaserOf(lasers), state.ship.escapePod, hostile);
  const r = autoResolve(enemy, can, hostile);
  events.push({ type: r.outcome, at, text: r.text });
  // Статистика: победа считается убийством ровно так же, как и при
  // ручном решении, иначе журнал расходится с рангом.
  const won = r.outcome === 'won' || r.outcome === 'auto-victory';
  const skipped = r.outcome === 'skipped' || r.outcome === 'auto-skip';
  return {
    ...state,
    cash: state.cash + r.bounty,
    kills: state.kills + (won ? 1 : 0),
    stats: {
      ...state.stats,
      kills: state.stats.kills + (won ? 1 : 0),
      skipped: state.stats.skipped + (skipped ? 1 : 0),
    },
    encounter: null,
    combat: null,
  };
}

/** Начинает бой и, в автоматическом режиме, сразу доигрывает его. */
function beginCombat(state: GameState, at: number, settings: Settings, events: GameEvent[]): GameState {
  const enc = state.encounter!;
  const combat = startCombat(enc.enemyId, state.ship, settings.deathMode === 'insurance', cargoTons(state), state.rng);
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
    s = { ...s, cargo: s.cargo.map(() => 0), holdSpace: holdCapacity(s.ship) };
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
          // Автоподбор: берём всё, что влезает, остальное остаётся в космосе.
          const got = autoScoop(next.cargo, next.holdSpace, leftovers);
          next = { ...next, cargo: got.cargo, holdSpace: got.holdSpace };
          if (got.taken > 0) {
            text += `. Подобрано контейнеров: ${got.taken}`;
          }
          if (got.left > 0) text += `, ${got.left} не поместилось`;
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
    case 'pod': {
      const fresh: PlayerShip = { ...STARTER_SHIP };
      const next = returnToStation({
        ...s,
        ship: fresh,
        cargo: s.cargo.map(() => 0),
        holdSpace: holdCapacity(fresh),
      });
      events.push({
        type: 'death',
        at,
        text: 'Капсула доставила вас на станцию вылета. Корабль, груз и оборудование потеряны',
      });
      return next;
    }
    default: {
      // гибель корабля
      if (settings.deathMode === 'insurance') {
        const next = returnToStation({
          ...s,
          cargo: s.cargo.map(() => 0),
          holdSpace: holdCapacity(s.ship),
          cash: Math.floor(s.cash * INSURANCE_CASH_KEPT),
        });
        events.push({
          type: 'death',
          at,
          text: 'Корабль уничтожен. Страховка вернула вас на станцию вылета, груз и часть денег потеряны',
        });
        return next;
      }
      events.push({
        type: 'death',
        at,
        text: 'Корабль серьёзно повреждён и отбуксирован на станцию вылета. Ничего не потеряно',
      });
      return returnToStation(s);
    }
  }
}

/** Прибытие в систему: обновляется рынок со случайным колебанием. */
function arrive(state: GameState, at: number, events: GameEvent[]): GameState {
  const flight = state.flight!;
  const system = systemsOf(state.galaxy)[flight.to];
  const [fluct, rng] = nextByte(state.rng);
  if (state.encounter) events.push({ type: 'vanished', at, text: 'Корабль остался позади' });
  events.push({ type: 'arrived', at, system: flight.to, name: system.name, text: `Прибытие: ${system.name}` });
  return {
    ...state,
    system: flight.to,
    market: generateMarket(system, fluct),
    rng,
    flight: null,
    encounter: null,
    combat: null,
    legal: state.legal >> 1,
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

  for (let guard = 0; guard < 500; guard++) {
    if (s.combat || s.salvage || !s.flight) break;
    const f = s.flight;
    // Следующее событие полёта в реальном времени — по ТЕКУЩЕМУ темпу.
    // Так смена темпа действует на уже начатый полёт, но события посреди
    // интервала не теряются при досчёте одним вызовом.
    const tArrive = f.dueAt + baseToReal(f.remainingBaseMs, settings);
    const tEnc = s.encounter ? s.encounter.resolveAt : Infinity;
    const tSpawn = s.encounter ? Infinity : nextEncounterAt(f, settings);
    const t = Math.min(tArrive, tEnc, tSpawn);
    if (t > now) break;

    // Подводим полёт ровно к моменту события: начисляем прошедшие базовые
    // миллисекунды и заново выводим `arriveAt` из остатка.
    const advanced = syncFlightToSpeed(f, t, settings);
    if (advanced !== f) s = { ...s, flight: advanced };

    if (s.encounter && tEnc <= tArrive) {
      if (s.encounter.outcome === 'leave') {
        events.push({ type: 'vanished', at: tEnc, text: 'Корабль покинул радиус действия' });
        s = { ...s, encounter: null };
      } else {
        // §38.1: раундов нет. Игрок не решил за отведённое время —
        // слабый враждебный даёт победу, сильный или нейтральный пропуск.
        // Смерти нет, капсула не тратится (§40).
        s = autoDecision(s, tEnc, settings, events);
      }
    } else if (!s.encounter && tSpawn < tArrive) {
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
    holdSpace: got.holdSpace,
    salvage: rest.length > 0 ? { ...sv, canisters: rest, taken: sv.taken + 1, pausedAt: at } : null,
    // Контейнер с контрабандой повышает правовой статус так же, как
    // покупка на рынке: за груз отвечает командир, а не продавец.
    legal: Math.min(255, state.legal + contrabandLevel(got.cargo) - contrabandLevel(state.cargo)),
  };
  return { state: next, error: 'none' };
}

/** Взять всё, что влезает, и закрыть подбор. */
export function salvageTakeAll(state: GameState, at: number): { state: GameState; taken: number; left: number } {
  const sv = state.salvage;
  if (!sv) return { state, taken: 0, left: 0 };
  const got = autoScoop(state.cargo, state.holdSpace, sv.canisters);
  return {
    taken: got.taken,
    left: got.left,
    state: {
      ...resumeAfterSalvage(state),
      cargo: got.cargo,
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

export function serialize(state: GameState): string {
  return JSON.stringify(state);
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
    } as GameState;
    if (migrated.flight) migrated.flight = { ...migrated.flight, pending: [] };
    return migrated;
  }
  if (data.version !== SAVE_VERSION) throw new Error(`Неподдерживаемая версия сохранения: ${data.version}`);
  const state = data as GameState;
  // Совместимость: в сохранениях до §70 статистики ещё не было.
  // Без этого старый файл даст undefined там, где читается stats.kills.
  if (!state.stats) state.stats = { ...ZERO_STATS };
  if (!state.cargoBasis) state.cargoBasis = COMMODITIES.map(() => 0);
  // Совместимость с сохранениями до §73: поля обломков тогда не было.
  if (state.salvage === undefined) state.salvage = null;
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
      pending: f.pending.map((t) => Math.max(0, t - f.departAt)),
    };
  }
  return state;
}
