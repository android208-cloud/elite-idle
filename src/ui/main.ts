import './styles.css';
import { canDo, MAX_ENERGY, MAX_SHIELDS, type CombatAction } from '../core/combat.ts';
import { distance, ECONOMIES, GOVERNMENTS } from '../core/galaxy.ts';
import { COMMODITIES } from '../core/market.ts';
import { EQUIPMENT, enemyById, LASER_NAMES, legalLabel, rankOf, type EquipmentId } from '../core/ships.ts';
import {
  advance,
  buy,
  buyEquipment,
  cargoTons,
  combatAction,
  combatAutoplay,
  currentSystem,
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

function save(): void {
  localStorage.setItem(SAVE_KEY, JSON.stringify({ state: serialize(state), log, settings }));
}

function load(): void {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
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
  const enc = state.encounter
    ? `<div class="card warn"><h2>В радиусе действия: ${ROLE_NAMES[state.encounter.role]} (${enemyById(state.encounter.enemyId).name})</h2>
        <div class="sub">Развязка через <span id="enc-eta"></span></div></div>`
    : '';
  return `<div class="card"><h2>В пути: ${systems[f.from].name} → ${systems[f.to].name}</h2>
    <div class="progress"><div id="flight-bar" style="width:0%"></div></div>
    <div class="sub">Прибытие через <span id="flight-eta"></span></div></div>${enc}`;
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

function mapScreen(): string {
  const systems = systemsOf(state.galaxy);
  let info = '<div class="muted">Нажмите на систему, чтобы выбрать цель прыжка.</div>';
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
        <button class="btn" data-action="jump" data-to="${selected}" ${reason ? 'disabled' : ''}>Прыжок</button>
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

function equipmentRows(): string {
  const docked = !state.flight;
  const tech = currentSystem(state).techLevel + 1;
  return EQUIPMENT.map((item) => {
    const have = owns(state.ship, item.id);
    let note = `${cr(item.price)} · тех. уровень ${item.minTech}`;
    if (item.id === 'missile') note += ` · сейчас ${state.ship.missiles}`;
    let action: string;
    if (have && item.id !== 'missile') action = '<span class="chip">установлено</span>';
    else if (have) action = '<span class="chip">полный боекомплект</span>';
    else if (tech < item.minTech) action = '<span class="chip dear">нет на этой станции</span>';
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
      ${equipmentRows()}</div>`;
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
      <div class="row" style="margin-top:12px">${notif}<span class="spacer"></span><button class="btn text" data-action="reset">Начать заново</button></div></div>
    <div class="card"><h2>Журнал</h2><ul class="log">${items || '<li>Пока пусто</li>'}</ul></div>`;
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
  updateFlight();
}

function updateFlight(): void {
  const f = state.flight;
  const now = Date.now();
  const bar = document.getElementById('flight-bar');
  const eta = document.getElementById('flight-eta');
  if (f && bar && eta) {
    const frac = Math.min(1, Math.max(0, (now - f.departAt) / (f.arriveAt - f.departAt || 1)));
    bar.style.width = `${(frac * 100).toFixed(1)}%`;
    eta.textContent = fmtDur(f.arriveAt - now);
  }
  const encEta = document.getElementById('enc-eta');
  if (state.encounter && encEta) encEta.textContent = fmtDur(state.encounter.resolveAt - now);
}

/* ---------- Карта ---------- */

function mapGeometry(canvas: HTMLCanvasElement) {
  const w = canvas.clientWidth;
  const h = Math.round(w / 2);
  const pad = 14;
  const sx = (x: number): number => pad + (x / 255) * (w - 2 * pad);
  const sy = (y: number): number => pad + (y / 2 / 127.5) * (h - 2 * pad);
  return { w, h, sx, sy };
}

function drawMap(): void {
  const canvas = document.getElementById('map') as HTMLCanvasElement | null;
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const { w, h, sx, sy } = mapGeometry(canvas);
  canvas.style.height = `${h}px`;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const systems = systemsOf(state.galaxy);
  const here = systems[state.system];

  // радиус прыжка: dist = 4*sqrt(dx² + (dy/2)²) → в пикселях
  const rangeLy = state.fuel / 4;
  const pxPerX = sx(1) - sx(0);
  ctx.beginPath();
  ctx.arc(sx(here.x), sy(here.y), rangeLy * pxPerX, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(79,216,196,.45)';
  ctx.setLineDash([6, 6]);
  ctx.stroke();
  ctx.setLineDash([]);

  for (const s of systems) {
    const reachable = distance(here, s) <= state.fuel;
    ctx.beginPath();
    ctx.arc(sx(s.x), sy(s.y), reachable ? 3 : 2, 0, Math.PI * 2);
    ctx.fillStyle = reachable ? '#dde4e2' : '#5c6b68';
    ctx.fill();
  }

  if (selected !== null) {
    const s = systems[selected];
    ctx.beginPath();
    ctx.arc(sx(s.x), sy(s.y), 8, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffd37a';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = '#ffd37a';
    ctx.font = '12px sans-serif';
    ctx.fillText(s.name, Math.min(sx(s.x) + 10, w - 80), sy(s.y) - 10);
  }

  ctx.beginPath();
  ctx.arc(sx(here.x), sy(here.y), 6, 0, Math.PI * 2);
  ctx.fillStyle = '#4fd8c4';
  ctx.fill();
}

function onMapTap(ev: MouseEvent): void {
  const canvas = ev.currentTarget as HTMLCanvasElement;
  const rect = canvas.getBoundingClientRect();
  const { sx, sy } = mapGeometry(canvas);
  const px = ev.clientX - rect.left;
  const py = ev.clientY - rect.top;
  let best = -1;
  let bestD = 28 * 28;
  systemsOf(state.galaxy).forEach((s, i) => {
    const d = (sx(s.x) - px) ** 2 + (sy(s.y) - py) ** 2;
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
    case 'jump': {
      const to = Number(el.dataset.to);
      const r = startJump(state, to, Date.now(), settings);
      if (r.error) {
        addLog(JUMP_ERRORS[r.error]);
      } else {
        state = r.state;
        addLog(`Отправление: ${currentSystem(state).name} → ${systemsOf(state.galaxy)[to].name}`);
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
  const result = advance(state, Date.now(), settings);
  if (result.events.length > 0 || result.state !== state) {
    state = result.state;
    handleEvents(result.events);
    save();
    render();
  } else {
    updateFlight();
  }
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
  const numeric = ['speed', 'encounterTimeoutMs', 'encounterRate'].includes(key);
  settings = { ...settings, [key]: numeric ? Number(el.value) : el.value };
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
