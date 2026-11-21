/*
 * §132: РЕДАКТОР ИНТЕРФЕЙСА.
 *
 * Включается из режима разработчика: в шапке по центру появляется карандаш,
 * по нажатию экран переходит в режим правки. Дальше:
 *   * нажатие на карточку — высота, цвет фона, радиус скругления;
 *   * нажатие на строку текста в карточке — сам текст, размер шрифта, цвет,
 *     выравнивание (то есть положение строки в карточке);
 *   * нажатие на кнопку — жёсткая ширина и высота плюс текст внутри.
 *
 * Почему отдельным модулем: это не игра, а инструмент. В `main.ts` он
 * подключается тремя строчками (инициализация, применение правок после
 * перерисовки, показ карандаша), и его легко выключить целиком.
 *
 * ГЛАВНОЕ РЕШЕНИЕ — КЛЮЧИ. Экран пересобирается через `innerHTML` каждый тик,
 * поэтому держать ссылки на узлы нельзя. Правки живут в localStorage и лежат
 * не на элементах, а на путях: `c2` — третья карточка экрана, `c2.t1` — вторая
 * строка в ней, `c2.b0` — первая кнопка. После каждой перерисовки разметка
 * обходится тем же порядком, элементы получают `data-ui-key`, и правки
 * накладываются заново. Порядок обхода один и тот же в decorate и в apply —
 * это единственное, что делает ключи устойчивыми.
 *
 * Правки локальные (в браузере) и не попадают в сейв игры: это черновик вида.
 * Кнопка «Скачать JSON» отдаёт их файлом, чтобы потом перенести в код.
 */
type Kind = 'card' | 'text' | 'button';

type UiStyle = {
  h?: number;
  w?: number;
  r?: number;
  bg?: string;
  fs?: number;
  color?: string;
  align?: 'left' | 'center' | 'right';
  /** §132.1: сдвиг строки или кнопки относительно её места в потоке. */
  dx?: number;
  dy?: number;
  text?: string;
};

type Store = Record<string, Record<string, UiStyle>>;

const KEY = 'elite-idle-ui-edits-v1';

let store: Store = {};
let editing = false;
let picked: string | null = null;
let deps: { render: () => void; screen: () => string } | null = null;

/** Правки читаются один раз при загрузке: битый JSON не должен ломать игру. */
function load(): void {
  try {
    const raw = localStorage.getItem(KEY);
    store = raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    store = {};
  }
}

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* приватный режим — правки просто не переживут перезагрузку */
  }
}

export function isEditing(): boolean {
  return editing;
}

/** Строки экрана: всё, что может быть отредактировано, лежит внутри `#content`. */
function currentScreen(): string {
  return deps?.screen() ?? 'unknown';
}

function editsFor(screen: string): Record<string, UiStyle> {
  store[screen] ??= {};
  return store[screen];
}

/* ---------- Обход разметки ---------- */

/**
 * Строки текста — ЛИСТЬЯ дерева внутри карточки.
 *
 * Лист — элемент без дочерних элементов и с непустым текстом. Так «Топливо»,
 * «10.0 св. г. из 10.0 св. г.» и «+1.0» становятся отдельными строками, а
 * контейнеры, в которых ничего нет, пропускаются.
 *
 * Кнопки в этот список не попадают: у кнопки свой режим (размер и текст), и
 * если считать её текст строкой, правки дрались бы друг с другом.
 */
function textLeaves(root: Element): HTMLElement[] {
  const out: HTMLElement[] = [];
  const walk = (el: Element): void => {
    for (const child of Array.from(el.children)) {
      if (child.tagName === 'BUTTON') continue;
      if (child.children.length === 0) {
        if ((child.textContent ?? '').trim() !== '') out.push(child as HTMLElement);
        continue;
      }
      walk(child);
    }
  };
  walk(root);
  return out;
}

function kindOf(key: string): Kind {
  if (/\.t\d+$/.test(key)) return 'text';
  if (/\.b\d+$/.test(key)) return 'button';
  return 'card';
}

/* ---------- Применение ---------- */

function hex(color: string): string {
  const m = color.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (!m) return /^#[0-9a-f]{6}$/i.test(color) ? color : '#000000';
  const to = (n: string) => Number(n).toString(16).padStart(2, '0');
  return `#${to(m[1])}${to(m[2])}${to(m[3])}`;
}

function applyCard(el: HTMLElement, s?: UiStyle): void {
  if (!s) return;
  if (s.h !== undefined) el.style.height = `${s.h}px`;
  if (s.r !== undefined) el.style.borderRadius = `${s.r}px`;
  if (s.bg) el.style.background = s.bg;
}

/**
 * §132.1: сдвиг — это `transform`, а не `position: absolute`.
 *
 * Строку или кнопку надо двигать, не ломая карточку. `transform` не трогает
 * поток: соседи остаются на местах, высота карточки не меняется, и вернуть
 * элемент на место можно, сбросив один стиль.
 */
function shift(el: HTMLElement, s: UiStyle): void {
  const dx = s.dx ?? 0;
  const dy = s.dy ?? 0;
  el.style.transform = dx || dy ? `translate(${dx}px, ${dy}px)` : '';
}

