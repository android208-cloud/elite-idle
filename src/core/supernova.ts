/**
 * §133.6: СЕКРЕТНАЯ МИССИЯ «СВЕРХНОВАЯ».
 *
 * Единственная миссия оригинальной Elite, которая приходит сама, а не висит на
 * доске. Пользователь собрал условия по версии для ZX Spectrum, и мы переносим
 * их почти дословно — с одной поправкой на то, что в нашей игре смертей нет.
 *
 * ЧТО В ОРИГИНАЛЕ:
 *   1. покинуть первую галактику и сделать больше 32 гиперпрыжков;
 *   2. следующий прыжок кончается красным экраном и «FUEL LEAK»;
 *   3. на станции предлагают спасти беженцев — при попытке купить товар;
 *   4. согласился — прыгай, иначе сверхновая настигнет;
 *   5. награда — 100 г драгоценных камней.
 *
 * ЧТО РЕШИЛ ПОЛЬЗОВАТЕЛЬ (2026-11-13, обсуждение перед кодом):
 *   * галактический гипердвигатель — обязательное условие старта. Он же
 *     гарантирует выход из тупика: идл-игра не имеет права ставить игрока в
 *     положение, где ждать нечего, а топливо уже вытекло;
 *   * на станции беженцев заправиться нельзя. Иначе миссия решается за 14 CR;
 *   * ранг «Опасный» (512 убийств) — дополнительное условие, но прогресс
 *     показываем только когда выполнены первые два: иначе это спойлер;
 *   * двигатель цел, если остатка топлива хватает на обычный прыжок; если не
 *     хватает (в том числе при нуле) — сгорает.
 *
 * ПОЧЕМУ ЭТО РАБОТАЕТ БЕЗ ИСКУССТВЕННЫХ ТАЙМЕРОВ: бак Кобры — 7.0 св. г., а
 * прыжок стоит ровно расстояние. То есть с полного бака два дальних прыжка не
 * сделать никогда, и «долететь и ещё иметь на чём уйти» — уже задача.
 */
import { GALAXY_COUNT } from './galaxy.ts';
import { holdCapacity } from './ships.ts';
import type { GameEvent, GameState, Settings } from './state.ts';

/** Сколько прыжков карьеры нужно, чтобы событие стало возможно. */
export const SUPERNOVA_TRIGGER_JUMPS = 32;
/** Ранг «Опасный» — 512 уничтоженных кораблей (см. RANKS в `ships.ts`). */
export const SUPERNOVA_TRIGGER_KILLS = 512;
/** Утечка: 2.0 св. г. за игровой час, в тех же десятых, что и `state.fuel`. */
export const SUPERNOVA_LEAK_PER_HOUR = 20;
/** Через сколько игровых часов взрывается звезда. */
export const SUPERNOVA_HOURS = 3;
/** Как часто в журнал падает сигнал бедствия (20 игровых минут). */
export const SUPERNOVA_MAYDAY_HOURS = 1 / 3;
/** Награда: 100 г драгоценных камней — ровно как в оригинале. */
export const SUPERNOVA_REWARD_GEMS = 100;
/** После провала событие не возвращается раньше, чем через 6 игровых часов. */
export const SUPERNOVA_COOLDOWN_HOURS = 6;
/** Индекс «Драгоценных камней» в таблице товаров (не занимают трюм). */
export const GEMS_INDEX = 15;

const HOUR_MS = 3_600_000;
const speedOf = (settings: Settings): number => Math.max(1, settings.speed || 1);
const gameHourMs = (settings: Settings): number => HOUR_MS / speedOf(settings);

export interface Supernova {
  /** Галактика и система, где горит звезда. */
  galaxy: number;
  system: number;
  /** Момент начала события и момент взрыва — реальное время, мс. */
  startedAt: number;
  at: number;
  /** До какого момента утечка уже списана (чтобы не брать дважды). */
  leakedTo: number;
  /** Когда ждать следующий сигнал бедствия. */
  maydayAt: number;
  /** Сколько сигналов уже передано — для текста, а не для логики. */
  maydays: number;
  /**
   * Событие окончено, но беженцы ещё на борту.
   *
   * Так их судьба не теряется при прыжке: утечка встала, станция обречена, а
   * награда ждёт первой стыковки. Флаг живёт, пока беженцев не высадят.
   */
  escaped: boolean;
  /** Беженцы на борту: трюм занят целиком, груза нет. */
  refugees: boolean;
}

