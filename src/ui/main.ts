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
import { COMMODITIES, isTonneCargo } from '../core/market.ts';
import { drawShipModel, FLEET, type ShipBlueprint } from './ship-model.ts';
import { layoutLabels, placeSingle, type Box, type LabelItem } from './label-layout.ts';
import { EQUIPMENT, enemyById, equipmentAvailable, LASER_NAMES, legalLabel, rankOf, type EquipmentId } from '../core/ships.ts';
import {
  advance,
  buy,
  buyEquipment,
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
  // Модель встречного корабля: видно, с кем имеешь дело, а не только
  // название. Корабль, которого нет в парке (канистра, астероид),
  // просто не показывается — лучше пусто, чем силуэт не того класса.
  const model = FLEET[enemy.id]
    ? `<canvas class="enc-model" data-ship="${enemy.id}" aria-label="Модель корабля ${enemy.name}"></canvas>`
    : '';
  return `<div class="card warn"><h2>В радиусе: ${ROLE_NAMES[e.role]} (${enemy.name})</h2>
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
  return `${flightCard()}${destinationCard()}
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
 * Кнопка «Отстыковаться» — вход в космос.
 *
 * Пользователь просил её здесь, на экране «Корабль»: это тот экран, где
 * игрок решает, лететь или нет, и уходить за этим на карту неудобно.
 * Кнопка ведёт себя так же, как на карте: открывает мини-игру стыковки,
 * а прыжок и галактический переход живут уже внутри неё.
 *
 * Показывается, только когда модуль стыковки включён: с выключенным
 * модулем космоса нет вовсе, и кнопка вела бы в пустоту.
 */
function undockButton(): string {
  if (!settings.dockingModule) return '';
  if (state.flight) return '';
  return `<button class="btn" data-action="undock">Отстыковаться</button>`;
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
  const undock = undockButton();
  // Блок целиком ведёт на карту: data-action на карточке, а кнопка
  // внутри гасит всплытие своим обработчиком.
  const open = '<div class="card linkable" data-action="go-map" role="link" tabindex="0">';

  if (state.flight) {
    const f = state.flight;
    const left = Math.max(0, f.arriveAt - Date.now());
    return `${open}<h2>Пункт назначения</h2>
      <div class="row"><span class="price">${systems[f.to].name}</span><span class="spacer"></span>
        <span class="muted">в пути</span></div>
      <div class="sub" style="margin-top:6px">Из ${systems[f.from].name} · осталось ${fmtDur(left)}</div>
    </div>`;
  }

  if (selected === null) {
    return `${open}<h2>Пункт назначения</h2>
      <div class="muted">Не выбран. Нажмите сюда, чтобы открыть карту и выбрать систему.</div>
      ${undock ? `<div class="row" style="margin-top:12px">${undock}</div>` : ''}
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
    ${undock ? `<div class="row" style="margin-top:12px">${undock}<span class="spacer"></span><span class="muted">нажмите, чтобы сменить цель</span></div>` : ''}
  </div>`;
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
      return `<div class="row"><span>${name}${full ? ' <span class="muted">— нет места</span>' : ''}</span>
        <span class="spacer"></span>
        <button class="btn tonal" data-action="salvage-take" data-i="${i}" ${full ? 'disabled' : ''}>Взять</button></div>`;
    })
    .join('');
  const total = sv.canisters.length;
  return `<div class="card"><h2>Обломки: ${sv.enemyName}</h2>
      <div class="sub">В обломках ${total} ${plural(total, 'контейнер', 'контейнера', 'контейнеров')}. Свободно в трюме: ${state.holdSpace} т</div>
      ${list}
      <div class="row" style="margin-top:14px">
        <button class="btn" data-action="salvage-all">Взять всё, что влезает</button>
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
      </div>
      <div class="sub" style="margin-top:6px">В пути: ${fmtDur(jumpDuration(settings, d))}${settings.speed > 1 ? ` (при ×${settings.speed})` : ''}</div>
      ${reason ? `<div class="muted" style="margin-top:6px">${reason}</div>` : ''}`;
  }
  // Две карты одна под другой: общая (вся галактика, горизонтальная)
  // и местная (окно вокруг корабля, крупно).
  return `<div class="card map-card">
      <h2>Галактика ${state.galaxy}</h2>
      <canvas id="map-overview"></canvas>
      <div class="sub">Рамка — область местной карты ниже.</div>
    </div>
    <div class="card map-card">
      <h2>Окрестности</h2>
      <canvas id="map-local" data-local="1"></canvas>
      <div class="sub" id="local-hint">Радиус — по текущему топливу. Нажмите на точку, чтобы выбрать цель.</div>
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
    if (ctx) drawSystems(ctx, v, { labels: true });
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

function marketScreen(): string {
  const docked = !state.flight;
  const rows = COMMODITIES.map((c, i) => {
    const m = state.market[i];
    if (c.name === 'Предметы пришельцев' && m.quantity === 0 && state.cargo[i] === 0) return '';
    // Контрабанда помечается красным и словом: в оригинале это рабы,
    // наркотики и оружие (SLAVES_INDEX, NARCOTICS_INDEX, FIREARMS_INDEX).
    // Подсветка нужна не для красоты: за такой груз растёт правовой
    // статус, и игрок должен видеть это до покупки, а не после.
    const illegal = [SLAVES_INDEX, NARCOTICS_INDEX, FIREARMS_INDEX].includes(i);
    return `<div class="card${illegal ? ' illegal' : ''}"><div class="good-row">
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
  // Модель корабля живёт в ангаре: это место про сам корабль, а экран
  // «Корабль» — про полёт и груз. В пути модель не рисуем: в ангаре
  // корабля нет, он улетел.
  const model = docked
    ? `<div class="card ship-view">
      <canvas id="ship-model" aria-label="Модель корабля Cobra Mk III"></canvas>
      <div class="sub" style="text-align:center">Cobra Mk III · ваш корабль в ангаре</div>
    </div>`
    : '';
  return `${model}<div class="card"><h2>Топливо</h2>
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

function logScreen(): string {
  const items = log.map((e) => `<li><time>${fmtTime(e.at)}</time>${e.text}</li>`).join('');
  const speeds = [0.5, 1, 2, 5, 10, 20, 100, 200].map((s): [string, string] => [String(s), `×${s}`]);
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
      <div class="sub" style="margin:6px 0 12px">Прыжок 7 св. лет: ${fmtDur(jumpDuration(settings, 7))} · 3 св. года: ${fmtDur(jumpDuration(settings, 3))}</div>
      <div class="row"><label>Бой</label><span class="spacer"></span>${select('combatMode', [['auto', 'Автоматический'], ['manual', 'С вмешательством']], settings.combatMode)}</div>
      <div class="row" style="margin-top:10px"><label>При гибели</label><span class="spacer"></span>${select('deathMode', [['insurance', 'Страховка'], ['none', 'Без смерти']], settings.deathMode)}</div>
      <div class="row" style="margin-top:10px"><label>Чужой корабль исчезает через</label><span class="spacer"></span>${select('encounterTimeoutMs', timeouts, String(settings.encounterTimeoutMs))}</div>
      <div class="row" style="margin-top:10px"><label>Частота встреч</label><span class="spacer"></span>${select('encounterRate', rates, String(settings.encounterRate))}</div>
      <div class="row" style="margin-top:10px"><label>Груз из обломков</label><span class="spacer"></span>${select('autoScoop', [['off', 'Выбирать вручную'], ['on', 'Подбирать автоматически']], settings.autoScoop ? 'on' : 'off')}</div>
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
  content.innerHTML = inCombat ? combatScreen() : inSalvage ? salvageScreen() : screens[tab]();
  document.getElementById('title')!.textContent = inCombat
    ? 'Бой'
    : inSalvage
      ? 'Обломки'
      : TABS.find((t) => t.id === tab)!.label;
  document.getElementById('top-info')!.textContent = cr(state.cash);
  document.getElementById('nav')!.innerHTML = TABS.map(
    (t) =>
      `<button class="${t.id === tab && !inCombat && !inSalvage ? 'active' : ''}" data-action="tab" data-tab="${t.id}">
        <span class="pill">${t.icon}</span>${t.label}</button>`,
  ).join('');
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
}

/* ---------- Модель корабля в ангаре ---------- */

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

/**
 * Модель встреченного корабля.
 *
 * Рисуется один раз (не анимация): экран встречи — это решение за
 * несколько секунд, вращение тут отвлекало бы. Угол в три четверти,
 * чтобы силуэт читался: нос, борт и то, насколько корабль большой.
 */
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
      // Пока идут обломки, уйти с экрана нельзя: подбор держит полёт на
      // паузе, и «уехать» на другую вкладку значило бы бросить его молча.
      if (!state.salvage) tab = el.dataset.tab as Tab;
      break;
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
      const can = availableDecisions(enemy, bestLaserOf(lasers), state.ship.escapePod, hostile);
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
          fled: state.stats.fled + (r.podUsed ? 1 : 0),
        },
        encounter: null,
        combat: null,
      };
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
    case 'jettison': {
      const i = Number(el.dataset.i);
      const r = jettisonCargo(state, i, 1);
      state = r.state;
      if (r.dropped > 0) addLog(`Выброшено: ${COMMODITIES[i].name}, ${r.dropped} ${UNITS[COMMODITIES[i].unit]}`);
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
    // Появление и исчезновение обломков меняет весь экран: без этой
    // строки подбор не показался бы до следующего тика, а после
    // последнего контейнера экран остался бы пустым.
    (next.salvage === null) !== (prev.salvage === null) ||
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

document.addEventListener('change', (ev) => {
  const el = ev.target as HTMLSelectElement;
  if (el.dataset.action !== 'setting') return;
  const key = el.dataset.key as keyof Settings;
  if (key === 'dockingModule' || key === 'autoScoop') {
    // Булевы флаги: в разметке 'on'/'off', в состоянии true/false.
    settings = { ...settings, [key]: el.value === 'on' };
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

window.addEventListener('resize', () => {
  if (tab === 'map' && !state.combat) drawMap();
});

setInterval(tick, 1000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) tick();
});

render();
