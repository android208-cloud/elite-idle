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
  /** Может ли встречаться как пират */
  pirate: boolean;
  /** Доля энергии, ниже которой противник может бежать */
  fleeBelow: number;
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
  { id: 'sidewinder',  name: 'Sidewinder',    energy: 70,  laser: 8,  missiles: 0, bounty: 50,  minKills: 0,   pirate: true,  fleeBelow: 0.3  },
  { id: 'gecko',       name: 'Gecko',         energy: 70,  laser: 8,  missiles: 0, bounty: 55,  minKills: 0,   pirate: true,  fleeBelow: 0.3  },
  { id: 'adder',       name: 'Adder',         energy: 85,  laser: 8,  missiles: 0, bounty: 40,  minKills: 4,   pirate: true,  fleeBelow: 0.25 },
  { id: 'cobra1',      name: 'Cobra Mk I',    energy: 90,  laser: 9,  missiles: 2, bounty: 75,  minKills: 4,   pirate: true,  fleeBelow: 0.25 },
  { id: 'mamba',       name: 'Mamba',         energy: 90,  laser: 9,  missiles: 2, bounty: 150, minKills: 16,  pirate: true,  fleeBelow: 0.2  },
  { id: 'krait',       name: 'Krait',         energy: 80,  laser: 8,  missiles: 0, bounty: 100, minKills: 16,  pirate: true,  fleeBelow: 0.2  },
  { id: 'moray',       name: 'Moray',         energy: 100, laser: 8,  missiles: 0, bounty: 50,  minKills: 24,  pirate: true,  fleeBelow: 0.2  },
  { id: 'cobra3',      name: 'Cobra Mk III',  energy: 150, laser: 9,  missiles: 2, bounty: 175, minKills: 44,  pirate: true,  fleeBelow: 0.15 },
  { id: 'asp',         name: 'Asp Mk II',     energy: 150, laser: 20, missiles: 1, bounty: 200, minKills: 44,  pirate: true,  fleeBelow: 0.15 },
  { id: 'ferdelance',  name: 'Fer-de-Lance',  energy: 160, laser: 9,  missiles: 2, bounty: 0,   minKills: 130, pirate: true,  fleeBelow: 0.1  },
  { id: 'python',      name: 'Python',        energy: 250, laser: 13, missiles: 3, bounty: 200, minKills: 130, pirate: true,  fleeBelow: 0.1  },
  { id: 'anaconda',    name: 'Anaconda',      energy: 252, laser: 31, missiles: 7, bounty: 0,   minKills: 512, pirate: true,  fleeBelow: 0.1  },
  { id: 'viper',       name: 'Viper',         energy: 120, laser: 8,  missiles: 1, bounty: 0,   minKills: 0,   pirate: false, fleeBelow: 0    },
] as const;

export function enemyById(id: string): EnemyType {
  const e = ENEMIES.find((x) => x.id === id);
  if (!e) throw new Error(`Неизвестный корабль: ${id}`);
  return e;
}

export interface PlayerShip {
  laser: LaserType;
  missiles: number;
  ecm: boolean;
  energyBomb: boolean;
  escapePod: boolean;
  energyUnit: boolean;
  fuelScoops: boolean;
  dockingComputer: boolean;
  galacticHyperdrive: boolean;
  cargoBayExtended: boolean;
}

/** Cobra Mk III с завода: один импульсный лазер и три ракеты. */
export const STARTER_SHIP: Readonly<PlayerShip> = {
  laser: 'pulse',
  missiles: 3,
  ecm: false,
  energyBomb: false,
  escapePod: false,
  energyUnit: false,
  fuelScoops: false,
  dockingComputer: false,
  galacticHyperdrive: false,
  cargoBayExtended: false,
};

export const MAX_MISSILES = 4;
export const HOLD_BASE = 20;
export const HOLD_EXTENDED = 35;

export const holdCapacity = (ship: PlayerShip): number => (ship.cargoBayExtended ? HOLD_EXTENDED : HOLD_BASE);

export type EquipmentId =
  | 'missile'
  | 'cargoBay'
  | 'ecm'
  | 'pulse'
  | 'beam'
  | 'scoops'
  | 'pod'
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
  /** Минимальный технологический уровень системы (в игровой нумерации, от 1) */
  minTech: number;
}

export const EQUIPMENT: readonly EquipmentItem[] = [
  { id: 'missile', name: 'Ракета', price: 300, minTech: 2 },
  { id: 'cargoBay', name: 'Увеличенный трюм (35 т)', price: 4000, minTech: 1 },
  { id: 'ecm', name: 'ECM (РЭБ)', price: 6000, minTech: 2 },
  { id: 'pulse', name: 'Импульсный лазер', price: 4000, minTech: 3 },
  { id: 'beam', name: 'Лучевой лазер', price: 10000, minTech: 4 },
  { id: 'scoops', name: 'Топливосборщик', price: 5250, minTech: 5 },
  { id: 'pod', name: 'Спасательная капсула', price: 10000, minTech: 6 },
  { id: 'bomb', name: 'Энергобомба', price: 9000, minTech: 7 },
  { id: 'energyUnit', name: 'Доп. энергоблок', price: 15000, minTech: 8 },
  { id: 'dockingComputer', name: 'Стыковочный компьютер', price: 10000, minTech: 9 },
  { id: 'galacticHyperdrive', name: 'Галактический гипердвигатель', price: 50000, minTech: 10 },
  { id: 'military', name: 'Военный лазер', price: 60000, minTech: 10 },
  { id: 'mining', name: 'Добывающий лазер', price: 8000, minTech: 10 },
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

