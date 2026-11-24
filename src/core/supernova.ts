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

/**
 * Сколько ПРЫЖКОВ В НОВЫЕ СИСТЕМЫ нужно, чтобы событие стало возможно
 * (ZX-условие «более 32 гиперпрыжков»; §133.11 — снова 32, не 36).
 *
 * §133.10: пользователь уточнил — считаются только прыжки в систему, где
 * игрок ещё никогда не был. Возврат по знакомому маршруту не приближает
 * событие: иначе его включал бы любой «челнок» между двумя станциями.
 */
export const SUPERNOVA_TRIGGER_JUMPS = 32;
/** Ранг «Опасный» — 512 уничтоженных кораблей (см. RANKS в `ships.ts`). */
export const SUPERNOVA_TRIGGER_KILLS = 512;
/** Утечка: 2.0 св. г. за игровой час, в тех же десятых, что и `state.fuel`. */
export const SUPERNOVA_LEAK_PER_HOUR = 20;
/** Через сколько игровых часов взрывается звезда. */
export const SUPERNOVA_HOURS = 3;
/** Как часто в журнал падает сигнал бедствия (20 игровых минут). */
export const SUPERNOVA_MAYDAY_HOURS = 1 / 3;
/** Сколько тонн беженцев ждёт на станции (решение пользователя: 200). */
export const SUPERNOVA_REFUGEES_TONS = 200;
/**
 * Через сколько реальных секунд после стыковки прыжок становится бесплатным,
 * если беженцев так и не взяли. Это выход из события для тех, кому нечем
 * улететь: сортировать груз на гибнущей станции можно сколько угодно, но
 * застрять в игре нельзя.
 */
export const SUPERNOVA_FREE_JUMP_MS = 30_000;
/** Награда: 100 г драгоценных камней — ровно как в оригинале. */
export const SUPERNOVA_REWARD_GEMS = 100;
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
  /** Беженцы на борту: сколько тонн уже взято. */
  taken: number;
  /** Взяли хотя бы кого-то. */
  refugees: boolean;
}

export type SupernovaError = 'none' | 'not-here' | 'no-station' | 'already' | 'no-hold';

export const supernovaOf = (state: GameState): Supernova | null => state.supernova ?? null;

/** Ключ системы: номер один и тот же в разных галактиках — места разные. */
export const stationKey = (galaxy: number, system: number): string => `${galaxy}:${system}`;

/**
 * §133.10: СКОЛЬКО НОВЫХ СИСТЕМ ПРОЙДЕНО.
 *
 * Условие старта считает не все прыжки, а только те, что привели в систему,
 * где игрок ещё не был. Стартовая система в счёт не идёт: карьера начинается
 * не прыжком.
 */
export function newSystemsVisited(state: GameState): number {
  return Math.max(0, (state.visitedSystems ?? []).length - 1);
}

/** Отметить текущую систему как посещённую. Возвращает то же состояние, если она уже была. */
export function noteVisit(state: GameState): GameState {
  const key = stationKey(state.galaxy, state.system);
  const seen = state.visitedSystems ?? [];
  if (seen.includes(key)) return state;
  return { ...state, visitedSystems: [...seen, key] };
}

/**
 * §133.10: СТАНЦИЯ ГИБНЕТ В ЛЮБОМ ИСХОДЕ.
 *
 * Пользователь: «станция исчезает в любом случае». Звезда вспыхивает
 * независимо от того, успел игрок уйти или нет, — значит и станции больше
 * нет. Поэтому пометка ставится в момент, когда событие закрывается, а не
 * только при взрыве.
 */
function withStationDestroyed(state: GameState, sn: Supernova): GameState {
  const key = stationKey(sn.galaxy, sn.system);
  const list = state.destroyedStations ?? [];
  return list.includes(key) ? state : { ...state, destroyedStations: [...list, key] };
}

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
  // §133.10: событие бывает один раз в карьере — прошло, значит прошло.
  if (state.supernovaDone) return false;
  if (state.galaxy === 1) return false;
  if (newSystemsVisited(state) <= SUPERNOVA_TRIGGER_JUMPS) return false;
  if (state.kills < SUPERNOVA_TRIGGER_KILLS) return false;
  if (!state.ship.galacticHyperdrive) return false;
  return true;
}