export type SupernovaError = 'none' | 'not-here' | 'no-station' | 'already' | 'missions';

export const supernovaOf = (state: GameState): Supernova | null => state.supernova ?? null;

/** Ключ погибшей станции: система одна и та же в разных галактиках — разные места. */
export const stationKey = (galaxy: number, system: number): string => `${galaxy}:${system}`;

/** Станция в системе ещё существует? Погибшая не возвращается никогда. */
export function stationAlive(state: GameState, system = state.system): boolean {
  return !(state.destroyedStations ?? []).includes(stationKey(state.galaxy, system));
}

/**
 * Станция закрыта для дел: идёт событие, и мы стоим именно там.
 *
 * Пользователь: «не позволить заправиться на станции (доступен только рынок с
 * беженцами)». Поэтому во время события здесь недоступны ни топливо, ни товар,
 * ни оборудование, ни верфь, ни доска контрактов — только беженцы и прыжок.
 */
export function stationLocked(state: GameState): boolean {
  const sn = supernovaOf(state);
  if (!sn || sn.escaped) return false;
  return sn.galaxy === state.galaxy && sn.system === state.system;
}

/**
 * Условия включения. Все четыре обязательны, и порядок проверки — от самого
 * дешёвого к самому дорогому.
 */
export function supernovaArmed(state: GameState): boolean {
  if (state.galaxy === 1) return false;
  if (state.stats.jumps <= SUPERNOVA_TRIGGER_JUMPS) return false;
  if (state.kills < SUPERNOVA_TRIGGER_KILLS) return false;
  if (!state.ship.galacticHyperdrive) return false;
  return true;
}

/**
 * Сколько условий выполнено — для подсказки в статистике (§133.6: прогресс
 * показываем только после первых двух, иначе это спойлер с первого экрана).
 */
export interface SupernovaProgress {
  /** Первые два условия ZX: не первая галактика и больше 32 прыжков. */
  basicsMet: boolean;
  /** Ранг «Опасный». */
  rankMet: boolean;
  /** Галактический двигатель на борту. */
  driveMet: boolean;
}

export function supernovaProgress(state: GameState): SupernovaProgress {
  return {
    basicsMet: state.galaxy !== 1 && state.stats.jumps > SUPERNOVA_TRIGGER_JUMPS,
    rankMet: state.kills >= SUPERNOVA_TRIGGER_KILLS,
    driveMet: !!state.ship.galacticHyperdrive,
  };
}

/** Началось ли событие: прыжок сюда стоил нам красного экрана. */
export function startSupernova(
  state: GameState,
  now: number,
  settings: Settings,
): { state: GameState; events: GameEvent[] } {
  if (supernovaOf(state)) return { state, events: [] };
  if (!supernovaArmed(state)) return { state, events: [] };
  // Погибшая станция — не место для спасения: там уже некому сигналить.
  if (!stationAlive(state)) return { state, events: [] };
  // Кулдаун после прошлого провала: событие не должно идти подряд.
  const last = state.supernovaEndedAt ?? 0;
  if (last > 0 && now - last < gameHourMs(settings) * SUPERNOVA_COOLDOWN_HOURS) {
    return { state, events: [] };
  }

  const hour = gameHourMs(settings);
  const sn: Supernova = {
    galaxy: state.galaxy,
    system: state.system,
    startedAt: now,
    at: now + hour * SUPERNOVA_HOURS,
    leakedTo: now,
    maydayAt: now + hour * SUPERNOVA_MAYDAY_HOURS,
    maydays: 0,
    refugees: false,
    escaped: false,
  };
  return {
    state: { ...state, supernova: sn },
    events: [
      {
        type: 'supernova',
        at: now,
        text: 'СВЕРХНОВА: топливо течёт. Звезда системы нестабильна — уходите, пока есть чем.',
      },
    ],
  };
}

