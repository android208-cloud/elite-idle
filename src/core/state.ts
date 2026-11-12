/**
 * Состояние игры и действия капитана. Все функции чистые: принимают состояние
 * и возвращают новое, ничего не изменяя. Это упрощает тесты и досчёт времени.
 *
 * Единицы как в оригинале: деньги в десятых долях кредита, топливо в десятых
 * долях светового года.
 */

import { autoCombat, canDo, combatRound, startCombat, type CombatAction, type CombatState } from './combat.ts';
import { buildGalaxy, distance, type StarSystem } from './galaxy.ts';
import { COMMODITIES, generateMarket, type MarketEntry } from './market.ts';
import { nextByte, nextFloat } from './rng.ts';
import {
  ENEMIES,
  enemyById,
  EQUIPMENT,
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
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  speed: 1,
  baseJumpMs: 15 * 60 * 1000,
  combatMode: 'auto',
  deathMode: 'insurance',
  encounterTimeoutMs: 5 * 60 * 1000,
  encounterRate: 1,
};

export interface Flight {
  from: number;
  to: number;
  departAt: number;
  arriveAt: number;
  fuelUsed: number;
  /** Моменты появления встреч по ходу полёта, по возрастанию */
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
  /** Когда полёт был поставлен на паузу */
  pausedAt: number;
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
}

export type GameEventType =
  | 'arrived'
  | 'detected'
  | 'vanished'
  | 'combat-start'
  | 'combat-end'
  | 'canister'
  | 'death';

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
  };
}

export function currentSystem(state: GameState): StarSystem {
  return systemsOf(state.galaxy)[state.system];
}

export function cargoTons(state: GameState): number {
  return COMMODITIES.reduce((sum, c, i) => sum + (c.unit === 0 ? state.cargo[i] : 0), 0);
}

export interface TradeResult {
  state: GameState;
  /** Сколько единиц реально куплено или продано */
  amount: number;
}

const isTonnes = (index: number): boolean => COMMODITIES[index].unit === 0;

