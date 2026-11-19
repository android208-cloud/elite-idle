/**
 * §113: отладочный файл — «всё, что нужно, чтобы понять, что произошло».
 *
 * Зачем отдельно от сохранения: сохранение — для игрока и для игры. В нём
 * нет ни настроек, ни журнала, ни среды, и по нему не видно, ПОЧЕМУ
 * пилот заработал именно столько. Отладочный файл — для разработчика:
 * полное состояние, настройки, журнал, среда браузера и посчитанная
 * расшифровка флота (расстояние, цикл, доход, риски).
 *
 * Правила, которые важнее удобства:
 *
 *  - **полнота**: в файле лежит состояние ЦЕЛИКОМ, а не выжимка. Если
 *    чего-то не хватит, разбираться придётся по переписке, а не по файлу;
 *  - **чистота**: функция ничего не читает из браузера сама — среду ей
 *    передают снаружи. Поэтому её можно проверить тестом и вызвать
 *    откуда угодно;
 *  - **читаемость**: JSON с отступами. Файл открывают глазами не реже,
 *    чем парсером.
 */
import { COMMODITIES } from './market.ts';
import { SAVE_FILE_APP, SAVE_FILE_VERSION, summarize, type SaveSummary } from './save-file.ts';
import {
  laneSurveillance,
  pilotRisk,
  pilotRunIncome,
  routeDistance,
  routeProfit,
} from './fleet.ts';
import { SHIPS } from './ships.ts';
import { pilotCycleMs, SAVE_VERSION, systemsOf, type GameState, type Settings } from './state.ts';

/** Среда, в которой шла игра. Собирается вызывающим (UI), не этим модулем. */
export interface DebugEnv {
  /** `navigator.userAgent` — браузер и версия. */
  userAgent?: string;
  platform?: string;
  language?: string;
  timeZone?: string;
  /** Размер окна, CSS-пиксели. */
  viewport?: [number, number];
  dpr?: number;
  online?: boolean;
  /** Ключи localStorage — видно, не разрослось ли хранилище. */
  storageKeys?: string[];
  /** Игра открыта как одиночный HTML или как сборка. */
  standalone?: boolean;
}

/** Один пилот в расшифровке: не только «кто», но и «сколько и чем рискует». */
export interface PilotDiagnostics {
  id: number;
  name: string;
  role: string;
  ship: string;
  route: { from: string; to: string; distanceLy: number } | null;
  /** Длительность полного цикла «туда-обратно + отдых», мс. */
  cycleMs: number;
  /** Когда ждать следующего возвращения (ISO), либо null. */
  nextRunAt: string | null;
  runs: number;
  failures: number;
  /** Ваша доля за один рейс, десятые кредита. */
  income: number;
  /** Шансы по текущему маршруту, доли (0.01 = 1%). */
  risk: Record<string, number> | null;
}

export interface DebugFile {
  app: typeof SAVE_FILE_APP;
  kind: 'debug';
  fileVersion: number;
  savedAt: string;
  /** Версия формата состояния — по ней видно, миграции уже применились. */
  stateVersion: number;
  env: DebugEnv;
  summary: SaveSummary;
  settings: Settings;
  /** Расшифровка флота: то, что обычно и приходится пересчитывать руками. */
  fleet: {
    pilots: number;
    withRoute: number;
    lanes: { lane: string; role: string; pilots: number }[];
    pilotList: PilotDiagnostics[];
  };
  /** Сколько чего в состоянии — быстрый взгляд без чтения всего файла. */
  counters: {
    logLines: number;
    systems: number;
    cargoTons: number;
    cargoKinds: number;
    marketEntries: number;
    commodities: number;
  };
  /** Полное состояние, как оно лежит в сохранении. */
  state: GameState;
  /** Журнал событий: последние строки обычно и объясняют странность. */
  log: { at: number; text: string }[];
}

/**
 * Собирает отладочный файл.
 *
 * `now` передаётся параметром, как и везде в проекте: иначе проверка
 * зависела бы от часов, а файл — от момента вызова.
 */