/**
 * Досчёт события: утечка, сигналы бедствия, взрыв.
 *
 * Утечка считается по игровым часам, как и всё остальное время в игре, поэтому
 * в закрытой вкладке топливо вытекает ровно так же, как при открытой.
 */
export function tickSupernova(
  state: GameState,
  now: number,
  settings: Settings,
): { state: GameState; events: GameEvent[]; exploded: boolean } {
  const sn = supernovaOf(state);
  if (!sn || sn.escaped) return { state, events: [], exploded: false };
  const events: GameEvent[] = [];
  const hour = gameHourMs(settings);

  let fuel = state.fuel;
  let leakedTo = sn.leakedTo;
  if (now > leakedTo) {
    const tenths = Math.floor(((now - leakedTo) / hour) * SUPERNOVA_LEAK_PER_HOUR);
    if (tenths > 0) {
      fuel = Math.max(0, fuel - tenths);
      // Сдвигаем отметку ровно на столько времени, сколько списали: остаток
      // до целой десятой переносится на следующий тик, а не теряется.
      leakedTo = Math.min(now, leakedTo + Math.ceil((tenths / SUPERNOVA_LEAK_PER_HOUR) * hour));
    }
  }

  let maydayAt = sn.maydayAt;
  let maydays = sn.maydays;
  while (now >= maydayAt) {
    maydays += 1;
    events.push({
      type: 'supernova',
      at: maydayAt,
      text: `MAYDAY: станция системы держится, на борту люди. Утечка продолжается, топливо ${(fuel / 10).toFixed(1)} св. г.`,
    });
    maydayAt += hour * SUPERNOVA_MAYDAY_HOURS;
    if (maydays > 200) break; // защита от вечного цикла при огромной паузе
  }

  if (now >= sn.at) {
    // Взрыв: дальше решает `state.ts` — там живёт переход в другую галактику.
    return { state: { ...state, fuel }, events, exploded: true };
  }

  return {
    state: { ...state, fuel, supernova: { ...sn, leakedTo, maydayAt, maydays } },
    events,
    exploded: false,
  };
}

/** Взрыв застал игрока на месте: станция гибнет навсегда, двигатель сгорает. */
export function destroyStation(state: GameState, now: number): { state: GameState; events: GameEvent[] } {
  const sn = supernovaOf(state);
  if (!sn) return { state, events: [] };
  const key = stationKey(sn.galaxy, sn.system);
  const destroyed = [...(state.destroyedStations ?? []), key];
  /*
   * Беженцы, взятые на борт, ударной волной улетают вместе с кораблём: их
   * судьба не должна пропасть из-за того, что игрок не успел прыгнуть. А вот
   * те, кого он так и не взял, погибают вместе со станцией — и это его вина.
   */
  const next: Supernova | null = sn.refugees ? { ...sn, escaped: true } : null;
  return {
    state: {
      ...state,
      destroyedStations: destroyed,
      supernova: next,
      supernovaEndedAt: next ? (state.supernovaEndedAt ?? 0) : now,
    },
    events: [
      {
        type: 'supernova',
        at: now,
        text: sn.refugees
          ? 'Сверхновая настигла станцию: её больше нет на карте. Ударная волна унесла корабль с беженцами в другую галактику, галактический двигатель сгорел.'
          : 'Сверхновая настигла станцию: её больше нет на карте, люди на ней погибли. Ударная волна унесла корабль в другую галактику, галактический двигатель сгорел.',
      },
    ],
  };
}

/**
 * Уход из системы: событие окончено, двигатель остаётся цел.
 *
 * Вызывается при обычном прыжке — том самом, на который хватило топлива.
 */