function applyText(el: HTMLElement, s?: UiStyle): void {
  if (!s) return;
  if (s.fs !== undefined) el.style.fontSize = `${s.fs}px`;
  if (s.color) el.style.color = s.color;
  if (s.align) el.style.textAlign = s.align;
  if (s.text !== undefined && el.textContent !== s.text) el.textContent = s.text;
  shift(el, s);
}

function applyButton(el: HTMLElement, s?: UiStyle): void {
  if (!s) return;
  if (s.w !== undefined) el.style.width = `${s.w}px`;
  if (s.h !== undefined) el.style.height = `${s.h}px`;
  if (s.text !== undefined && el.textContent !== s.text) el.textContent = s.text;
  shift(el, s);
}

/**
 * Разметить экран и наложить правки. Вызывается в конце `render()`, то есть
 * после каждой перерисовки: правки живут вне узлов и должны возвращаться сами.
 */
export function applyUiEdits(content: HTMLElement, screen: string): void {
  const edits = editsFor(screen);
  const cards = Array.from(content.querySelectorAll<HTMLElement>('.card'));
  cards.forEach((card, i) => {
    const key = `c${i}`;
    // Атрибуты ставим ТОЛЬКО в режиме правки: в обычной игре разметка должна
    // оставаться такой, какой её собрали экраны, — на неё смотрят проверки и
    // отладка.
    if (editing) card.dataset.uiKey = key;
    applyCard(card, edits[key]);
    textLeaves(card).forEach((el, j) => {
      const k = `${key}.t${j}`;
      if (editing) el.dataset.uiKey = k;
      applyText(el, edits[k]);
    });
    Array.from(card.querySelectorAll<HTMLElement>('button')).forEach((el, j) => {
      const k = `${key}.b${j}`;
      if (editing) el.dataset.uiKey = k;
      applyButton(el, edits[k]);
    });
  });
  if (picked && !content.querySelector(`[data-ui-key="${picked}"]`)) picked = null;
}

/* ---------- Панель ---------- */

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function numRow(label: string, prop: string, value: number, min: number, max: number): string {
  return `<div class="uied-row"><label>${label}</label>
    <input type="range" min="${min}" max="${max}" value="${value}" data-ui-prop="${prop}" data-ui-kind="range">
    <input type="number" min="${min}" max="${max}" value="${value}" data-ui-prop="${prop}" data-ui-kind="number"></div>`;
}

function colorRow(label: string, prop: string, value: string): string {
  return `<div class="uied-row"><label>${label}</label>
    <input type="color" value="${hex(value)}" data-ui-prop="${prop}" data-ui-kind="color">
    <input type="text" value="${esc(hex(value))}" data-ui-prop="${prop}" data-ui-kind="text-color"></div>`;
}

function panel(el: HTMLElement, key: string): string {
  const kind = kindOf(key);
  const s = editsFor(currentScreen())[key] ?? {};
  const title = kind === 'card' ? 'Карточка' : kind === 'button' ? 'Кнопка' : 'Строка текста';
  const cs = getComputedStyle(el);
  const bg = s.bg ?? cs.backgroundColor;
  const color = s.color ?? cs.color;
  const fs = s.fs ?? Math.round(parseFloat(cs.fontSize) || 14);
  const r = s.r ?? Math.round(parseFloat(cs.borderTopLeftRadius) || 0);
  const h = s.h ?? Math.round(el.getBoundingClientRect().height || 0);
  const w = s.w ?? Math.round(el.getBoundingClientRect().width || 0);

  let body = '';
  if (kind === 'card') {
    body = numRow('Высота', 'h', h, 40, 800) + numRow('Радиус', 'r', r, 0, 48) + colorRow('Фон', 'bg', bg);
  } else if (kind === 'text') {
    body =
      `<div class="uied-row"><label>Текст</label>
         <input type="text" value="${esc(s.text ?? el.textContent ?? '')}" data-ui-prop="text" data-ui-kind="text"></div>` +
      numRow('Шрифт', 'fs', fs, 8, 40) +
      colorRow('Цвет', 'color', color) +
      numRow('Сдвиг X', 'dx', s.dx ?? 0, -160, 160) +
      numRow('Сдвиг Y', 'dy', s.dy ?? 0, -80, 80) +
      `<div class="uied-row"><label>Положение</label>
         ${(['left', 'center', 'right'] as const)
           .map((a) => `<button class="btn small" data-ui-act="align" data-ui-val="${a}"
             aria-pressed="${(s.align ?? '') === a}">${
               a === 'left' ? 'слева' : a === 'center' ? 'по центру' : 'справа'
             }</button>`)
           .join('')}</div>`;
  } else {
    body =
      numRow('Ширина', 'w', w, 40, 400) +
      numRow('Высота', 'h', h, 24, 160) +
      numRow('Сдвиг X', 'dx', s.dx ?? 0, -160, 160) +
      numRow('Сдвиг Y', 'dy', s.dy ?? 0, -80, 80) +
      `<div class="uied-row"><label>Текст</label>
         <input type="text" value="${esc(s.text ?? el.textContent ?? '')}" data-ui-prop="text" data-ui-kind="text"></div>`;
  }

  return `<div class="uied-head"><b>${title}</b><span class="uied-key">${key}</span>
      <span class="spacer"></span>
      <button class="btn small tonal" data-ui-act="reset">Сбросить</button>
      <button class="btn small" data-ui-act="done">Готово</button></div>
    ${body}
    <div class="uied-row"><span class="spacer"></span>
      <button class="btn small tonal" data-ui-act="export">Скачать JSON</button></div>`;
}

