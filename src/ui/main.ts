import './styles.css';
import { IframeDockingModule } from './docking-module.ts';
import {
  applyDecision,
  applyPodLoss,
  availableDecisions,
  autoResolve,
  bestLaserOf,
  enemyOf,
  type Decision,
} from '../core/one-decision.ts';
import { canDo, MAX_ENERGY, MAX_SHIELDS, type CombatAction } from '../core/combat.ts';
import { distance, ECONOMIES, GALACTIC_ARRIVAL, GOVERNMENTS, nearestSystem } from '../core/galaxy.ts';
import { COMMODITIES } from '../core/market.ts';
import { drawShipModel } from './ship-model.ts';
import { EQUIPMENT, enemyById, equipmentAvailable, LASER_NAMES, legalLabel, rankOf, type EquipmentId } from '../core/ships.ts';
import {
  advance,
  buy,
  buyEquipment,
  cargoTons,
  combatAction,
  combatAutoplay,
  currentSystem,
  galacticJump,
  DEFAULT_SETTINGS,
  deserialize,
  jumpDuration,
  MAX_FUEL,
  newGame,
  owns,
  refuel,
  ROLE_NAMES,
  sell,
  serialize,
  startJump,
  systemsOf,
  type EquipmentError,
  type GameEvent,
  type GameState,
  type JumpError,
  type Settings,
} from '../core/state.ts';

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

/** Момент последней записи в localStorage — чтобы не писать каждый тик. */
let lastSaveAt = 0;

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

function save(): void {
  if (!storageAvailable) return;
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
      log = data.log ?? [];
      settings = { ...DEFAULT_SETTINGS, ...data.settings };
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
    if (e.type === 'detected' || e.type === 'combat-start' || e.type === 'death' || e.type === 'arrived') {
      notify(e.text);
    }
  }
}

/* ---------- Форматирование ---------- */

const UNITS = ['т', 'кг', 'г'];
const cr = (n: number): string => `${(n / 10).toFixed(1)} CR`;
const ly = (n: number): string => `${(n / 10).toFixed(1)} св. г.`;

function fmtDur(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

const fmtTime = (at: number): string =>
  new Date(at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const JUMP_ERRORS: Record<JumpError, string> = {
  'in-flight': 'Корабль уже в полёте',
  'same-system': 'Вы уже в этой системе',
  'too-far': 'Не хватает топлива',
  'bad-target': 'Неверная цель',
};

const EQUIPMENT_ERRORS: Record<EquipmentError, string> = {
  'in-flight': 'Покупки возможны только на станции',
  tech: 'Технологический уровень системы слишком низкий',
  cash: 'Не хватает денег',
  owned: 'Уже установлено',
  full: 'Боекомплект полон',
};

/* ---------- Экраны ---------- */

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'ship', label: 'Корабль', icon: '🚀' },
  { id: 'map', label: 'Карта', icon: '🗺' },
  { id: 'market', label: 'Рынок', icon: '⚖' },
  { id: 'hangar', label: 'Ангар', icon: '🔧' },
  { id: 'log', label: 'Журнал', icon: '📜' },
];

function stat(label: string, value: string): string {
  return `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div></div>`;
}

function systemInfo(index: number): string {
  const s = systemsOf(state.galaxy)[index];
  return `${ECONOMIES[s.economy]}, ${GOVERNMENTS[s.government]}, тех. уровень ${s.techLevel + 1}`;
}