export function buildDebugFile(
  state: GameState,
  log: { at: number; text: string }[],
  settings: Settings,
  env: DebugEnv = {},
  now = Date.now(),
): DebugFile {
  const systems = systemsOf(state.galaxy);
  const nameOf = (i: number): string => systems[i]?.name ?? `#${i}`;

  const pilotList: PilotDiagnostics[] = state.pilots.map((p) => {
    const route = p.route;
    const distanceLy = route ? routeDistance(systems, route) / 10 : 0;
    /* Цикл — той же функцией, что у игры: если завтра формула изменится,
     * файл не начнёт врать. */
    const cycleMs = route ? pilotCycleMs(state, p, settings) : 0;
    const lane = route ? laneSurveillance(systems, route) : 0;
    /* §108: у полицейского риск считается по правительству патрулируемой
     * системы, а не по надзору линии — иначе он сам себе его гасит. */
    const destSurv = route
      ? p.role === 'police'
        ? systems[route.to].government
        : laneSurveillance(systems, route)
      : 0;
    const risk = route ? { ...pilotRisk(p.role, lane, destSurv) } : null;
    const index = Math.max(0, state.pilots.indexOf(p));
    const hold = SHIPS[p.ship]?.hold ?? 0;
    const income = route ? pilotRunIncome(routeProfit(state.galaxy, systems, route, hold, p.role), index) : 0;
    return {
      id: p.id,
      name: p.name,
      role: p.role,
      ship: p.ship,
      route: route ? { from: nameOf(route.from), to: nameOf(route.to), distanceLy } : null,
      cycleMs,
      nextRunAt: p.nextRunAt ? new Date(p.nextRunAt).toISOString() : null,
      runs: p.runs,
      failures: p.failures,
      income,
      risk,
    };
  });

  // Маршруты схлопываем так же, как карта: пара систем + роль.
  const laneMap = new Map<string, { lane: string; role: string; pilots: number }>();
  for (const p of state.pilots) {
    if (!p.route) continue;
    const lane = `${nameOf(p.route.from)} → ${nameOf(p.route.to)}`;
    const key = `${lane}|${p.role}`;
    const row = laneMap.get(key);
    if (row) row.pilots++;
    else laneMap.set(key, { lane, role: p.role, pilots: 1 });
  }

  const cargoTons = state.cargo.reduce((a, b) => a + b, 0);
  return {
    app: SAVE_FILE_APP,
    kind: 'debug',
    fileVersion: SAVE_FILE_VERSION,
    savedAt: new Date(now).toISOString(),
    stateVersion: SAVE_VERSION,
    env,
    summary: summarize(state),
    settings,
    fleet: {
      pilots: state.pilots.length,
      withRoute: state.pilots.filter((p) => p.route !== null).length,
      lanes: [...laneMap.values()],
      pilotList,
    },
    counters: {
      logLines: log.length,
      systems: systems.length,
      cargoTons,
      cargoKinds: state.cargo.filter((t) => t > 0).length,
      marketEntries: state.market.length,
      commodities: COMMODITIES.length,
    },
    state,
    log,
  };
}

/** Текст файла: JSON с отступами — его читают глазами чаще, чем парсером. */
export function encodeDebugFile(file: DebugFile): string {
  return JSON.stringify(file, null, 2);
}

/**
 * Имя файла: система, кредиты и дата — как у сохранения, только с `debug`.
 *
 * Отдельный префикс важен: отладочный файл нельзя случайно загрузить
 * обратно в игру кнопкой «Загрузить из файла», и по папке сразу видно,
 * что это выгрузка для разбора.
 */
export function debugFileName(state: GameState, now = Date.now()): string {
  const system = systemsOf(state.galaxy)[state.system];
  const name = (system?.name ?? 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20) || 'unknown';
  const date = new Date(now).toISOString().slice(0, 10);
  return `elite-idle-debug-${name}-${Math.floor(state.cash / 10)}cr-${date}.json`;
}