/** Покупка: не больше, чем есть на рынке, влезает в трюм и хватает денег. */
export function buy(state: GameState, index: number, amount: number): TradeResult {
  if (state.flight || amount <= 0) return { state, amount: 0 };
  const entry = state.market[index];
  let t = Math.min(entry.quantity, Math.floor(amount));
  if (isTonnes(index)) t = Math.min(state.holdSpace, t);
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
      holdSpace: isTonnes(index) ? state.holdSpace - t : state.holdSpace,
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
      holdSpace: isTonnes(index) ? state.holdSpace + t : state.holdSpace,
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
  if (currentSystem(state).techLevel + 1 < item.minTech) return { state, error: 'tech' };
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

/* ---------- Прыжок ---------- */

export type JumpError = 'in-flight' | 'same-system' | 'too-far' | 'bad-target';

export interface JumpResult {
  state: GameState;
  error?: JumpError;
}

/** Длительность прыжка в миллисекундах с учётом настроек темпа. */
export function jumpDuration(settings: Settings): number {
  return Math.max(0, Math.round(settings.baseJumpMs / Math.max(settings.speed, 0.0001)));
}

/** Попыток встречи за прыжок и шанс каждой (до умножения на encounterRate) */
const ENCOUNTER_ATTEMPTS = 2;
const ENCOUNTER_CHANCE = 0.35;

/** Начало прыжка: топливо списывается сразу, прибытие по таймеру. */
export function startJump(state: GameState, target: number, now: number, settings: Settings): JumpResult {
  if (state.flight) return { state, error: 'in-flight' };
  const systems = systemsOf(state.galaxy);
  if (!Number.isInteger(target) || target < 0 || target >= systems.length) return { state, error: 'bad-target' };
  if (target === state.system) return { state, error: 'same-system' };
  const d = distance(systems[state.system], systems[target]);
  if (d > state.fuel) return { state, error: 'too-far' };

  const duration = jumpDuration(settings);
  let rng = state.rng;
  const pending: number[] = [];
  for (let k = 0; k < ENCOUNTER_ATTEMPTS; k++) {
    const [roll, r1] = nextFloat(rng);
    const [when, r2] = nextFloat(r1);
    rng = r2;
    if (roll < ENCOUNTER_CHANCE * settings.encounterRate) {
      pending.push(Math.round(now + duration * (0.1 + 0.8 * when)));
    }
  }
  pending.sort((a, b) => a - b);

  return {
    state: {
      ...state,
      rng,
      fuel: state.fuel - d,
      flight: { from: state.system, to: target, departAt: now, arriveAt: now + duration, fuelUsed: d, pending },
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
  const pool = ENEMIES.filter((e) => e.pirate && e.minKills <= kills);
  // чаще попадаются более слабые корабли из доступных
  const weak = pool.slice(0, Math.max(1, Math.ceil(pool.length * (0.4 + 0.6 * dice.next()))));
  return dice.pick(weak).id;
}

function spawnEncounter(state: GameState, at: number, settings: Settings, events: GameEvent[]): GameState {
  const flight = state.flight!;
  const dice = new Dice(state.rng);
  const gov = systemsOf(state.galaxy)[flight.to].government;
  const rest: Flight = { ...flight, pending: flight.pending.slice(1) };

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
      const room = isTonnes(index) ? Math.min(amount, state.holdSpace) : amount;
      if (room > 0) {
        const cargo = state.cargo.slice();
        cargo[index] += room;
        next = { ...next, cargo, holdSpace: isTonnes(index) ? state.holdSpace - room : state.holdSpace };
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

  const enemyId = role === 'police' ? 'viper' : role === 'trader' ? 'cobra3' : pickPirate(state.kills, dice);
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

/** Начинает бой и, в автоматическом режиме, сразу доигрывает его. */
function beginCombat(state: GameState, at: number, settings: Settings, events: GameEvent[]): GameState {
  const enc = state.encounter!;
  const combat = startCombat(enc.enemyId, state.ship, settings.deathMode === 'insurance', cargoTons(state), state.rng);
  const startText =
    enc.role === 'police' ? 'Полиция требует остановиться и открывает огонь' : `${ROLE_NAMES[enc.role]} атакует`;
  const next: GameState = {
    ...state,
    encounter: null,
    combat: { combat, role: enc.role, pausedAt: at },
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
function finishCombat(state: GameState, endAt: number, settings: Settings, events: GameEvent[]): GameState {
  const active = state.combat!;
  const c = active.combat;
  const enemy = enemyById(c.enemyId);
  const flight = state.flight;
  let s: GameState = { ...state, rng: c.rng, combat: null, encounter: null };

  // расход ресурсов в бою
  s = {
    ...s,
    ship: { ...s.ship, missiles: c.playerMissiles, energyBomb: s.ship.energyBomb && !c.bombUsed },
  };

  if (c.cargoDumped) {
    s = { ...s, cargo: s.cargo.map(() => 0), holdSpace: holdCapacity(s.ship) };
  }

  /** Полёт продолжается: время боя добавляется к прибытию и ожидающим встречам. */
  const resume = (st: GameState): GameState => {
    if (!st.flight) return st;
    const shift = Math.max(0, endAt - active.pausedAt);
    return {
      ...st,
      flight: {
        ...st.flight,
        arriveAt: st.flight.arriveAt + shift,
        pending: st.flight.pending.map((t) => t + shift),
      },
    };
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
    events.push({ type: 'combat-end', at: endAt, text });
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
      const dice = new Dice(next.rng);
      if (next.ship.fuelScoops && dice.next() < 0.5) {
        const index = Math.floor(dice.next() * 16);
        const amount = 1 + Math.floor(dice.next() * 2);
        const room = isTonnes(index) ? Math.min(amount, next.holdSpace) : amount;
        if (room > 0) {
          const cargo = next.cargo.slice();
          cargo[index] += room;
          next = { ...next, cargo, holdSpace: isTonnes(index) ? next.holdSpace - room : next.holdSpace };
          text += `. Подобран груз: ${COMMODITIES[index].name}, ${room}`;
        }
      }
      next = { ...next, rng: dice.rng };
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
        at: endAt,
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
          at: endAt,
          text: 'Корабль уничтожен. Страховка вернула вас на станцию вылета, груз и часть денег потеряны',
        });
        return next;
      }
      events.push({
        type: 'death',
        at: endAt,
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

  for (let guard = 0; guard < 500; guard++) {
    if (s.combat || !s.flight) break;
    const f = s.flight;
    const tArrive = f.arriveAt;
    const tEnc = s.encounter ? s.encounter.resolveAt : Infinity;
    const tSpawn = s.encounter ? Infinity : (f.pending[0] ?? Infinity);
    const t = Math.min(tArrive, tEnc, tSpawn);
    if (t > now) break;

    if (s.encounter && tEnc <= tArrive) {
      if (s.encounter.outcome === 'leave') {
        events.push({ type: 'vanished', at: tEnc, text: 'Корабль покинул радиус действия' });
        s = { ...s, encounter: null };
      } else {
        s = beginCombat(s, tEnc, settings, events);
      }
    } else if (!s.encounter && tSpawn < tArrive) {
      s = spawnEncounter(s, tSpawn, settings, events);
    } else {
      s = arrive(s, tArrive, events);
    }
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
  let s: GameState = { ...state, combat: { ...state.combat, combat } };
  if (combat.outcome) s = finishCombat(s, now, settings, events);
  return { state: s, events };
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
    } as GameState;
    if (migrated.flight) migrated.flight = { ...migrated.flight, pending: [] };
    return migrated;
  }
  if (data.version !== SAVE_VERSION) throw new Error(`Неподдерживаемая версия сохранения: ${data.version}`);
  return data as GameState;
}