function flightCard(): string {
  const f = state.flight;
  if (!f) {
    return `<div class="card"><h2>На станции ${currentSystem(state).name}</h2>
      <div class="sub">${systemInfo(state.system)}</div></div>`;
  }
  const systems = systemsOf(state.galaxy);
  const enc = state.encounter ? encounterCard() : '';
  return `<div class="card"><h2>В пути: ${systems[f.from].name} → ${systems[f.to].name}</h2>
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
  const can = availableDecisions(enemy, best, state.ship.escapePod, hostile);

  const btn = (decision: Decision, label: string, enabled: boolean, reason?: string): string =>
    `<button class="btn" data-action="decide" data-decision="${decision}" ${enabled ? '' : 'disabled'}
      title="${reason ?? ''}">${label}</button>`;

  const share = hostile && can.attack ? '' : '';
  return `<div class="card warn"><h2>В радиусе: ${ROLE_NAMES[e.role]} (${enemy.name})</h2>
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
  const parts = [`Лазер: ${LASER_NAMES[s.laser]}`, `Ракеты: ${s.missiles}`];
  if (s.ecm) parts.push('ECM');
  if (s.energyBomb) parts.push('Энергобомба');
  if (s.escapePod) parts.push('Капсула');
  if (s.energyUnit) parts.push('Энергоблок');
  if (s.fuelScoops) parts.push('Топливосборщик');
  if (s.dockingComputer) parts.push('Стыковочный компьютер');
  if (s.galacticHyperdrive) parts.push('Галактический гипердвигатель');
  if (s.cargoBayExtended) parts.push('Увеличенный трюм');
  return parts.join(' · ');
}

function shipScreen(): string {
  const tons = cargoTons(state);
  const items = COMMODITIES.map((c, i) => (state.cargo[i] > 0 ? `${c.name}: ${state.cargo[i]} ${UNITS[c.unit]}` : ''))
    .filter(Boolean)
    .join('<br>');
  return `${flightCard()}
    <div class="card ship-view">
      <canvas id="ship-model" aria-label="Модель корабля Cobra Mk III"></canvas>
      <div class="sub" style="text-align:center">Cobra Mk III</div>
    </div>
    <div class="grid">
      ${stat('Деньги', cr(state.cash))}
      ${stat('Топливо', ly(state.fuel))}
      ${stat('Трюм (т)', `${tons} / ${tons + state.holdSpace}`)}
      ${stat('Галактика', String(state.galaxy))}
      ${stat('Ранг', rankOf(state.kills))}
      ${stat('Статус', legalLabel(state.legal))}
    </div>
    <div class="card"><h2>Оборудование</h2><div class="muted">${equipmentSummary()}</div></div>
    <div class="card"><h2>Груз</h2><div class="muted">${items || 'Трюм пуст'}</div></div>`;
}

function bar(value: number, max: number, cls = ''): string {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return `<div class="progress ${cls}"><div style="width:${pct.toFixed(0)}%"></div></div>`;
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
        ${btn('pod', 'Капсула')}
      </div>
      <div class="row" style="margin-top:12px">
        <button class="btn" data-action="combat-auto">Автобой до конца</button>
      </div>
    </div>
    <div class="card"><h2>Ход боя</h2><ul class="log">${lines}</ul></div>`;
}

/**
 * Кнопка на карте под выбранной системой.
 *
 * С включённым модулем стыковки прыжок из карты недоступен: космос у нас
 * есть только в мини-игре, там и находится действие «покинуть систему».
 * Вместо него карта предлагает «Отстыковку» — вход в мини-игру.
 */
function jumpControl(distanceLy: number, reason: string): string {
  if (settings.dockingModule) {
    // Прыжок недоступен из карты: цель только запоминается.
    return `<button class="btn" data-action="undock">Отстыковка</button>`;
  }
  return `<button class="btn" data-action="jump" data-to="${selected}" ${reason ? 'disabled' : ''}>Прыжок</button>`;
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
    info = `<h2>${s.name}</h2><div class="sub">${systemInfo(selected)}</div>
      <div class="row" style="margin-top:12px">
        <span class="price">${ly(d)}</span><span class="spacer"></span>
        ${jumpControl(d, reason)}
      </div>${reason ? `<div class="muted" style="margin-top:6px">${reason}</div>` : ''}`;
  }
  return `<canvas id="map"></canvas><div class="card">${info}</div>`;
}

function priceChip(i: number): string {
  const base = COMMODITIES[i].basePrice * 4;
  const ratio = state.market[i].price / base;
  if (ratio <= 0.92) return '<span class="chip cheap">дёшево</span>';
  if (ratio >= 1.08) return '<span class="chip dear">дорого</span>';
  return '';
}

function marketScreen(): string {
  const docked = !state.flight;
  const rows = COMMODITIES.map((c, i) => {
    const m = state.market[i];
    if (c.name === 'Предметы пришельцев' && m.quantity === 0 && state.cargo[i] === 0) return '';
    return `<div class="card"><div class="good-row">
        <div><div class="name">${c.name} ${priceChip(i)}</div>
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
  return `<div class="card"><h2>Рынок: ${currentSystem(state).name}</h2>
    <div class="sub">Деньги: ${cr(state.cash)} · Свободно в трюме: ${state.holdSpace} т</div>
    ${state.flight ? '<div class="sub">Торговля недоступна в полёте</div>' : ''}</div>${rows}`;
}

