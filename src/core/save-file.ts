/**
 * Сохранение прогресса в файл и загрузка из файла.
 *
 * Зачем это нужно, если есть `localStorage`: хранилище браузера привязано к
 * устройству и к браузеру. Почистил кэш, открыл игру на другом компьютере,
 * зашёл из приватного окна — прогресса нет. Файл переживает всё это и
 * переносит игру между устройствами.
 *
 * Формат — обычный JSON, тот же, что игра держит в `localStorage`, но с
 * обёрткой: версия формата, имя игры, момент выгрузки и сводка (система,
 * деньги, ранг). Сводка нужна не игре, а человеку: по имени файла не видно,
 * какой там прогресс, а по сводке внутри — видно, и её можно показать до
 * загрузки, не применяя данные.
 *
 * Правило, ради которого всё так осторожно: **битый или чужой файл не
 * должен испортить текущую игру**. Поэтому импорт сначала проверяет всё и
 * только потом отдаёт данные; ошибка — это отдельный результат, а не
 * исключение посреди записи состояния.
 */

import { GALAXY_COUNT, type StarSystem } from './galaxy.ts';
import { COMMODITIES } from './market.ts';
import { rankOf } from './ships.ts';
import { deserialize, systemsOf, migrateSettings, type GameState, type Settings } from './state.ts';

/** Метка формата в файле: чтобы отличить нашу выгрузку от любого другого JSON. */
export const SAVE_FILE_APP = 'elite-idle';

/**
 * Версия ФОРМАТА ФАЙЛА, не версия состояния.
 *
 * Состояние версионируется отдельно (`SAVE_VERSION` в state.ts) и умеет
 * мигрировать старые записи. Эта версия меняется, только если поменяется
 * сама обёртка: понадобится, если старые файлы станет невозможно прочитать.
 */
export const SAVE_FILE_VERSION = 1;

/** Что лежит в файле. Ровно то же, что в `localStorage`, плюс обёртка. */
export interface SaveFile {
  /** Метка, чтобы отличить наш файл от чужого JSON */
  app: typeof SAVE_FILE_APP;
  /** Версия обёртки */
  fileVersion: number;
  /** Версия состояния (её читает `deserialize`) */
  version: number;
  /** Когда выгружено, ISO-строка — для человека */
  savedAt: string;
  /**
   * Сводка для показа до загрузки. Игре она не нужна: всё это есть в
   * состоянии. Но показать «что в файле» до того, как затереть текущий
   * прогресс, — единственный способ не потерять его по ошибке.
   */
  summary: SaveSummary;
  /** Состояние игры — та же JSON-строка, что в localStorage */
  state: string;
  log: { at: number; text: string }[];
  settings: Settings;
}

export interface SaveSummary {
  systemName: string;
  galaxy: number;
  cash: number;
  kills: number;
  rank: string;
  /** В полёте ли командир на момент выгрузки */
  inFlight: boolean;
}

/** Все причины отказа принять файл. Каждая — со своим текстом для игрока. */
export type ImportError =
  | 'not-json'
  | 'not-our-file'
  | 'unsupported-version'
  | 'broken-state'
  | 'newer-save';

export const IMPORT_ERROR_TEXT: Record<ImportError, string> = {
  'not-json': 'Это не файл сохранения: внутри не JSON.',
  'not-our-file': 'Это JSON, но не сохранение Elite Idle.',
  'unsupported-version': 'Файл сохранения другой версии формата.',
  'broken-state': 'Файл повреждён: состояние игры не читается.',
  'newer-save': 'Сохранение из более новой версии игры — обновите игру.',
};

/** Собирает содержимое файла из текущего состояния игры. */
export function buildSaveFile(state: GameState, log: { at: number; text: string }[], settings: Settings, now = Date.now()): SaveFile {
  return {
    app: SAVE_FILE_APP,
    fileVersion: SAVE_FILE_VERSION,
    version: state.version,
    savedAt: new Date(now).toISOString(),
    summary: summarize(state),
    // Формат состояния — тот же, что в localStorage: одна точка правды
    // на сериализацию, иначе файл и хранилище разойдутся в деталях.
    state: JSON.stringify(state),
    log,
    settings,
  };
}

/** Сериализует файл в текст — то, что попадёт в скачивание. */
export function encodeSaveFile(file: SaveFile): string {
  return JSON.stringify(file, null, 2);
}