function box(): HTMLElement | null {
  return document.getElementById('ui-editor');
}

function paint(): void {
  const el = box();
  if (!el) return;
  const node = editing && picked ? document.querySelector<HTMLElement>(`[data-ui-key="${picked}"]`) : null;
  document.querySelectorAll('.ui-picked').forEach((n) => n.classList.remove('ui-picked'));
  if (!node) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  node.classList.add('ui-picked');
  el.hidden = false;
  el.innerHTML = panel(node, picked!);
}

function setProp(prop: string, raw: string): void {
  if (!picked) return;
  const node = document.querySelector<HTMLElement>(`[data-ui-key="${picked}"]`);
  if (!node) return;
  const edits = editsFor(currentScreen());
  const s: UiStyle = (edits[picked] ??= {});
  const kind = kindOf(picked);

  if (prop === 'text') s.text = raw;
  else if (prop === 'bg') s.bg = raw;
  else if (prop === 'color') s.color = raw;
  else if (prop === 'align') s.align = raw as UiStyle['align'];
  else {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    // Высота у кнопки и у карточки — одно и то же поле, но смысл разный.
    s[prop as 'h' | 'w' | 'r' | 'fs' | 'dx' | 'dy'] = n;
  }

  if (kind === 'card') applyCard(node, s);
  else if (kind === 'button') applyButton(node, s);
  else applyText(node, s);
  save();
  /*
   * Пару «ползунок + число» держим в согласии, но панель не перерисовываем:
   * иначе при перетаскивании ползунка теряется фокус. И не трогаем поле, в
   * котором сейчас печатают.
   */
  document.querySelectorAll<HTMLInputElement>(`#ui-editor [data-ui-prop="${prop}"]`).forEach((input) => {
    if (input === document.activeElement || input.type === 'color') return;
    input.value = raw;
  });
}

function onClick(ev: MouseEvent): void {
  const t = ev.target as HTMLElement;
  if (!editing) return;
  /*
   * В режиме правки настоящие действия игры не работают: клик только выбирает
   * элемент. Иначе редактирование карточки «Топливо» грозило бы покупкой
   * топлива, а правка кнопки — прыжком.
   *
   * Исключения: сама панель и нижние вкладки. Панель понятно почему, а
   * вкладки нужны, чтобы ходить по экранам и править их все.
   */
  if (t.closest('#ui-editor') || t.closest('#nav')) return;

  const node = t.closest<HTMLElement>('[data-ui-key]');
  if (!node) return;
  ev.preventDefault();
  ev.stopPropagation();
  picked = node.dataset.uiKey ?? null;
  paint();
}

function onPanelInput(ev: Event): void {
  const el = ev.target as HTMLInputElement;
  const prop = el.dataset.uiProp;
  if (!prop) return;
  setProp(prop, el.value);
}

function onPanelClick(ev: MouseEvent): void {
  const btn = (ev.target as HTMLElement).closest<HTMLElement>('[data-ui-act]');
  if (!btn) return;
  const act = btn.dataset.uiAct;
  if (act === 'done') {
    editing = false;
    picked = null;
    paint();
    document.body.classList.remove('ui-editing');
    deps?.render();
    return;
  }
  if (act === 'align') {
    setProp('align', btn.dataset.uiVal ?? 'left');
    paint();
    return;
  }
  if (act === 'reset') {
    if (!picked) return;
    const edits = editsFor(currentScreen());
    delete edits[picked];
    save();
    deps?.render();
    picked = null;
    paint();
    return;
  }
  if (act === 'export') {
    const json = JSON.stringify(store, null, 2);
    try {
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'elite-idle-ui.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // В окружении без Blob/URL ничего не скачиваем: файл всё равно лежит в
      // localStorage, и его видно в отладке.
    }
  }
}

/** Включить и выключить режим правки (карандаш в шапке). */
export function toggleEditing(): void {
  editing = !editing;
  picked = null;
  document.body.classList.toggle('ui-editing', editing);
  paint();
  deps?.render();
}

export function initUiEditor(d: { render: () => void; screen: () => string }): void {
  deps = d;
  load();
  const el = document.createElement('div');
  el.id = 'ui-editor';
  el.hidden = true;
  document.getElementById('app')!.appendChild(el);
  // Перехват в ФАЗЕ ЗАХВАТА: обработчик игры висит на документе и иначе
  // успел бы сработать первым.
  document.addEventListener('click', onClick, true);
  el.addEventListener('input', onPanelInput);
  el.addEventListener('click', onPanelClick);
}
