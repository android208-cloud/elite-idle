/**
 * Генерация галактики по алгоритму оригинальной Elite (Ян Белл, Дэвид Брабен).
 * Все числа 16-битные без знака, как в оригинале.
 */

export interface Seed {
  w0: number;
  w1: number;
  w2: number;
}

export interface StarSystem {
  /** Номер системы в галактике, 0..255 */
  index: number;
  name: string;
  x: number;
  y: number;
  /** 0..7, индекс в ECONOMIES */
  economy: number;
  /** 0..7, индекс в GOVERNMENTS */
  government: number;
  /** Технологический уровень (в игре отображается +1) */
  techLevel: number;
  population: number;
  productivity: number;
  radius: number;
  /** Зерно для генерации описания системы */
  descriptionSeed: [number, number, number, number];
}

export const GALAXY_SIZE = 256;
export const GALAXY_COUNT = 8;

/** Начальное зерно первой галактики. */
export const BASE_SEED: Readonly<Seed> = { w0: 0x5a4a, w1: 0x0248, w2: 0xb753 };

/** 32 пары букв для названий систем. Точки при сборке имени отбрасываются. */
const PAIRS = '..LEXEGEZACEBISOUSESARMAINDIREA.ERATENBERALAVETIEDORQUANTEISRION';

export const ECONOMIES = [
  'Богатая промышленная',
  'Средняя промышленная',
  'Бедная промышленная',
  'Преимущественно промышленная',
  'Преимущественно аграрная',
  'Богатая аграрная',
  'Средняя аграрная',
  'Бедная аграрная',
] as const;

export const GOVERNMENTS = [
  'Анархия',
  'Феодализм',
  'Многопартийное',
  'Диктатура',
  'Коммунистическое',
  'Конфедерация',
  'Демократия',
  'Корпоративное государство',
] as const;

const mask16 = (n: number): number => n & 0xffff;

/** Циклический сдвиг байта влево на 1 бит. */
function rotateLeft8(x: number): number {
  return (x & 128) !== 0 ? 2 * (x & 127) + 1 : 2 * x;
}

/** Применяется к 16-битному слову: каждый байт сдвигается циклически влево. */
function twist(x: number): number {
  return mask16(256 * rotateLeft8(x >> 8) + rotateLeft8(x & 255));
}

/** Переход к зерну следующей галактики. */
export function nextGalaxySeed(seed: Seed): Seed {
  return { w0: twist(seed.w0), w1: twist(seed.w1), w2: twist(seed.w2) };
}

/** Зерно галактики с номером 1..8. */
export function galaxySeed(galaxyNumber: number): Seed {
  if (!Number.isInteger(galaxyNumber) || galaxyNumber < 1 || galaxyNumber > GALAXY_COUNT) {
    throw new RangeError(`Номер галактики должен быть от 1 до ${GALAXY_COUNT}`);
  }
  let seed: Seed = { ...BASE_SEED };
  for (let i = 1; i < galaxyNumber; i++) seed = nextGalaxySeed(seed);
  return seed;
}

/** Один шаг генератора зерна: изменяет seed на месте. */
function tweakSeed(seed: Seed): void {
  const temp = mask16(seed.w0 + seed.w1 + seed.w2);
  seed.w0 = seed.w1;
  seed.w1 = seed.w2;
  seed.w2 = temp;
}

/** Создаёт систему по текущему зерну и продвигает зерно к следующей системе. */
function makeSystem(seed: Seed, index: number): StarSystem {
  const longName = (seed.w0 & 64) !== 0;

  const x = seed.w1 >> 8;
  const y = seed.w0 >> 8;
  const government = (seed.w1 >> 3) & 7;
  let economy = (seed.w0 >> 8) & 7;
  if (government <= 1) economy |= 2;

  let techLevel = ((seed.w1 >> 8) & 3) + (economy ^ 7);
  techLevel += government >> 1;
  if ((government & 1) === 1) techLevel += 1;

  let population = 4 * techLevel + economy;
  population += government;
  population += 1;

  let productivity = ((economy ^ 7) + 3) * (government + 4);
  productivity *= population * 8;

  const radius = 256 * (((seed.w2 >> 8) & 15) + 11) + x;

  const descriptionSeed: [number, number, number, number] = [
    seed.w1 & 0xff,
    seed.w1 >> 8,
    seed.w2 & 0xff,
    seed.w2 >> 8,
  ];

  const pairs: number[] = [];
  for (let i = 0; i < 4; i++) {
    pairs.push(2 * ((seed.w2 >> 8) & 31));
    tweakSeed(seed);
  }

  const used = longName ? 4 : 3;
  let name = '';
  for (let i = 0; i < used; i++) {
    name += PAIRS[pairs[i]] + PAIRS[pairs[i] + 1];
  }
  name = name.replaceAll('.', '');

  return {
    index,
    name,
    x,
    y,
    economy,
    government,
    techLevel,
    population,
    productivity,
    radius,
    descriptionSeed,
  };
}

/** Строит все 256 систем указанной галактики (1..8). */
export function buildGalaxy(galaxyNumber: number): StarSystem[] {
  const seed = galaxySeed(galaxyNumber);
  const systems: StarSystem[] = [];
  for (let i = 0; i < GALAXY_SIZE; i++) systems.push(makeSystem(seed, i));
  return systems;
}

/** Расстояние между системами в десятых долях светового года (как в оригинале). */
export function distance(a: StarSystem, b: StarSystem): number {
  const dx = a.x - b.x;
  const dy = (a.y - b.y) / 2;
  return Math.floor(4 * Math.sqrt(dx * dx + dy * dy));
}