/**
 * Имя файла выгрузки.
 *
 * Имя отражает прогресс, а не дату: `elite-idle-lave-148-2026-11-16.json`
 * читается лучше, чем `save-1763300000000.json`, и по папке с несколькими
 * сохранениями сразу видно, где какой командир. Всё, что может сломать имя
 * файла в системе, заменяем на дефис.
 */
export function saveFileName(state: GameState, now = Date.now()): string {
  const system = systemsOf(state.galaxy)[state.system];
  const name = (system?.name ?? 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20) || 'unknown';
  const date = new Date(now).toISOString().slice(0, 10);
  return `elite-idle-${name}-${Math.floor(state.cash / 10)}cr-${date}.json`;
}

/** Сводка состояния для показа игроку. */
export function summarize(state: GameState): SaveSummary {
  const system = systemsOf(state.galaxy)[state.system];
  return {
    systemName: system?.name ?? '—',
    galaxy: state.galaxy,
    cash: state.cash,
    kills: state.kills,
    rank: rankOf(state.kills),
    inFlight: state.flight !== null,
  };
}

export type ImportResult =
  | { ok: true; state: GameState; log: { at: number; text: string }[]; settings: Settings; summary: SaveSummary; savedAt: string }
  | { ok: false; error: ImportError; message: string };

/**
 * Читает файл сохранения.
 *
 * Порядок проверок важен: сначала «это вообще JSON», потом «это наш файл»,
 * и только потом трогаем игру. Ни одна проверка не меняет ничего снаружи —
 * функция чистая, поэтому вызывающая сторона решает, применять ли результат.
 */
export function importSaveFile(text: string, now = Date.now()): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return fail('not-json');
  }
  if (!data || typeof data !== 'object') return fail('not-our-file');
  const file = data as Partial<SaveFile>;
  if (file.app !== SAVE_FILE_APP) return fail('not-our-file');
  if (typeof file.fileVersion !== 'number' || file.fileVersion > SAVE_FILE_VERSION) {
    return fail('unsupported-version');
  }
  if (typeof file.state !== 'string') return fail('broken-state');

  // Дату не проверяем на «из будущего»: часы на устройстве врут чаще, чем
  // файлы подделывают, а отказ по дате помешал бы загрузить собственный
  // прогресс. Достаточно, что она разбирается — иначе покажем «неизвестно».
  let savedAt = file.savedAt ?? '';
  const parsed = Date.parse(savedAt);
  if (Number.isNaN(parsed)) savedAt = '';

  let state: GameState;
  try {
    state = deserialize(file.state);
  } catch {
    return fail('broken-state');
  }

  // Проверки на «файл не наш/не тот» уже позади — теперь убеждаемся, что
  // числа осмысленны. Сохранение от будущей версии игры тоже сюда придёт:
  // `deserialize` бросит на неизвестной версии, и мы скажем «битый».
  const problem = validateState(state);
  if (problem) return fail(problem);

  /*
   * §117: настройки проходят через миграцию — в старых файлах лежит
   * прежнее умолчание темпа прыжка, и оно не должно перекрывать текущее.
   */
  const settings: Settings = migrateSettings(file.settings);
  const log = Array.isArray(file.log)
    ? file.log.filter((e) => e && typeof e.text === 'string' && typeof e.at === 'number')
    : [];
  return { ok: true, state, log, settings, summary: summarize(state), savedAt };
}

/** Точечные проверки состояния: то, что `deserialize` пропустил бы молча. */
function validateState(state: GameState): ImportError | null {
  if (!Number.isInteger(state.galaxy) || state.galaxy < 1 || state.galaxy > GALAXY_COUNT) return 'broken-state';
  const systems: StarSystem[] = systemsOf(state.galaxy);
  if (!Number.isInteger(state.system) || state.system < 0 || state.system >= systems.length) return 'broken-state';
  if (!Number.isFinite(state.cash) || state.cash < 0) return 'broken-state';
  if (!Array.isArray(state.cargo) || state.cargo.length !== COMMODITIES.length) return 'broken-state';
  if (!state.ship || typeof state.ship.laser !== 'string') return 'broken-state';
  if (!Number.isFinite(state.holdSpace) || state.holdSpace < 0) return 'broken-state';
  return null;
}

const fail = (error: ImportError): ImportResult => ({ ok: false, error, message: IMPORT_ERROR_TEXT[error] });

/** Текст вида «16 ноября 2026, 18:40» — для показа, когда сделан файл. */
export function formatSavedAt(iso: string): string {
  if (!iso) return 'неизвестно когда';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'неизвестно когда';
  const date = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `${date}, ${time}`;
}