export function escapeSupernova(state: GameState, now: number): { state: GameState; events: GameEvent[] } {
  const sn = supernovaOf(state);
  if (!sn) return { state, events: [] };
  /*
   * Беженцы на борту — событие не кончается, а переходит в «вывезли»: утечка
   * встала (топливо больше не течёт), а награда ждёт стыковки. Если людей на
   * борту нет, событие просто заканчивается.
   */
  const next: Supernova | null = sn.refugees ? { ...sn, escaped: true } : null;
  return {
    state: { ...state, supernova: next, supernovaEndedAt: next ? (state.supernovaEndedAt ?? 0) : now },
    events: [
      {
        type: 'supernova',
        at: now,
        text: sn.refugees
          ? 'Ушли от сверхновой с беженцами на борту. Галактический двигатель цел.'
          : 'Ушли от сверхновой. Станция погибнет, но людей на борту не было.',
      },
    ],
  };
}

/**
 * ВЗЯТЬ БЕЖЕНЦЕВ.
 *
 * Пользователь: беженцы занимают весь трюм, груз приходится выбросить. Поэтому
 * здесь нет «сколько влезет»: свободного места после них ровно ноль.
 */
export function takeRefugees(
  state: GameState,
  now: number,
): { state: GameState; error?: SupernovaError; events: GameEvent[] } {
  const sn = supernovaOf(state);
  if (!sn) return { state, error: 'none', events: [] };
  if (sn.galaxy !== state.galaxy || sn.system !== state.system) {
    return { state, error: 'not-here', events: [] };
  }
  if (!stationAlive(state)) return { state, error: 'no-station', events: [] };
  if (sn.refugees) return { state, error: 'already', events: [] };
  // Пассажиры по контракту — тоже люди: пока они на борту, инвариант трюма
  // («свободно + груз + контракты = вместимость») не даст занять его целиком.
  if ((state.missions ?? []).some((m) => m.tons > 0)) {
    return { state, error: 'missions', events: [] };
  }

  const tons = holdCapacity(state.ship);
  const cargo = state.cargo.map((n, i) => (i <= 12 ? 0 : n));
  const dropped = state.cargo.reduce((sum, n, i) => sum + (i <= 12 ? n : 0), 0);
  return {
    state: {
      ...state,
      cargo,
      cargoOrigin: [],
      holdSpace: 0,
      supernova: { ...sn, refugees: true },
    },
    events: [
      {
        type: 'supernova',
        at: now,
        text: dropped > 0
          ? `Беженцы на борту: ${tons} т, груз (${dropped} т) выброшен. Прыгайте — топливо течёт.`
          : `Беженцы на борту: ${tons} т. Прыгайте — топливо течёт.`,
      },
    ],
  };
}

/**
 * НАГРАДА. Выдаётся при прибытии на любую станцию с беженцами — тратить время
 * на отдельную кнопку незачем, спасение уже состоялось.
 */
export function deliverRefugees(
  state: GameState,
  now: number,
  settings: Settings,
): { state: GameState; events: GameEvent[] } {
  const sn = supernovaOf(state);
  if (!sn || !sn.refugees) return { state, events: [] };
  // Прилетели в ту же систему, откуда ушли? Значит никуда не ушли.
  if (sn.galaxy === state.galaxy && sn.system === state.system) return { state, events: [] };

  const cargo = state.cargo.slice();
  cargo[GEMS_INDEX] = (cargo[GEMS_INDEX] ?? 0) + SUPERNOVA_REWARD_GEMS;
  return {
    state: {
      ...state,
      cargo,
      holdSpace: holdCapacity(state.ship) - (state.missions ?? []).reduce((s, m) => s + m.tons, 0),
      supernova: null,
      supernovaEndedAt: now,
      missionRep: (state.missionRep ?? 0) + 5,
    },
    events: [
      {
        type: 'supernova',
        at: now,
        text: `Беженцы высажены. В благодарность — ${SUPERNOVA_REWARD_GEMS} г драгоценных камней.`,
      },
    ],
  };
}

/** Сколько ещё игровых часов до взрыва — для подписи на экране. */
export function hoursLeft(state: GameState, now: number, settings: Settings): number {
  const sn = supernovaOf(state);
  if (!sn) return 0;
  return Math.max(0, (sn.at - now) / gameHourMs(settings));
}

/** Ключи погибших станций для проверок и миграций сейва. */
export const destroyedCount = (state: GameState): number => (state.destroyedStations ?? []).length;