/** Номер предмета на верфи (1 — топливо), как в EQSHP; используется в подсказке. */
const equipmentNote = (item: (typeof EQUIPMENT)[number]): string => `${cr(item.price)} · №${item.screenNumber} на верфи`;

function equipmentRows(): string {
  const docked = !state.flight;
  const tek = currentSystem(state).techLevel;
  return EQUIPMENT.map((item) => {
    const have = owns(state.ship, item.id);
    const available = equipmentAvailable(item, tek);
    let note = equipmentNote(item);
    if (item.id === 'missile') note += ` · сейчас ${state.ship.missiles}`;
    let action: string;
    if (have && item.id !== 'missile') action = '<span class="chip">установлено</span>';
    else if (have) action = '<span class="chip">полный боекомплект</span>';
    else if (!available) action = '<span class="chip dear">нет на этой станции</span>';
    else
      action = `<button class="btn tonal" data-action="equip" data-id="${item.id}" ${docked && state.cash >= item.price ? '' : 'disabled'}>Купить</button>`;
    return `<div class="good-row" style="margin:10px 0"><div><div class="name">${item.name}</div>
      <div class="muted">${note}</div></div>${action}</div>`;
  }).join('');
}

function hangarScreen(): string {
  const docked = !state.flight;
  const missing = MAX_FUEL - state.fuel;
  return `<div class="card"><h2>Топливо</h2>
      <div class="sub">${ly(state.fuel)} из ${ly(MAX_FUEL)} · цена 0.2 CR за св. год</div>
      <div class="progress"><div style="width:${(state.fuel / MAX_FUEL) * 100}%"></div></div>
      <div class="row">
        <button class="btn tonal" data-action="refuel" data-n="10" ${docked && missing > 0 ? '' : 'disabled'}>+1.0</button>
        <button class="btn" data-action="refuel" data-n="${missing}" ${docked && missing > 0 ? '' : 'disabled'}>Полный бак</button>
      </div></div>
    <div class="card"><h2>Оборудование</h2>
      <div class="sub">Доступность зависит от технологического уровня станции (здесь ${currentSystem(state).techLevel + 1}). Установлен один лазер: новый заменяет прежний.</div>
      ${equipmentRows()}</div>
    ${galacticCard()}`;
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

function logScreen(): string {
  const items = log.map((e) => `<li><time>${fmtTime(e.at)}</time>${e.text}</li>`).join('');
  const speeds = [0.5, 1, 2, 5, 10, 20, 100].map((s): [string, string] => [String(s), `×${s}`]);
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
  return `<div class="card"><h2>Настройки</h2>
      <div class="row"><label>Темп игры</label><span class="spacer"></span>${select('speed', speeds, String(settings.speed))}</div>
      <div class="sub" style="margin:6px 0 12px">Один прыжок: ${fmtDur(jumpDuration(settings))}</div>
      <div class="row"><label>Бой</label><span class="spacer"></span>${select('combatMode', [['auto', 'Автоматический'], ['manual', 'С вмешательством']], settings.combatMode)}</div>
      <div class="row" style="margin-top:10px"><label>При гибели</label><span class="spacer"></span>${select('deathMode', [['insurance', 'Страховка'], ['none', 'Без смерти']], settings.deathMode)}</div>
      <div class="row" style="margin-top:10px"><label>Чужой корабль исчезает через</label><span class="spacer"></span>${select('encounterTimeoutMs', timeouts, String(settings.encounterTimeoutMs))}</div>
      <div class="row" style="margin-top:10px"><label>Частота встреч</label><span class="spacer"></span>${select('encounterRate', rates, String(settings.encounterRate))}</div>
      <div class="row" style="margin-top:10px"><label>Модуль стыковки</label><span class="spacer"></span>${select('dockingModule', [['on', 'Включён'], ['off', 'Выключен']], settings.dockingModule ? 'on' : 'off')}</div>
      <div class="sub" style="margin:6px 0 12px">${settings.dockingModule
        ? 'Прыжок — только из мини-игры стыковки. На карте «Отстыковка».'
        : 'Прыжок — прямо с карты, без мини-игры.'}</div>
      <div class="row" style="margin-top:12px">${notif}<span class="spacer"></span><button class="btn text" data-action="reset">Начать заново</button></div></div>
    <div class="card"><h2>Журнал</h2><ul class="log">${items || '<li>Пока пусто</li>'}</ul></div>`;
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
        addLog(`Стыковка: успешно (${mod.label})`);
      } else {
        addLog(
          `Стыковка: провал, повреждение ${outcome.damage} (${mod.label})`,
        );
      }
      render();
    });

  return true;
}

