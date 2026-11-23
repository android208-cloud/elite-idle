import './styles.css';
import { IframeDockingModule } from './docking-module.ts';
import {
  applyDecision,
  applyPodLoss,
  availableDecisions,
  autoResolve,
  bestLaserOf,
  enemyOf,
  isCriminal,
  isLegalTarget,
  toughnessOf,
  type Decision,
} from '../core/one-decision.ts';
import { canDo, MAX_ENERGY, MAX_SHIELDS, type CombatAction } from '../core/combat.ts';
import { distance, ECONOMIES, GALACTIC_ARRIVAL, GOVERNMENTS, nearestSystem } from '../core/galaxy.ts';
import { COMMODITIES, isTonneCargo } from '../core/market.ts';
import { isContraband } from '../core/cargo-canisters.ts';
import { cargoManifest, handoverLine, contrabandValue, contrabandGoods, untrackedContraband, holdValue } from '../core/cargo-origin.ts';
import { buildSaveFile, encodeSaveFile, formatSavedAt, importSaveFile, saveFileName } from '../core/save-file.ts';
import { buildDebugFile, debugFileName, encodeDebugFile, type DebugEnv } from '../core/debug-file.ts';
import { drawShipModel, FLEET, type ShipBlueprint } from './ship-model.ts';
import { applyUiEdits, initUiEditor, isEditing, toggleEditing } from './ui-editor.ts';
import { layoutLabels, placeSingle, type Box, type LabelItem } from './label-layout.ts';
import { EQUIPMENT, enemyById, equipmentAvailable, LASER_NAMES, legalLabel, rankOf, type EquipmentId } from '../core/ships.ts';
import {
  advance,
  hoursLeft,
  stationAlive,
  stationLocked,
  supernovaOf,
  supernovaProgress,
  SUPERNOVA_REFUGEES_TONS,
  SUPERNOVA_TRIGGER_KILLS,
  takeRefugees,
  buy,
  buyEquipment,
  buyShip,
  buyStation,
  movePilot,
  pilotTransferCost,
  pilotTransferMs,
  refitPilot,
  cargoTons,
  combatAction,
  combatAutoplay,
  jettisonCargo,
  salvageClose,
  salvageTake,
  salvageTakeAll,
  currentSystem,
  galacticJump,
  DEFAULT_SETTINGS,
  migrateSettings,
  POLICE_KILL_LEGAL,
  deserialize,
  jumpDuration,
  MAX_FUEL,
  newGame,
  owns,
  plural,
  SLAVES_INDEX,
  NARCOTICS_INDEX,
  FIREARMS_INDEX,
  refuel,
  ROLE_NAMES,
  sell,
  serialize,
  startJump,
  startPatrol,
  returnFromPatrol,
  systemsOf,
  type EquipmentError,
  type ShipError,
  hirePilot,
  assignPilotRoute,
  pilotCycleMs,
  pilotEncounters,
  pilotRouteProfit,
  surveillanceMap,
  type PilotError,
  type GameEvent,
  type GameState,
  type JumpError,
  type Settings,
  PATROL_MISSILES_REQUIRED,
  PATROL_RETURN_RESERVE,
  contrabandLevel,
  escapeProgress,
  settleWonEncounter,
  type EncounterRole,
  abandonMission,
  deliverMission,
  missionsOf,
  missionRepOf,
  missionTons,
  offersOf,
  takeMission,
  MISSION_OFFERS,
  type Mission,
  type MissionKind,
} from '../core/state.ts';
import {
  formatSpan,
  laneBusy,
  laneSurveillance,
  PIRATE_LEGAL_PER_RUN,
  policeBounty,
  PILOT_HIRE_FEE,
  PILOT_MIN_KILLS,
  pirateLoot,
  POLICE_SURVEILLANCE_BONUS,
  pilotRank,
  pilotRankName,
  pilotRisk,
  pilotRiskRanked,
  pilotRunIncome,
  PILOT_RANK_INCOME,
  PILOT_RANK_RISK,
  PILOT_RANK_RUNS,
  PILOT_ROLE_NAMES,
  SMUGGLER_LEGAL,
  routeDistance,
  routeProfit,
  surveillanceOf,
  type Pilot,
  type PilotRole,
} from '../core/fleet.ts';
import {
  holdCapacity,
  maxFuel,
  maxMissiles,
  patrolMissilesRequired,
  SHIPS,
  shipPrice,
  shipsForSale,
  shipSpec,
  type ShipId,
} from '../core/ships.ts';
import { stationPrice } from '../core/station.ts';
import { topValue } from './top-bar.ts';

/* ---------- Сохранение ---------- */

const SAVE_KEY = 'elite-idle-save-v1';

interface LogEntry {
  at: number;
  text: string;
}

type Tab = 'ship' | 'map' | 'market' | 'hangar' | 'log';

let state: GameState = newGame(Date.now());
let log: LogEntry[] = [];
let settings: Settings = { ...DEFAULT_SETTINGS };
let tab: Tab = 'ship';
let selected: number | null = null;
/**
 * Корабль, ожидающий подтверждения покупки (§102.4).
 *
 * Покупка стирает оборудование и необратима, поэтому одного клика мало:
 * первый клик спрашивает, второй покупает. Сбрасывается при смене вкладки
 * и при любом действии, кроме подтверждения.
 */
let confirmShip: ShipId | null = null;

/**
 * §105: флот. Три состояния найма и открытый список маршрутов.
 *
 * `hireOpen` — показан ли список кораблей под кнопкой «Нанять пилота»;
 * `hireShip` — выбранный корабль, ждущий подтверждения (наём списывает
 * корабль и задаток сразу, поэтому подтверждение нужно);
 * `routePilot` — чей список маршрутов раскрыт.
 */
let hireOpen = false;

/* §127: подтверждение покупки станции — живёт только на экране рынка. */
let stationBuyOpen = false;

/*
 * §133.3: экран «Контракты» — поверх вкладки «Рынок», только на станции.
 * Вкладка закрывает его так же, как экран пилотов (§115).
 */
let contractsOpen = false;

/* §128: чьи панели «перелёт» и «корабль» раскрыты (одна за раз). */
let movePilotFor: number | null = null;
let refitPilotFor: number | null = null;
let hireShip: ShipId | null = null;
let routePilot: number | null = null;

/*
 * §126: блок маршрута переехал над списком, и после открытия его надо
 * показать. Иначе нажатие «Назначить маршрут» у десятого пилота ничего не
 * меняло на экране: панель появлялась выше прокрутки, вне поля зрения.
 * Флаг съедается один раз — в первом рендере после открытия.
 */
let scrollToRoute = false;
/** §107: какую роль показывать в открытом списке маршрутов. */
let routeRole: PilotRole = 'trader';

/** Момент последней записи в localStorage — чтобы не писать каждый тик. */
let lastSaveAt = 0;

/**
 * Свёрнут ли журнал.
 *
 * Это состояние ВИДА, а не игры: оно не сохраняется в файл прогресса и не
 * влияет на расчёты. Живёт в памяти вкладки — пережило перезагрузку
 * страницы или нет, не важно.
 *
 * Свёрнут по умолчанию: журнал длинный и на телефоне занимал пол-экрана
 * под настройками, до которых надо было прокручивать.
 */
let logCollapsed = true;

/** Когда прогресс последний раз выгружали в файл (0 — ни разу за сеанс). */
let lastFileSaveAt = '';

/**
 * Сообщение под кнопками сохранения: что вышло и чем это кончилось.
 * Живёт до следующего действия — игрок должен увидеть, что файл записан.
 */
let saveNotice: { ok: boolean; text: string } | null = null;

/**
 * Есть ли рабочее хранилище.
 *
 * На `file://` браузеры выдают «opaque origin», и обращение к
 * `localStorage` не просто возвращает null, а **бросает** SecurityError.
 * Поэтому проверяем один раз и молча работаем без сохранений: игра
 * должна запускаться и без диска. Это же поведение в приватном режиме
 * некоторых браузеров.
 */
const storageAvailable = (() => {
  try {
    const probe = '__elite_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
})();

/*
 * §118: ДВЕ ВКЛАДКИ — ОДИН СЕЙВ.
 *
 * Так и родилось «внезапное» пиратство из отладочного файла: в двух
 * экземплярах игры (вкладка и PWA, или две вкладки) жили РАЗНЫЕ состояния
 * одного сохранения — с разными деньгами, статусом и историей. Каждая
 * запись затирала чужую, и игрок видел скачки: 108 474 CR в одном файле,
 * 340 081 в другом через час, при видимых +12 000 торговли.
 *
 * Полноценная синхронизация тут не нужна и была бы вредна: idle-игре
 * достаточно одного хозяина. Поэтому вкладки договариваются, кто играет:
 *
 *   - живая вкладка раз в 5 секунд пишет метку времени в свою запись;
 *   - увидев ЧУЖУЮ свежую метку, вкладка показывает предупреждение и
 *     ПЕРЕСТАЁТ сохранять — молча затирать чужую игру нельзя;
 *   - «Играть здесь» забирает хозяина себе (и тогда предупреждение
 *     появится у соседней вкладки);
 *   - если сосед замолчал дольше 20 секунд, он закрыт — вкладка снова
 *     сохраняет сама.
 */
const TAB_KEY = 'elite-idle-tab-v1';
/** Как часто живая вкладка подтверждает, что она жива. */
const TAB_BEAT_MS = 5000;
/** Молчание дольше этого — вкладка закрыта, а не просто в фоне. */
const TAB_STALE_MS = 20000;

/** Свой идентификатор: случайный, чтобы две вкладки не совпали. */
const tabId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
/** Чужая вкладка жива: показываем предупреждение и не сохраняем. */
let otherTab = false;
/** Игрок нажал «Играть здесь»: хозяин сейва переехал в эту вкладку. */
let tabTaken = false;
let lastTabBeatAt = 0;

function readTab(): { id: string; at: number } | null {
  if (!storageAvailable) return null;
  try {
    const raw = localStorage.getItem(TAB_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { id?: unknown; at?: unknown };
    if (typeof v?.id !== 'string' || typeof v.at !== 'number') return null;
    return { id: v.id, at: v.at };
  } catch {
    return null;
  }
}

function tabBeat(): void {
  try {
    localStorage.setItem(TAB_KEY, JSON.stringify({ id: tabId, at: Date.now() }));
  } catch {
    // место кончилось — это не повод ломать игру
  }
}

/**
 * Жива ли другая вкладка. Возвращает true, если состояние изменилось, —
 * тогда надо перерисовать экран.
 */
function checkTabs(): boolean {
  const other = readTab();
  const alive = other !== null && other.id !== tabId && Date.now() - other.at < TAB_STALE_MS;
  if (alive === otherTab) return false;
  otherTab = alive;
  return true;
}

/** Раз в несколько секунд: проверить соседа и подтвердить, что живы мы. */
function tabsTick(): void {
  if (Date.now() - lastTabBeatAt < TAB_BEAT_MS) return;
  lastTabBeatAt = Date.now();
  const changed = checkTabs();
  if (!otherTab) tabBeat();
  if (changed) render();
}

/**
 * Сохранение заблокировано, пока хозяин сейва — другая вкладка.
 *
 * Именно это и требовалось: «не давать молча затирать сейв». Как только
 * соседняя вкладка закрылась (или игрок нажал «Играть здесь»), запись
 * возобновляется сама.
 */
function save(): void {
  if (!storageAvailable) return;
  if (otherTab && !tabTaken) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ state: serialize(state), log, settings }));
  } catch {
    // место кончилось или диск недоступен — играть это не мешает
  }
}

function load(): void {
  try {
    const raw = storageAvailable ? localStorage.getItem(SAVE_KEY) : null;
    if (raw) {
      const data = JSON.parse(raw) as { state: string; log: LogEntry[]; settings: Settings };
      state = deserialize(data.state);
      /*
       * §89: после загрузки точку отсчёта времени карьеры надо сбросить.
       * `careerAt` в файле — момент игры, а браузер живёт своей жизнью:
       * без сброса первый же тик начислил бы всё время, пока вкладка была
       * закрыта. Сохраняем накопленное `careerMs`, а `careerAt` пусть
       * выставит первый `tickCareer`.
       */
      state = { ...state, careerAt: 0 };
      log = data.log ?? [];
      // §117: старые сохранения несут прежнее умолчание скорости прыжка.
      settings = migrateSettings(data.settings);
      return;
    }
  } catch {
    // повреждённое сохранение: начинаем заново
  }
  state = newGame(Date.now());
  addLog('Вы стартуете на станции Lave. Удачной торговли, командир.');
}

function addLog(text: string, at = Date.now()): void {
  log.unshift({ at, text });
  if (log.length > 100) log.length = 100;
}

/* ---------- Уведомления ---------- */

function notify(text: string): void {
  if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
    new Notification('Elite Idle', { body: text });
  }
}

function handleEvents(events: GameEvent[]): void {
  for (const e of events) {
    addLog(e.text, e.at);
    if (e.type === 'detected' || e.type === 'combat-start' || e.type === 'damaged' || e.type === 'arrived') {
      notify(e.text);
    }
  }
}

/* ---------- Форматирование ---------- */

const UNITS = ['т', 'кг', 'г'];
const cr = (n: number): string => `${(n / 10).toFixed(1)} CR`;
const ly = (n: number): string => `${(n / 10).toFixed(1)} св. г.`;

/*
 * §125: цена станции — сотни тысяч кредитов.
 *
 * `cr()` показывает копейки: «477 420.0 CR» на такой сумме читается как
 * выписка из бухгалтерии, да ещё и без разрядов. Для цены станции —
 * целые кредиты с пробелами между разрядами: «477 400 CR».
 */
const cash = (n: number): string =>
  `${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} CR`;

/**
 * Длительность человеческим языком.
 *
 * Раньше при часе и больше печаталось `1:00:00`, а до часа — `15:00`.
 * Это читается двусмысленно: `1:00` можно принять и за час, и за минуту
 * с секундами. Теперь у каждой единицы своя подпись: «1 ч 00 мин»,
 * «16 мин 24 с», «42 с». Для таймера в полёте важна точность до секунды,
 * для плана прыжка — читаемость.
 */
function fmtDur(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  // «1 ч 00 мин» — это «ровно час», и печатать нули незачем.
  if (h > 0) return m > 0 ? `${h} ч ${pad(m)} мин` : `${h} ч`;
  if (m > 0) return s > 0 ? `${m} мин ${pad(s)} с` : `${m} мин`;
  return `${s} с`;
}

const fmtTime = (at: number): string =>
  new Date(at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const JUMP_ERRORS: Record<JumpError, string> = {
  'in-flight': 'Корабль уже в полёте',
  'same-system': 'Вы уже в этой системе',
  'too-far': 'Не хватает топлива',
  'bad-target': 'Неверная цель',
  // §78: патруль требует полного боекомплекта и запаса топлива.
  'no-missiles': 'Для патруля нужно 4 ракеты',
  'no-fuel': 'Мало топлива даже на возврат',
  // §133.12: во время «Сверхновой» патруль и пиратство закрыты.
  'locked': 'Станция занята беженцами: патруль и пиратство недоступны',
};

const SHIP_ERRORS: Record<ShipError, string> = {
  'in-flight': 'Корабли продают только на станции',
  unavailable: 'В этой системе такую модель не продают — нужна более промышленная',
  cash: 'Не хватает денег даже с зачётом старого корабля',
  owned: 'Это ваш корабль',
  cargo: 'Груз не влезет в трюм нового корабля — сначала продайте лишнее',
};

/** §105: почему не получилось нанять или назначить маршрут. */
const PILOT_ERRORS: Record<PilotError, string> = {
  'in-flight': 'Пилотами занимаются только на станции',
  rank: 'Пилоты идут к опытным: нужен ранг «Опытный»',
  unavailable: 'Такой корабль на этой верфи не продаётся',
  cash: 'Не хватает на корабль и задаток',
  none: 'Такого пилота нет',
  self: 'Это его же система — летать некуда',
  range: 'Далеко для его бака',
  taken: 'Этой линией уже летает ваш пилот — они собьют друг другу цену',
  busy: 'Пилот ещё в перелёте — дождитесь прилёта',
  same: 'Этот корабль у него уже стоит',
};

/* §127: почему станцию купить не вышло — три разных ответа, не один. */
const STATION_BUY_ERRORS: Record<'in-flight' | 'owned' | 'cash', string> = {
  'in-flight': 'Покупать станцию можно только на причале',
  owned: 'Эта станция уже ваша',
  cash: 'Не хватает денег на эту станцию',
};

const EQUIPMENT_ERRORS: Record<EquipmentError, string> = {
  'in-flight': 'Покупки возможны только на станции',
  model: 'На этот корабль такое не ставится',
  tech: 'Технологический уровень системы слишком низкий',
  cash: 'Не хватает денег',
  owned: 'Уже установлено',
  full: 'Боекомплект полон',
};

/* ---------- Экраны ---------- */

/**
 * Вкладки, которые доступны только на станции.
 *
 * Рынок и ангар — это места, куда надо СТЫКОВАТЬСЯ: торговать и ставить
 * оборудование можно лишь у причала. В полёте они показывались, но все
 * кнопки были выключены, и экран выглядел сломанным. Правильнее не пускать
 * туда вовсе.
 *
 * Это ещё и проверка честности игры: раз мы «просто летим», рынок в пути
 * не должен быть доступен — иначе полёт перестаёт что-либо значить.
 */
const DOCKED_ONLY: Tab[] = ['hangar'];

/** Вкладки, недоступные в полёте именно сейчас. */
function blockedTabs(): Tab[] {
  return state.flight ? DOCKED_ONLY : [];
}

/*
 * §89: иконки вкладок — SVG, а не эмодзи.
 *
 * Эмодзи рисовал сам шрифт: на каждом телефоне свой, в цвете, с толщиной
 * штриха, которая не совпадала ни с текстом, ни между собой. Здесь один
 * набор: контурные фигуры 24×24, `stroke` текущим цветом, `fill` нет.
 * Тогда активная вкладка красит иконку через `color`, а CSS остаётся
 * единственным местом, где задан цвет.
 *
 * `currentColor` в `stroke` — не мелочь: без него иконки пришлось бы
 * дублировать под активное и неактивное состояние.
 */
const icons = {
  /** Корабль: стрелка вверх — «свой ход», как в навигации. */
  ship: '<path d="M12 3.5 18.5 20 12 16.2 5.5 20 12 3.5Z"/>',
  /** Карта: рамка и точка нахождения внутри. */
  map: '<path d="M3.5 6.5 9 4.5v13l-5.5 2v-13Z"/><path d="M9 4.5 15 6.5v13L9 17.5"/><path d="M15 6.5l5.5-2v13l-5.5 2"/><circle cx="12" cy="11" r="1.4" fill="currentColor" stroke="none"/>',
  /** Рынок: две встречные стрелки — обмен. */
  market: '<path d="M4 8.5h13"/><path d="m13.5 5 3.5 3.5-3.5 3.5"/><path d="M20 15.5H7"/><path d="M10.5 12 7 15.5 10.5 19"/>',
  /** Ангар: гаечный ключ — ремонт и снаряжение. */
  hangar: '<path d="M15.5 4.5a4.6 4.6 0 0 0-4 6.9L4.6 18.3a1.6 1.6 0 0 0 2.2 2.2l6.9-6.9a4.6 4.6 0 0 0 5.8-6.1l-2.6 2.6-2.6-.7-.7-2.6 2.4-2.4a4.6 4.6 0 0 0-.5-.3Z"/>',
  /** Журнал: лист с линиями. */
  log: '<path d="M6 3.5h8.5L19 8v12.5H6V3.5Z"/><path d="M14 3.5V8h4.5"/><path d="M9 12h7"/><path d="M9 15.5h5"/>',

  /*
   * §130: ЗНАЧКИ РОЛЕЙ.
   *
   * Пользователь: «нарисуй векторные минималистичные значки для торговца
   * (знак доллара), пирата (череп), полиции (щит), охотника (пара скрещенных
   * мечей), контрабандист (придумай сам)». Контрабандисту досталась маска:
   * он не воюет и не торгует в открытую — он ездит с чужим лицом.
   *
   * Рисунок тот же, что у вкладок: viewBox 24, обводка `currentColor`,
   * никакой заливки, кроме зрачков. Значок не заменяет слово, а помогает
   * найти строку глазом: роль читается раньше имени.
   */
  trader: '<path d="M12 3.5v17"/><path d="M16.2 7.4c-.7-1.5-2.4-2.4-4.2-2.4-2.3 0-4 1.2-4 3s1.7 2.8 4 3.2 4 1.3 4 3.1-1.7 3-4 3c-1.9 0-3.6-.9-4.2-2.4"/>',
  pirate: '<path d="M12 3.4c-3.9 0-6.8 2.8-6.8 6.4 0 2.1 1 3.6 2.4 4.4v2.4c0 1 .8 1.8 1.8 1.8h5.2c1 0 1.8-.8 1.8-1.8v-2.4c1.4-.8 2.4-2.3 2.4-4.4 0-3.6-2.9-6.4-6.8-6.4Z"/><circle cx="9.4" cy="9.9" r="1.35" fill="currentColor" stroke="none"/><circle cx="14.6" cy="9.9" r="1.35" fill="currentColor" stroke="none"/><path d="M10.6 15.6v2.2M13.4 15.6v2.2"/>',
  police: '<path d="M12 3.6 19 6.4v5.3c0 4.1-2.9 7-7 8.8-4.1-1.8-7-4.7-7-8.8V6.4L12 3.6Z"/>',
  hunter: '<path d="M6.6 17.4 17.4 6.6"/><path d="M4.4 15.4l4.2 4.2"/><path d="M17.4 17.4 6.6 6.6"/><path d="M19.6 15.4l-4.2 4.2"/>',
  smuggler: '<path d="M3.6 10c2.6-1.7 5.4-2.3 8.4-2.3s5.8.6 8.4 2.3c-.6 2.7-2.9 4.5-5.6 4.5-1.4 0-2.3-.8-2.8-1.6-.5.8-1.4 1.6-2.8 1.6-2.7 0-5-1.8-5.6-4.5Z"/><circle cx="8.6" cy="10.2" r="1.1" fill="currentColor" stroke="none"/><circle cx="15.4" cy="10.2" r="1.1" fill="currentColor" stroke="none"/>',
} as const;

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'ship', label: 'Корабль', icon: icons.ship },
  { id: 'map', label: 'Карта', icon: icons.map },
  // §98: в полёте это не рынок, а трюм. Тот же значок обмена: игрок ищет
  // груз там же, где торговал, и не должен переучиваться.
  { id: 'market', label: 'Рынок', icon: icons.market },
  { id: 'hangar', label: 'Ангар', icon: icons.hangar },
  { id: 'log', label: 'Журнал', icon: icons.log },
];