/**
 * Сколько условий выполнено — для подсказки в статистике (§133.6: прогресс
 * показываем только после первых двух, иначе это спойлер с первого экрана).
 */
export interface SupernovaProgress {
  /** Первые два условия: не первая галактика и больше 32 новых систем. */
  basicsMet: boolean;
  /** Ранг «Опасный». */
  rankMet: boolean;
  /** Галактический двигатель на борту. */
  driveMet: boolean;
}

export function supernovaProgress(state: GameState): SupernovaProgress {
  return {
    basicsMet: state.galaxy !== 1 && newSystemsVisited(state) > SUPERNOVA_TRIGGER_JUMPS,
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
  const hour = gameHourMs(settings);
  const sn: Supernova = {
    galaxy: state.galaxy,
    system: state.system,
    startedAt: now,
    at: now + hour * SUPERNOVA_HOURS,
    leakedTo: now,
    maydayAt: now + hour * SUPERNOVA_MAYDAY_HOURS,
    maydays: 0,
    taken: 0,
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
    /*
     * §133.11: ПОКА МЫ НА СТАНЦИИ, ОНА НЕ ВЗРЫВАЕТСЯ.
     *
     * Пользователь: «станция не взрывается, пока мы на ней». Иначе игрок
     * стоял бы на станции, которой уже нет. Поэтому срок сдвигается, пока
     * корабль здесь; как только он ушёл — станция гибнет (в любом исходе).
     */
    const here = !state.flight && sn.galaxy === state.galaxy && sn.system === state.system;
    if (here) {
      return {
        state: { ...state, fuel, supernova: { ...sn, leakedTo, maydayAt, maydays, at: now + hour } },
        events,
        exploded: false,
      };
    }
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
  /*
   * §133.11: награда зависит только от беженцев, а не от способа ухода.
   * Ударная волна уносит корабль в другую галактику — люди, которых уже взяли
   * на борт, летят с ним и награду приносят. Станция гибнет в любом случае.
   */
  const next: Supernova | null = sn.refugees ? { ...sn, escaped: true } : null;
  return {
    state: {
      ...withStationDestroyed(state, sn),
      supernova: next,
      supernovaEndedAt: next ? (state.supernovaEndedAt ?? 0) : now,
      supernovaDone: true,
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
    state: {
      ...withStationDestroyed(state, sn),
      supernova: next,
      supernovaEndedAt: next ? (state.supernovaEndedAt ?? 0) : now,
      // §133.10: событие одно на карьеру — второй раз оно не придёт.
      supernovaDone: true,
    },
    events: [
      {
        type: 'supernova',
        at: now,
        text: sn.refugees
          ? 'Ушли от сверхновой с беженцами на борту. Галактический двигатель цел, станция за кормой гибнет.'
          : 'Ушли от сверхновой. Станции в этой системе больше нет, людей на борту не было.',
      },
    ],
  };
}

/**
 * УХОД ГАЛАКТИЧЕСКИМ ПРЫЖКОМ.
 *
 * Это гарантированный выход для того, у кого пустой бак: двигатель сгорит,
 * станция погибнет. Беженцы летят с кораблём, и награду за них платят так же,
 * как при обычном прыжке: §133.11 — «если условия беженцев соблюдены, награда
 * будет, неважно как мы ушли».
 */
export function galacticEscapeSupernova(
  state: GameState,
  now: number,
): { state: GameState; events: GameEvent[] } {
  const sn = supernovaOf(state);
  if (!sn) return { state, events: [] };
  const next: Supernova | null = sn.refugees ? { ...sn, escaped: true } : null;
  return {
    state: {
      ...withStationDestroyed(state, sn),
      supernova: next,
      supernovaEndedAt: next ? (state.supernovaEndedAt ?? 0) : now,
      supernovaDone: true,
    },
    events: [
      {
        type: 'supernova',
        at: now,
        text: sn.refugees
          ? 'Ушли от сверхновой в другую галактику. Беженцы летят с вами — высадите их на любой станции.'
          : 'Ушли от сверхновой в другую галактику. Станция погибла, людей на борту не было.',
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
  /*
   * §133.8: БЕЖЕНЦЕВ РОВНО 250 ТОНН, И БЕРУТ СКОЛЬКО ВЛЕЗЕТ.
   *
   * Пользователь: «беженцев будет всего 250 тонн, если в трюме есть товары, то
   * вместо „продать всё“ будет „оставить всё“, мы сами решим, что выбросить.
   * Если взяли беженцев не на полный трюм, то награду не получаем».
   *
   * Отсюда три правила:
   *   * груз больше не выбрасывается автоматически — трюм освобождает игрок;
   *   * взяли столько, сколько было свободно (и сколько есть на станции);
   *   * награда только за ПОЛНЫЙ трюм — то есть если свободного места не
   *     осталось совсем ничего.
   */
  // Защита от сейвов, где поля `taken` ещё не было.
  const already = Number.isFinite(sn.taken) ? sn.taken : 0;
  const left = Math.max(0, SUPERNOVA_REFUGEES_TONS - already);
  const room = Math.min(left, state.holdSpace);
  if (room <= 0) return { state, error: 'no-hold', events: [] };

  const taken = already + room;
  // «Взяли всех» — не «трюм забит под край», а «забрали всё, что могли»:
  // у Анаконды трюм 253 т, а беженцев 200, и добрать нечего (§133.9).
  const capacity = holdCapacity(state.ship);
  const needed = Math.min(SUPERNOVA_REFUGEES_TONS, capacity);
  const full = taken >= needed;
  return {
    state: {
      ...state,
      holdSpace: state.holdSpace - room,
      supernova: { ...sn, taken, refugees: true },
    },
    events: [
      {
        type: 'supernova',
        at: now,
        text: full
          ? `Беженцы на борту: ${taken} т — забрали всех. Прыгайте, топливо течёт.`
          : `Беженцы на борту: ${taken} т из ${needed}: в трюме остался груз. Награды не будет, пока не освободите место.`,
      },
    ],
  };
}

/**
 * §133.17: СКОЛЬКО БЕЖЕНЦЕВ ЖДЁТ ВЫСАДКИ.
 *
 * Пользователь: «забрал беженцев, но в трюме они не отображаются. По прибытии
 * на другую станцию в рынке их нет, чтобы высадить». Люди занимали место в
 * трюме, но нигде не были видны: в трюме нет карточки, в рынке нет кнопки.
 * Теперь это одно число, которое знают и трюм, и рынок.
 */
export function refugeesAboard(state: GameState): number {
  const sn = supernovaOf(state);
  return sn && sn.refugees ? sn.taken : 0;
}

/**
 * НАГРАДА. §133.17: выдаётся по кнопке «Высадить» на любой станции, кроме той,
 * откуда ушли.
 *
 * Раньше высадка была автоматической: прилетел — получил камни. Пользователь
 * искал в рынке кнопку и не находил её, а люди исчезали из трюма сами, без
 * его участия. Высадка — это решение игрока, и оно должно быть видимым.
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

  const capacity = holdCapacity(state.ship);
  const freed = capacity - (state.missions ?? []).reduce((s, m) => s + m.tons, 0);
  /*
   * §133.8–133.9: платят за «всех забрали», а не за «трюм забит под край».
   * Взяли меньше, чем было можно, — значит часть трюма держал груз: беженцев
   * спасли, награды нет. Так «оставить всё» остаётся настоящим выбором, но
   * владелец Анаконды (трюм 253 т против 200 т беженцев) не наказан за то,
   * что добрать ему нечего.
   */
  const needed = Math.min(SUPERNOVA_REFUGEES_TONS, capacity);
  const full = sn.taken >= needed;
  const cargo = state.cargo.slice();
  if (full) cargo[GEMS_INDEX] = (cargo[GEMS_INDEX] ?? 0) + SUPERNOVA_REWARD_GEMS;
  return {
    state: {
      ...state,
      cargo,
      holdSpace: freed,
      supernova: null,
      supernovaEndedAt: now,
      missionRep: (state.missionRep ?? 0) + (full ? 5 : 0),
    },
    events: [
      {
        type: 'supernova',
        at: now,
        text: full
          ? `Беженцы высажены. В благодарность — ${SUPERNOVA_REWARD_GEMS} г драгоценных камней.`
          : `Беженцы высажены: ${sn.taken} т из ${needed} — часть трюма держал груз, награды нет.`,
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