/* ---------- Отрисовка ---------- */

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
  content.innerHTML = inCombat ? combatScreen() : screens[tab]();
  document.getElementById('title')!.textContent = inCombat ? 'Бой' : TABS.find((t) => t.id === tab)!.label;
  document.getElementById('top-info')!.textContent = cr(state.cash);
  document.getElementById('nav')!.innerHTML = TABS.map(
    (t) =>
      `<button class="${t.id === tab && !inCombat ? 'active' : ''}" data-action="tab" data-tab="${t.id}">
        <span class="pill">${t.icon}</span>${t.label}</button>`,
  ).join('');
  if (tab === 'map' && !inCombat) drawMap();
  if (tab === 'ship' && !inCombat) startShipModel();
  updateFlight();
}

/* ---------- Модель корабля на главном экране ---------- */

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

  drawShipModel(ctx, { width: w, height: h, yaw: shipModelAngle });
  shipModelFrame = requestAnimationFrame(drawShipFrame);
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
  if (f && bar && eta) {
    // Прогресс считаем в БАЗОВЫХ единицах: тогда при смене темпа он не
    // прыгает назад/вперёд, а отражает реально пройденную часть маршрута.
    const done = f.elapsedBaseMs;
    const total = done + f.remainingBaseMs;
    const frac = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
    bar.style.width = `${(frac * 100).toFixed(1)}%`;
    eta.textContent = fmtDur(Math.max(0, f.arriveAt - now));
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

/** Запас сверх радиуса топлива: крайние системы не липнут к рамке. */
const MAP_MARGIN = 1.35;

interface MapView {
  width: number;
  height: number;
  /** Пикселей на координатную единицу по X. */
  kx: number;
  /** То же по Y — вдвое меньше, см. `distance()`. */
  ky: number;
  /** Радиус окна в координатных единицах. */
  radius: number;
  cx: number;
  cy: number;
  /** X галактики → вертикаль экрана (карта повёрнута на 90°). */
  screenX: (gx: number) => number;
  /** Y галактики → горизонталь экрана. */
  screenY: (gy: number) => number;
  /** Попадает ли система в окно. */
  visible: (s: { x: number; y: number }) => boolean;
}

function mapView(canvas: HTMLCanvasElement): MapView {
  const width = canvas.clientWidth;
  // Полотно вытянуто вниз: после поворота вдоль него идёт X (0..255).
  const height = Math.round(Math.min(width * 1.55, 620));
  const pad = 16;

  const here = systemsOf(state.galaxy)[state.system];
  const radius = Math.max(4, (state.fuel / 4) * MAP_MARGIN);

  // Дальность считается как hypot(dx, dy/2), то есть по Y «дешевле»
  // вдвое. Чтобы круг дальности остался кругом, ky = kx/2.
  // Ограничиваем по обеим осям, чтобы окно влезло целиком.
  const kx = Math.min((width - 2 * pad) / (2 * radius), (height - 2 * pad) / (2 * radius));
  const ky = kx / 2;

  const cx = width / 2;
  const cy = height / 2;

  const screenX = (gx: number): number => cx + (gx - here.x) * kx;
  const screenY = (gy: number): number => cy + (gy - here.y) * ky;

  return {
    width,
    height,
    kx,
    ky,
    radius,
    cx,
    cy,
    screenX,
    screenY,
    // Запас 15%: подписи и кольцо выбранной системы не должны обрезаться.
    visible: (s) =>
      Math.abs(s.x - here.x) <= radius * 1.15 && Math.abs(s.y - here.y) <= radius * 2 * 1.15,
  };
}

function drawMap(): void {
  const canvas = document.getElementById('map') as HTMLCanvasElement | null;
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const v = mapView(canvas);

  canvas.style.height = `${v.height}px`;
  canvas.width = Math.round(v.width * dpr);
  canvas.height = Math.round(v.height * dpr);

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, v.width, v.height);

  const systems = systemsOf(state.galaxy);
  const here = systems[state.system];

  // Круг дальности на текущем топливе. Он круглый именно потому,
  // что ky = kx/2: иначе здесь был бы эллипс, врущий о дальности.
  const fuelPx = (state.fuel / 4) * v.kx;
  ctx.beginPath();
  ctx.arc(v.cx, v.cy, fuelPx, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(79,216,196,.35)';
  ctx.setLineDash([5, 7]);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.setLineDash([]);

  for (const sys of systems) {
    if (!v.visible(sys)) continue;
    const reachable = distance(here, sys) <= state.fuel;
    const isHere = sys.index === here.index;
    ctx.beginPath();
    ctx.arc(v.screenY(sys.y), v.screenX(sys.x), isHere ? 5 : reachable ? 3.4 : 2.6, 0, Math.PI * 2);
    ctx.fillStyle = isHere ? '#4fd8c4' : reachable ? '#dde4e2' : '#5c6b68';
    ctx.fill();
  }

  // Подписи у всех видимых систем: их 3–11, места хватает. Без подписи
  // выбирать «на глаз» — это и была та самая неточность.
  ctx.font = '12px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (const sys of systems) {
    if (!v.visible(sys)) continue;
    const reachable = distance(here, sys) <= state.fuel;
    ctx.fillStyle = sys.index === here.index ? '#4fd8c4' : reachable ? '#dde4e2' : '#7b8b88';
    ctx.fillText(sys.name, v.screenY(sys.y), v.screenX(sys.x) + 18);
  }

  if (selected !== null && v.visible(systems[selected])) {
    const sel = systems[selected];
    ctx.beginPath();
    ctx.arc(v.screenY(sel.y), v.screenX(sel.x), 11, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffd37a';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineWidth = 1;
  }
}

function onMapTap(ev: MouseEvent): void {
  const canvas = ev.currentTarget as HTMLCanvasElement;
  const rect = canvas.getBoundingClientRect();
  const v = mapView(canvas);
  const px = ev.clientX - rect.left;
  const py = ev.clientY - rect.top;

  // Систем в окне немного (3–11), поэтому можно позволить щедрый
  // радиус попадания. Раньше он был 28 px на 256 систем — отсюда
  // промахи: соседняя точка оказывалась ближе пальца.
  // Сравниваем по экранным координатам, поворот уже учтён в них.
  let best = -1;
  let bestD = 44 * 44;
  systemsOf(state.galaxy).forEach((sys, i) => {
    if (!v.visible(sys)) return;
    const d = (v.screenY(sys.y) - px) ** 2 + (v.screenX(sys.x) - py) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  if (best >= 0) {
    selected = best;
    render();
  }
}

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
    case 'tab':
      tab = el.dataset.tab as Tab;
      break;
    case 'buy1':
    case 'buyMax': {
      const cashBefore = state.cash;
      const r = buy(state, i, a === 'buy1' ? 1 : 9999);
      state = r.state;
      tradeLog('Куплено', i, r.amount, cashBefore - state.cash);
      break;
    }
    case 'sell1':
    case 'sellAll': {
      const cashBefore = state.cash;
      const r = sell(state, i, a === 'sell1' ? 1 : 9999);
      state = r.state;
      tradeLog('Продано', i, r.amount, state.cash - cashBefore);
      break;
    }
    case 'refuel': {
      const r = refuel(state, Number(el.dataset.n));
      state = r.state;
      if (r.amount > 0) addLog(`Заправка: +${ly(r.amount)}`);
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
      const can = availableDecisions(enemy, bestLaserOf(lasers), state.ship.escapePod, hostile);
      const r = applyDecision(enemy, decision, can, hostile);
      if (!r) {
        addLog('Это решение сейчас недоступно');
        break;
      }
      let next: GameState = { ...state, cash: state.cash + r.bounty, encounter: null, combat: null };
      if (r.podUsed) {
        // §37 / UpdateEscapePod: капсула тратится, груз теряется
        // (кроме предметов пришельцев), правовой статус обнуляется.
        const pod = applyPodLoss({ cargo: state.cargo, holdSpace: state.holdSpace });
        next = {
          ...next,
          cargo: [...pod.cargo],
          holdSpace: pod.holdSpace,
          legal: 0,
          ship: { ...state.ship, escapePod: false },
        };
      }
      if (r.legalCleared) next = { ...next, legal: 0 };
      state = next;
      addLog(r.text + (r.bounty > 0 ? ` (+${cr(r.bounty)})` : ''));
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
          addLog(
            `Контрабанда в трюме: правовой статус ${legalBefore} → ${state.legal} (${legalLabel(state.legal)})`,
          );
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
  const prev = state;
  const result = advance(state, Date.now(), settings);
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
    (next.encounter === null) !== (prev.encounter === null) ||
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
  const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (el && el.tagName !== 'SELECT') onAction(el);
});

document.addEventListener('change', (ev) => {
  const el = ev.target as HTMLSelectElement;
  if (el.dataset.action !== 'setting') return;
  const key = el.dataset.key as keyof Settings;
  if (key === 'dockingModule') {
    // Булев флаг: в разметке 'on'/'off', в состоянии true/false.
    settings = { ...settings, dockingModule: el.value === 'on' };
    save();
    render();
    return;
  }
  const numeric = ['speed', 'encounterTimeoutMs', 'encounterRate'].includes(key);
  settings = { ...settings, [key]: numeric ? Number(el.value) : el.value };
  save();
  // Смена темпа должна действовать сразу, не дожидаясь следующего тика:
  // пересчитываем полёт и перерисовываем экран в тот же момент.
  const r = advance(state, Date.now(), settings);
  if (r.events.length > 0) handleEvents(r.events);
  state = r.state;
  save();
  render();
});

document.getElementById('content')!.addEventListener('click', (ev) => {
  if ((ev.target as HTMLElement).id === 'map') onMapTap(ev as MouseEvent);
});

window.addEventListener('resize', () => {
  if (tab === 'map' && !state.combat) drawMap();
});

setInterval(tick, 1000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) tick();
});

render();