/** Обёртка иконки: общие атрибуты в одном месте, чтобы не дублировать в разметке. */
const icon = (body: string): string =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
     stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"
     aria-hidden="true" focusable="false">${body}</svg>`;

/**
 * §130: значок роли перед именем.
 *
 * Одна функция на обе роли — пилота (`PilotRole`) и встречи (`EncounterRole`):
 * торговец, пират и полиция есть и там, и там, и два разных набора значков
 * для одного слова были бы ошибкой. `data-role` нужен проверкам: искать
 * картинку по цвету обводки — плохая идея.
 */
function roleIcon(role: PilotRole | EncounterRole): string {
  return `<span class="role-ico" data-role="${role}">${icon(icons[role])}</span>`;
}

/**
 * Блок журнала, который можно свернуть.
 *
 * Свёрнутый — одна строка: сколько записей и кнопка «Развернуть». Развёрнутый
 * — обычный список. Используется один и тот же код и на «Журнале», и в
 * настройках, чтобы вид не разъезжался.
 *
 * Кнопка — настоящий `button`, а не `details`: `details` при перерисовке
 * `innerHTML` теряет открытость, а её пришлось бы хранить отдельно и
 * восстанавливать. Один флаг в памяти проще и надёжнее.
 */
function logCard(): string {
  const count = log.length;
  const word = count === 1 ? 'запись' : count >= 2 && count <= 4 ? 'записи' : 'записей';
  const head = `<div class="row"><h2 style="margin:0">Журнал</h2><span class="spacer"></span>
      <button class="btn text" data-action="log-toggle" aria-expanded="${logCollapsed ? 'false' : 'true'}">
        ${logCollapsed ? `Развернуть (${count})` : 'Свернуть'}</button></div>`;
  if (logCollapsed) {
    return `<div class="card">${head}<div class="muted" style="margin-top:8px">${
      count === 0 ? 'Пока пусто' : `${count} ${word}, последняя: ${log[0].text}`
    }</div></div>`;
  }
  const items = log.map((e) => `<li><time>${fmtTime(e.at)}</time>${e.text}</li>`).join('');
  return `<div class="card">${head}<ul class="log">${items || '<li>Пока пусто</li>'}</ul></div>`;
}

/**
 * Ячейка сетки показателей. Флаг `danger` (§83.1) красит рамку — так
 * красным горит сам «Статус», когда пилот в розыске.
 */
function stat(label: string, value: string, danger = false): string {
  return `<div class="stat${danger ? ' danger' : ''}"><div class="label">${label}</div><div class="value">${value}</div></div>`;
}

/**
 * Короткое обозначение экономики для карты.
 *
 * Полное «Преимущественно промышленная» на карте не помещается и
 * налезает на соседние подписи. Сокращаем до двух слов: тип + уровень.
 * Смысл сохраняется, строка влезает под точку.
 */
const ECONOMY_SHORT = [
  'пром. богатая',
  'пром. средняя',
  'пром. бедная',
  'пром. преим.',
  'агро преим.',
  'агро богатая',
  'агро средняя',
  'агро бедная',
] as const;

function shortEconomy(i: number): string {
  return ECONOMY_SHORT[i] ?? '—';
}

/**
 * Краткая карточка системы (§82).
 *
 * Пользователь попросил «добавить недостающую инфу о планете». Раньше
 * было три поля (экономика, правительство, техуровень), а данные в
 * `StarSystem` есть шире: население и продуктивность. Это то, что игрок
 * в оригинале видел на экране системы, и то, по чему выбирают, куда лететь
 * торговать.
 *
 * Названия экономик расшифрованы (ECONOMIES даёт прилагательное вида
 * «сельскохозяйственная»), население — в миллиардах, как в оригинале.
 */
function systemInfo(index: number): string {
  const s = systemsOf(state.galaxy)[index];
  const pop = (s.population * 256) / 1000;
  const popText = pop >= 1 ? `${pop.toFixed(1)} млрд` : `${Math.round(pop * 1000)} млн`;
  /*
   * §132.9: ОПИСАНИЕ — ПАРЫ «СЛЕВА ПОДПИСЬ, СПРАВА ЗНАЧЕНИЕ».
   *
   * Пользователь: «Описание сделай по принципу: Правительство: Диктатура
   * (правительство слева, Диктатура справа)».
   *
   * Раньше это был слитный абзац: экономика и правительство через запятую,
   * ниже три числа через точки. Глазу не за что зацепиться, а сравнить две
   * планеты по одной строке было нельзя. Теперь каждая величина — своя строка
   * с подписью; подписи стоят столбцом слева, значения справа от двоеточия,
   * и первая буква значения совпадает во всех строках.
   *
   * Разметка остаётся одним текстовым блоком (строки через `<br>`), поэтому
   * редактор интерфейса продолжает видеть в нём одну многострочную строку.
   */
  /*
   * §132.11: КАЖДАЯ ВЕЛИЧИНА — СВОЁ ПОЛЕ.
   *
   * Пользователь: «Сделай весь динамический текст в игре отдельными полями или
   * реши проблему иначе (допустим, я меняю слово „Правительство", а если выбрать
   * другую станцию, то текст ломается)».
   *
   * До этого блок был единой строкой из шести строк через `<br>`: редактор
   * правил целую простыню, и любая правка жила в общей куче с числами планеты.
   * Теперь подпись и значение — два разных элемента в своей строке. Правка
   * подписи не может задеть значение: это другой узел. Поменяли «Правительство»
   * на «Власть» — и на любой другой планете меняется только слово.
   *
   * Внешне ничего не изменилось: подпись с двоеточием и значение идут подряд,
   * как в макете.
   */
  const own = state.stations.includes(index) ? ' · ваша' : '';
  const row = (k: string, v: string): string =>
    `<div class="sys-row"><span class="sys-k">${k}: </span><span class="sys-v">${v}</span></div>`;
  return `<div class="sys-info">${[
    row('Экономика', ECONOMIES[s.economy]),
    row('Правительство', GOVERNMENTS[s.government]),
    row('Техуровень', String(s.techLevel + 1)),
    row('Население', popText),
    row('Продуктивность', String(s.productivity)),
    row('Станция', `${cash(stationPrice(s))}${own}`),
  ].join('')}</div>`;
}

function flightCard(): string {
  const f = state.flight;
  // §102.3: бак — свойство корабля.
  const tank = maxFuel(state.ship);
  if (!f) {
    /*
     * §133.5: «На станции LAVE» → «Станция LAVE» (правка текста в редакторе):
     * предлог ни к чему, имя системы и так отвечает на «где я».
     */
    return `<div class="card"><h2>Станция ${currentSystem(state).name}</h2>
      <div class="sub">${systemInfo(state.system)}</div></div>`;
  }
  /*
   * §82: У ПАТРУЛЯ НЕТ ВРЕМЕНИ ПРИБЫТИЯ.
   *
   * Раньше карточка в полёте всегда писала «Прибытие через …», а у
   * патруля `arriveAt = Infinity` — игрок видел «Прибытие через Infinity ч».
   * Это не поломка часов, а неверная подача: патруль кончается не по
   * времени, а по топливу.
   */
  if (f.patrol) {
    const enc = state.encounter ? encounterCard() : '';
    const pirate = isCriminal(state.legal);
    /*
     * §86: ЖЁЛТАЯ — «следят», КРАСНАЯ — «пиратство».
     *
     * Пользователь развёл два состояния:
     *
     *   Патруль + розыск/контрабанда → ЖЁЛТАЯ («за тобой следят»)
     *   Пиратство (криминальный статус) → КРАСНАЯ (правила другие)
     *
     * До этого обе ситуации были красными, и цвет перестал различать
     * «на меня смотрят» и «я сам хищник».
     */
    const wanted = isCriminal(state.legal);
    const smuggling = contrabandLevel(state.cargo) > 0;
    const frame = pirate ? ' danger' : wanted || smuggling ? ' warn' : '';
    return `<div class="card${frame}"><h2>${pirate ? 'Пиратство' : 'Патруль'}: ${currentSystem(state).name}</h2>
      <div class="row">
        ${stat('Встреч', String(f.encounters))}
        ${stat('Израсходовано', `${f.patrolFuelUsed ?? 0} ед.`)}
      </div>
      ${bar(state.fuel, tank, '', 'flight-fuel')}
      <div class="sub">Топливо <span id="flight-fuel-text">${ly(state.fuel)}</span> из ${ly(tank)}</div></div>${enc}`;
  }
  const systems = systemsOf(state.galaxy);
  const enc = state.encounter ? encounterCard() : '';
  const frame = isCriminal(state.legal) || contrabandLevel(state.cargo) > 0 ? ' danger' : '';
  return `<div class="card${frame}"><h2>В пути: ${systems[f.from].name} → ${systems[f.to].name}</h2>
    <div class="progress"><div id="flight-bar" style="width:0%"></div></div>
    <div class="sub">Прибытие через <span id="flight-eta"></span></div></div>${enc}`;
}

/**
 * Уведомление о встрече с тремя кнопками (§38.1, §40).
 *
 * Раундов нет: одно решение — и исход. Кнопки показываются только
 * доступные, с причиной отказа в подсказке. Таймер виден, чтобы игрок
 * понимал, сколько у него времени до автобоя.
 */
function encounterCard(): string {
  const e = state.encounter!;
  const enemy = enemyOf(e.enemyId);
  const hostile = e.outcome === 'attack';
  const lasers = {
    pulse: state.ship.laser === 'pulse',
    beam: state.ship.laser === 'beam',
    military: state.ship.laser === 'military',
    mining: state.ship.laser === 'mining',
  };
  const best = bestLaserOf(lasers);
  // §77: капсулы нет, третий аргумент больше ни на что не влияет.
  /*
   * §95: «законная цель» — это РОЛЬ, а не флаг модели. `enemy.pirate`
   * означает «на таком корабле летают пираты»; Cobra Mk III бывает и
   * торговой. Поэтому напасть можно на пирата по роли — даже если он
   * сейчас летит мимо (жёлтый, §86).
   */
  const can = availableDecisions(
    enemy,
    best,
    true,
    isLegalTarget(e.role, hostile),
    toughnessOf(state.ship),
  );

  const btn = (decision: Decision, label: string, enabled: boolean, reason?: string): string =>
    `<button class="btn" data-action="decide" data-decision="${decision}" ${enabled ? '' : 'disabled'}
      title="${reason ?? ''}">${label}</button>`;

  /*
   * §85: ЦВЕТ КАРТОЧКИ ВСТРЕЧИ ПО РОЛИ И ВРАЖДЕБНОСТИ.
   *
   * Пользователь: «красить карточку, полицию и охотника различать только
   * если враждебны, а так — зелёный».
   *
   * Правило простое: угроза красная, всё остальное зелёное. Пират, который
   * уже атакует, и власть, которая вас ищет, — красные. Мирный торговец,
   * патруль, которому вы безразличны, и охотник, летящий мимо, — зелёные:
   * драться с ними не нужно.
   *
   * Жёлтого больше нет: раньше карточка была жёлтой ВСЕГДА, то есть цвет
   * не нёс информации.
   */
  /*
   * §86: ПИРАТ, ЛЕТЯЩИЙ МИМО, — ЖЁЛТЫЙ.
   *
   * Пользователь: «пират, летящий мимо — жёлтый». Это правильно: он не
   * атакует СЕЙЧАС, но он пират — в любой момент может передумать.
   * Зелёный здесь врал бы: торговец безопасен, а пират — нет.
   *
   *   атакует            → красная
   *   пират, но не атакует → жёлтая
   *   все остальные мирные → зелёная
   */
  const tone = hostile ? ' danger' : e.role === 'pirate' ? ' warn' : ' calm';
  const share = hostile && can.attack ? '' : '';
  // Модель встречного корабля: видно, с кем имеешь дело, а не только
  // название. Корабль, которого нет в парке (канистра, астероид),
  // просто не показывается — лучше пусто, чем силуэт не того класса.
  const model = FLEET[enemy.id]
    ? `<canvas class="enc-model" data-ship="${enemy.id}" aria-label="Модель корабля ${enemy.name}"></canvas>`
    : '';
  return `<div class="card${tone}"><h2>${roleIcon(e.role)}В радиусе: ${ROLE_NAMES[e.role]} (${enemy.name})</h2>
    ${model}
    <div class="sub">${hostile ? 'Враждебен' : 'Не враждебен'} · Решение через <span id="enc-eta"></span></div>
    <div class="row" style="margin-top:12px">
      ${btn('attack', 'Напасть', can.attack, can.attackReason)}
      ${btn('flee', 'Бежать', can.flee, can.fleeReason)}
      ${btn('skip', 'Пропустить', can.skip)}
    </div>
    ${can.attackReason && !can.attack ? `<div class="muted" style="margin-top:6px">${can.attackReason}</div>` : ''}
    ${can.fleeReason && !can.flee ? `<div class="muted" style="margin-top:4px">${can.fleeReason}</div>` : ''}
  </div>${share}`;
}

function equipmentSummary(): string {
  const s = state.ship;
  /*
   * §102.3: с появлением разных кораблей модель — часть снаряжения, а не
   * украшение. Раньше её негде было увидеть, кроме ангара.
   */
  const parts = [
    shipSpec(s).name,
    `Лазер: ${LASER_NAMES[s.laser]}`,
    `Ракеты: ${s.missiles} из ${maxMissiles(s)}`,
  ];
  if (s.ecm) parts.push('ECM');
  if (s.energyBomb) parts.push('Энергобомба');
  if (s.energyUnit) parts.push('Энергоблок');
  if (s.fuelScoops) parts.push('Топливосборщик');
  if (s.dockingComputer) parts.push('Стыковочный компьютер');
  if (s.galacticHyperdrive) parts.push('Галактический гипердвигатель');
  if (s.cargoBayExtended) parts.push('Увеличенный трюм');
  return parts.join(' · ');
}

/**
 * Что показать вместо экрана, который в полёте недоступен.
 *
 * Возвращается на «Корабль», потому что там полёт виден лучше всего.
 */
function unavailableNote(): string {
  return `<div class="card"><h2>Только на станции</h2>
    <div class="sub">Рынок и ангар открываются у причала. В полёте вы в космосе — торговать и ставить оборудование негде.</div></div>`;
}

function shipScreen(): string {
  const tons = cargoTons(state);
  const items = COMMODITIES.map((c, i) => (state.cargo[i] > 0 ? `${c.name}: ${state.cargo[i]} ${UNITS[c.unit]}` : ''))
    .filter(Boolean)
    .join('<br>');
  /*
   * §83.1: красная рамка у «Статуса» и «Груза».
   *
   * Пользователь заметил: рамка появилась только у патруля, а блоки,
   * которые ПОКАЗЫВАЮТ то же самое, остались обычными. Логика простая:
   * если в розыске — красным горит сам статус; если в трюме запрещёнка —
   * красным горит сам груз. Игрок видит причину там, где она написана,
   * а не только на карточке патруля.
   */
  // §83.2: «Статус» не красим — пользователь сказал «тогда ладно, не крась».
  // Плитка сетки с цветной полосой смотрелась чужеродно рядом с карточками.
  const smuggling = contrabandLevel(state.cargo) > 0;
  return `${flightCard()}${destinationCard()}
    <div class="grid">
      ${stat('Деньги', cr(state.cash))}
      ${stat('Топливо', ly(state.fuel))}
      ${stat('Трюм (т)', `${tons} / ${tons + state.holdSpace}`)}
      ${stat('Галактика', String(state.galaxy))}
      ${stat('Ранг', rankOf(state.kills))}
      ${stat('Статус', legalLabel(state.legal))}
    </div>
    ${isCriminal(state.legal)
      ? `<div class="card warn"><h2>Розыск: ${state.legal} (${legalLabel(state.legal)})</h2>${escapeWarn()}</div>`
      : ''}
    ${state.ship.laser === 'none'
      ? `<div class="card warn"><h2>Лазера нет</h2>
      <div class="sub">Без лазера вы не можете ни нападать, ни обороняться: карточка встречи предложит только «Бежать» и «Пропустить», а автобой не выиграет ни одного боя. Купите лазер в ангаре, пока стоите у причала.</div></div>`
      : ''}
    <div class="card"><h2>Оснащение корабля</h2><div class="muted">${equipmentSummary()}</div></div>
    <div class="card${smuggling ? ' danger' : ''}"><h2>Груз в трюме</h2><div class="muted">${items || 'Трюм пуст'}</div></div>`;
}

/**
 * §121: СЧЁТЧИК ПОБЕГА.
 *
 * Пользователь второй раз оказался в розыске 255 и не знал, что делать:
 * правило «12 новых планет — и статус чист» (§84) существует, но его
 * видно только в журнале, куда игрок не смотрит. Здесь — та же цифра, но
 * на экране, рядом с причиной: и «ещё не начал», и «сколько осталось», и
 * «нельзя, в трюме запрещёнка».
 */
function escapeWarn(): string {
  const { done, need } = escapeProgress(state);
  if (done === 0 && !isCriminal(state.legal)) return '';
  const banned = contrabandLevel(state.cargo);
  if (banned > 0) {
    return `<div class="sub" style="margin-top:6px">Побег невозможен: в трюме ${banned} ${plural(banned, 'тонна', 'тонны', 'тонн')} запрещённого товара. Сбросьте его во вкладке «Трюм» — иначе статус не снизится.</div>`;
  }
  if (done === 0) {
    return `<div class="sub" style="margin-top:6px">Побег не начат: ${need} ${plural(need, 'новая планета', 'новые планеты', 'новых планет')} без возврата — и розыск сгорит. Первый прыжок откроет маршрут.</div>`;
  }
  const left = need - done;
  return `<div class="sub" style="margin-top:6px">Побег: <b data-escape="${done}/${need}">${done}/${need}</b> · ещё ${left} ${plural(left, 'планета', 'планеты', 'планет')} — и розыск сгорит. На посещённые не возвращайтесь: маршрут начнётся заново.</div>`;
}

/**
 * Пункт назначения на экране «Корабль».
 *
 * Пользователь просил сюда имя планеты, расстояние и время полёта.
 * Данные уже есть: цель выбирается на карте и лежит в `selected`.
 * Раньше, чтобы их увидеть, нужно было вернуться на карту — а на
 * экране «Корабль» игрок как раз и решает, лететь ему или нет.
 *
 * Три состояния:
 *  - цель не выбрана — подсказка, где её выбрать;
 *  - цель выбрана — имя, расстояние, время и предупреждение, если
 *    топлива не хватает;
 *  - корабль в полёте — показываем, куда и сколько осталось, потому
 *    что цель в этот момент уже неактуальна.
 */
/**
 * Кнопки космоса в блоке «Пункт назначения» (§81).
 *
 * Пользователь решил так: мини-игра стыковки отключена, «Отстыковка» и
 * «Прыжок» заменены на ОДНО действие — «Перелёт». Это то, за чем игрок
 * приходит на экран «Корабль»: выбрать, куда лететь, и полететь.
 *
 * Второй кнопкой — «Патрулировать» (или «Пиратство», если статус
 * криминальный): полёт внутри системы без цели. Режим виден по подписи,
 * потому что правила у них разные: в пиратстве в зачёт идут все корабли.
 */
function flightButtons(): string {
  // §82: В ПАТРУЛЕ перелёт разрешён — игрок не должен быть заперт.
  // Остальные кнопки в полёте не нужны.
  const inPatrol = state.flight?.patrol === true;
  if (state.flight && !inPatrol) return '';

  const systems = systemsOf(state.galaxy);
  const here = systems[state.system];
  const dest = selected !== null ? systems[selected] : null;
  const d = dest ? distance(here, dest) : 0;

  // Перелёт: цель должна быть выбрана, быть не текущей и хватать топлива.
  let jumpReason = '';
  if (!dest) jumpReason = 'Сначала выберите цель на карте';
  else if (selected === state.system) jumpReason = 'Вы уже здесь';
  else if (d > state.fuel) jumpReason = 'Не хватает топлива';

  const jump = `<button class="btn" data-action="jump" data-to="${selected ?? ''}" ${jumpReason ? 'disabled' : ''}>Перелёт</button>`;

  /*
   * Патруль: нужны ракеты (их тратят большие корабли) и бак на резерв
   * возврата. Причина отказа показывается ПОД кнопкой: молча выключенная
   * кнопка — худшее, что можно сделать в интерфейсе, игрок не поймёт,
   * чего не хватает.
   */
  const pirate = isCriminal(state.legal);
  let patrolReason = '';
  if (stationLocked(state)) {
    patrolReason = JUMP_ERRORS['locked'];
  } else if (state.ship.missiles < patrolMissilesRequired(state.ship)) {
    patrolReason = `Не полный боекомплект: ${state.ship.missiles} из ${patrolMissilesRequired(state.ship)}`;
  } else if (state.fuel <= PATROL_RETURN_RESERVE) {
    patrolReason = `Нужен запас топлива на возврат: в баке ${ly(state.fuel)}`;
  }
  const patrol = inPatrol
    ? '<button class="btn" data-action="return-from-patrol">Вернуться</button>'
    : `<button class="btn${pirate ? ' danger' : ''}" data-action="patrol" ${patrolReason ? 'disabled' : ''}>${pirate ? 'Пиратство' : 'Патрулировать'}</button>`;

  /*
   * §118: ПАТРУЛЬ В РОЗЫСКЕ — ЭТО УЖЕ ПИРАТСТВО.
   *
   * Пользователь получил «пиратство во время патруля»: статус был выше
   * нуля, полиция стала враждебной, автобой сбил семь Viper'ов по +64, и
   * потолок 255 наступил за четыре боя. Кнопка меняла надпись на
   * «Пиратство», но не объясняла, что будет. Теперь объясняет — до нажатия,
   * а не в журнале после.
   */
  const pirateWarn = pirate
    ? `<div class="sub" style="margin-top:6px">Вы в розыске: ${state.legal} (${legalLabel(state.legal)}). Полиция будет атаковать, торговцы станут добычей, за каждого сбитого полицейского +${POLICE_KILL_LEGAL} к розыску.</div>${escapeWarn()}`
    : '';

  return `<div class="row" style="margin-top:12px;gap:8px;flex-wrap:wrap">${jump}${patrol}</div>
    ${jumpReason ? `<div class="sub" style="margin-top:6px">${jumpReason}</div>` : ''}
    ${patrolReason ? `<div class="sub" style="margin-top:6px">${patrolReason}</div>` : ''}
    ${pirateWarn}`;
}

/**
 * Пункт назначения на экране «Корабль».
 *
 * Пользователь просил сюда имя планеты, расстояние и время полёта — и
 * чтобы нажатие на блок вело на карту. Карточка целиком кликабельна:
 * это привычнее, чем искать мелкую ссылку, а на телефоне палец и так
 * бьёт по всей площади.
 *
 * Три состояния:
 *  - цель не выбрана — подсказка и приглашение открыть карту;
 *  - цель выбрана — имя, характеристики, расстояние, время и топливо;
 *  - корабль в полёте — куда и сколько осталось.
 *
 * Здесь же кнопка «Отстыковаться»: экран «Корабль» — место, где игрок
 * решает, лететь ему или нет, и уходить за этим на карту неудобно.
 */
function destinationCard(): string {
  const systems = systemsOf(state.galaxy);
  const here = systems[state.system];
  const buttons = flightButtons();
  // Блок целиком ведёт на карту: data-action на карточке, а кнопка
  // внутри гасит всплытие своим обработчиком.
  const open = '<div class="card linkable" data-action="go-map" role="link" tabindex="0">';

  if (state.flight) {
    const f = state.flight;
    /*
     * §82: ПАТРУЛЬ — НЕ ПЕРЕЛЁТ.
     *
     * Раньше блок показывал «осталось Infinity ч», потому что у патруля
     * `arriveAt = Infinity` (он кончается топливом, а не временем). Это
     * выглядело как поломка. Теперь у патруля своя карточка: режим,
     * встречи, расход топлива и кнопка возврата.
     */
    /*
     * §82: у патруля нет времени прибытия — он кончается топливом.
     * Показываем «в системе» и кнопки, без остатка пути.
     */
    if (f.patrol) {
      return `<div class="card"><h2>Пункт назначения</h2>
        <div class="row"><span class="price">${systems[state.system].name}</span><span class="spacer"></span>
          <span class="muted">${isCriminal(state.legal) ? 'пиратство' : 'патруль'}</span></div>
        <div class="sub" style="margin-top:6px">Полёт внутри системы, цель не нужна</div>
        ${flightButtons()}
      </div>`;
    }
    const left = Math.max(0, f.arriveAt - Date.now());
    return `${open}<h2>Пункт назначения</h2>
      <div class="row"><span class="price">${systems[f.to].name}</span><span class="spacer"></span>
        <span class="muted">в пути</span></div>
      <div class="sub" style="margin-top:6px">Из ${systems[f.from].name} · осталось ${fmtDur(left)}</div>
      ${flightButtons()}
    </div>`;
  }

  if (selected === null) {
    return `${open}<h2>Пункт назначения</h2>
      <div class="muted">Не выбран. Нажмите сюда, чтобы открыть карту и выбрать систему.</div>
      ${buttons ? `<div class="row" style="margin-top:12px;gap:8px;flex-wrap:wrap">${buttons}</div>` : ''}
    </div>`;
  }

  const dest = systems[selected];
  const d = distance(here, dest);
  const enough = d <= state.fuel;
  // Время считаем той же функцией, что и сам прыжок, иначе подпись
  // обещает одно, а полёт занимает другое.
  const trip = jumpDuration(settings, d);

  return `<div class="card linkable${enough ? '' : ' warn'}" data-action="go-map" role="link" tabindex="0"><h2>Пункт назначения</h2>
    <div class="row">
      <span class="price">${dest.name}</span>
      <span class="chip">Т${dest.techLevel + 1}</span>
      <span class="spacer"></span>
      <span class="price">${ly(d)}</span>
    </div>
    <div class="sub" style="margin-top:6px">${shortEconomy(dest.economy)} · ${GOVERNMENTS[dest.government]}</div>
    <div class="row" style="margin-top:12px">
      ${stat('Время полёта', fmtDur(trip))}
      ${stat('Топливо', `${ly(d)} из ${ly(state.fuel)}`)}
    </div>
    ${enough
      ? `<div class="sub" style="margin-top:8px">Прыжок тратит ${ly(d)} топлива, после него останется ${ly(state.fuel - d)}</div>`
      : `<div class="muted" style="margin-top:8px;color:var(--warn)">Не хватает топлива: нужно ${ly(d)}, в баке ${ly(state.fuel)}. Заправьтесь в ангаре.</div>`}
    ${buttons ? `<div style="margin-top:12px">${buttons}</div><div class="sub" style="margin-top:8px">Нажмите на карточку, чтобы сменить цель</div>` : ''}
  </div>`;
}

function bar(value: number, max: number, cls = '', id = ''): string {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const mark = id ? ` id="${id}"` : '';
  return `<div class="progress ${cls}"><div${mark} style="width:${pct.toFixed(0)}%"></div></div>`;
}

function combatScreen(): string {
  const active = state.combat!;
  const c = active.combat;
  const enemy = enemyById(c.enemyId);
  const btn = (a: CombatAction, label: string): string =>
    `<button class="btn tonal" data-action="combat" data-a="${a}" ${canDo(c, a) ? '' : 'disabled'}>${label}</button>`;
  const lines = c.log
    .slice(-8)
    .reverse()
    .map((l) => `<li>${l}</li>`)
    .join('');
  return `<div class="card danger"><h2>${ROLE_NAMES[active.role]}: ${enemy.name}</h2>
      <div class="sub">Энергия противника: ${Math.max(0, c.enemyEnergy)} / ${enemy.energy}</div>
      ${bar(c.enemyEnergy, enemy.energy, 'enemy')}
      <div class="sub">Щиты: ${Math.round(c.shields)} / ${MAX_SHIELDS}</div>${bar(c.shields, MAX_SHIELDS)}
      <div class="sub">Энергия: ${Math.round(c.energy)} / ${MAX_ENERGY}</div>${bar(c.energy, MAX_ENERGY)}
      ${c.incomingMissile ? '<div class="alert">⚠ Ракета противника на подходе!</div>' : ''}
    </div>
    <div class="card"><h2>Действия</h2>
      <div class="row">
        ${btn('laser', 'Лазер')}
        ${btn('missile', `Ракета (${c.playerMissiles})`)}
        ${btn('ecm', 'ECM')}
        ${btn('bomb', 'Энергобомба')}
        ${btn('flee', 'Уйти от боя')}
        ${btn('dump', 'Сбросить груз')}
      </div>
      <div class="row" style="margin-top:12px">
        <button class="btn" data-action="combat-auto">Автобой до конца</button>
      </div>
    </div>
    <div class="card"><h2>Ход боя</h2><ul class="log">${lines}</ul></div>`;
}

/**
 * Карточка «Прогресс в файле».
 *
 * Зачем файл, если игра уже сохраняется в браузере: `localStorage` привязан
 * к устройству и к браузеру. Почистил кэш, открыл на другом компьютере,
 * зашёл в приватном окне — прогресса нет. Файл переносит игру между
 * устройствами и переживает чистку браузера.
 *
 * Кнопка выгрузки не спрашивает подтверждения: она ничего не меняет.
 * Кнопка загрузки спрашивает всегда — она затирает текущий прогресс, а
 * вернуть его будет нечем.
 */
function saveCard(): string {
  const when = lastFileSaveAt ? `<div class="muted" style="margin-top:8px">Последняя выгрузка: ${formatSavedAt(lastFileSaveAt)}</div>` : '';
  return `<div class="card"><h2>Прогресс в файле</h2>
      <div class="sub">Игра сохраняется в этом браузере. Файл нужен, чтобы перенести прогресс на другое устройство или сохранить его навсегда.</div>
      <div class="row" style="margin-top:12px">
        <button class="btn tonal" data-action="save-file">Сохранить в файл</button>
        <span class="spacer"></span>
        <button class="btn tonal" data-action="load-file">Загрузить из файла</button>
      </div>
      <input type="file" id="load-file-input" accept=".json,application/json" hidden>
      ${when}
      ${saveNotice ? `<div class="${saveNotice.ok ? 'sub' : 'alert'}" style="margin-top:10px">${saveNotice.text}</div>` : ''}
    </div>`;
}

/**
 * Экран подбора груза из обломков.
 *
 * Появляется сразу после победы, если автоподбор выключен. Полёт в это
 * время стоит: подбор держит паузу так же, как бой, — иначе обломки
 * «уехали» бы вместе с прибытием.
 *
 * Каждый контейнер — отдельная кнопка: видно, что именно лежит в
 * обломках, и можно выбрать. Рядом список трюма с кнопками выброса:
 * трюм 20 тонн, а с Питона падает пять канистр, и в тесноте надо
 * решать, что дороже — выброшенное или подобранное.
 */
function salvageScreen(): string {
  const sv = state.salvage!;
  const cargo = COMMODITIES.map((c, i) =>
    state.cargo[i] > 0
      ? `<div class="row"><span>${c.name}: ${state.cargo[i]} ${UNITS[c.unit]}</span><span class="spacer"></span>
          <button class="btn text" data-action="jettison" data-i="${i}">Выбросить 1</button></div>`
      : '',
  )
    .filter(Boolean)
    .join('');
  const list = sv.canisters
    .map((c, i) => {
      const name = COMMODITIES[c.commodity].name;
      const full = isTonneCargo(c.commodity) && state.holdSpace < c.amount;
      /*
       * §97: запрещённый товар помечен прямо в списке.
       *
       * Взять его по-прежнему можно — это решение игрока, и статус вырастет
       * честно (`salvageTake`). Но в патруле, где игрок нажимает кнопки
       * быстро, он должен видеть цену ДО нажатия, а не узнавать из журнала
       * потом. §93 требовал причины в журнале; здесь та же причина, только
       * заранее.
       *
       * Слово «контрабанда» не используется: по правилу пользователя оно не
       * должно появляться — только красный цвет.
       */
      const banned = isContraband(c.commodity);
      const note = full ? ' <span class="muted">— нет места</span>' : '';
      return `<div class="row"><span${banned ? ' class="banned"' : ''}>${name}${note}</span>
        <span class="spacer"></span>
        <button class="btn tonal" data-action="salvage-take" data-i="${i}" ${full ? 'disabled' : ''}>Взять</button></div>`;
    })
    .join('');
  const total = sv.canisters.length;
  return `<div class="card"><h2>Обломки: ${sv.enemyName}</h2>
      <div class="sub">В обломках ${total} ${plural(total, 'контейнер', 'контейнера', 'контейнеров')}. Свободно в трюме: ${state.holdSpace} т</div>
      ${list}
      <div class="row" style="margin-top:14px">
        <button class="btn" data-action="salvage-all">Взять всё чистое</button>
        <button class="btn text" data-action="salvage-close">Оставить</button>
      </div>
    </div>
    <div class="card"><h2>Трюм</h2>${cargo || '<div class="muted">Трюм пуст</div>'}</div>
    <div class="card"><h2>Журнал</h2><ul class="log">${log
      .slice(-6)
      .reverse()
      .map((e) => `<li>${e.text}</li>`)
      .join('')}</ul></div>`;
}

/**
 * Кнопка на карте под выбранной системой.
 *
 * С включённым модулем стыковки прыжок из карты недоступен: космос у нас
 * есть только в мини-игре, там и находится действие «покинуть систему».
 * Вместо него карта предлагает «Отстыковку» — вход в мини-игру.
 */
function jumpControl(_distanceLy: number, _reason: string): string {
  /*
   * §82: НА КАРТЕ НЕТ КНОПКИ ПРЫЖКА.
   *
   * Пользователь: «на карте убери кнопку "прыжок"». Карта — это выбор
   * цели, а полёт запускается на экране «Корабль» кнопкой «Перелёт».
   * Разделение простое: карта решает КУДА, корабль решает КОГДА.
   *
   * Раньше здесь была то «Отстыковка» (с мини-игрой), то «Прыжок» —
   * два разных места для одного действия путали.
   */
  return '';
}

function mapScreen(): string {
  const systems = systemsOf(state.galaxy);
  let info = settings.dockingModule
    ? '<div class="muted">Выберите систему как цель. Прыжок — в мини-игре стыковки.</div>'
    : '<div class="muted">Нажмите на систему, чтобы выбрать цель прыжка.</div>';
  if (selected !== null) {
    const s = systems[selected];
    const d = distance(systems[state.system], s);
    let reason = '';
    if (state.flight) reason = JUMP_ERRORS['in-flight'];
    else if (selected === state.system) reason = JUMP_ERRORS['same-system'];
    else if (d > state.fuel) reason = JUMP_ERRORS['too-far'];
    /*
     * §132.9: ПРИЧИНА ОТКАЗА — В ПРАВОМ ВЕРХНЕМ УГЛУ.
     *
     * Пользователь: «Вы уже в этой системе расположи в правом верхнем углу».
     * Раньше причина висела под карточкой, после «В пути», и читалась как ещё
     * одна справка — хотя это ответ на нажатие «Перелёт». Теперь она стоит в
     * строке заголовка, справа от имени системы: там же, где игрок ищет
     * объяснение, почему кнопка серая.
     *
     * Заголовок `h2` остаётся отдельным элементом: по нему проверяют карту
     * (verify-labels-tap), и обёртка вокруг него сломала бы сравнение.
     */
    const note = reason ? `<span class="sys-note">${reason}</span>` : '';
    /*
     * §132.11: «В пути» — в одной строке с расстоянием, справа, как в макете.
     *
     * Пользователь: «Расположи строку „в пути..." как на скрине и, если мы уже
     * на этой станции, то эту строку не показывай». Время полёта к самому себе
     * — это «1 с при ×200», бессмыслица: расстояние 0.0, лететь некуда.
     */
    const eta =
      selected === state.system
        ? ''
        : `<span class="sys-eta">В пути: ${fmtDur(jumpDuration(settings, d))}${
            settings.speed > 1 ? ` (при ×${settings.speed})` : ''
          }</span>`;
    info = `<div class="sys-head"><h2>${s.name}</h2>${note}</div>
      <div class="sub">${systemInfo(selected)}</div>
      <div class="row" style="margin-top:12px">
        <span class="price">${ly(d)}</span><span class="spacer"></span>${jumpControl(d, reason)}${eta}
      </div>`;
  }
  /*
   * §112: расшифровка цветов маршрутов.
   *
   * Без неё цвет линии — загадка, а подписывать каждую линию именем
   * пилота на карте нельзя: их 20, и они перекроют друг друга. Поэтому
   * легенда одна на всех и только для тех ролей, что сейчас в рейсе.
   * Пилоты без маршрута тоже видны здесь — иначе «нанял, а он не летит»
   * выглядело бы поломкой.
   */
  const flying = state.pilots.filter((p) => p.route !== null);
  const idle = state.pilots.length - flying.length;
  const roles = [...new Set(flying.map((p) => p.role))];
  const legend = roles.length
    ? `<div class="sub" style="margin-top:6px">Маршруты пилотов: ${roles
        .map((r) => `<span style="color:${PILOT_ROLE_CHART[r]}">${PILOT_ROLE_NAMES[r].toLowerCase()}</span>`)
        .join(' · ')}${idle > 0 ? ` · без маршрута: ${idle}` : ''}</div>`
    : '';

  // Две карты одна под другой: общая (вся галактика, горизонтальная)
  // и местная (окно вокруг корабля, крупно).
  return `<div class="card map-card">
      <h2>Галактика ${state.galaxy}</h2>
      <canvas id="map-overview"></canvas>
      <div class="sub">Рамка — область местной карты ниже.</div>${legend}
    </div>
    <div class="card map-card">
      <h2>Окрестности</h2>
      <canvas id="map-local" data-local="1"></canvas>
      <div class="sub" id="local-hint">Доступный радиус прыжка. Нажмите на точку, чтобы выбрать цель.</div>
    </div>
    <div class="card">${info}</div>`;
}

/* ---------- Карты ---------- */

/**
 * Карт-пространство.
 *
 * В Elite расстояние считается как `4·hypot(dx, dy/2)`: по Y оно
 * «дешевле» вдвое. Поэтому карта рисуется не в галактических
 * координатах, а в «карт-пространстве» `(x, y/2)`. Там расстояние —
 * обычное евклидово, круг дальности остаётся кругом, и пропорции
 * совпадают с оригиналом: 255 на 127, то есть ровно 2:1.
 *
 * Из-за этого общая карта выходит ГОРИЗОНТАЛЬНОЙ сама собой — так в
 * ZX Elite и было. Если рисовать в сырых координатах, всё становится
 * квадратным и круг дальности превращается в эллипс.
 */
interface ChartPoint {
  u: number;
  v: number;
}

const chartPoint = (s: { x: number; y: number }): ChartPoint => ({ u: s.x, v: s.y / 2 });

/** Габариты карт-пространства: 255 по горизонтали, 127.5 по вертикали. */
const CHART_W = 255;
const CHART_H = 127.5;

interface ChartView {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /** Пикселей на единицу карт-пространства. Один на обе оси. */
  k: number;
  /** Центр окна в карт-пространстве. */
  cu: number;
  cv: number;
  /** Радиус видимого окна в единицах карт-пространства. */
  radius: number;
  /** Экранные координаты по галактическим. */
  screenOf: (gx: number, gy: number) => { x: number; y: number };
  visible: (s: { x: number; y: number }) => boolean;
}

/** Общая карта: вся галактика, вписана целиком. Горизонтальная. */
function overviewView(canvas: HTMLCanvasElement): ChartView {
  const width = canvas.clientWidth || 320;
  const pad = 10;
  // Пропорции галактики 255:127.5 — ровно 2:1, поэтому высота вполовину.
  const height = Math.round(((width - 2 * pad) * CHART_H) / CHART_W + 2 * pad);
  const k = Math.min((width - 2 * pad) / CHART_W, (height - 2 * pad) / CHART_H);
  const cu = CHART_W / 2;
  const cv = CHART_H / 2;
  return {
    canvas,
    width,
    height,
    k,
    cu,
    cv,
    radius: Math.max(CHART_W, CHART_H) / 2,
    screenOf: (gx, gy) => ({
      x: width / 2 + (gx - cu) * k,
      y: height / 2 + (gy / 2 - cv) * k,
    }),
    visible: () => true,
  };
}

/** Запас сверх радиуса топлива: крайние системы не липнут к рамке. */
const MAP_MARGIN = 1.15;

/**
 * Местная карта: окно вокруг корабля, радиус — по топливу.
 *
 * Квадратная, потому что показывает круг. Масштаб один на обе оси
 * (k), поэтому круг дальности не превращается в эллипс.
 */
function localView(canvas: HTMLCanvasElement): ChartView {
  const width = canvas.clientWidth || 320;
  const pad = 10;
  // Квадрат по ширине: круг дальности влезает целиком и остаётся кругом.
  // Раньше было `min(width, 400)` — на узком экране то же самое, но
  // ограничение 400 срезало высоту на широких экранах и точки ложились
  // теснее по вертикали, чем по горизонтали.
  const height = Math.round(width);
  const here = chartPoint(systemsOf(state.galaxy)[state.system]);
  const radius = Math.max(3, (state.fuel / 4) * MAP_MARGIN);
  const k = Math.min((width - 2 * pad) / (2 * radius), (height - 2 * pad) / (2 * radius));
  return {
    canvas,
    width,
    height,
    k,
    cu: here.u,
    cv: here.v,
    radius,
    screenOf: (gx, gy) => ({
      x: width / 2 + (gx - here.u) * k,
      y: height / 2 + (gy / 2 - here.v) * k,
    }),
    visible: (s) => {
      const p = chartPoint(s);
      return Math.abs(p.u - here.u) <= radius && Math.abs(p.v - here.v) <= radius;
    },
  };
}

/** Готовитcanvas к рисованию с учётом плотности пикселей. */
function prepareCanvas(view: ChartView): CanvasRenderingContext2D | null {
  const { canvas, width, height } = view;
  const dpr = window.devicePixelRatio || 1;
  // Высота холста в CSS — от раскладки, а НЕ от view.height.
  //
  // Раньше здесь стояло `canvas.style.height = height + 'px'`, где height
  // для общей карты считается из clientWidth. При каждом тапе render()
  // строит разметку заново, clientWidth в момент отрисовки мог быть ещё
  // нулевым/старым — и высота карточки прыгала. Контейнер прокрутки от
  // этого «дёргался», и экран уезжал. Ширина у холста задана CSS (100%),
  // поэтому высоту карте ставит сама карта через aspect-ratio, а не код.
  const cssW = width;
  const cssH = height;
  // Высоту задаёт только код, ширина — CSS (100%). Иначе `height: auto`
  // в стилях спорит с инлайновой высотой и карточка прыгает по высоте
  // между перерисовками.
  canvas.style.height = `${cssH}px`;
  const bw = Math.round(cssW * dpr);
  const bh = Math.round(cssH * dpr);
  // Размер атрибутов задаём только когда он реально меняется: присвоение
  // тех же чисел само по себе очищает холст, но лишний раз трогать
  // геометрию при каждой перерисовке незачем.
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  return ctx;
}

/**
 * Расставляет подписи так, чтобы они не налезали друг на друга
 * и не уезжали за край.
 *
 * Раньше подпись всегда ставилась справа-снизу от точки, и на местной
 * карте она уезжала за правый край («ZAONCE» на скриншоте) и налезала
 * на соседнюю («ZASOER / RELAES / ORRERE» в кучу).
 *
 * Пробуем несколько позиций вокруг точки по порядку и берём первую
 * свободную. Порядок важен: сначала под точкой, потом над ней, потом
 * справа и слева.
 */
function placeLabels(
  ctx: CanvasRenderingContext2D,
  items: (LabelItem & { index?: number })[],
  width: number,
  height: number,
  canvas?: HTMLCanvasElement,
): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Ширины измеряет canvas — раскладка их только использует.
  const sizes = items.map((it) => {
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    const tw = ctx.measureText(it.text).width;
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
    const sw = it.sub ? ctx.measureText(it.sub).width : 0;
    return { tw, sw };
  });

  const { placed, occupied } = layoutLabels(items, sizes, width, height);
  const placedSet = new Set(placed.map((p) => p.item));

  // Попадания по подписям — для касания. В cards попадают и
  // однострочные резервные подписи: они тоже должны выбирать систему.
  const cards: { box: { x1: number; y1: number; x2: number; y2: number }; index: number }[] = [];
  for (const p of placed) {
    const idx = (p.item as LabelItem & { index?: number }).index;
    if (idx !== undefined) cards.push({ box: p.box, index: idx });
  }

  for (const pl of placed) {
    const it = pl.item;
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = it.color;
    ctx.fillText(it.text, pl.cx, it.sub ? pl.cy - 6 : pl.cy);
    if (it.sub) {
      ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = it.subColor ?? it.color;
      ctx.fillText(it.sub, pl.cx, pl.cy + 6);
    }
  }

  /*
   * Кому места не хватило.
   *
   * Раньше такие подписи пропускались целиком — и вместе с именем
   * терялись характеристики планеты. Пользователь просил их видеть,
   * поэтому теперь жмёмся: печатаем в одну строку «ИМЯ Т8» справа от
   * точки. Такой текст вдвое уже двухстрочного блока и почти всегда
   * находит себе место.
   */
  for (const it of items) {
    if (placedSet.has(it)) continue;
    const short = it.sub ? `${it.text} Т${it.sub.split('Т').pop()}` : it.text;
    ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
    const tw = ctx.measureText(short).width;
    const spot = placeSingle(it.x, it.y, tw, width, occupied as Box[]);
    if (!spot) continue; // совсем нет места — лучше пусто, чем каша
    ctx.fillStyle = it.subColor ?? it.color;
    ctx.fillText(short, spot.cx, spot.cy);
    const idx = (it as LabelItem & { index?: number }).index;
    if (idx !== undefined) cards.push({ box: spot.box, index: idx });
  }

  if (canvas) labelHit.set(canvas, cards);
}

/** Рисует точки систем и подписи. */
/**
 * Куда на холсте легли подписи систем.
 *
 * Заполняется при отрисовке и используется при касании: попадание по
 * подписи = выбор системы. Нужно потому, что список под картой убран,
 * а две точки могут стоять в 19 px друг от друга — палец их не
 * разделит, а подпись лежит рядом и однозначна.
 *
 * Ключ — холст: на карте их два (общая и местная), и раскладки разные.
 */
const labelHit: WeakMap<HTMLCanvasElement, { box: { x1: number; y1: number; x2: number; y2: number }; index: number }[]> = new WeakMap();

/**
 * §112: цвет роли пилота на карте.
 *
 * Взят из палитры интерфейса, чтобы карта не заводила свой язык цветов:
 * торговец — бирюзовый (как всё «ваше» и спокойное), контрабандист —
 * янтарный (как предупреждения), пират — красный (как опасность),
 * полицейский — голубой: единственный цвет вне палитры, и это
 * намеренно, полиция не «вы» и не «опасность», она третий.
 */
const PILOT_ROLE_CHART: Record<PilotRole, string> = {
  trader: '#4fd8c4',
  smuggler: '#ffd37a',
  pirate: '#ff8a80',
  police: '#8fb6ff',
};

/** Сколько разных линий рисуем максимум: дальше карта превращается в паутину. */
const MAX_ROUTE_LINES = 40;

/**
 * §112: маршруты пилотов на карте.
 *
 * Зачем на карте: маршрут пилота — это ПАРА СИСТЕМ, и спрашивают про него
 * всегда одно и то же — «а где он летает?». В карточке пилота ответ есть,
 * но его надо читать по строкам; на карте он виден сразу.
 *
 * Как читается:
 *   - линия между двумя системами — маршрут, цвет — роль;
 *   - кольцо вокруг системы — патруль (полицейский летает «в себя»,
 *     линии у него нет и быть не может);
 *   - линии, касающиеся выбранной (или текущей) системы, ярче прочих:
 *     остальные — фон, чтобы 20 маршрутов не спорили с картой;
 *   - несколько пилотов на одном маршруте — одна линия потолще, а не
 *     пучок одинаковых.
 */
function drawPilotRoutes(ctx: CanvasRenderingContext2D, view: ChartView): void {
  const pilots = state.pilots ?? [];
  if (!pilots.length) return;

  const systems = systemsOf(state.galaxy);
  const big = view.canvas.dataset.local === '1';

  // Маршруты схлопываем: ключ — «откуда-куда-роль».
  const lanes = new Map<string, { from: number; to: number; role: PilotRole; n: number }>();
  for (const p of pilots) {
    if (!p.route) continue; // без маршрута пилот стоит в ангаре
    const { from, to } = p.route;
    if (from >= systems.length || to >= systems.length) continue;
    const key = `${from}-${to}-${p.role}`;
    const lane = lanes.get(key);
    if (lane) lane.n++;
    else lanes.set(key, { from, to, role: p.role, n: 1 });
  }
  if (!lanes.size) return;

  if (!settings.devRoutes && !settings.devPilots) return;

  // Фокус — то, на что игрок сейчас смотрит: выбранная система, а если
  // ничего не выбрано — та, где он стоит.
  const focus = selected ?? state.system;

  ctx.save();
  ctx.lineCap = 'round';
  let drawn = 0;
  for (const lane of settings.devRoutes ? lanes.values() : []) {
    if (drawn >= MAX_ROUTE_LINES) break;
    const color = PILOT_ROLE_CHART[lane.role];
    const touches = lane.from === focus || lane.to === focus;

    if (lane.from === lane.to) {
      // Патруль: система одна, поэтому кольцо, а не линия.
      const sys = systems[lane.from];
      if (!view.visible(sys)) continue;
      const p = view.screenOf(sys.x, sys.y);
      ctx.beginPath();
      ctx.arc(p.x, p.y, big ? 11 : 7, 0, Math.PI * 2);
      ctx.globalAlpha = touches ? 0.95 : 0.5;
      ctx.strokeStyle = color;
      ctx.lineWidth = touches ? 2 : 1.4;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      drawn++;
      continue;
    }

    const a = systems[lane.from];
    const b = systems[lane.to];
    const pa = view.screenOf(a.x, a.y);
    const pb = view.screenOf(b.x, b.y);
    /*
     * На местной карте рисуем маршрут только целиком: оба конца в окне.
     *
     * Иначе через круг идут чужие линии, у которых ни начала, ни конца не
     * видно, — они ничего не объясняют, а карту заслоняют. На общей карте
     * видно всё, там `visible()` всегда истинно и проверка ничего не режет.
     */
    if (big && !(view.visible(a) && view.visible(b))) continue;

    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.globalAlpha = touches ? 0.9 : 0.38;
    ctx.strokeStyle = color;
    // Толще, если на маршруте несколько пилотов: один маршрут — одна линия.
    ctx.lineWidth = Math.min(3.5, (big ? 2 : 1.2) + (lane.n - 1) * 0.6);
    ctx.stroke();
    drawn++;
  }

  /*
   * §113: САМ ПИЛОТ НА МАРШРУТЕ — ТРЕУГОЛЬНИК.
   *
   * Пользователь: «делаем не точки, а треугольники, чтобы было понятно
   * направление». Точка на линии ничего не говорит о том, летит он туда
   * или уже обратно; треугольник, повёрнутый по ходу, говорит это сразу.
   *
   * Где он сейчас — считаем по времени, а не храним: рейс идёт от
   * возвращения минус цикл, половина цикла — туда, половина — обратно.
   * Так положение всегда согласовано с теми же числами, по которым
   * платят деньги (`pilotCycleMs`), и его нельзя «рассинхронизировать».
   */
  /*
   * §114: на ОБЩЕЙ карте меток нет.
   *
   * Там 256 систем на двухсот с небольшим пикселях: треугольник размером
   * в 5 px наезжает на соседние точки и читается как ещё одна система.
   * Направление видно на местной карте, где маршрут — это две подписи и
   * десятки пикселей между ними. Пользователь: «на глобальной карте метки
   * пилотов не нужны».
   */
  if (settings.devPilots && big) {
    const now = Date.now();
    for (const pilot of pilots) {
      if (!pilot.route || pilot.route.from === pilot.route.to) continue; // патруль — кольцом
      const a = systems[pilot.route.from];
      const b = systems[pilot.route.to];
      if (!a || !b) continue;
      if (big && !(view.visible(a) && view.visible(b))) continue;

      const cycle = pilotCycleMs(state, pilot, settings);
      if (cycle <= 0) continue;
      let phase = (now - (pilot.nextRunAt - cycle)) / cycle;
      phase = phase - Math.floor(phase); // 0..1, переполнение не ломает
      const outbound = phase < 0.5;
      const f = outbound ? phase * 2 : 2 - phase * 2;

      const pa = view.screenOf(a.x, a.y);
      const pb = view.screenOf(b.x, b.y);
      const x = pa.x + (pb.x - pa.x) * f;
      const y = pa.y + (pb.y - pa.y) * f;
      const angle = Math.atan2((pb.y - pa.y) * (outbound ? 1 : -1), (pb.x - pa.x) * (outbound ? 1 : -1));
      const size = big ? 7 : 5;

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(size, 0);
      ctx.lineTo(-size * 0.72, size * 0.6);
      ctx.lineTo(-size * 0.72, -size * 0.6);
      ctx.closePath();
      ctx.globalAlpha = 1;
      ctx.fillStyle = PILOT_ROLE_CHART[pilot.role];
      ctx.fill();
      /* Тёмный ореол: треугольник стоит на линии своего же цвета, и без
       * него он сливается с ней в одну палку. */
      ctx.strokeStyle = '#0f1514';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
  }

  ctx.restore();
}

function drawSystems(
  ctx: CanvasRenderingContext2D,
  view: ChartView,
  opts: { labels: boolean },
): void {
  const systems = systemsOf(state.galaxy);
  const here = systems[state.system];

  // Круг дальности на текущем топливе.
  const fuelR = (state.fuel / 4) * view.k;
  if (fuelR > 2) {
    const c = view.screenOf(here.x, here.y);
    ctx.beginPath();
    ctx.arc(c.x, c.y, fuelR, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(79,216,196,.35)';
    ctx.setLineDash([5, 6]);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Точки.
  for (const sys of systems) {
    if (!view.visible(sys)) continue;
    const p = view.screenOf(sys.x, sys.y);
    const reachable = distance(here, sys) <= state.fuel;
    const isHere = sys.index === here.index;
    const isSel = selected === sys.index;
    ctx.beginPath();
    // На местной карте точки крупнее: их немного, и по ним надо попадать
    // пальцем. На общей — мельче, иначе 256 точек сольются в пятно.
    const big = view.canvas.dataset.local === '1';
    const radius = isHere ? (big ? 6 : 4.5) : reachable ? (big ? 4.5 : 3) : big ? 3.5 : 2.2;
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = isHere ? '#4fd8c4' : reachable ? '#dde4e2' : '#5c6b68';
    ctx.fill();
    if (isSel) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, view.canvas.dataset.local === '1' ? 12 : 9, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffd37a';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.lineWidth = 1;
    }
  }

  if (!opts.labels) return;

  // Подписи. Порядок задаёт приоритет: если места нет, подпись текущей
  // и выбранной системы важнее прочих.
  //
  // На местной карте под системой идёт вторая строка — характеристики
  // планеты. Раньше они были отдельными полями под картой, но их
  // приходилось сопоставлять со списком глазами, а рядом с точкой
  // видно сразу, к какой звезде относится строка.
  const items = systems
    .filter((sys) => view.visible(sys))
    .map((sys) => ({ sys, p: view.screenOf(sys.x, sys.y) }))
    .sort((a, b) => {
      const rank = (x: typeof a): number =>
        x.sys.index === here.index ? 0 : x.sys.index === selected ? 1 : 2;
      return rank(a) - rank(b);
    })
    .map(({ sys, p }) => {
      const reachable = distance(here, sys) <= state.fuel;
      return {
        x: p.x,
        y: p.y,
        text: sys.name,
        sub: `${shortEconomy(sys.economy)} · Т${sys.techLevel + 1}`,
        index: sys.index,
        color: sys.index === here.index ? '#4fd8c4' : reachable ? '#dde4e2' : '#7b8b88',
        subColor: sys.index === here.index ? 'rgba(79,216,196,.72)' : 'rgba(221,228,226,.55)',
      };
    });

  placeLabels(ctx, items as (LabelItem & { index: number })[], view.width, view.height, view.canvas);
}

/** Рисует обе карты. */
function drawMap(): void {
  const overview = document.getElementById('map-overview') as HTMLCanvasElement | null;
  const local = document.getElementById('map-local') as HTMLCanvasElement | null;
  if (!overview && !local) return;

  const systems = systemsOf(state.galaxy);

  if (overview) {
    const v = overviewView(overview);
    const ctx = prepareCanvas(v);
    if (ctx) {
      // §112: маршруты пилотов — ПОД точками систем: точки важнее линий.
      drawPilotRoutes(ctx, v);
      drawSystems(ctx, v, { labels: false });

      // Рамка местной карты — чтобы было видно, что именно крупно внизу.
      const lv = localView(local ?? overview);
      const here = chartPoint(systems[state.system]);
      const r = lv.radius;
      const a = v.screenOf(here.u - r, (here.v - r) * 2);
      const b = v.screenOf(here.u + r, (here.v + r) * 2);
      ctx.strokeStyle = 'rgba(255,211,122,.5)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.setLineDash([]);

      // На общей карте подписываем только текущую и выбранную:
      // 256 подписей не поместятся.
      ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const marks = [systems[state.system], ...(selected !== null ? [systems[selected]] : [])];
      for (const sys of marks) {
        const p = v.screenOf(sys.x, sys.y);
        const txt = sys.name;
        const w = ctx.measureText(txt).width;
        const x = Math.max(w / 2 + 2, Math.min(p.x, v.width - w / 2 - 2));
        const y = p.y > v.height - 16 ? p.y - 14 : p.y + 14;
        ctx.fillStyle = sys.index === state.system ? '#4fd8c4' : '#ffd37a';
        ctx.fillText(txt, x, Math.max(10, y));
      }
    }
  }

  if (local) {
    const v = localView(local);
    const ctx = prepareCanvas(v);
    if (ctx) {
      drawPilotRoutes(ctx, v);
      drawSystems(ctx, v, { labels: true });
    }
  }
}

/**
 * Касание по любой из карт.
 *
 * Выбор — по ближайшей системе в радиусе, который зависит от масштаба
 * карты, а не от фиксированного числа. На местной карте точки крупные
 * и далеко друг от друга, на общей — плотно; один радиус на обе плох.
 *
 * Радиус НЕ больше половины расстояния до ближайшей соседней точки:
 * иначе палец, целясь в одну систему, накрывает соседнюю, и выбирается
 * не та. Именно так было с QUATOR и RA — 19 px между точками при
 * радиусе 40.
 */
function onMapTap(ev: PointerEvent, canvas: HTMLCanvasElement): void {
  const rect = canvas.getBoundingClientRect();
  const isLocal = canvas.dataset.local === '1';

  // jsdom и старые браузеры могут не иметь размеров — берём как есть.
  // Переводим координаты касания в систему холста. Высота канваса
  // равна его ширине, а CSS растягивает его по контейнеру, поэтому
  // масштаб по обеим осям один и тот же — берём от ширины.
  const cssW = rect.width || canvas.clientWidth;
  const scale = cssW > 0 ? canvas.clientWidth / cssW : 1;
  const px = (ev.clientX - rect.left) * scale;
  const py = (ev.clientY - rect.top) * scale;

  const v = isLocal ? localView(canvas) : overviewView(canvas);
  const systems = systemsOf(state.galaxy);

  // Позиции всех видимых систем на экране — считаем один раз.
  const points = systems
    .filter((sys) => v.visible(sys))
    .map((sys) => {
      const p = v.screenOf(sys.x, sys.y);
      return { index: sys.index, x: p.x, y: p.y };
    });

  if (!points.length) return;

  /*
   * Сначала — попадание по ПОДПИСИ.
   *
   * Список систем под картой убран (пользователь просил «снизу убрать»),
   * а он заодно решал проблему точности: QUATOR и RA стоят в 19 px друг
   * от друга, и палец накрывает обе точки. Подпись лежит рядом с точкой
   * и однозначна, поэтому касание по ней считается выбором системы.
   * Порядок важен: подпись проверяется раньше «ближайшей точки», иначе
   * тап по названию соседа всё равно выбрал бы точку под пальцем.
   */
  const hits = labelHit.get(canvas) ?? [];
  for (const h of hits) {
    if (px >= h.box.x1 && px <= h.box.x2 && py >= h.box.y1 && py <= h.box.y2) {
      selected = h.index;
      render();
      return;
    }
  }

  // Ближайшая к пальцу.
  let best = -1;
  let bestD = Infinity;
  for (const p of points) {
    const d = (p.x - px) ** 2 + (p.y - py) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p.index;
    }
  }
  if (best < 0) return;

  // Радиус по умолчанию: щедрый, чтобы легко попадать.
  let tolerance = isLocal ? 34 : 14;

  // …но не больше половины расстояния до ближайшей другой системы:
  // иначе накроем соседнюю и выберем не ту.
  const target = points.find((p) => p.index === best)!;
  let nearestOther = Infinity;
  for (const p of points) {
    if (p.index === best) continue;
    const d = Math.hypot(p.x - target.x, p.y - target.y);
    if (d < nearestOther) nearestOther = d;
  }
  if (nearestOther < Infinity) tolerance = Math.min(tolerance, nearestOther / 2);

  // Отдельный минимум: совсем мелкий радиус неудобен даже при плотных точках.
  tolerance = Math.max(tolerance, 10);

  if (bestD > tolerance * tolerance) return; // палец мимо всех систем

  selected = best;
  render();
}

/**
 * Список систем в окрестностях кнопками.
 *
 * Зачем, если есть карта: QUATOR и RA — физически соседние звёзды,
 * 8 св. лет, на карте их точки в 19 px друг от друга. Палец накрывает
 * обе сразу, и попасть в нужную невозможно, как ни увеличивай
 * точность — это предел разрешения экрана, а не ошибка кода.
 *
 * Кнопки дают однозначный выбор: тап по названию не может «промахнуться».
 * Карта остаётся для того, чтобы видеть расположение.
 */
function priceChip(i: number): string {
  const base = COMMODITIES[i].basePrice * 4;
  const ratio = state.market[i].price / base;
  if (ratio <= 0.92) return '<span class="chip cheap">дёшево</span>';
  if (ratio >= 1.08) return '<span class="chip dear">дорого</span>';
  return '';
}

/**
 * §99: полоска заполнения трюма — по образцу полоски топлива в ангаре.
 *
 * Топливо показывает, сколько бака занято, здесь — сколько трюма. Одни и
 * те же классы `.progress`, тот же зелёный цвет: игрок не учится заново,
 * а полоска читается одним взглядом там, где раньше приходилось считать
 * в уме «занято 7 из 20».
 *
 * Показывается и на рынке, и в трюме: покупка на станции и сброс в полёте —
 * две стороны одного и того же места в корабле.
 */
function holdBar(): string {
  const tons = cargoTons(state);
  /*
   * §133.6: при беженцах на борту трюм занят, но груза нет — `tons + holdSpace`
   * дало бы «0 из 0». Вместимость берём у корабля, а сумму оставляем как
   * нижнюю границу для старых сейвов, где она могла быть больше.
   */
  const cap = Math.max(holdCapacity(state.ship), tons + state.holdSpace);
  const pct = cap > 0 ? Math.min(100, (tons / cap) * 100) : 0;
  return `<div class="progress"><div style="width:${pct}%"></div></div>`;
}

/**
 * §98: «Трюм» — вкладка рынка в полёте.
 *
 * Пользователь: «Сделай чтобы в полете экран рынок превращался в "Трюм", в
 * котором будет список товаров как в рынке, но с возможностью сбросить
 * конкретный товар».
 *
 * Список повторяет рынок намеренно: тот же порядок товаров, те же названия,
 * то же место цены. Глаз не переучивается — меняются только кнопки: вместо
 * «купить/продать» здесь «выбросить». Цена показывается справочно (по рынку
 * системы вылета): в полёте продать некому, но сколько груз стоит — знать
 * полезно, особенно когда решаешь, что выбросить.
 *
 * Сброс в полёте — не роскошь. Контрабанда в трюме запрещает побег от
 * статуса (§80.1), а выбросить её было негде: экран обломков появляется
 * только после боя и только с тем, что выпало. Игрок оказывался заперт со
 * своим грузом.
 *
 * Пустые позиции показываются: в трюме важно видеть, что ты НЕ везёшь,
 * а список из трёх строк выглядел бы поломкой.
 */
function holdScreen(): string {
  const tons = cargoTons(state);
  const cap = state.holdSpace + tons;
  const banned = contrabandGoods(state.cargo);
  const value = contrabandValue(state.cargo, state.market);
  /*
   * §98.1: только то, что лежит в трюме.
   *
   * Сначала показывались все семнадцать позиций — «чтобы видеть, чего нет».
   * На телефоне это три экрана прокрутки ради двух строк груза, и
   * пользователь попросил убрать пустое. Правильно: трюм — это список
   * ТОГО, ЧТО ВЕЗЁШЬ; что не везёшь, и так понятно.
   */
  const rows = COMMODITIES.map((c, i) => {
    const have = state.cargo[i];
    if (have <= 0) return '';
    const m = state.market[i];
    const illegal = isContraband(i);
    const chip = priceChip(i);
    /*
     * §99: карточка — точная копия рыночной.
     *
     * Пользователь: «Точно скопируй карточку товара для трюма из рынка,
     * замени "Макс" на "Выбросить всё", оставь кнопку "-1" на марки месте».
     *
     * Поэтому разметка та же, до класса `illegal` включительно: название с
     * меткой цены, строка «В наличии · В трюме», цена справа. Кнопка «−1»
     * стоит первой и в том же тональном стиле, «Выбросить всё» — на месте
     * «Макс.», последней.
     *
     * Двух кнопок рынка здесь нет: «+1» и «Продать всё» в полёте
     * невозможны — торговли нет. Выключенные кнопки, которые ничего не
     * делают, хуже их отсутствия.
     */
    /*
     * §100.1: в трюме цена — ЗА ВЕСЬ ЗАПАС, одной строкой.
     *
     * Сначала (в §99) здесь была рыночная цена за единицу, потом (§100) к
     * ней добавилась мелкая строка со стоимостью всего запаса. Пользователь
     * попросил иначе: «сделай одну цену за всё, в две строки не надо».
     *
     * Логика его права: на рынке спрашивают «почём», потому что покупают
     * поштучно; в трюме спрашивают «сколько у меня», потому что груз уже
     * свой. Поэтому крупная цифра — стоимость всего запаса, а цена за
     * единицу остаётся в подписи рядом с ценой станции.
     */
    return `<div class="card${illegal ? ' illegal' : ''}"><div class="good-row">
        <div><div class="name${chip ? ' with-chip' : ''}">${c.name}${chip}</div>
          <div class="muted">В наличии: ${m.quantity} ${UNITS[c.unit]} · В трюме: ${have} ${UNITS[c.unit]} · ${cr(m.price)}/${UNITS[c.unit]}</div></div>
        <div class="price">${cr(m.price * have)}</div></div>
      <div class="row" style="margin-top:10px">
        <button class="btn tonal" data-action="drop1" data-i="${i}">−1</button>
        <span class="spacer"></span>
        <button class="btn text" data-action="dropAll" data-i="${i}">Выбросить всё</button>
      </div></div>`;
  }).filter(Boolean).join('');
  const empty = rows
    ? ''
    : '<div class="card"><h2>Трюм пуст</h2><div class="sub">Здесь будут товары, которые вы везёте. Покупать и продавать можно только на станции — вкладка «Рынок».</div></div>';
  const warn = banned
    ? `<div class="alert">В трюме запрещённый товар: ${banned} — это ${cr(value)} по ценам станции. Пока он в трюме, побег от статуса невозможен (§80.1).</div>`
    : '';
  return `<div class="card"><h2>Трюм</h2>
      <div class="sub">Занято ${tons} из ${cap} т · Свободно: ${state.holdSpace} т · Деньги: ${cr(state.cash)}</div>
      ${holdBar()}
      ${warn}
      <div class="sub" style="margin-top:8px">Выброшенный груз пропадает навсегда — подобрать его в открытом космосе нельзя.</div></div>${empty}${rows}
    ${logCard()}`;
}

/**
 * §127: «Купить станцию» — в карточке «Рынок», под полосой трюма.
 *
 * Пользователь: «Кнопка „Купить станцию“ — на экране рынок в карточке
 * „рынок“ под полосой трюма (если у игрока нет денег на покупку, то кнопка
 * будет просто серой и без надписи)».
 *
 * Без денег на кнопке стоит «--»: «Купить станцию» рядом с ценой в сотни
 * тысяч, которую нечем закрыть, читается как обещание или как поломка, а
 * пустая плашка была меньше соседних кнопок. Пользователь: «поместим внутрь
 * этой кнопки „--“, чтобы придать ей размер как на карточке ниже».
 * Смысла в этих двух чёрточках нет — и это нарочно: интрига (§127.1).
 *
 * §127.1: ЦЕНЫ ЗДЕСЬ НЕТ ВОВСЕ, И ЭТО НАРОЧНО.
 *
 * Пользователь: «кнопка „Купить станцию“ будет слева, по образцу карточки
 * ниже, цену там же убери, оставим интригу, пусть игрок не догадывается,
 * что станцию можно купить». Строка с ценой выдавала тему до того, как
 * игрок вообще заметил кнопку. Теперь цена называется один раз — на
 * подтверждении, когда решение уже принято и прятать её было бы обманом.
 *
 * Кнопка стоит слева, как «−1/+1» в товарных строках ниже: это действие
 * с товаром станции, а не кнопка в углу.
 *
 * Покупка в два нажатия, как корабль (§102.4) и пилот (§105): сумма такая,
 * что случайный тап по экрану не должен её тратить.
 */
function stationBuyActions(disabled = false): string {
  const system = currentSystem(state);
  const price = stationPrice(system);

  if (state.stations.includes(state.system)) {
    return `<span class="chip">Ваша станция</span>`;
  }

  const affordable = state.cash >= price * 10;
  if (stationBuyOpen && affordable && !disabled) {
    // Цена — только здесь: решение уже принято, а платить вслепую нельзя.
    return `<button class="btn danger" data-action="station-buy-confirm">Подтвердить · ${cash(price)}</button>
      <button class="btn text" data-action="station-buy-cancel">Отмена</button>`;
  }

  // §133.7: во время события станция не продаётся — кнопка гаснет целиком.
  const off = disabled || !affordable;
  return `<button class="btn tonal" data-action="station-buy" ${off ? 'disabled' : ''}>${disabled || !affordable ? '--' : 'Купить станцию'}</button>`;
}

function marketScreen(): string {
  // §98: в полёте рынок недоступен, но вкладка не пустует — это «Трюм».
  if (state.flight) return holdScreen();
  /*
   * §133.6: СТАНЦИЯ ВО ВРЕМЯ «СВЕРХНОВОЙ».
   *
   * Пользователь: «не позволить заправиться на станции (доступен только рынок
   * с беженцами)». Поэтому здесь торговать нечем: все действия по товару
   * выключены, а вместо них — одна кнопка «Взять беженцев». Так миссия не
   * решается за 14 CR заправки.
   */
  const sn = supernovaOf(state);
  const locked = stationLocked(state);
  // Погибшая станция не возвращается: на её месте не торгуют и не чинят.
  if (!stationAlive(state)) {
    return `<div class="card"><h2>Станция ${currentSystem(state).name}</h2>
      <div class="sub">Станции здесь больше нет: звезда вспыхнула, а спасать было некому.</div></div>`;
  }
  /*
   * §133.7: РЫНОК ЗАКРЫТОЙ СТАНЦИИ — ОДНА КАРТОЧКА.
   *
   * Пользователь: «рынок доступен только с одной карточкой „Беженцы“ с ценой
   * 0.0 cr и кнопкой „Макс.“, остальные кнопки не активны». Так экран говорит
   * сам за себя: на станции осталось одно дело, и оно стоит ноль.
   */
  const refugeeCard = sn && !sn.escaped
    ? (() => {
        const left = Math.max(0, SUPERNOVA_REFUGEES_TONS - sn.taken);
        const canTake = left > 0 && state.holdSpace > 0;
        return `<div class="card"><div class="good-row">
        <div><div class="name">Беженцы</div>
          <div class="muted">В наличии: ${left} т · На борту: ${sn.taken} т · Свободно: ${state.holdSpace} т</div></div>
        <div class="price">0.0 CR</div></div>
      <div class="row" style="margin-top:10px">
        <span class="spacer"></span>
        <button class="btn tonal" data-action="refugees" ${canTake ? '' : 'disabled'}>Макс.</button>
      </div></div>`;
      })()
    : '';
  /*
   * §133.8: ГРУЗ ИГРОК ВЫБРАСЫВАЕТ САМ.
   *
   * Пользователь: «если в трюме есть товары, то вместо „продать всё“ будет
   * „оставить всё“, мы сами решим, что выбросить». Поэтому на закрытой станции
   * карточки товара показывают только то, что лежит в трюме, и одну кнопку —
   * «Оставить всё». Ни продать, ни купить здесь уже нельзя.
   */
  const leaveCards = COMMODITIES.map((c, i) => {
    const have = state.cargo[i];
    if (!have || !locked) return '';
    return `<div class="card"><div class="good-row">
        <div><div class="name">${c.name}</div>
          <div class="muted">В трюме: ${have} ${UNITS[c.unit]}</div></div></div>
      <div class="row" style="margin-top:10px"><span class="spacer"></span>
        <button class="btn text" data-action="leave-all" data-i="${i}">Оставить всё</button></div></div>`;
  }).join('');
  const docked = !locked;
  const rows = COMMODITIES.map((c, i) => {
    const m = state.market[i];
    /*
     * §103: ЧЕГО НЕТ НА СТАНЦИИ — ТОГО НЕ ПОКАЗЫВАЕМ.
     *
     * Раньше прятались только «Предметы пришельцев» (их не продают нигде),
     * а остальные нулевые позиции висели серыми карточками с «В наличии: 0»
     * и выключенными кнопками. В каждой системе таких 3–5 из 17 — то есть
     * четверть списка была мёртвой: ни купить, ни понять, зачем она тут.
     *
     * Исключение одно и важное: если товар ЛЕЖИТ В ТРЮМЕ, карточка
     * остаётся даже при нуле на станции — иначе груз не продать. Это тот
     * же принцип, что §98.1 в «Трюме»: показываем только то, что реально
     * участвует в игре.
     */
    if (m.quantity === 0 && state.cargo[i] === 0) return '';
    const chip = priceChip(i);
    // Контрабанда помечается красным и словом: в оригинале это рабы,
    // наркотики и оружие (SLAVES_INDEX, NARCOTICS_INDEX, FIREARMS_INDEX).
    // Подсветка нужна не для красоты: за такой груз растёт правовой
    // статус, и игрок должен видеть это до покупки, а не после.
    const illegal = [SLAVES_INDEX, NARCOTICS_INDEX, FIREARMS_INDEX].includes(i);
    return `<div class="card${illegal ? ' illegal' : ''}"><div class="good-row">
        <div><div class="name${chip ? ' with-chip' : ''}">${c.name}${chip}</div>
          <div class="muted">В наличии: ${m.quantity} ${UNITS[c.unit]} · В трюме: ${state.cargo[i]} ${UNITS[c.unit]}</div></div>
        <div class="price">${cr(m.price)}</div></div>
      <div class="row" style="margin-top:10px">
        <button class="btn tonal" data-action="sell1" data-i="${i}" ${docked && state.cargo[i] > 0 ? '' : 'disabled'}>−1</button>
        <button class="btn tonal" data-action="buy1" data-i="${i}" ${docked && m.quantity > 0 ? '' : 'disabled'}>+1</button>
        <span class="spacer"></span>
        <button class="btn text" data-action="sellAll" data-i="${i}" ${docked && state.cargo[i] > 0 ? '' : 'disabled'}>Продать всё</button>
        <button class="btn text" data-action="buyMax" data-i="${i}" ${docked && m.quantity > 0 ? '' : 'disabled'}>Макс.</button>
      </div></div>`;
  }).join('');
  const tons = cargoTons(state);
  // §133.6: см. `holdBar` — при беженцах вместимость берём у корабля.
  const cap = Math.max(holdCapacity(state.ship), tons + state.holdSpace);
  /*
   * §130: на рынке заголовок — «Станция», а не «Рынок».
   *
   * Пользователь: «на экране рынок, в блоке „рынок“ замени слово „рынок“ на
   * „Станция“». Так честнее: в карточке не только цены, но и покупка станции —
   * место называется тем, чем оно является. Вкладка внизу остаётся «Рынок»:
   * по ней игрок ищет торговлю.
   *
   * §130.1: «убери двоеточие после слова „станция“, убери оттуда деньги,
   * замени слово „занято“ на „Трюм“». Деньги и так висят в шапке экрана, а
   * строка здесь — про трюм, и начинаться она должна с трюма.
   */
  /*
   * §132.7: КАРТОЧКА СТАНЦИИ ПРИЛИПАЕТ, КАК «ТОПЛИВО».
   *
   * Пользователь: «Сделай карточку c0 в рынке по принципу „топливо“». Механика
   * та же (§131): прозрачная обёртка с `position: sticky`, поэтому карточка
   * остаётся при прокрутке длинного списка товаров, а под неё уползают цены.
   * Своего кода у рынка нет — это тот же класс и тот же `syncStickyCards`.
   */
  /*
   * §133.3: КОНТРАКТЫ — ОТДЕЛЬНЫЙ ЭКРАН, ВХОД С КАРТОЧКИ СТАНЦИИ.
   *
   * Пользователь: «Контракты отдельным экраном со входом по кнопке
   * „Контракты" на карточке „Станция" на экране „Рынок", эта кнопка будет
   * справа». §133.4: кнопка переехала из строки заголовка в нижнюю строку
   * действий — рядом с «Купить станцию», у правого края (в редакторе она
   * была опущена на высоту этой строки и покрашена тональным цветом).
   */
  const takenNow = missionsOf(state).length;
  return `<div class="sticky-fuel"><div class="card"><h2>Станция ${currentSystem(state).name}</h2>
    <div class="sub">Трюм ${tons} из ${cap} т · Свободно: ${state.holdSpace} т</div>
    ${holdBar()}
    <div class="row" style="margin-top:10px">
      ${stationBuyActions(locked)}
      <span class="spacer"></span>
      <button class="btn tonal" data-action="contracts-open" ${locked ? 'disabled' : ''}>Контракты${takenNow > 0 ? ` (${takenNow})` : ''}</button>
    </div>
    ${state.flight ? '<div class="sub">Торговля недоступна в полёте</div>' : ''}
    ${locked ? `<div class="sub">Сверхновая: топливо течёт, до взрыва ${hoursLeft(state, Date.now(), settings).toFixed(1)} игр. ч. Станция торгует только беженцами. Нет топлива на прыжок — уходите в другую галактику, но награды не будет.</div>` : ''}</div></div>${locked ? refugeeCard + leaveCards : rows}`;
}

/*
 * §133.3: ЭКРАН «КОНТРАКТЫ».
 *
 * Живёт поверх вкладки «Рынок» (как «Пилоты» поверх ангара) и только на
 * станции: в полёте доска не нужна — брать нечего, сдавать негде.
 *
 * Две карточки: сверху взятые, ниже доска. Взятые — первыми, потому что
 * именно они горят по сроку: игрок открывает экран, чтобы понять, что у него
 * в работе, а не что предлагают.
 *
 * Репутация — справа в шапке экрана (решение пользователя). Здесь же одной
 * строкой сказано, что она делает: иначе «+4» читается как что угодно.
 */
const MISSION_KIND_NAMES: Record<MissionKind, string> = {
  courier: 'Курьер',
  passenger: 'Пассажиры',
};

/** Что за контракт — одной строкой, без легенды на пол-экрана. */
function missionNote(m: Mission): string {
  if (m.kind === 'courier') return 'Документы и посылки: места в трюме не просят';
  return `Люди на борту: ${m.tons} ${plural(m.tons, 'тонна', 'тонны', 'тонн')} трюма занято`;
}

/** Срок в игровых часах — в реальные по нынешнему темпу. */
function missionRealMs(hours: number): number {
  return Math.round((hours * 3_600_000) / Math.max(1, settings.speed || 1));
}

function contractsScreen(): string {
  const now = Date.now();
  /*
   * §133.6: во время «Сверхновой» доска закрыта — на станции сейчас одно дело,
   * и это не контракты.
   */
  if (stationLocked(state)) {
    return `<div class="card"><h2>Контракты</h2>
      <div class="sub">Станция занята беженцами: доска закрыта, пока идёт событие.</div>
      <div class="row" style="margin-top:10px"><button class="btn" data-action="contracts-close">Назад</button></div></div>`;
  }
  const systems = systemsOf(state.galaxy);
  const here = systems[state.system];
  const rep = missionRepOf(state);
  const active = missionsOf(state);
  const board = offersOf(state);

  /*
   * §91: в шапке — значение, но репутация без подписи читалась бы как
   * непонятное «+4». Поэтому подпись здесь есть, а подробность — строкой
   * ниже: сколько это даёт к оплате.
   */
  const repPct = Math.min(10, Math.abs(rep)) * 2;
  const repNote = rep === 0
    ? 'Репутация нулевая: оплата по номиналу.'
    : rep > 0
      ? `Репутация даёт +${repPct} % к оплате (потолок +20 %).`
      : `Репутация отнимает ${repPct} % от оплаты (предел −20 %).`;

  const activeCards = active.length === 0
    ? ''
    : active.map((m) => {
        const sys = systems[m.to];
        const left = m.deadline - now;
        const ready = m.to === state.system;
        /*
         * Кнопка «Сдать» появляется только там, где сдавать можно, — и
         * вместо неё сказано, где именно это будет. Серая кнопка без
         * причины запрещена правилом §123.
         */
        const action = ready
          ? `<button class="btn" data-action="mission-deliver" data-id="${m.id}">Сдать · ${cr(m.reward)}</button>`
          : `<span class="muted">Сдать можно в системе ${sys.name}</span>`;
        return `<div class="card">
        <div class="row"><h2 style="margin:0">${MISSION_KIND_NAMES[m.kind]} · ${sys.name}</h2>
          <span class="spacer"></span><span class="chip">${ly(distance(here, sys))}</span></div>
        <div class="sub" style="margin-top:2px">${left > 0
          ? `Осталось <span data-mission-left="${m.id}">${formatSpan(left)}</span>`
          : 'Срок вышел — контракт сорвётся в ближайший тик'}</div>
        <div class="grid" style="margin-top:10px">
          ${stat('Награда', cr(m.reward))}
          ${stat('Штраф за срыв', cr(m.penalty), true)}
        </div>
        <div class="sub" style="margin-top:8px">${missionNote(m)}</div>
        <div class="row" style="margin-top:12px">${action}<span class="spacer"></span>
          <button class="btn text" data-action="mission-abandon" data-id="${m.id}">Отказаться</button></div>
      </div>`;
      }).join('');

  const offers = board.map((m) => {
    const sys = systems[m.to];
    const full = active.length >= MISSION_OFFERS;
    const noRoom = m.tons > state.holdSpace;
    /*
     * Причина отказа — словами (§123), и она же объясняет, что делать:
     * «нет места» без числа заставляет игрока считать в уме.
     */
    const reason = full
      ? `В работе уже ${MISSION_OFFERS} контракта — сначала сдайте или откажитесь от одного`
      : noRoom
        ? `Нужно ${m.tons} т трюма, свободно ${state.holdSpace} т`
        : '';
    return `<div class="card">
      <div class="row"><h2 style="margin:0">${MISSION_KIND_NAMES[m.kind]} · ${sys.name}</h2>
        <span class="spacer"></span><span class="chip">${ly(distance(here, sys))}</span></div>
      <div class="sub" style="margin-top:2px">${missionNote(m)}</div>
      <div class="grid" style="margin-top:10px">
        ${stat('Награда', cr(m.reward))}
        ${stat('Срок', formatSpan(missionRealMs(m.hours)))}
      </div>
      <div class="row" style="margin-top:12px">
        <button class="btn" data-action="mission-take" data-id="${m.id}" ${reason ? 'disabled' : ''}>Взять</button>
        ${reason ? `<span class="muted">${reason}</span>` : `<span class="muted">Штраф за срыв ${cr(m.penalty)}</span>`}
      </div>
    </div>`;
  }).join('');

  /*
   * §133.4: шапка экрана — только «Назад» и что даёт репутация.
   *
   * Пользователь: «В контактах „0 из 3 в работе" перенеси на карточку c1».
   * Счётчик в работе — это про доску, а не про навигацию, поэтому он уехал в
   * заголовок карточки «Доска станции» (она и есть c1, когда ничего не взято).
   *
   * «Назад» стала обычной кнопкой без стрелки: в редакторе пользователь снял
   * «←» и покрасил её в основной цвет.
   */
  return `<div class="card">
    <div class="row"><button class="btn" data-action="contracts-close">Назад</button></div>
    <div class="sub" style="margin-top:8px">${repNote}</div>
  </div>
  ${active.length > 0
    ? `<div class="card"><h2>В работе</h2>
        <div class="sub">Срок идёт и в закрытой вкладке: контракт сорвётся сам, со штрафом.${
          missionTons(state) > 0 ? ` Контракты занимают ${missionTons(state)} т трюма.` : ''}</div></div>`
    : ''}
  ${activeCards}
  <div class="card">
    <div class="row"><h2 style="margin:0">Доска станции ${here.name}</h2>
      <span class="spacer"></span>
      <span class="chip">${active.length} из ${MISSION_OFFERS} в работе</span></div>
    <div class="sub" style="margin-top:8px">Три предложения, обновляются при каждом прибытии. В работе может быть ${MISSION_OFFERS} контракта; отказ до срока бесплатен, но стоит единицы репутации.</div>
  </div>
  ${board.length > 0
    ? offers
    : `<div class="card"><div class="sub">Предложений нет: доска обновится при следующем прибытии.</div></div>`}`;
}

/** Номер предмета на верфи (1 — топливо), как в EQSHP; используется в подсказке. */
const equipmentNote = (item: (typeof EQUIPMENT)[number]): string => `${cr(item.price)} · №${item.screenNumber} на верфи`;

function equipmentRows(): string {
  // §133.6: во время «Сверхновой» станция оборудованием не торгует.
  const docked = !state.flight && !stationLocked(state);
  const tek = currentSystem(state).techLevel;
  return EQUIPMENT.map((item) => {
    const have = owns(state.ship, item.id);
    const available = equipmentAvailable(item, tek);
    /*
     * §103.1: ЧЕГО НЕ ПРОДАЮТ — ТОГО НЕ ПОКАЗЫВАЕМ.
     *
     * Раньше недоступный по техуровню предмет висел строкой с подписью
     * «нет на этой станции». Это тот же мёртвый ряд, что §103 убрал на
     * рынке: в системе с техуровнем 1 из двенадцати строк девять были
     * такими. Список верфи должен отвечать на вопрос «что я могу купить
     * здесь», а не перечислять каталог галактики.
     *
     * Исключение — то, что УЖЕ СТОИТ на корабле: «установлено» это не
     * предложение, а состояние, его прятать нельзя.
     */
    if (!available && !have) return '';
    /*
     * §102.3: большой трюм ставится только на Кобру. У Аддера его нет, и
     * продавать за 400 CR апгрейд, который ничего не меняет, нельзя.
     */
    if (item.id === 'cargoBay' && shipSpec(state.ship).holdExtended === null) return '';
    let note = equipmentNote(item);
    if (item.id === 'missile') {
      note += ` · сейчас ${state.ship.missiles} из ${patrolMissilesRequired(state.ship)}`;
    }
    let action: string;
    if (have && item.id !== 'missile') action = '<span class="chip">установлено</span>';
    else if (have) action = '<span class="chip">полный боекомплект</span>';
    else
      action = `<button class="btn tonal" data-action="equip" data-id="${item.id}" ${docked && state.cash >= item.price ? '' : 'disabled'}>Купить</button>`;
    return `<div class="good-row" style="margin:10px 0"><div><div class="name">${item.name}</div>
      <div class="muted">${note}</div></div>${action}</div>`;
  }).join('');
}

function hangarScreen(): string {
  /*
   * §133.7: `docked` — «корабль на станции» (от него зависит модель), а
   * `trading` — «станция ещё чем-то торгует». Во время «Сверхновой» корабль
   * стоит в ангаре, но заправлять его нечем, и путать эти два состояния
   * нельзя: модель должна остаться.
   */
  const docked = !state.flight;
  const trading = docked && !stationLocked(state);
  const tank = maxFuel(state.ship);
  const missing = tank - state.fuel;
  // Модель корабля живёт в ангаре: это место про сам корабль, а экран
  // «Корабль» — про полёт и груз. В пути модель не рисуем: в ангаре
  // корабля нет, он улетел.
  const name = shipSpec(state.ship).name;
  const model = docked
    ? `<div class="card ship-view">
      <canvas id="ship-model" data-ship="${state.ship.model}" aria-label="Модель корабля ${name}"></canvas>
      <div class="sub" style="text-align:center">${name} · пристыкован</div>
    </div>`
    : '';
  /*
   * §131: карточка топлива прилипает к нижнему краю шапки.
   *
   * Пользователь: «сперва карточка корабля уезжает вверх вместе с остальным
   * списком, затем карточка „топливо“, дойдя до нижнего края шапки,
   * закрепляется там, а остальной список уходит уже под „топливо“».
   *
   * Обёртка нужна только ради `position: sticky`: она прозрачна, без полей и
   * отступов (§131.10), поэтому видна ровно карточка — со своим скруглением и
   * тенью, и сквозь дуги её нижних углов видно то, что под неё уползает.
   *
   * §131.12: у прилипшей карточки верхние углы не гасятся, а закрашиваются
   * фоном страницы — скругление остаётся, а мелькать в нём нечему.
   */
  /*
   * §133.5: в редакторе карточке топлива задана высота 140, а кнопкам —
   * сдвиг на 6 вниз. Высоту ставим как `min-height`, а не `height`: список
   * ниже бывает любой длины, а обрезать его нельзя — карточка не коробка с
   * прокруткой, содержимое просто вылезло бы за скругление.
   */
  /*
   * §133.7: ВО ВРЕМЯ «СВЕРХНОВОЙ» АНГАР — ЭТО ДВЕ КАРТОЧКИ.
   *
   * Пользователь: «экран „ангар“ — только мой корабль и карточка „топливо“,
   * вместо кнопок надпись „Топлива на станции не осталось“». Топливо увозят
   * беженцы, оборудование и верфь закрыты — показывать их выключенными значит
   * обещать то, чего не будет.
   */
  const fuelActions = stationLocked(state)
    ? '<div class="sub" style="margin-top:6px">Топлива на станции не осталось</div>'
    : `<div class="row" style="margin-top:6px">
        <button class="btn tonal" data-action="refuel" data-n="10" ${trading && missing > 0 ? '' : 'disabled'}>+1.0</button>
        <button class="btn" data-action="refuel" data-n="${missing}" ${trading && missing > 0 ? '' : 'disabled'}>Полный бак</button>
      </div>`;
  return `${model}<div class="sticky-fuel"><div class="card" style="min-height:140px"><h2>Топливо</h2>
      <div class="sub">${ly(state.fuel)} из ${ly(tank)} · цена 0.2 CR за св. год</div>
      <div class="progress"><div style="width:${(state.fuel / tank) * 100}%"></div></div>
      ${fuelActions}</div></div>
    ${stationLocked(state) ? '' : `<div class="card"><h2>Оборудование</h2>
      <div class="sub">Здесь технологический уровень ${currentSystem(state).techLevel + 1}: показано только то, что на этой станции продаётся. Установлен один лазер — новый заменяет прежний.</div>
      ${equipmentRows()}</div>
    ${shipyardCard()}
    ${pilotsSummaryCard()}
    ${galacticCard()}`}`;
}

/**
 * ВЕРФЬ (§102.4).
 *
 * Правила Elite-A:
 *   * продаются первые `15 - 2 * экономика` моделей из таблицы цен;
 *   * старый корабль идёт в зачёт по полной цене — доплачивается разница;
 *   * новый корабль приходит «голым», оборудование слетает (кроме ГГД,
 *     это отступление, о котором сказано в подписи).
 *
 * Покупка необратима и стирает снаряжение, поэтому кнопка не покупает
 * сразу: первый клик показывает подтверждение с точной суммой, второй
 * совершает обмен.
 */
function shipyardCard(): string {
  // §133.6: верфь тоже закрыта, пока станция занята беженцами.
  const docked = !state.flight && !stationLocked(state);
  const economy = currentSystem(state).economy;
  const forSale = shipsForSale(economy);
  const mine = state.ship.model;
  const tradeIn = shipPrice(mine);

  const rows = forSale.map((id) => {
    const spec = SHIPS[id];
    const price = shipPrice(id);
    const diff = price - tradeIn;
    const isMine = id === mine;
    const unaffordable = state.cash < diff;
    const tons = cargoTons(state);
    const tooMuchCargo = tons > spec.hold;

    let action: string;
    if (isMine) action = '<span class="chip">ваш корабль</span>';
    else if (confirmShip === id) {
      action = `<span class="row" style="gap:6px">
        <button class="btn danger" data-action="ship-confirm" data-id="${id}">Подтвердить</button>
        <button class="btn text" data-action="ship-cancel">Отмена</button>
      </span>`;
    } else if (tooMuchCargo) {
      action = `<span class="chip dear">груз ${tons} т не влезет в ${spec.hold} т</span>`;
    } else {
      action = `<button class="btn tonal" data-action="ship-buy" data-id="${id}" ${docked && !unaffordable ? '' : 'disabled'}>${diff > 0 ? `Доплатить ${cr(diff)}` : `Обменять`}</button>`;
    }

    const note = [
      `Трюм ${spec.hold} т`,
      `Ракеты ${spec.missiles}`,
      `Прыжок ${ly(spec.range)}`,
      `Цена ${cr(price)}`,
    ].join(' · ');

    const left = state.cash + tradeIn - price;
    const confirm = confirmShip === id
      ? `<div class="muted" style="margin-top:6px">Оборудование и ракеты слетят — останется голый ${spec.name}: без лазера вы не сможете ни нападать, ни обороняться, пока не купите его заново${state.ship.galacticHyperdrive ? ' и галактический двигатель' : ''}. Груз (${cargoTons(state)} т) останется. ${
          left >= 0 ? `Денег останется ${cr(left)}.` : `Не хватает ${cr(-left)}.`
        }</div>`
      : '';

    return `<div class="good-row" style="margin:10px 0"><div>
        <div class="name">${spec.name}${isMine ? ' · сейчас' : ''}</div>
        <div class="muted">${note}</div>${confirm}</div>${action}</div>`;
  }).join('');

  /*
   * §102.5: НИКАКИХ ПОДСКАЗОК О ФОРМУЛЕ.
   *
   * Пользователь: «здесь продаётся 1 из 6 моделей, чем промышленнее
   * система, тем длиннее список» — убрать, «должна остаться интрига и
   * тайна». Раньше здесь стояла и вторая подпись про богатую промышленную
   * систему — она выдавала то же правило с другой стороны.
   *
   * Теперь витрина просто показывает то, что есть. Где продают Анаконду,
   * игрок выясняет сам — это и есть открытие галактики.
   */
  // §133.5: в редакторе карточке верфи задана высота 150 — тоже `min-height`:
  // кораблей в продаже бывает много, а фиксированная высота их обрезала бы.
  return `<div class="card" style="min-height:150px"><h2>Верфь</h2>
      <div class="sub">Зачёт вашего ${SHIPS[mine].name} — ${cr(tradeIn)}. Платится только разница.</div>
      ${rows}</div>`;
}

/**
 * ФЛОТ (§105): пилоты, которые летают сами.
 *
 * Шаг 1 — только торговцы. Правила, о которых договорились:
 *   * нанимать можно с ранга «Опытный» (128 убийств), число пилотов не
 *     ограничено — ограничение кошелёк;
 *   * корабль покупается на этой же верфи (значит, в бедной системе
 *     пилоту достанется только Аддер) плюс задаток 500 CR;
 *   * маршрут — из системы, где наняли, в любую в пределах бака корабля;
 *   * один маршрут — один пилот: двое сбивают друг другу цену. Это и есть
 *     потолок флота: он растёт от разведанных маршрутов, а не от денег.
 *
 * До «Опытного» карточки нет вовсе: как и в рынке, недоступное скрыто, а
 * не подписано «заблокировано».
 */
/**
 * §115: сводные числа флота — по одному месту расчёта.
 *
 * Одни и те же цифры нужны и в карточке ангара, и в шапке экрана
 * «Пилоты». Считать их дважды в двух местах — это гарантированное
 * расхождение через месяц, поэтому считаем здесь.
 */
function fleetTotals(): { count: number; inRoute: number; perHour: number; earned: number } {
  let perHour = 0;
  let inRoute = 0;
  for (const p of state.pilots) {
    const cycle = pilotCycleMs(state, p, settings);
    if (cycle <= 0) continue;
    const income = pilotRunIncome(pilotRouteProfit(state, p), p.id - 1, p.runs);
    perHour += Math.round(income / (cycle / 3_600_000) / 10);
    inRoute++;
  }
  return {
    count: state.pilots.length,
    inRoute,
    perHour,
    earned: state.stats?.pilotIncome ?? 0,
  };
}

/**
 * §115: КАРТОЧКА-СВОДКА в ангаре.
 *
 * Раньше весь флот жил прямо в ангаре: список пилотов, наём, список
 * маршрутов. На трёх-четырёх пилотах ангар превращался в простыню, и
 * «а сколько у меня всего» приходилось складывать глазами.
 *
 * Теперь здесь только сводка и вход на отдельный экран «Пилоты»
 * (карточка целиком — кнопка: палец должен попадать, а не искать
 * мелкую надпись в углу).
 */
function pilotsSummaryCard(): string {
  if (state.kills < PILOT_MIN_KILLS) return '';
  const t = fleetTotals();

  const body = t.count === 0
    ? `<div class="sub">Пилот не нанят. Пилот летает маршрут сам: три четверти выручки — вам, четверть — ему.</div>`
    : `<div class="grid">
        ${stat('Пилотов', String(t.count))}
        ${stat('В рейсе', String(t.inRoute))}
        ${stat('Доход в час', `${t.perHour} CR`)}
      </div>
      <div class="sub" style="margin-top:8px">Пилот летает маршрут сам: три четверти выручки — вам, четверть — ему. Один маршрут — один пилот.</div>`;

  return `<div class="card" data-action="pilots-open" style="cursor:pointer">
      <div class="row"><h2 style="margin:0">Пилоты</h2><span class="spacer"></span>
        <span class="chip">${t.count === 0 ? 'никого' : `${t.inRoute} в рейсе`}</span></div>
      ${body}
      <div class="row" style="margin-top:12px">
        <span class="muted">Пилотов ${t.count} · принесли ${cr(t.earned)}</span>
        <span class="spacer"></span>
        <button class="btn tonal" data-action="pilots-open">Все пилоты →</button>
      </div>
    </div>`;
}

/**
 * §115: экран «Пилоты».
 *
 * Каждый пилот — своя карточка, как товар в магазине: имя и корабль в
 * заголовке, ниже три числа (рейс / вам / в час), риск и срок
 * возвращения. Рядом — кнопка «маршрут», которая раскрывает тот же
 * список направлений, что был в ангаре.
 *
 * Наём переехал сюда же: это часть флота, а не ангара. Иначе игрок
 * искал бы «нанять» в одном месте, а «сменить маршрут» — в другом.
 */
function pilotsScreen(): string {
  const now = Date.now();
  const systems = systemsOf(state.galaxy);
  const docked = !state.flight;
  const economy = currentSystem(state).economy;
  const t = fleetTotals();

  const cards = state.pilots.map((p) => {
    const cycle = pilotCycleMs(state, p, settings);
    const profit = pilotRouteProfit(state, p);
    const income = pilotRunIncome(profit, p.id - 1, p.runs);
    // `income` — в десятых кредита, как вся экономика; в час показываем
    // целые кредиты, иначе на экране было бы «490 CR/ч» вместо 49.
    const perHour = cycle > 0 ? Math.round(income / (cycle / 3_600_000) / 10) : 0;

    /*
     * §108: у полицейского не маршрут, а место дежурства — «LAVE → LAVE»
     * читалось бы как ошибка. Строка собирается ТОЛЬКО при наличии
     * маршрута: обращение к p.route до проверки роняло рендер у пилота,
     * который ещё стоит в ангаре.
     */
    /*
     * §128: перелёт показывается раньше маршрута — в это время маршрута
     * нет вовсе, и «без маршрута» читалось бы как «стоит без дела».
     */
    const transfer = p.transfer && now < p.transfer.until ? p.transfer : null;
    const where = transfer
      ? `${PILOT_ROLE_NAMES[p.role]} · летит ${systems[transfer.from].name} → ${systems[p.home].name} · прибудет через ${formatSpan(transfer.until - now)}`
      : p.route
      ? (p.role === 'police'
        ? `${PILOT_ROLE_NAMES[p.role]} · патруль ${systems[p.route.to].name}`
        : `${PILOT_ROLE_NAMES[p.role]} · ${systems[p.route.from].name} → ${systems[p.route.to].name} · ${ly(routeDistance(systems, p.route))}`)
      : `${PILOT_ROLE_NAMES[p.role]} · без маршрута`;

    const body = transfer
      ? '<div class="sub" style="margin-top:10px">В пути: рейсов не делает, маршрут можно назначить после прилёта.</div>'
      : p.route
      ? `<div class="grid" style="margin-top:10px">
           ${stat('Рейс', cr(profit))}
           ${stat('Вам', cr(income))}
           ${stat('В час', `${perHour} CR`)}
         </div>
         <div class="sub" style="margin-top:8px">${risksLine(p.role, p, systems)}</div>
         <div class="sub">${rankLine(p)} · встреч за рейс ${pilotEncounters(state, p, settings)}</div>
         <div class="sub">Вернётся через <span data-pilot-next="${p.id}">${formatSpan(p.nextRunAt - now)}</span> · рейсов ${p.runs}${p.failures > 0 ? ` · провалов ${p.failures}` : ''}</div>`
      : '<div class="sub" style="margin-top:10px">Маршрут не задан — корабль стоит в ангаре</div>';

    return {
      perHour,
      income,
      html: `<div class="card">
        <div class="row"><h2 style="margin:0">${roleIcon(p.role)}${p.name}</h2><span class="spacer"></span>
          <span class="chip">${SHIPS[p.ship].name}</span></div>
        <div class="sub" style="margin-top:2px">${where}</div>
        ${body}
        <div class="row" style="margin-top:12px">
          <button class="btn tonal" data-action="pilot-move" data-i="${p.id}">Сменить планету</button>
          <button class="btn tonal" data-action="pilot-route" data-i="${p.id}">${p.route ? 'Сменить маршрут' : 'Назначить маршрут'}</button>
          <button class="btn text" data-action="pilot-refit" data-i="${p.id}">Сменить корабль</button>
        </div>
      </div>`,
    };
  })
    /*
     * §116: ПОРЯДОК — ПО ДОХОДУ.
     *
     * Пользователь: «сортировка по доходу будет кстати». Карточки идут от
     * самой прибыльной к самой скромной: экран нужен для одного
     * взгляда — «кто кормит флот, а кто простаивает». Пилот без маршрута
     * приносит ноль и оказывается внизу сам собой, без отдельного правила.
     *
     * Второй ключ — доход за рейс: при одинаковой ставке в час выше тот,
     * кто везёт больше. Дальше сравнивать нечем, и это безопасно: sort в
     * JS устойчивый, поэтому равные пилоты остаются в порядке найма и
     * карточки не меняются местами при каждой перерисовке.
     */
    .sort((a, b) => b.perHour - a.perHour || b.income - a.income)
    .map((c) => c.html)
    .join('');

  let hire: string;
  if (!hireOpen) {
    hire = `<button class="btn tonal" data-action="pilot-hire-open" ${docked ? '' : 'disabled'}>Нанять пилота · задаток ${cr(PILOT_HIRE_FEE)}</button>`;
  } else {
    hire = shipsForSale(economy).map((id) => {
      const price = shipPrice(id) + PILOT_HIRE_FEE;
      const pick = `<button class="btn tonal" data-action="pilot-hire-pick" data-id="${id}" ${state.cash >= price ? '' : 'disabled'}>Нанять</button>`;
      const action = hireShip === id
        ? `<span class="row" style="gap:6px">
            <button class="btn danger" data-action="pilot-hire-confirm" data-id="${id}">Подтвердить</button>
            <button class="btn text" data-action="pilot-hire-cancel">Отмена</button>
          </span>`
        : pick;
      const confirm = hireShip === id
        ? `<div class="muted" style="margin-top:6px">Корабль ${cr(shipPrice(id))} и задаток ${cr(PILOT_HIRE_FEE)}. Пилот придёт без маршрута — назначите следом.</div>`
        : '';
      return `<div class="good-row" style="margin:10px 0"><div>
          <div class="name">${SHIPS[id].name}</div>
          <div class="muted">Трюм ${SHIPS[id].hold} т · Радиус ${ly(SHIPS[id].range)} · ${cr(price)}</div>${confirm}</div>${action}</div>`;
    }).join('');
    hire = `${hire}<div class="row" style="margin-top:8px">
        <button class="btn text" data-action="pilot-hire-close">Свернуть</button></div>`;
  }

  /*
   * §126: МАРШРУТ — ТОЖЕ НАД СПИСКОМ.
   *
   * Пользователь: «ранее мы переместили блок „нанять пилота“, но теперь
   * блок с выбором маршрута для него остался внизу списка. Перенеси его
   * так же».
   *
   * Панель рисовалась ВНУТРИ карточки пилота, а нанятый пилот без маршрута
   * приносит ноль и по правилу §116 оказывается в самом низу. То есть
   * сразу после найма следующий шаг — назначить маршрут — уезжал под весь
   * флот. Теперь панель стоит отдельной карточкой под блоком найма, над
   * списком, и подписана именем пилота: видно, кому назначаем.
   */
  /*
   * §128: три панели живут над списком по одному правилу — та, что открыта,
   * стоит над карточками, а не внутри них (§124, §126).
   */
  const routed = routePilot === null ? undefined : state.pilots.find((p) => p.id === routePilot);
  const moving = movePilotFor === null ? undefined : state.pilots.find((p) => p.id === movePilotFor);
  const refitting = refitPilotFor === null ? undefined : state.pilots.find((p) => p.id === refitPilotFor);
  const routeCard = routed ? pilotRoutePanel(routed, systems) : '';
  const moveCard = moving ? pilotMovePanel(moving, systems) : '';
  const refitCard = refitting ? pilotRefitPanel(refitting) : '';

  return `<div class="card">
      <div class="row"><button class="btn text" data-action="pilots-close">← Назад</button>
        <span class="spacer"></span>
        <span class="chip">${t.count} ${plural(t.count, 'пилот', 'пилота', 'пилотов')}</span></div>
      <div class="grid" style="margin-top:12px">
        ${stat('В рейсе', `${t.inRoute} из ${t.count}`)}
        ${stat('Доход в час', `${t.perHour} CR`)}
        ${stat('Принесли', cr(t.earned))}
      </div>
      <div class="sub" style="margin-top:8px">Пилот летает маршрут сам: три четверти выручки — вам, четверть — ему. Рейс — настоящий перелёт туда и обратно плюс два часа отдыха. Один маршрут — один пилот.</div>
      <div class="sub">Сверху — кто приносит больше в час; пилоты без маршрута в конце. Нанять нового можно выше списка.</div>
    </div>
    <div class="card"><h2>Нанять пилота</h2>
      <div class="sub">Пилот приходит со своим кораблём: цена = корабль + задаток ${cr(PILOT_HIRE_FEE)}.</div>
      <div style="margin-top:12px">${hire}</div>
    </div>
    ${routeCard}
    ${moveCard}
    ${refitCard}
    ${cards}`;
}


/**
 * Список маршрутов пилота: только то, куда хватает его бака.
 *
 * §107: вместе с маршрутом выбирается РОЛЬ. Считается всё сразу по трём
 * ролям — игрок переключает их и видит, как меняются деньги и риск, не
 * уходя с экрана. Риск показан до назначения: попадать в беду, о которой
 * не предупредили, — против правил этой игры (§97).
 */
function pilotRoutePanel(pilot: Pilot, systems: ReturnType<typeof systemsOf>): string {
  const spec = SHIPS[pilot.ship];
  const role = routeRole;

  const roles = (Object.keys(PILOT_ROLE_NAMES) as PilotRole[]).map((id) => {
    const active = id === role;
    return `<button class="btn ${active ? 'tonal' : 'text'}" data-action="pilot-role" data-role="${id}">${PILOT_ROLE_NAMES[id]}</button>`;
  }).join('');

  const hint = role === 'pirate'
    ? `Каждый рейс: +${PIRATE_LEGAL_PER_RUN} к розыску. Перехват — корабль и пилот потеряны, трепка — ремонт.`
    : role === 'smuggler'
      ? `Возит законный груз и запрещёнку. Досмотр: запрещёнка конфискована, штраф 100 CR, ваш розыск +${SMUGGLER_LEGAL} — а с ним полиция становится враждебной.`
      : role === 'police'
        ? `Дежурит в системе: +${POLICE_SURVEILLANCE_BONUS} к надзору — вашим торговцам спокойнее, вашим пиратам и контрабандистам здесь тесно. Плата — награды за поимку.`
        : 'Запрещёнку не берёт вовсе. Риск — пираты на линии.';

  // Надзор с учётом дежурных: риски, которые видит игрок, и риски, по
  // которым считает `accrueFleet`, берутся из одной карты.
  const surv = surveillanceMap(state);

  const options = systems
    .map((sys, i) => ({ i, d: distance(systems[pilot.home], sys) }))
    // Полицейскому своя система — законное место дежурства.
    .filter((o) => (role === 'police' || o.i !== pilot.home) && o.d <= spec.range)
    .map((o) => {
      const route = { from: pilot.home, to: o.i };
      const gross = role === 'pirate'
        ? pirateLoot(state.galaxy, systems, route, spec.hold)
        : role === 'police'
          ? policeBounty(systems[o.i].government)
          : routeProfit(state.galaxy, systems, route, spec.hold, role);
      const cycle = pilotCycleMs(state, { ...pilot, route }, settings);
      const income = pilotRunIncome(gross, pilot.id - 1, pilot.runs);
      // Полицейский рискует по беззаконию системы, а не по надзору с его же
      // участием — ровно так же считает и `accrueFleet`.
      const risk = pilotRiskRanked(pilotRisk(
        role,
        (surv[route.from] + surv[route.to]) / 2,
        role === 'police' ? systems[o.i].government : surv[o.i],
      ), pilot.runs);
      return {
        ...o,
        perHour: cycle > 0 ? Math.round(income / (cycle / 3_600_000) / 10) : 0,
        income,
        risk,
      };
    })
    .sort((a, b) => b.perHour - a.perHour);

  const head = `<div class="row"><h2 style="margin:0">Маршрут: ${pilot.name}</h2>
      <span class="chip">${spec.name}</span><span class="spacer"></span>
      <button class="btn text" data-action="pilot-route-close">Свернуть</button></div>`;

  if (options.length === 0) {
    return `<div class="card" data-route-card style="margin:0 0 14px">${head}
      <div class="muted" style="margin:6px 0 4px">В радиусе бака нет ни одной системы — этому кораблю отсюда не улететь.</div></div>`;
  }

  const rows = options.map((o) => {
    // §129: та же проверка, что в ядре — иначе витрина обещает запрет,
    // которого нет, или разрешает то, что ядро отклонит.
    const taken = laneBusy(state.pilots, pilot, o.i, role);
    const isCurrent = pilot.route?.to === o.i && pilot.role === role;
    /*
     * §132.12: ЗНАЧОК ТОГО, КТО УЖЕ НА ЭТОЙ ЛИНИИ.
     *
     * Пользователь: «Для пилота перед кнопками „лететь" и „занят" поставить
     * значки, кем занят маршрут».
     *
     * Линия делится только внутри своего типа (§129), поэтому рядом с
     * «Лететь» может стоять чужой пилот — торговец не мешает полицейскому.
     * Раньше об этом не говорилось вообще, и выглядело так, будто линия
     * свободна. Теперь перед действием видны роли всех, кто на ней: значок
     * роли плюс подсказка с именем.
     */
    const guard = state.pilots
      .filter((other) => other.id !== pilot.id && other.route?.from === pilot.home && other.route?.to === o.i)
      .map((other) => `<span title="${PILOT_ROLE_NAMES[other.role]}: ${other.name}">${roleIcon(other.role)}</span>`)
      .join('');
    const action = isCurrent
      ? `<span class="chip">${role === 'police' ? 'дежурит здесь' : 'летает здесь'}</span>`
      : taken
        ? '<span class="chip dear">маршрут занят</span>'
        : `<button class="btn" data-action="pilot-route-set" data-i="${pilot.id}" data-to="${o.i}" data-role="${role}">Лететь</button>`;
    return `<div class="good-row"><div>
        <div class="name">${systems[o.i].name}</div>
        <div class="muted">${role === 'police' ? '' : `${ly(o.d)} · `}вам ${cr(o.income)} за рейс · ${o.perHour} CR/ч</div>
        <div class="muted">${riskLabel(role, o.risk)}</div></div>${
          guard ? `<span class="lane-guard">${guard}</span>` : ''
        }${action}</div>`;
  }).join('');

  return `<div class="card" data-route-card style="margin:0 0 14px;background:rgba(255,255,255,0.03)">
      ${head}
      <div class="sub">Маршрут из ${systems[pilot.home].name}, в пределах ${ly(spec.range)}.</div>
      <div class="row" style="gap:6px;margin:6px 0 10px">${roles}</div>
      <div class="sub" style="color:var(--dim)">${hint}</div>
      ${rows}</div>`;
}

/**
 * §128: ПЕРЕЛЁТ ПИЛОТА НА ДРУГУЮ ПЛАНЕТУ.
 *
 * Пользователь: «кнопка слева „Сменить планету“ рядом с „сменить маршрут“,
 * а внутри будут маршруты планеты расположения игрока. Пилот будет
 * добираться туда сам, честно. Топливо ему за перелёт оплатим мы».
 *
 * Поэтому список — планеты, до которых дотягивается САМ ИГРОК: он задаёт
 * точку, пилот летит к ней своим ходом. Видно три вещи, и все три важны
 * перед нажатием: расстояние, топливо (платит командир) и время в пути.
 * Время считается по настоящей формуле прыжка, а если путь длиннее бака
 * пилота — по сумме отрезков: короткий бак действительно замедляет переезд.
 */
function pilotMovePanel(pilot: Pilot, systems: ReturnType<typeof systemsOf>): string {
  const spec = SHIPS[pilot.ship];
  const reach = maxFuel(state.ship);
  const here = systems[state.system].name;

  const rows = systems
    .map((sys, i) => ({ i, d: distance(systems[state.system], sys) }))
    .filter((o) => o.d <= reach && o.i !== pilot.home)
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((o) => {
      const cost = pilotTransferCost(state, pilot, o.i);
      const ms = pilotTransferMs(state, pilot, o.i, settings);
      const affordable = state.cash >= cost;
      return `<div class="good-row" style="margin-top:10px"><div>
          <div class="name">${systems[o.i].name}</div>
          <div class="muted">${ly(distance(systems[pilot.home], systems[o.i]))} · топливо ${cr(cost)} · в пути ${formatSpan(ms)}</div>
        </div><button class="btn" data-action="pilot-move-set" data-i="${pilot.id}" data-to="${o.i}" ${affordable ? '' : 'disabled'}>Лететь</button></div>`;
    }).join('');

  return `<div class="card" data-move-card style="margin:0 0 14px;background:rgba(255,255,255,0.03)">
      <div class="row"><h2 style="margin:0">Перелёт: ${pilot.name}</h2>
        <span class="chip">${spec.name}</span><span class="spacer"></span>
        <button class="btn text" data-action="pilot-move-close">Свернуть</button></div>
      <div class="sub">Сейчас в ${systems[pilot.home].name}. Выберите планету рядом с ${here}; топливо платите вы, пилот летит сам и в это время рейсов не делает.</div>
      ${rows || '<div class="muted" style="margin-top:10px">В радиусе вашего бака нет ни одной другой планеты.</div>'}
    </div>`;
}

/**
 * §128: СМЕНА КОРАБЛЯ ПИЛОТА.
 *
 * Пользователь: «нужна возможность менять им корабли». Правило взято у
 * верфи игрока (§102.4), чтобы не заводить вторую экономику: новый корабль
 * по своей цене, старый — в зачёт по своей. Маршрут снимается: у нового
 * корабля может быть короче бак.
 */
function pilotRefitPanel(pilot: Pilot): string {
  const products = shipsForSale(currentSystem(state).economy).filter((id) => id !== pilot.ship);
  const rows = products.map((id) => {
    const diff = shipPrice(id) - shipPrice(pilot.ship);
    const affordable = state.cash >= diff;
    const money = diff > 0
      ? `доплата ${cr(diff)}`
      : diff < 0
        ? `вернут ${cr(-diff)}`
        : 'ровно в цену';
    return `<div class="good-row" style="margin-top:10px"><div>
        <div class="name">${SHIPS[id].name}</div>
        <div class="muted">Трюм ${SHIPS[id].hold} т · Радиус ${ly(SHIPS[id].range)} · ${money}</div>
      </div><button class="btn" data-action="pilot-refit-set" data-i="${pilot.id}" data-id="${id}" ${affordable ? '' : 'disabled'}>Поставить</button></div>`;
  }).join('');

  return `<div class="card" data-refit-card style="margin:0 0 14px;background:rgba(255,255,255,0.03)">
      <div class="row"><h2 style="margin:0">Корабль: ${pilot.name}</h2>
        <span class="chip">${SHIPS[pilot.ship].name}</span><span class="spacer"></span>
        <button class="btn text" data-action="pilot-refit-close">Свернуть</button></div>
      <div class="sub">Старый корабль идёт в зачёт по своей цене, новый — по цене верфи. Маршрут придётся назначить заново: у другого корабля свой бак.</div>
      ${rows || '<div class="muted" style="margin-top:10px">На этой верфи больше нечего поставить.</div>'}
    </div>`;
}

/** Шанс в процентах: «2%», «4.5%», «0.5%». */
function pct(x: number): string {
  const v = x * 100;
  return `${v >= 10 || Number.isInteger(v) ? Math.round(v) : v.toFixed(1)}%`;
}

/**
 * §120: строка ранга в карточке пилота.
 *
 * Ранг — это не только титул: он даёт +4% выручки и −5% риска за ступень,
 * поэтому рядом с именем стоит и цена ступени. И до следующего ранга —
 * чтобы было видно, растёт пилот или стоит.
 */
function rankLine(p: Pilot): string {
  const rank = pilotRank(p.runs);
  const name = pilotRankName(p.runs);
  const next = PILOT_RANK_RUNS[rank + 1];
  const bonus = `+${Math.round(PILOT_RANK_INCOME * rank * 100)}% дохода, −${Math.round(PILOT_RANK_RISK * rank * 100)}% риска`;
  const left = next === undefined
    ? 'предел'
    : `до «${pilotRankName(next)}» ${next - p.runs} ${next - p.runs === 1 ? 'рейс' : 'рейса'}`;
  return `Ранг: <b>${name}</b> · ${bonus} · ${left}`;
}

/** Риски роли одной строкой — то, что игрок читает ПЕРЕД назначением. */
function riskLabel(role: PilotRole, risk: ReturnType<typeof pilotRisk>): string {
  if (role === 'pirate') return `перехват ${pct(risk.police)} · трепка ${pct(risk.damage)}`;
  if (role === 'smuggler') {
    if (risk.inspect <= 0) return 'досмотр маловероятен';
    // §121: цена досмотра — не только штраф, но и ВАШ розыск. Игрок должен
    // видеть это до назначения роли, а не узнавать из журнала.
    return `досмотр ${pct(risk.inspect)} · при досмотре ваш розыск +${SMUGGLER_LEGAL}`;
  }
  if (role === 'police') return `гибель ${pct(risk.death)} · трепка ${pct(risk.beaten)}`;
  return risk.raid > 0 ? `пираты ${pct(risk.raid)}` : 'линия спокойная';
}

/** Риски пилота по уже назначенному маршруту. */
function risksLine(role: PilotRole, pilot: Pilot, systems: ReturnType<typeof systemsOf>): string {
  if (!pilot.route) return '';
  const surv = surveillanceMap(state);
  const risk = pilotRiskRanked(pilotRisk(
    role,
    (surv[pilot.route.from] + surv[pilot.route.to]) / 2,
    role === 'police' ? systems[pilot.route.to].government : surv[pilot.route.to],
  ), pilot.runs);
  return riskLabel(role, risk);
}

/**
 * Галактический гипердвигатель: одноразовый предмет (как GHYP в Ghy).
 * Переход всегда приводит в точку (96, 96) новой галактики, а оттуда —
 * в ближайшую систему; криминальное дозье при этом обнуляется.
 */
function galacticCard(): string {
  const drive = state.ship.galacticHyperdrive;
  const next = (state.galaxy % 8) + 1;
  const arrival = systemsOf(next)[nearestSystem(systemsOf(next), GALACTIC_ARRIVAL.x, GALACTIC_ARRIVAL.y)];
  const explain = drive
    ? `Прибытие: точка (96, 96) → ближайшая система <b>${arrival.name}</b> в галактике ${next}. Двигатель одноразовый, криминальное дозье будет сброшено.`
    : `Установите галактический гипердвигатель на станции с достаточным технологическим уровнем (№12 на верфи).`;
  return `<div class="card warn"><h2>Галактический гиперпрыжок</h2>
      <div class="sub">${explain}</div>
      <div class="sub" style="margin-top:8px;color:var(--dim)">
        Прыжок выполняется только в космосе: карта → «Отстыковка» → «ГАЛАКТИКА».
      </div></div>`;
}

function select(key: string, options: [string, string][], current: string): string {
  const opts = options
    .map(([v, l]) => `<option value="${v}" ${v === current ? 'selected' : ''}>${l}</option>`)
    .join('');
  return `<select data-action="setting" data-key="${key}">${opts}</select>`;
}

/**
 * Статистика командира для журнала.
 *
 * Показывает не только «сколько убил», но и торговый баланс: из
 * статистики сделок видно, зарабатывает игрок на перевозках или
 * теряет. Это подсказка к стратегии, а не просто цифры.
 */
function statsCard(): string {
  const st = state.stats ?? {
    kills: 0, fled: 0, skipped: 0, goodTrades: 0, badTrades: 0,
    tradeProfit: 0, jumps: 0, dockings: 0, dockingFails: 0,
  };
  const trades = st.goodTrades + st.badTrades;
  const rate = trades > 0 ? Math.round((st.goodTrades / trades) * 100) : 0;
  const profitSign = st.tradeProfit >= 0 ? '+' : '−';
  return `<div class="card"><h2>Статистика</h2>
    <div class="grid">
      ${stat('Уничтожено', String(st.kills))}
      ${stat('Ранг', rankOf(state.kills))}
      ${stat('Прыжков', String(st.jumps))}
      ${stat('Стыковок', `${st.dockings}${st.dockingFails ? ` / ${st.dockingFails} ✗` : ''}`)}
      ${stat('Бегств', String(st.fled))}
      ${stat('Пропущено', String(st.skipped))}
      ${stat('Доход флота', cr(st.pilotIncome ?? 0))}
    </div>
    <h2 style="margin-top:14px">Торговля</h2>
    <div class="grid">
      ${stat('Удачных', String(st.goodTrades))}
      ${stat('Неудачных', String(st.badTrades))}
      ${stat('Успех', trades ? `${rate}%` : '—')}
      ${stat('Прибыль', `${profitSign}${cr(Math.abs(st.tradeProfit))}`)}
    </div>
    ${trades === 0 ? '<div class="sub" style="margin-top:8px">Сделок пока не было — купите товар подешевле и продайте там, где дорого.</div>' : ''}
  </div>`;
}

/**
 * §113: экран «Отладка».
 *
 * Зачем отдельный экран, а не строки в настройках: у игрока настройки —
 * это «как играть», а здесь «как смотреть внутрь». Смешивать их значит
 * заставлять игрока читать наши ручки, а нас — прятать их в общий список.
 *
 * Что здесь есть:
 *  - два переключателя карты (линии маршрутов и сам пилот);
 *  - выгрузка отладочного файла — полное состояние, настройки, журнал,
 *    среда браузера и расшифровка флота (`buildDebugFile`).
 */
/** §119: варианты отдыха пилота — от 1 минуты до 3 часов, как просил пользователь. */
const REST_CHOICES: [string, string][] = [
  [String(1 * 60_000), '1 мин'],
  [String(5 * 60_000), '5 мин'],
  [String(10 * 60_000), '10 мин'],
  [String(15 * 60_000), '15 мин'],
  [String(30 * 60_000), '30 мин'],
  [String(60 * 60_000), '1 час'],
  [String(90 * 60_000), '1.5 часа'],
  [String(120 * 60_000), '2 часа'],
  [String(180 * 60_000), '3 часа'],
];

function devScreen(): string {
  const sizes = (() => {
    try {
      const raw = localStorage.getItem(SAVE_KEY) ?? '';
      return `${Math.round(raw.length / 1024)} КБ`;
    } catch {
      return '—';
    }
  })();
  const notice = devNotice
    ? `<div class="${devNotice.ok ? 'sub' : 'alert'}" style="margin-top:10px">${devNotice.text}</div>`
    : '';
  const pilots = state.pilots ?? [];
  const withRoute = pilots.filter((p) => p.route !== null).length;

  return `<div class="card">
      <div class="row"><button class="btn text" data-action="dev-close">← Назад</button><span class="spacer"></span>
        <span class="chip">сохранение ${sizes}</span></div>
      <div class="row" style="margin-top:10px"><label>Редактор интерфейса</label><span class="spacer"></span>
        <button class="btn small ${editorOn ? '' : 'tonal'}" data-action="dev-editor">${
          editorOn ? 'Убрать карандаш' : 'Редактор'
        }</button></div>
      <div class="sub" style="margin:8px 0 4px">${editorOn
        ? 'Карандаш по центру шапки включает правку: нажмите на карточку, строку или кнопку. Пока правка включена, игра стоит на паузе.'
        : 'Кнопка достаёт карандаш в шапку. Дальше карандаш включает и выключает сам режим правки.'}</div>
      <h2 style="margin-top:10px">Карта и флот</h2>
      <div class="row" style="margin-top:6px"><label>Линии маршрутов</label><span class="spacer"></span>
        ${select('devRoutes', [['on', 'Показаны'], ['off', 'Скрыты']], settings.devRoutes ? 'on' : 'off')}</div>
      <div class="row" style="margin-top:10px"><label>Пилот на маршруте</label><span class="spacer"></span>
        ${select('devPilots', [['on', 'Показан'], ['off', 'Скрыт']], settings.devPilots ? 'on' : 'off')}</div>
      <div class="sub" style="margin:6px 0 4px">Пилот рисуется треугольником по ходу движения на МЕСТНОЙ карте (на общей карте метки не нужны: там им тесно); патрульный — кольцом вокруг системы.</div>
      <h2 style="margin-top:16px">Экономика флота</h2>
      <div class="row" style="margin-top:6px"><label>Отдых пилота</label><span class="spacer"></span>
        ${select('pilotRestMs', REST_CHOICES, String(settings.pilotRestMs))}</div>
      <div class="sub" style="margin:6px 0 4px">Отдых — главный тормоз флота: перелёт 2.6 св. г. занимает 18 минут, остальное — отдых. На карточке пилота видно «В час» и «Вернётся через»; после смены значения они пересчитываются сразу.</div>
      <div class="sub" style="margin-top:8px;color:var(--dim)">Пилотов: ${pilots.length}, из них в рейсе: ${withRoute}.</div>
    </div>
    <div class="card">
      <h2>Лог файла</h2>
      <div class="sub">Полная выгрузка для разбора: состояние целиком, настройки, журнал событий, среда браузера и расшифровка флота —
        расстояние рейса, длительность цикла, доход и риски каждого пилота.</div>
      <div class="sub" style="margin-top:8px;color:var(--dim)">В браузере: система ${systemsOf(state.galaxy)[state.system]?.name ?? '—'},
        кредитов ${cr(state.cash)}, строк журнала ${log.length}.</div>
      <div class="row" style="margin-top:12px">
        <button class="btn tonal" data-action="dev-log">Скачать лог</button>
      </div>
      <div class="sub" style="margin-top:8px;color:var(--dim)">Файл: ${debugFileName(state)}</div>
      ${notice}
    </div>`;
}

function logScreen(): string {
  // ×0.5 убран по просьбе пользователя (§76): на этапе расчётов он был
  // полезен (позволял замерить «полтора часа отсутствия»), в игре лишний.
  const speeds = [1, 2, 5, 10, 20, 100, 200].map((s): [string, string] => [String(s), `×${s}`]);
  const timeouts = [1, 2, 5, 10, 30].map((m): [string, string] => [String(m * 60000), `${m} мин`]);
  const rates = [
    ['0', 'Нет встреч'],
    ['0.5', 'Редко'],
    ['1', 'Обычно'],
    ['2', 'Часто'],
  ] as [string, string][];
  const notif =
    'Notification' in window
      ? Notification.permission === 'granted'
        ? '<span class="muted">Уведомления включены</span>'
        : '<button class="btn tonal" data-action="notify-permission">Включить уведомления</button>'
      : '<span class="muted">Уведомления не поддерживаются</span>';
  return `${statsCard()}<div class="card"><h2>Настройки</h2>
      <div class="row"><label>Темп игры</label><span class="spacer"></span>${select('speed', speeds, String(settings.speed))}</div>
      <div class="sub" style="margin:6px 0 12px">Прыжок 7 св. лет: ${fmtDur(jumpDuration(settings, 70))} · 3 св. года: ${fmtDur(jumpDuration(settings, 30))}</div>
      <div class="row"><label>Бой</label><span class="spacer"></span>${select('combatMode', [['auto', 'Автоматический'], ['manual', 'С вмешательством']], settings.combatMode)}</div>
      <div class="row" style="margin-top:10px"><label>Чужой корабль исчезает через</label><span class="spacer"></span>${select('encounterTimeoutMs', timeouts, String(settings.encounterTimeoutMs))}</div>
      <div class="row" style="margin-top:10px"><label>Частота встреч</label><span class="spacer"></span>${select('encounterRate', rates, String(settings.encounterRate))}</div>
      <div class="row" style="margin-top:10px"><label>Груз из обломков</label><span class="spacer"></span>${select('autoScoop', [['off', 'Выбирать вручную'], ['on', 'Подбирать автоматически']], settings.autoScoop ? 'on' : 'off')}</div>
      <div class="row" style="margin-top:10px"><label>Модуль стыковки</label><span class="spacer"></span>${select('dockingModule', [['on', 'Включён'], ['off', 'Выключен']], settings.dockingModule ? 'on' : 'off')}</div>
      <div class="sub" style="margin:6px 0 12px">${settings.dockingModule
        ? 'Прыжок — только из мини-игры стыковки. На карте «Отстыковка».'
        : 'Прыжок — прямо с карты, без мини-игры.'}</div>
      <div class="row" style="margin-top:12px">${notif}<span class="spacer"></span><button class="btn text" data-action="reset">Начать заново</button></div>
      <div class="row" style="margin-top:6px"><button class="btn text" data-action="dev-open">Для разработчика →</button></div></div>
    ${saveCard()}
    ${logCard()}`;
}


/* ---------- Модуль стыковки ---------- */

/**
 * Контракт заменяемого модуля стыковки.
 *
 * Любая реализация — наша мини-игра, прототип пользователя (user-docking3),
 * вариант A или B — подключается как объект с этими полями. Игра не знает,
 * что внутри: она открывает экран и получает результат.
 *
 * Это и есть «модульность» без правок ядра: `state.ts` не участвует,
 * меняется только объект в DOCKING_MODULES.
 */
export interface DockingResult {
  /** Пристыковались? */
  docked: boolean;
  /** Повреждение корпуса при провале, 0..60 */
  damage: number;
  /** Игрок улетел, бросив заход (для прыжка из мини-игры) */
  jumpedAway?: boolean;
}

export interface DockingModule {
  /** Имя для настроек и журнала */
  readonly name: string;
  /** Короткая подпись для списка */
  readonly label: string;
  /**
   * Открыть экран стыковки. Возвращает результат или null,
   * если модуль не смог открыться.
   */
  open(): DockingResult | null;
}

/**
 * Реализация по умолчанию — мини-игра пользователя в iframe.
 *
 * Файл лежит в `public/`, поэтому копируется в сборку как есть и может
 * быть заменён без пересборки игры: достаточно положить другой HTML
 * с тем же протоколом.
 */
const STANDALONE_SCREEN_ID = 'docking-screen-html';

/**
 * Экран для автономной сборки: разметка уже лежит в странице под
 * `<script type="text/plain" id="docking-screen-html">`. Если такого
 * тега нет — это обычная сборка, и экран грузится файлом.
 */
const EMBEDDED = typeof document !== 'undefined' && !!document.getElementById(STANDALONE_SCREEN_ID);

const DEFAULT_DOCKING = new IframeDockingModule({
  src: EMBEDDED ? STANDALONE_SCREEN_ID : './user-docking3-tune.html',
  mode: EMBEDDED ? 'srcdoc' : 'url',
  name: 'user-docking3',
  label: 'Ваша мини-игра',
});

/** Активный модуль. Меняется, если подключат другую реализацию. */
let activeDocking: IframeDockingModule | null = DEFAULT_DOCKING;

let dockingOpen = false;

/**
 * Открывает экран стыковки и применяет результат.
 *
 * Возвращает false, только если модуль недоступен. Сама стыковка
 * асинхронна: экран живёт в iframe, ответ приходит сообщением.
 */
function openDocking(): boolean {
  const mod = activeDocking;
  if (!mod) return false;
  if (dockingOpen) return false;
  dockingOpen = true;

  const systems = systemsOf(state.galaxy);
  const target = selected !== null && selected !== state.system ? selected : null;

  void mod
    .open({
      systemName: systems[state.system].name,
      hasComputer: state.ship.dockingComputer,
      // Прыжок живёт в космосе, а космос у нас только здесь.
      canJump: true,
      jumpTarget: target,
      jumpTargetName: target !== null ? systems[target].name : null,
      hasGalacticDrive: state.ship.galacticHyperdrive,
      nextGalaxy: (state.galaxy % 8) + 1,
    })
    .then((outcome) => {
      dockingOpen = false;
      if (!outcome) {
        addLog('Стыковка: экран закрыт без решения');
        render();
        return;
      }
      if (outcome.jumpedAway && outcome.jumpKind === 'galactic') {
        // Галактический прыжок: цель не нужна — она задана жёстко
        // (точка 96,96), а двигатель одноразовый.
        const from = state.galaxy;
        const rg = galacticJump(state);
        if (rg.error) {
          addLog(
            rg.error === 'no-drive'
              ? 'Галактический гипердвигатель не установлен'
              : 'Нельзя прыгнуть сейчас',
          );
        } else {
          state = rg.state;
          selected = null;
          addLog(
            `Галактический гиперпрыжок: галактика ${from} → ${state.galaxy}, прибытие в систему ${currentSystem(state).name}. Двигатель израсходован`,
          );
          tab = 'map';
        }
        render();
        return;
      }
      if (outcome.jumpedAway) {
        // Игрок улетел, бросив заход. Цель — выбранная на карте,
        // иначе прыгать некуда.
        if (target === null) {
          addLog('Прыжок отменён: на карте не выбрана система');
          render();
          return;
        }
        const r = startJump(state, target, Date.now(), settings);
        if (r.error) {
          addLog(JUMP_ERRORS[r.error]);
        } else {
          const legalBefore = state.legal;
          state = r.state;
          addLog(`Отправление: ${systems[state.system].name} → ${systems[target].name}`);
          if (state.legal > legalBefore) {
            addLog(`Контрабанда в трюме: правовой статус ${legalBefore} → ${state.legal} (${legalLabel(state.legal)})`);
          }
          tab = 'ship';
        }
        render();
        return;
      }
      if (outcome.docked) {
        state = { ...state, stats: { ...state.stats, dockings: state.stats.dockings + 1 } };
        addLog(`Стыковка: успешно (${mod.label})`);
      } else {
        state = {
          ...state,
          stats: { ...state.stats, dockingFails: state.stats.dockingFails + 1 },
        };
        addLog(
          `Стыковка: провал, повреждение ${outcome.damage} (${mod.label})`,
        );
      }
      render();
    });

  return true;
}

/* ---------- Отрисовка ---------- */

/**
 * §89: начисление времени карьеры.
 *
 * Живёт в UI, а не в `advance`, по важной причине: `advance` — чистый
 * досчёт мира, и инвариант «один вызов = много вызовов» проверяется
 * тестами. Настенное время внутри него сделало бы результат зависимым от
 * того, как часто его зовут, — то есть перестало бы быть досчётом.
 *
 * Два правила, и оба про честность счётчика:
 *
 *  1. `careerAt <= 0` — точки отсчёта нет (новая игра или только что
 *     загруженный файл). Первый тик только ставит её. Иначе закрытая на
 *     сутки вкладка дала бы сутки «карьеры».
 *  2. Шаг ограничен `CAREER_MAX_STEP`. Тик идёт раз в секунду, так что для
 *     играющего человека потолок незаметен; срабатывает он на спящем
 *     телефоне и переводе системных часов.
 *
 * Паузы боя и обломков отдельно не вычитаются, и это осознанно: тик не
 * останавливается, пока игрок думает над ходом, — но и «игрой» это время
 * не является. Считать его проще, чем объяснять расхождение с календарём.
 */
const CAREER_MAX_STEP = 5 * 60 * 1000;

function tickCareer(state: GameState, now: number): GameState {
  const at = state.careerAt ?? 0;
  if (at <= 0) return { ...state, careerMs: state.careerMs ?? 0, careerAt: now };
  if (now <= at) return state;
  const step = Math.min(now - at, CAREER_MAX_STEP);
  return { ...state, careerMs: (state.careerMs ?? 0) + step, careerAt: now };
}

/**
 * §91: верхняя строка — одно значение, без подписи.
 *
 * Заголовок экрана слева уже говорит, где вы («Корабль», «Рынок»...),
 * поэтому подпись справа дублировала бы его — так и вышло в §90, где на
 * экране стояло «Корабль» слева и «КОРАБЛЬ» справа. Осталось значение:
 * слева ГДЕ, справа ЧТО здесь важно (см. `topValue` в `top-bar.ts`).
 */
function topBar(busy: boolean, override: string | null = null): void {
  const el = document.getElementById('top-info');
  if (!el) return;
  el.textContent = override ?? topValue(state, busy ? null : tab);
}

/**
 * §133.3: репутация в шапке — «Репутация +4».
 *
 * Подпись здесь нужна: без неё «+4» в правом верхнем углу читается как что
 * угодно. Заголовок «Контракты» её не дублирует — он говорит, где вы.
 */
function repLabel(rep: number): string {
  const sign = rep > 0 ? '+' : rep < 0 ? '−' : '';
  return `Репутация ${sign}${Math.abs(rep)}`;
}

/**
 * §98: подпись вкладки зависит от места.
 *
 * На станции это «Рынок» — там торгуют. В полёте рынка нет, но груз есть,
 * и именно там его надо сбрасывать: контрабанда в трюме запрещает побег
 * (§80.1), а выбросить её раньше было негде — экран обломков бывает только
 * после боя.
 *
 * Поэтому та же вкладка в полёте называется «Трюм». Отдельную вкладку не
 * заводим: пять кнопок внизу — это предел для телефона, шестая сжала бы
 * все, а значение и так одно — груз.
 *
 * `id` при этом остаётся 'market': переименование не должно тянуть за собой
 * сохранения, шапку и проверки.
 */
function tabLabel(id: Tab): string {
  if (id === 'market') return state.flight ? 'Трюм' : 'Рынок';
  return TABS.find((t) => t.id === id)!.label;
}

/**
 * §118: предупреждение о второй вкладке.
 *
 * Не модальное окно: игра продолжает идти, но сохранение стоит. Кнопка
 * «Играть здесь» переносит хозяина сейва в эту вкладку — соседняя начнёт
 * предупреждать сама, и игрок сам решит, какую закрыть.
 */
function tabWarningCard(): string {
  return `<div class="card illegal" data-tabs="warn"><h2>Игра открыта в другой вкладке</h2>
      <div class="sub">Сохранение одно на всех, и две вкладки затирают игру друг друга: так теряются деньги и появляется «внезапный» розыск. Пока эта вкладка не хозяйка сейва, она <b>не сохраняет</b>.</div>
      <div class="row" style="margin-top:10px"><span class="spacer"></span>
        <button class="btn tonal" data-action="tab-take">Играть здесь</button></div>
    </div>`;
}

/**
 * §132: включён ли редактор интерфейса.
 *
 * Держим копию флага в `main`, чтобы `render()` не дёргал геттер на каждом
 * кадре: значение меняется только по нажатию карандаша.
 */
let editing = isEditing();

/**
 * §132.1: показывать ли карандаш.
 *
 * Пользователь: «В настройках для разработчиков должна быть кнопка „редактор“
 * по её нажатию и появляется и убирается карандаш. А сам редактор уже
 * активируется карандашом». То есть это ДВА разных действия: кнопка в отладке
 * только достаёт инструмент, карандаш — включает правку.
 *
 * В сейв не пишется: это состояние инструмента, а не игры.
 */
let editorOn = false;

/**
 * §132: под каким именем редактор хранит правки этого экрана.
 *
 * Ключ — экран, а не вкладка: у боя, обломков и списка пилотов своя разметка,
 * и правки одного не должны налезать на другой.
 */
function editorScreen(): string {
  if (state.combat) return 'combat';
  if (state.salvage) return 'salvage';
  if (pilotsOpen && tab === 'hangar') return 'pilots';
  // §133.3: у доски контрактов своя разметка — правки не должны налезать на рынок.
  if (contractsOpen && tab === 'market' && !state.flight) return 'contracts';
  return tab;
}

function render(): void {
  const content = document.getElementById('content')!;
  const screens: Record<Tab, () => string> = {
    ship: shipScreen,
    map: mapScreen,
    market: marketScreen,
    hangar: hangarScreen,
    log: logScreen,
  };
  const inCombat = state.combat !== null;
  const inSalvage = state.salvage !== null;

  /*
   * Сохраняем прокрутку перед перерисовкой.
   *
   * `innerHTML = ...` уничтожает все узлы, и браузер сбрасывает
   * scrollTop в 0. Для карты это особенно заметно: тапнул по системе,
   * чтобы посмотреть сведения, — и тебя унесло наверх, приходится
   * скроллить заново. Пользователь назвал это «скролл сбывается».
   *
   * Достаточно запомнить scrollTop контейнера и вернуть после.
   */
  /*
   * Прокрутка и фокус.
   *
   * Сохраняем не только scrollTop: при пересборке innerHTML браузер
   * сбрасывает фокус на body, а если фокусируемый элемент был ниже
   * края экрана — прокручивает к нему. На карте фокусируемых элементов
   * нет, но кнопки «Напасть/Прыжок» рядом, и клик по ним тоже вызывал
   * рывок. Восстановим и активный элемент.
   */
  const scrollTop = content.scrollTop;
  const active = document.activeElement as HTMLElement | null;
  // §113: экран отладки — поверх вкладки, но не поверх боя и обломков:
  // там идёт решение, и уводить с него нельзя.
  // §132: в режиме правки показываем сам экран, а не отладку, — иначе править
  // было бы нечего.
  const showDev = devOpen && !inCombat && !inSalvage && !editing;
  // §115: экран пилотов живёт только поверх ангара — уходя с вкладки, он
  // закрывается (это делает обработчик вкладок), как и экран отладки.
  const showPilots = pilotsOpen && !showDev && !inCombat && !inSalvage && tab === 'hangar';
  /*
   * §133.3: контракты — поверх рынка и только на станции. В полёте вкладка
   * называется «Трюм», и доски там нет вовсе.
   */
  const showContracts = contractsOpen && !showDev && !inCombat && !inSalvage
    && tab === 'market' && !state.flight;
  /*
   * §118: предупреждение о второй вкладке — поверх ЛЮБОГО экрана, включая
   * бой: если сохранение сейчас заблокировано, игрок обязан это знать, а
   * не выяснять через час, куда делся прогресс.
   */
  const content0 = inCombat
    ? combatScreen()
    : inSalvage
      ? salvageScreen()
      : showDev
        ? devScreen()
        : showPilots
          ? pilotsScreen()
          : showContracts
            ? contractsScreen()
            : screens[tab]();
  content.innerHTML = (otherTab && !tabTaken ? tabWarningCard() : '') + content0;
  document.getElementById('title')!.textContent = inCombat
    ? 'Бой'
    : inSalvage
      ? 'Обломки'
      : showDev
        ? 'Отладка'
        : showPilots
          ? 'Пилоты'
          : showContracts
            ? 'Контракты'
            : tabLabel(tab);
  /*
   * §133.3: репутация — справа в шапке экрана контрактов (решение
   * пользователя). В остальных местах шапка живёт по правилу §91.
   */
  topBar(inCombat || inSalvage, showContracts ? repLabel(missionRepOf(state)) : null);
  const blocked = inCombat || inSalvage ? TABS.map((t) => t.id) : blockedTabs();
  document.getElementById('nav')!.innerHTML = TABS.map((t) => {
    const off = blocked.includes(t.id);
    // Заблокированная вкладка остаётся видимой, но приглушённой: игрок
    // должен видеть, что рынок существует и вернётся, когда сядешь.
    return `<button class="${t.id === tab && !inCombat && !inSalvage ? 'active' : ''}${off ? ' off' : ''}"
        data-action="tab" data-tab="${t.id}" ${off ? 'disabled aria-disabled="true"' : ''}
        title="${off ? 'Только на станции' : ''}">
        <span class="pill">${icon(t.icon)}</span>${tabLabel(t.id)}</button>`;
  }).join('');
  if (tab === 'map' && !inCombat && !inSalvage) drawMap();
  // Модель встречи живёт только пока экран её показывает: иначе кадры
  // крутятся на невидимом холсте и жгут батарею.
  if (state.encounter && !inCombat && !inSalvage) startEncounterModel();
  else stopEncounterModel();
  // Модель корабля теперь в ангаре и только на стоянке: в полёте
  // канваса нет, анимация не нужна.
  if (tab === 'hangar' && !inCombat && !state.flight) startShipModel();
  else cancelAnimationFrame(shipModelFrame);
  updateFlight();

  /*
   * Прокрутку возвращаем ПОСЛЕ отрисовки холстов.
   *
   * Здесь была причина «экран сам скроллится при выборе планеты».
   * Порядок был: запомнить scrollTop → innerHTML → вернуть scrollTop →
   * drawMap(). В момент возврата холсты ещё дефолтные (300×150 вместо
   * 360×360), контент короче примерно на 210 px, и браузер обрезает
   * scrollTop по тогдашнему максимуму. Игрок был на 300 — оказывался
   * на 120. Карта дорисовывалась уже после, высота возвращалась, а
   * прокрутка оставалась обрезанной.
   *
   * В jsdom это не воспроизводится: там scrollTop — просто поле,
   * которое ничего не обрезает. Поэтому и не поймалось тестами.
   */
  // Фокус возвращаем до прокрутки: сфокусированный элемент у края
  // экрана сам подтягивает прокрутку, и порядок здесь важен.
  if (active && active.dataset?.action && active !== document.body) {
    const again = content.querySelector<HTMLElement>(`[data-action="${active.dataset.action}"]`);
    if (again && document.activeElement !== again) again.blur();
  }
  content.scrollTop = scrollTop;

  /*
   * §126: открыли маршрут — показываем его.
   *
   * Панель теперь над списком, а игрок мог стоять в самом низу. Восстановленная
   * прокрутка оставила бы его там, и нажатие «Назначить маршрут» выглядело бы
   * как «ничего не произошло». Подводим контейнер к карточке маршрута.
   */
  if (scrollToRoute) {
    scrollToRoute = false;
    const routeCardEl = content.querySelector<HTMLElement>('[data-route-card], [data-move-card], [data-refit-card]');
    if (routeCardEl) content.scrollTop = Math.max(0, routeCardEl.offsetTop - 8);
  }

  // §131.11: разметка новая — прежний класс `stuck` уехал вместе со старой.
  syncStickyCards();

  /*
   * §132: редактор интерфейса.
   *
   * Карандаш — только в режиме разработчика. Он же показывает, включена ли
   * правка: нажатое состояние закрашено.
   */
  const pencil = document.getElementById('dev-pencil');
  if (pencil) {
    /*
     * §132.2: карандаш живёт в шапке на ВСЕХ экранах, а не только в отладке.
     *
     * Пользователь: «Карандаш должен быть в шапке на всех экранах». Условие
     * одно — инструмент достали кнопкой в отладке; дальше он есть везде, в том
     * числе в бою и в обломках: правки — дело вида, а не места.
     */
    pencil.hidden = !editorOn;
    pencil.setAttribute('aria-pressed', editing ? 'true' : 'false');
  }
  applyUiEdits(content, editorScreen());
}

/**
 * §131.12 / §132.7: залипла липкая карточка («Топливо», «Станция») или ещё едет.
 *
 * Нужно ради верхних углов: у прилипшей карточки за ними лежит полоса цвета
 * страницы. Снизу углы не трогаются — сквозь них должно быть видно уползающую
 * карточку.
 *
 * Признак прилипания простой: верх обёртки сравнялся с верхом области
 * прокрутки. Считать по смещению нельзя — оно зависит от браузера.
 */
function syncStickyCards(): void {
  const content = document.getElementById('content');
  if (!content) return;
  /*
   * §132.7: обёрток может быть несколько — сейчас «Топливо» в ангаре и
   * «Станция» на рынке. Но на одном экране всегда одна, поэтому проверяем все:
   * это дешевле, чем потом искать, почему на новом экране углы не закрасились.
   */
  const top = content.getBoundingClientRect().top + 0.5;
  content.querySelectorAll<HTMLElement>('.sticky-fuel').forEach((wrap) => {
    wrap.classList.toggle('stuck', wrap.getBoundingClientRect().top <= top);
  });
}

/* ---------- Модель корабля в ангаре ---------- */

/**
 * §113: отдельный экран для разработчика.
 *
 * Не вкладка: вкладок пять, и шестая сжала бы все (это уже решено в §98).
 * Поэтому «Отладка» открывается кнопкой из настроек, а закрывается либо
 * «Назад», либо любой вкладкой — состояние экрана не переживает переход.
 */
let devOpen = false;

/**
 * §115: экран «Пилоты» — отдельно от ангара.
 *
 * Та же схема, что у экрана отладки: не вкладка (их пять), а экран поверх
 * ангара. Открывается карточкой-сводкой, закрывается «Назад» или любой
 * вкладкой.
 */
let pilotsOpen = false;

/** Строка-подтверждение на экране отладки (после скачивания лога). */
let devNotice: { ok: boolean; text: string } | null = null;

let shipModelFrame = 0;
let shipModelAngle = 0;
let shipModelLast = 0;

/**
 * Крутит модель корабля, пока открыт экран «Корабль».
 *
 * Угол считается от времени, а не прибавляется каждый кадр: так
 * скорость вращения не зависит от частоты кадров, и на слабом
 * телефоне корабль не начнёт вертеться медленнее.
 */
function drawShipFrame(now: number): void {
  const canvas = document.getElementById('ship-model') as HTMLCanvasElement | null;
  if (!canvas) return; // экран сменили — анимация закончилась

  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 300;
  const h = Math.round(w * 0.46);
  canvas.style.height = `${h}px`;
  if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
  if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  if (!shipModelLast) shipModelLast = now;
  // 24 секунды на оборот: медленно, чтобы не отвлекало от чтения цифр.
  shipModelAngle = (now / 24000) * Math.PI * 2;

  /*
   * §106: в ангаре — модель ТОГО корабля, на котором летает игрок.
   *
   * Раньше `drawShipModel` вызывался без `ship`, а по умолчанию в нём
   * зашита Кобра — и в ангаре всегда стояла она, даже когда игрок уже
   * купил Питон и подпись честно говорила «Python · пристыкован».
   * Модель берём из `data-ship`, чтобы её нельзя было рассинхронизировать
   * с подписью: и то, и другое пишется из `state.ship.model`.
   */
  const bp = FLEET[canvas.dataset.ship ?? ''];
  drawShipModel(ctx, { width: w, height: h, yaw: shipModelAngle, ship: bp });
  shipModelFrame = requestAnimationFrame(drawShipFrame);
}

/**
 * Модель встреченного корабля.
 *
 * Рисуется один раз (не анимация): экран встречи — это решение за
 * несколько секунд, вращение тут отвлекало бы. Угол в три четверти,
 * чтобы силуэт читался: нос, борт и то, насколько корабль большой.
 */
/**
 * §113: среда браузера для отладочного файла.
 *
 * Собирается здесь, а не в `debug-file.ts`: ядро не должно знать про
 * `navigator` и `window` — иначе его нельзя проверить тестом.
 */
function debugEnv(): DebugEnv {
  let storageKeys: string[] = [];
  try {
    storageKeys = Object.keys(localStorage);
  } catch {
    storageKeys = [];
  }
  return {
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    platform: typeof navigator !== 'undefined' ? navigator.platform : undefined,
    language: typeof navigator !== 'undefined' ? navigator.language : undefined,
    timeZone: (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch {
        return undefined;
      }
    })(),
    viewport: [window.innerWidth, window.innerHeight],
    dpr: window.devicePixelRatio,
    online: typeof navigator !== 'undefined' ? navigator.onLine : undefined,
    storageKeys,
    standalone: EMBEDDED,
  };
}

/** Кадр анимации модели встреченного корабля. */
let encFrame = 0;

/**
 * Модель встреченного корабля — вращается.
 *
 * Сначала она рисовалась один раз под фиксированным углом: на экране
 * решения (несколько секунд) вращение казалось лишним. Пользователь
 * попросил вращение — и он прав: по одной проекции не понять форму,
 * особенно у плоских кораблей вроде Mamba. Оборот медленнее, чем у
 * модели в ангаре: здесь на экране есть кнопки, и мельтешение мешает
 * читать.
 */
function drawEncounterFrame(now: number): void {
  const canvas = document.querySelector('canvas.enc-model') as HTMLCanvasElement | null;
  if (!canvas) return; // экран сменился — анимация сама остановится
  const bp = FLEET[canvas.dataset.ship ?? ''];
  const ctx = canvas.getContext('2d');
  if (!bp || !ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 260;
  const h = Math.round(w * 0.42);
  canvas.style.height = `${h}px`;
  const bw = Math.round(w * dpr);
  const bh = Math.round(h * dpr);
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // 30 секунд на оборот: медленно, но форма читается за пару секунд.
  drawShipModel(ctx, {
    width: w,
    height: h,
    yaw: 0.7 + (now / 30000) * Math.PI * 2,
    ship: bp as ShipBlueprint,
  });

  encFrame = requestAnimationFrame(drawEncounterFrame);
}

function startEncounterModel(): void {
  cancelAnimationFrame(encFrame);
  encFrame = requestAnimationFrame(drawEncounterFrame);
}

function stopEncounterModel(): void {
  cancelAnimationFrame(encFrame);
}

function startShipModel(): void {
  cancelAnimationFrame(shipModelFrame);
  shipModelLast = 0;
  shipModelFrame = requestAnimationFrame(drawShipFrame);
}

function updateFlight(): void {
  const f = state.flight;
  const now = Date.now();
  const bar = document.getElementById('flight-bar');
  const eta = document.getElementById('flight-eta');
  if (f && bar && eta && !f.patrol) {
    // Прогресс считаем в БАЗОВЫХ единицах: тогда при смене темпа он не
    // прыгает назад/вперёд, а отражает реально пройденную часть маршрута.
    const done = f.elapsedBaseMs;
    const total = done + f.remainingBaseMs;
    const frac = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
    bar.style.width = `${(frac * 100).toFixed(1)}%`;
    eta.textContent = fmtDur(Math.max(0, f.arriveAt - now));
  }
  /*
   * §83: полоска топлива в патруле — живая.
   *
   * Обновляем её тем же тиком, что и время полёта: топливо убывает по
   * встречам, и игрок должен видеть, что патруль подходит к концу, не
   * дожидаясь полной перерисовки экрана.
   */
  if (f?.patrol) {
    const fuelBar = document.getElementById('flight-fuel');
    const fuelText = document.getElementById('flight-fuel-text');
    if (fuelBar) {
      const tank = maxFuel(state.ship);
      fuelBar.style.width = `${Math.max(0, Math.min(100, (state.fuel / tank) * 100)).toFixed(1)}%`;
    }
    if (fuelText) fuelText.textContent = ly(state.fuel);
  }
  /*
   * §105: обратный отсчёт пилотов. Раньше он обновлялся только при полной
   * перерисовке, то есть замирал на «2 ч 50 мин» и выглядел сломанным.
   * Теперь тик правит только текст, не трогая разметку.
   */
  for (const el of document.querySelectorAll<HTMLElement>('[data-pilot-next]')) {
    const pilot = state.pilots.find((p) => p.id === Number(el.dataset.pilotNext));
    if (pilot) el.textContent = formatSpan(pilot.nextRunAt - now);
  }
  /*
   * §133.3: обратный отсчёт контрактов — тем же тиком, что и у пилотов:
   * срок горит постоянно, а полная перерисовка раз в секунду убивала бы
   * обработчики кнопок.
   */
  for (const el of document.querySelectorAll<HTMLElement>('[data-mission-left]')) {
    const m = missionsOf(state).find((x) => x.id === Number(el.dataset.missionLeft));
    if (m) el.textContent = formatSpan(m.deadline - now);
  }
  const encEta = document.getElementById('enc-eta');
  if (state.encounter && encEta) encEta.textContent = fmtDur(state.encounter.resolveAt - now);
}

/* ---------- Карта ---------- */

/**
 * Геометрия карты.
 *
 * Карта развёрнута на 90°: галактика шире, чем выше (координаты 0..255
 * по X и 0..127 по Y), а телефон держат вертикально. Раньше карта была
 * полосой высотой в половину ширины, и система ложились тесно по
 * вертикали. Теперь оси местами: X галактики идёт вниз по экрану,
 * Y — вправо. Так карта занимает высоту экрана, где места больше.
 *
 * `ASPECT` = 0.5 — отношение высоты галактики к ширине (127 против 255).
 */
/**
 * Локальная карта: окно вокруг корабля, привязанное к топливу.
 *
 * Почему переделано. В прошлой версии я «повернул» карту, но:
 *  1. не проверил, что ось Y галактики тоже 0..255, а не 0..127 —
 *     холст выходил уже галактики, 110 систем уезжали за край;
 *  2. не учёл, что `distance()` в Elite — это `4·hypot(dx, dy/2)`.
 *     По Y расстояние считается ВДВОЕ «дешевле». Значит на экране
 *     масштаб по Y должен быть вдвое меньше, иначе круг дальности
 *     превращается в эллипс, и карта врёт о том, куда можно прыгнуть.
 *
 * В оригинале карта ZX Elite сжимает Y вдвое именно по этой причине —
 * я это видел раньше и сам же сломал при повороте.
 *
 * Показываем не всю галактику, а окно вокруг корабля с радиусом по
 * топливу: на телефоне 256 точек на экране — это каша, попасть
 * пальцем невозможно. В окне 3–11 систем, они крупные и подписаны.
 *
 * Поворот: X галактики идёт вниз по экрану, Y — вправо, поэтому
 * на телефоне карта вытянута вертикально.
 */

/* ---------- Действия ---------- */

function tradeLog(verb: string, i: number, amount: number, total: number): void {
  if (amount > 0) {
    addLog(`${verb} ${amount} ${UNITS[COMMODITIES[i].unit]} «${COMMODITIES[i].name}» на сумму ${cr(total)}`);
  }
}

function onAction(el: HTMLElement): void {
  const a = el.dataset.action;
  const i = Number(el.dataset.i);
  switch (a) {
    case 'tab': {
      // Пока идут обломки, уйти с экрана нельзя: подбор держит полёт на
      // паузе, и «уехать» на другую вкладку значило бы бросить его молча.
      if (state.salvage) break;
      const want = el.dataset.tab as Tab;
      // Рынок и ангар — только на станции. Кнопка уже выключена, но
      // проверяем и здесь: заблокированный элемент можно активировать
      // скриптом, а правило должно держаться в одном месте.
      if (blockedTabs().includes(want)) break;
      tab = want;
      /*
       * §113: экран отладки закрывается любой вкладкой.
       *
       * §132.2: правку это не трогает — карандаш теперь в шапке на всех
       * экранах, поэтому выйти из редактора можно откуда угодно.
       */
      devOpen = false;
      pilotsOpen = false; // §115: экран пилотов — тоже
      contractsOpen = false; // §133.3: доска контрактов — тоже
      // §102.4: подтверждение покупки корабля живёт только на вкладке.
      confirmShip = null;
      // §105: то же для найма и открытого списка маршрутов.
      hireOpen = false;
      hireShip = null;
      routePilot = null;
      routeRole = 'trader';
      movePilotFor = null; // §128
      refitPilotFor = null;
      // §127: подтверждение покупки станции живёт только на рынке.
      stationBuyOpen = false;
      break;
    }
    case 'go-map':
      tab = 'map';
      break;
    case 'buy1':
    case 'buyMax': {
      const cashBefore = state.cash;
      const r = buy(state, i, a === 'buy1' ? 1 : 9999);
      // Средняя цена покупки: нужно, чтобы потом понять, удачной ли
      // была продажа. Пересчитываем средневзвешенно по остатку.
      if (r.amount > 0) {
        const prevTons = state.cargo[i];
        const prevBasis = state.cargoBasis?.[i] ?? 0;
        const paid = cashBefore - r.state.cash;
        const newTons = prevTons + r.amount;
        const basis = newTons > 0 ? Math.round((prevBasis * prevTons + paid) / newTons) : 0;
        const basisArr = [...(state.cargoBasis ?? COMMODITIES.map(() => 0))];
        basisArr[i] = basis;
        r.state = { ...r.state, cargoBasis: basisArr };
      }
      state = r.state;
      tradeLog('Куплено', i, r.amount, cashBefore - state.cash);
      break;
    }
    case 'sell1':
    case 'sellAll': {
      const cashBefore = state.cash;
      const r = sell(state, i, a === 'sell1' ? 1 : 9999);
      // Удачная сделка = продали дороже средней цены покупки.
      if (r.amount > 0) {
        const basis = state.cargoBasis?.[i] ?? 0;
        const received = r.state.cash - cashBefore;
        const cost = basis * r.amount;
        // Отрицательная прибыль означает убыток: считаем и его.
        const profit = received - cost;
        const basisArr = [...(state.cargoBasis ?? COMMODITIES.map(() => 0))];
        if (r.state.cargo[i] === 0) basisArr[i] = 0; // товар кончился — базис не нужен
        r.state = {
          ...r.state,
          cargoBasis: basisArr,
          stats: {
            ...r.state.stats,
            goodTrades: r.state.stats.goodTrades + (profit > 0 ? 1 : 0),
            badTrades: r.state.stats.badTrades + (profit <= 0 ? 1 : 0),
            tradeProfit: r.state.stats.tradeProfit + profit,
          },
        };
        if (profit !== 0) {
          const sign = profit > 0 ? '+' : '−';
          addLog(`Сделка ${profit > 0 ? 'удачная' : 'в убыток'}: ${sign}${cr(Math.abs(profit))}`);
        }
      }
      state = r.state;
      tradeLog('Продано', i, r.amount, state.cash - cashBefore);
      break;
    }
    case 'leave-all': {
      // §133.8: «оставить всё» — груз остаётся на гибнущей станции.
      const i = Number(el.dataset.i);
      const r = jettisonCargo(state, i, state.cargo[i] ?? 0);
      state = r.state;
      if (r.dropped > 0) addLog(`Оставлено на станции: ${COMMODITIES[i].name} — ${r.dropped}`);
      break;
    }
    case 'refugees': {
      // §133.6: беженцы занимают трюм целиком — это осознанное действие.
      const r = takeRefugees(state, Date.now());
      state = r.state;
      handleEvents(r.events);
      if (r.error === 'no-station') addLog('Станции больше нет — спасать некого');
      if (r.error === 'no-hold') addLog('В трюме нет свободного места: оставьте товар на станции');
      break;
    }
    case 'refuel': {
      const r = refuel(state, Number(el.dataset.n));
      state = r.state;
      if (r.amount > 0) addLog(`Заправка: +${ly(r.amount)}`);
      break;
    }
    case 'ship-buy': {
      // Первый клик — только спросить: покупка стирает снаряжение.
      confirmShip = el.dataset.id as ShipId;
      break;
    }
    case 'ship-cancel': {
      confirmShip = null;
      break;
    }
    case 'ship-confirm': {
      const id = el.dataset.id as ShipId;
      const was = SHIPS[state.ship.model].name;
      const r = buyShip(state, id);
      confirmShip = null;
      if (r.error) {
        addLog(SHIP_ERRORS[r.error]);
      } else {
        state = r.state;
        addLog(`Куплен ${SHIPS[id].name} вместо ${was}. Доплата: ${cr(r.paid ?? 0)}`);
      }
      break;
    }
    case 'pilot-hire-open':
      hireOpen = true;
      hireShip = null;
      break;
    case 'pilot-hire-pick':
      hireShip = el.dataset.id as ShipId;
      break;
    case 'pilot-hire-cancel':
      hireShip = null;
      hireOpen = false;
      break;
    case 'pilot-hire-confirm': {
      const id = el.dataset.id as ShipId;
      const r = hirePilot(state, id, Date.now());
      hireShip = null;
      hireOpen = false;
      if (r.error) {
        addLog(PILOT_ERRORS[r.error]);
      } else {
        state = r.state;
        addLog(`Нанят пилот ${r.pilot!.name} · ${SHIPS[id].name}. Корабль и задаток: ${cr(shipPrice(id) + PILOT_HIRE_FEE)}`);
        // Сразу открываем маршруты: нанятый без дела пилот — это просто
        // потраченные деньги, и игрок должен увидеть следующий шаг.
        routePilot = r.pilot!.id;
        scrollToRoute = true;
      }
      break;
    }
    case 'pilot-hire-close':
      hireOpen = false;
      hireShip = null;
      break;
    case 'pilot-role':
      routeRole = (el.dataset.role as PilotRole) ?? 'trader';
      break;
    case 'pilot-move': {
      if (movePilotFor === i) { movePilotFor = null; break; }
      movePilotFor = i;
      routePilot = null;
      refitPilotFor = null;
      scrollToRoute = true;
      break;
    }
    case 'pilot-move-close':
      movePilotFor = null;
      break;
    case 'pilot-move-set': {
      const to = Number(el.dataset.to);
      const r = movePilot(state, i, to, Date.now(), settings);
      if (r.error) {
        addLog(PILOT_ERRORS[r.error]);
      } else {
        state = r.state;
        movePilotFor = null;
        addLog(`${r.pilot!.name} летит на ${systemsOf(state.galaxy)[to].name}. Топливо за счёт командира.`);
      }
      break;
    }
    case 'pilot-refit': {
      if (refitPilotFor === i) { refitPilotFor = null; break; }
      refitPilotFor = i;
      routePilot = null;
      movePilotFor = null;
      scrollToRoute = true;
      break;
    }
    case 'pilot-refit-close':
      refitPilotFor = null;
      break;
    case 'pilot-refit-set': {
      const id = el.dataset.id as ShipId;
      const r = refitPilot(state, i, id, Date.now());
      if (r.error) {
        addLog(PILOT_ERRORS[r.error]);
      } else {
        state = r.state;
        refitPilotFor = null;
        addLog(`${r.pilot!.name} пересел на ${SHIPS[id].name}. Маршрут снят — назначьте заново.`);
      }
      break;
    }
    case 'pilot-route': {
      if (routePilot === i) {
        routePilot = null;
        break;
      }
      routePilot = i;
      movePilotFor = null;
      refitPilotFor = null;
      scrollToRoute = true;
      // Открывая список, показываем ту роль, которой пилот летает сейчас.
      const pilot = state.pilots.find((p) => p.id === i);
      routeRole = pilot?.role ?? 'trader';
      break;
    }
    case 'pilot-route-close':
      routePilot = null;
      hireOpen = false;
      hireShip = null;
      break;
    case 'pilot-route-set': {
      const to = Number(el.dataset.to);
      const role = (el.dataset.role as PilotRole) ?? 'trader';
      const r = assignPilotRoute(state, i, to, Date.now(), role);
      if (r.error) {
        addLog(PILOT_ERRORS[r.error]);
      } else {
        const systems = systemsOf(state.galaxy);
        state = r.state;
        /*
         * §107: момент, который должен остаться в журнале. Наём пирата —
         * это решение с последствиями (розыск, потеря корабля), и он не
         * должен появляться молча.
         */
        const legal = role === 'pirate' ? ' Пират: каждый рейс +2 к розыску.' : '';
        addLog(`${r.pilot!.name} (${PILOT_ROLE_NAMES[role].toLowerCase()}) вышел на маршрут ${systems[r.pilot!.route!.from].name} → ${systems[to].name}.${legal}`);
        routePilot = null;
      }
      break;
    }
    case 'station-buy':
      stationBuyOpen = true;
      break;
    case 'station-buy-cancel':
      stationBuyOpen = false;
      break;
    case 'station-buy-confirm': {
      const bought = buyStation(state);
      stationBuyOpen = false;
      if (bought.error) {
        addLog(STATION_BUY_ERRORS[bought.error]);
      } else {
        state = bought.state;
        addLog(`Куплена станция в ${currentSystem(state).name} за ${cash((bought.paid ?? 0) / 10)}.`);
      }
      break;
    }
    case 'equip': {
      const id = el.dataset.id as EquipmentId;
      const r = buyEquipment(state, id);
      if (r.error) {
        addLog(EQUIPMENT_ERRORS[r.error]);
      } else {
        state = r.state;
        addLog(`Установлено: ${EQUIPMENT.find((e) => e.id === id)!.name}`);
      }
      break;
    }
    case 'select-system':
      selected = i;
      break;
    case 'decide': {
      const decision = el.dataset.decision as Decision;
      const enc = state.encounter;
      if (!enc) break;
      const enemy = enemyOf(enc.enemyId);
      const hostile = enc.outcome === 'attack';
      const lasers = {
        pulse: state.ship.laser === 'pulse',
        beam: state.ship.laser === 'beam',
        military: state.ship.laser === 'military',
        mining: state.ship.laser === 'mining',
      };
      /*
       * §96: ЗДЕСЬ БЫЛА ПРИЧИНА «это решение сейчас недоступно».
       *
       * Карточка встречи рисовала кнопку по правилу `isLegalTarget(роль)`,
       * а обработчик нажатия считал решения без роли. На пирата, летящего
       * мимо, кнопка была активна, нажатие приходило сюда — `can.attack`
       * выходил `false` — и игрок получал отказ.
       *
       * Теперь правило одно на оба места.
       */
      const can = availableDecisions(
        enemy,
        bestLaserOf(lasers),
        true,
        isLegalTarget(enc.role, hostile),
        toughnessOf(state.ship),
      );
      const r = applyDecision(enemy, decision, can, hostile);
      if (!r) {
        addLog('Это решение сейчас недоступно');
        break;
      }
      const won = r.outcome === 'won' || r.outcome === 'auto-victory';
      const skipped = r.outcome === 'skipped' || r.outcome === 'auto-skip';
      let next: GameState = {
        ...state,
        cash: state.cash + r.bounty,
        kills: state.kills + (won ? 1 : 0),
        stats: {
          ...state.stats,
          kills: state.stats.kills + (won ? 1 : 0),
          skipped: state.stats.skipped + (skipped ? 1 : 0),
          fled: state.stats.fled + (r.outcome === 'fled' ? 1 : 0),
        },
        encounter: null,
        combat: null,
      };
      /*
       * §122: ЦЕНА ПОБЕДЫ — ТА ЖЕ, ЧТО В АВТОБОЕ.
       *
       * Ручное «Напасть» раньше не давало ни груза с торговца, ни +64 за
       * полицейского: последствия жили только в автобое. Пока нападать на
       * мирных было нельзя, это не проявлялось; §122 открыл кнопку — и
       * цена должна считаться там же, где и в автобое.
       */
      if (won) {
        const settled: GameEvent[] = [];
        next = settleWonEncounter(next, enc, Date.now(), settled);
        for (const e of settled) addLog(e.text);
      }
      /*
       * §77: капсулы нет, но правило побега осталось — оно про бегство,
       * а не про предмет. Уходя от боя, игрок сбрасывает груз (кроме
       * предметов пришельцев: `cargoAfterPod` их сохраняет) и теряет
       * правовой статус. Так бегство остаётся решением с ценой, а не
       * бесплатной кнопкой «пропустить».
       */
      if (r.outcome === 'fled') {
        const pod = applyPodLoss({ cargo: state.cargo, holdSpace: state.holdSpace });
        next = {
          ...next,
          cargo: [...pod.cargo],
          holdSpace: pod.holdSpace,
          legal: 0,
        };
      }
      if (r.legalCleared) next = { ...next, legal: 0 };
      state = next;
      addLog(r.text + (r.bounty > 0 ? ` (+${cr(r.bounty)})` : ''));
      render();
      break;
    }
    case 'return-from-patrol': {
      // §82: вернуться можно в любой момент, ждать топлива не обязательно.
      const r = returnFromPatrol(state, Date.now());
      state = r.state;
      handleEvents(r.events);
      save();
      render();
      break;
    }
    case 'patrol': {
      /*
       * §81: патруль из блока «Пункт назначения».
       *
       * Отдельной кнопки «отстыковаться» больше нет: космос начинается
       * либо «Перелётом» (к цели), либо патрулём (внутри системы).
       * Режим выбирает статус: криминальный — пиратство.
       */
      const r = startPatrol(state, Date.now());
      if (r.error) {
        addLog(JUMP_ERRORS[r.error] ?? 'Патруль не начался');
      } else {
        state = r.state;
        const pirate = isCriminal(state.legal);
        addLog(
          pirate
            ? `Пиратство началось: в зачёт идут все встречные корабли. Розыск ${state.legal} (${legalLabel(state.legal)})`
            : 'Патруль начался: ищем встречи в системе',
        );
        tab = 'ship';
      }
      render();
      break;
    }
    case 'undock': {
      // Вход в мини-игру стыковки. Сам модуль подключается отдельно;
      // здесь только точка входа, чтобы карта была рабочей уже сейчас.
      const opened = openDocking();
      if (!opened) addLog('Модуль стыковки не подключён');
      break;
    }
    case 'jump': {
      const to = Number(el.dataset.to);
      const r = startJump(state, to, Date.now(), settings);
      if (r.error) {
        addLog(JUMP_ERRORS[r.error]);
      } else {
        const legalBefore = state.legal;
        state = r.state;
        addLog(`Отправление: ${currentSystem(state).name} → ${systemsOf(state.galaxy)[to].name}`);
        // Взлёт с контрабандой поднимает правовой статус (TT110 / BAD)
        if (state.legal > legalBefore) {
          /*
           * §98: записи мало говорить «статус вырос» — она обязана называть
           * ЧТО везём и ОТКУДА оно взялось. Иначе игрок видит наказание без
           * причины и не знает, что выбрасывать.
           */
          const manifest = cargoManifest(state);
          const goods = manifest.filter((e) => e.amount > 0);
          const what = handoverLine(goods);
          /*
           * §98.1: если путь неизвестен (груз достался от сохранения до §98
           * или от пути, который не записывается), не выдумываем его и не
           * молчим: называем товар и говорим прямо, что путь неизвестен.
           */
          const lost = untrackedContraband(manifest, state.cargo);
          const unknown = lost > 0 ? contrabandGoods(state.cargo) : '';
          const batch = what
            ? what
            : `${unknown} — происхождение неизвестно`;
          addLog(
            `Взлёт с запрещённым грузом: ${batch}. Правовой статус ${legalBefore} → ${state.legal} (${legalLabel(state.legal)})`,
          );
          if (state.cargo.some((n, k) => isContraband(k) && n > 0)) {
            addLog('Пока такой груз в трюме, побег от статуса невозможен. Сбросить его можно во вкладке «Трюм»');
          }
        }
        tab = 'ship';
      }
      break;
    }
    case 'combat': {
      const r = combatAction(state, el.dataset.a as CombatAction, Date.now(), settings);
      state = r.state;
      handleEvents(r.events);
      break;
    }
    case 'combat-auto': {
      const r = combatAutoplay(state, Date.now(), settings);
      state = r.state;
      handleEvents(r.events);
      break;
    }
    case 'salvage-take': {
      const r = salvageTake(state, Number(el.dataset.i), Date.now());
      state = r.state;
      if (r.error === 'no-room') addLog('В трюме нет места — нечем взять');
      break;
    }
    case 'salvage-all': {
      const r = salvageTakeAll(state, Date.now());
      state = r.state;
      if (r.taken > 0) addLog(`Подобрано контейнеров: ${r.taken}`);
      if (r.left > 0) addLog(`Не поместилось контейнеров: ${r.left}`);
      break;
    }
    case 'salvage-close':
      state = salvageClose(state);
      addLog('Обломки оставлены');
      break;
    /*
     * §98: сброс груза из «Трюма».
     *
     * Отдельно от `jettison` (тот живёт на экране обломков и связан с
     * паузой подбора): здесь сброс — обычное действие в полёте, и он
     * обязан попадать в журнал. Журнал — единственное место, где игрок
     * потом поймёт, куда делся груз.
     */
    case 'drop1':
    case 'dropAll': {
      const amount = a === 'drop1' ? 1 : state.cargo[i];
      const r = jettisonCargo(state, i, amount);
      state = r.state;
      if (r.dropped > 0) {
        const name = COMMODITIES[i].name;
        const unit = UNITS[COMMODITIES[i].unit];
        addLog(`Выброшено в космос: ${name}, ${r.dropped} ${unit}`);
        if (isContraband(i) && state.cargo[i] === 0) {
          addLog(`В трюме больше нет: ${name}. Побег от статуса снова возможен`);
        }
      }
      break;
    }
    case 'jettison': {
      const i = Number(el.dataset.i);
      const r = jettisonCargo(state, i, 1);
      state = r.state;
      if (r.dropped > 0) addLog(`Выброшено: ${COMMODITIES[i].name}, ${r.dropped} ${UNITS[COMMODITIES[i].unit]}`);
      break;
    }
    case 'log-toggle':
      logCollapsed = !logCollapsed;
      break;
    case 'save-file': {
      /*
       * Выгрузка в файл. `Blob` + ссылка с `download` — единственный способ
       * отдать файл без сервера: игра работает и как одинокий HTML-файл.
       * Ссылку убираем сразу после клика, иначе в некоторых браузерах она
       * остаётся висеть в документе и течёт память.
       */
      try {
        const now = Date.now();
        const file = buildSaveFile(state, log, settings, now);
        const blob = new Blob([encodeSaveFile(file)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = saveFileName(state, now);
        document.body.appendChild(a);
        a.click();
        a.remove();
        // Освобождаем ссылку не сразу: браузеру нужно время начать скачивание.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        lastFileSaveAt = new Date(now).toISOString();
        saveNotice = { ok: true, text: `Файл сохранён: ${a.download}` };
      } catch {
        saveNotice = { ok: false, text: 'Не удалось сохранить файл: браузер не дал скачать.' };
      }
      break;
    }
    case 'load-file': {
      // Открываем выбор файла. Сама загрузка — в обработчике change ниже.
      const input = document.getElementById('load-file-input') as HTMLInputElement | null;
      input?.click();
      return;
    }
    /*
     * §113: экран отладки.
     *
     * Открывается из настроек, закрывается «Назад» или любой вкладкой.
     * Отдельного пункта в нижней строке нет: пять вкладок — предел для
     * телефона (см. §98), и шестая сжала бы остальные.
     */
    case 'tab-take': {
      // §118: хозяином сейва становится эта вкладка; соседняя увидит нашу
      // метку и покажет предупреждение у себя.
      tabTaken = true;
      otherTab = false;
      tabBeat();
      render();
      break;
    }
    case 'pilots-open': {
      pilotsOpen = true;
      render();
      break;
    }
    case 'pilots-close': {
      pilotsOpen = false;
      routePilot = null;
      hireOpen = false;
      hireShip = null;
      render();
      break;
    }
    /*
     * §133.3: доска контрактов. Вход с карточки станции, выход — «Назад»
     * или любая вкладка.
     */
    case 'contracts-open': {
      contractsOpen = true;
      render();
      break;
    }
    case 'contracts-close': {
      contractsOpen = false;
      render();
      break;
    }
    case 'mission-take': {
      const now = Date.now();
      const r = takeMission(state, Number(el.dataset.id), now, settings);
      if (r.error) {
        // Кнопка запрещена, но запрет дублируется правилом в ядре (§123).
        addLog(r.error === 'no-hold' ? 'Контракт не взят: нет места в трюме или в работе уже три' : 'Контракт уже недоступен');
        break;
      }
      state = r.state;
      const m = missionsOf(state).find((x) => x.id === Number(el.dataset.id));
      if (m) {
        addLog(`Контракт взят: ${MISSION_KIND_NAMES[m.kind]} · ${systemsOf(state.galaxy)[m.to].name}, срок ${formatSpan(m.deadline - now)}`);
      }
      break;
    }
    case 'mission-deliver': {
      const r = deliverMission(state, Number(el.dataset.id));
      if (r.error) {
        addLog(r.error === 'wrong-system' ? 'Сдать контракт можно только в целевой системе' : 'Контракт уже не в работе');
        break;
      }
      const done = missionsOf(state).find((x) => x.id === Number(el.dataset.id));
      state = r.state;
      if (done) {
        addLog(`Контракт сдан: ${systemsOf(state.galaxy)[done.to].name}, +${cr(done.reward)}`);
      }
      break;
    }
    case 'mission-abandon': {
      const before = missionsOf(state).find((x) => x.id === Number(el.dataset.id));
      const r = abandonMission(state, Number(el.dataset.id));
      if (r.error) break;
      state = r.state;
      if (before) {
        addLog(`Контракт отменён: ${systemsOf(state.galaxy)[before.to].name}, репутация −1`);
      }
      break;
    }
    case 'dev-editor': {
      // §132.1: кнопка в отладке только достаёт карандаш и убирает его обратно.
      editorOn = !editorOn;
      if (!editorOn && editing) {
        toggleEditing();
        editing = isEditing();
      }
      devNotice = null;
      render();
      break;
    }
    case 'ui-edit-toggle': {
      // §132: карандаш в шапке включает и выключает режим правки.
      toggleEditing();
      editing = isEditing();
      render();
      break;
    }
    case 'dev-open': {
      devOpen = true;
      devNotice = null;
      render();
      break;
    }
    case 'dev-close': {
      // §132.2: ушли из отладки, правку не трогаем — карандаш остался в шапке.
      devOpen = false;
      render();
      break;
    }
    case 'dev-log': {
      try {
        const now = Date.now();
        const file = buildDebugFile(state, log, settings, debugEnv(), now);
        const blob = new Blob([encodeDebugFile(file)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = debugFileName(state, now);
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        devNotice = { ok: true, text: `Лог сохранён: ${a.download}` };
      } catch {
        devNotice = { ok: false, text: 'Не удалось выгрузить лог: браузер не дал скачать.' };
      }
      render();
      break;
    }
    case 'notify-permission':
      void Notification.requestPermission().then(() => render());
      return;
    case 'reset':
      if (confirm('Начать игру заново? Текущий прогресс будет потерян.')) {
        state = newGame(Date.now());
        log = [];
        selected = null;
        addLog('Новая игра. Вы стартуете на станции Lave.');
      }
      break;
    default:
      return;
  }
  save();
  render();
}

/* ---------- Запуск ---------- */

function tick(): void {
  /*
   * §132.1: ПОКА ОТКРЫТ РЕДАКТОР, ЭКРАН СТОИТ.
   *
   * Пользователь: «Интерфейс игры в этот момент должен встать на паузу».
   * Иначе править нечего: раз в секунду тик пересчитывает мир, перерисовывает
   * экран и подменяет тексты — выделенная строка уезжает, ползунок дёргается.
   *
   * Пауза именно интерфейсная. Время мира идёт по часам (`advance` считает по
   * `Date.now()`), поэтому после выхода из редактора всё досчитается сразу —
   * как после свёрнутой вкладки. Иначе пришлось бы сдвигать все сроки в
   * состоянии, а это уже вмешательство в игру, а не в инструмент.
   */
  if (editing) return;
  const prev = state;
  // §89: время карьеры считается ДО досчёта мира и независимо от него:
  // это счётчик присутствия, а не правило полёта (см. `tickCareer`).
  // `now` берём один раз: два вызова `Date.now()` могли бы разойтись на
  // миллисекунду, и карьера посчиталась бы по разным часам, чем полёт.
  const now = Date.now();
  state = tickCareer(state, now);
  const result = advance(state, now, settings);
  const changed = result.state !== prev;
  const structural = changed && structuralChange(prev, result.state);
  if (result.events.length > 0 || changed) {
    state = result.state;
    handleEvents(result.events);
    // Движение полёта сохраняем не чаще раза в 10 с: терять секунду прогресса
    // не страшно (`advance` всё равно досчитает по `dueAt`), а писать в
    // localStorage каждую секунду незачем.
    if (result.events.length > 0 || structural || Date.now() - lastSaveAt > 10_000) {
      save();
      lastSaveAt = Date.now();
    }
  }
  // Полная перерисовка нужна только при событиях (рынок, бой, прибытие)
  // или когда меняется структура экрана. Обычный тик лишь двигает полёт —
  // тогда обновляем прогресс-бар на месте, иначе `innerHTML` каждую секунду
  // убивал бы его вместе с обработчиками.
  if (result.events.length > 0 || structural) {
    render();
  } else {
    updateFlight();
  }
}

/**
 * Требует ли смена состояния перестроить разметку: полёт начался или
 * закончился, бой, встреча, другой экран. Текущее время полёта — не повод.
 */
function structuralChange(prev: GameState, next: GameState): boolean {
  return (
    (next.flight === null) !== (prev.flight === null) ||
    (next.combat === null) !== (prev.combat === null) ||
    // Появление и исчезновение обломков меняет весь экран: без этой
    // строки подбор не показался бы до следующего тика, а после
    // последнего контейнера экран остался бы пустым.
    (next.salvage === null) !== (prev.salvage === null) ||
    (next.encounter === null) !== (prev.encounter === null) ||
    // §105: пилот вернулся с рейса — деньги в шапке изменились, значит
    // экран надо перестроить (иначе сумма обновится только к следующему
    // событию). Рейсы редкие, так что это не «перерисовка каждую секунду».
    next.pilots !== prev.pilots ||
    next.system !== prev.system ||
    next.flight?.to !== prev.flight?.to
  );
}

load();
{
  // досчёт времени, прошедшего с закрытия приложения
  const r = advance(state, Date.now(), settings);
  state = r.state;
  handleEvents(r.events);
  save();
}

document.addEventListener('click', (ev) => {
  /*
   * closest берёт БЛИЖАЙШИЙ элемент с data-action — а если внутри
   * кликабельной карточки лежит кнопка, ближайшей будет она. Это и
   * нужно: «Отстыковаться» внутри блока «Пункт назначения» не должна
   * уводить на карту. Порядок обеспечивает сам closest, а не проверки
   * в коде.
   */
  const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (el && el.tagName !== 'SELECT') onAction(el);
});

/*
 * Загрузка прогресса из файла.
 *
 * Отдельный обработчик `change` на input: файл приходит асинхронно, а
 * `FileReader` — единственный способ прочитать его без сервера. Сначала
 * читаем и проверяем, потом спрашиваем подтверждение, и только потом
 * затираем текущую игру. Порядок именно такой: если файл битый, игрок
 * узнает об этом до того, как согласится что-то потерять.
 */
document.addEventListener('change', async (ev) => {
  const el = ev.target as HTMLInputElement;
  if (el.id !== 'load-file-input') return;
  const file = el.files?.[0];
  // Сбрасываем значение: иначе выбор того же файла второй раз не вызовет
  // change, и кнопка «загрузить» будет выглядеть сломанной.
  el.value = '';
  if (!file) return;
  const text = await file.text();
  const result = importSaveFile(text, Date.now());
  if (!result.ok) {
    saveNotice = { ok: false, text: `${file.name}: ${result.message}` };
    render();
    return;
  }
  const s = result.summary;
  const answer = confirm(
    `Загрузить сохранение?\n\n` +
      `Система: ${s.systemName}, галактика ${s.galaxy}\n` +
      `Деньги: ${(s.cash / 10).toFixed(1)} CR, ранг: ${s.rank}\n` +
      `Сохранено: ${formatSavedAt(result.savedAt)}\n\n` +
      `Текущий прогресс будет заменён.`,
  );
  if (!answer) {
    saveNotice = { ok: true, text: 'Загрузка отменена — прогресс не тронут.' };
    render();
    return;
  }
  state = result.state;
  log = result.log;
  settings = result.settings;
  selected = null;
  // Бой и обломки из файла оставляем как есть — они часть прогресса, и
  // `structuralChange` сам покажет нужный экран. А вот вкладку сбрасываем
  // на «Корабль»: в файле её нет, и оставаться на «Карте» с чужими
  // координатами было бы странно.
  tab = 'ship';
  addLog(`Сохранение загружено из файла (${file.name})`);
  saveNotice = { ok: true, text: `Загружено из ${file.name}: ${s.systemName}, ${(s.cash / 10).toFixed(1)} CR` };
  save();
  render();
});

document.addEventListener('change', (ev) => {
  const el = ev.target as HTMLSelectElement;
  if (el.dataset.action !== 'setting') return;
  const key = el.dataset.key as keyof Settings;
  if (key === 'dockingModule' || key === 'autoScoop' || key === 'devRoutes' || key === 'devPilots') {
    // Булевы флаги: в разметке 'on'/'off', в состоянии true/false.
    settings = { ...settings, [key]: el.value === 'on' };
    save();
    render();
    return;
  }
  const numeric = ['speed', 'encounterTimeoutMs', 'encounterRate', 'pilotRestMs'].includes(key);
  const before = settings;
  settings = { ...settings, [key]: numeric ? Number(el.value) : el.value };
  /*
   * §119: СМЕНА ОТДЫХА ПЕРЕСЧИТЫВАЕТ УЖЕ НАЗНАЧЕННЫЕ РЕЙСЫ.
   *
   * `nextRunAt` — абсолютное время, и без пересчёта новый отдых применился
   * бы только после текущего рейса: поставил «1 минуту», а пилот ещё два
   * часа летает по-старому. Сохраняем не время, а ДОЛЮ оставшегося цикла —
   * тогда «вернётся через 40 минут» остаётся правдой и при смене отдыха.
   */
  if (key === 'pilotRestMs') {
    const now = Date.now();
    const pilots = state.pilots.map((p) => {
      if (!p.route) return p;
      const oldCycle = pilotCycleMs(state, p, before);
      const newCycle = pilotCycleMs(state, p, settings);
      if (oldCycle <= 0 || newCycle <= 0) return p;
      const left = Math.max(0, p.nextRunAt - now);
      return { ...p, nextRunAt: now + Math.round((left * newCycle) / oldCycle) };
    });
    state = { ...state, pilots };
    addLog(`Отдых пилота: ${fmtDur(before.pilotRestMs)} → ${fmtDur(settings.pilotRestMs)}; рейсы пересчитаны`);
  }
  save();
  // Смена темпа должна действовать сразу, не дожидаясь следующего тика:
  // пересчитываем полёт и перерисовываем экран в тот же момент.
  const r = advance(state, Date.now(), settings);
  if (r.events.length > 0) handleEvents(r.events);
  state = r.state;
  save();
  render();
});

/*
 * Касание карт — через pointerdown, а не click.
 *
 * Почему: на телефоне `click` приходит после `touchend`, и если палец
 * сдвинулся хоть немного (а он всегда сдвигается), браузер считает это
 * прокруткой и click не приходит вовсе. Отсюда «не могу нажать на
 * мини-карту»: жест выглядел как скролл, а не как тап.
 *
 * pointerdown срабатывает сразу при касании, до любых жестов прокрутки.
 */
document.getElementById('content')!.addEventListener('pointerdown', (ev) => {
  // ВАЖНО: берём ev.target, а не currentTarget.
  //
  // Обработчик висит на #content (делегирование), поэтому currentTarget
  // всегда #content, а не холст. В onMapTap я читал currentTarget и
  // получал контейнер: у него нет ни data-local, ни размеров холста,
  // поэтому масштаб считался от нулевого rect, и клик «попадал» не туда.
  // Отсюда и «не могу нажать на мини-карту».
  const target = ev.target as HTMLElement;
  if (target.id === 'map-overview' || target.id === 'map-local') {
    /*
     * preventDefault тут ОБЯЗАТЕЛЕН, и вот почему.
     *
     * render() целиком пересобирает innerHTML, то есть холст, по
     * которому пришло касание, к моменту следующего события уже
     * уничтожен. Браузеру больше не к чему привязать жест — и он
     * трактует остаток касания как прокрутку контейнера, уводя экран.
     * Пользователь описал это как «экран сам скроллится при выборе
     * планеты».
     *
     * Отменяем жест сразу: карта — элемент выбора, а не ленты прокрутки.
     * Прокрутка самой страницы работает как прежде: за пределами карты
     * касания идут обычным путём.
     */
    ev.preventDefault();
    onMapTap(ev as PointerEvent, target as HTMLCanvasElement);
  }
});

/*
 * §131.11: прокрутка меняет только верхние углы карточки — пересобирать экран
 * ради этого нельзя, поэтому отдельный слушатель.
 */
document.getElementById('content')!.addEventListener('scroll', syncStickyCards, { passive: true });

/*
 * §132: редактор интерфейса. Модулю нужны только две вещи из игры: как
 * перерисовать экран и под каким именем хранить правки.
 */
initUiEditor({ render: () => render(), screen: () => editorScreen() });

window.addEventListener('resize', () => {
  if (tab === 'map' && !state.combat) drawMap();
});

setInterval(tick, 1000);
// §118: раз в несколько секунд вкладки выясняют, кто хозяин сейва.
setInterval(tabsTick, 1000);
/*
 * §118: перезагрузка — не «вторая вкладка».
 *
 * Метка живёт 20 секунд, и без этого обработчика F5 в течение этих
 * секунд выглядел бы как чужой игрок: страница предупреждала бы сама себя
 * и не сохраняла прогресс. Уходя, вкладка снимает свою метку; возвращаясь
 * из кеша браузера — ставит снова.
 */
window.addEventListener('pagehide', () => {
  if (readTab()?.id === tabId) localStorage.removeItem(TAB_KEY);
});
window.addEventListener('pageshow', () => {
  if (checkTabs()) render();
  if (!otherTab) tabBeat();
});

window.addEventListener('storage', (ev) => {
  // Соседняя вкладка записала метку или сейв — перепроверяем сразу, не
  // дожидаясь тика. `render` вызывает только изменение состояния.
  if (ev.key === TAB_KEY || ev.key === SAVE_KEY) {
    if (checkTabs() && !tabTaken) render();
  }
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) tick();
});

// §118: при старте выясняем, не играет ли уже кто-то в соседней вкладке.
checkTabs();
if (!otherTab) tabBeat();
render();
