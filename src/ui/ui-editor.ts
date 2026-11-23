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
  /*
   * §132.13: ЦВЕТ КНОПКИ — ОКАНТОВКА И ФОН, ОТДЕЛЬНО ДЛЯ ДВУХ СОСТОЯНИЙ.
   *
   * Кнопка в игре живёт в двух видах: активная и недоступная (`disabled`,
   * приглушённая до 38 %). Один цвет на оба вида — это ловушка: выкрашенная
   * ярко кнопка в неактивном виде превращается в тусклое пятно, а тихая
   * неактивная — в яркое, которого в игре не бывает. Поэтому у фона и
   * окантовки по две настройки: `bg`/`bd` — активная, `bgOff`/`bdOff` —
   * недоступная. Не задана «неактивная» — берётся активная (и просто тускнеет,
   * как раньше).
   */
  bd?: string;
  bgOff?: string;
  bdOff?: string;
  fs?: number;
  color?: string;
  align?: 'left' | 'center' | 'right';
  /** §132.1: сдвиг строки или кнопки относительно её места в потоке. */
  dx?: number;
  dy?: number;
  /** §132.6: замены внутри живого текста (см. `Op`). */
  ops?: Op[];
  /** Старый формат: текст целиком. При загрузке переводится в `ops`. */
  text?: string;
}

/**
 * §132.6: ОДНА ЗАМЕНА ВНУТРИ ТЕКСТА, А НЕ ТЕКСТ ЦЕЛИКОМ.
 *
 * Пользователь: «Когда я отредактировал этот текст (убрал слово „цена"), то
 * весь блок текста перестал меняться при выборе другой планеты». Так и было:
 * правка хранила текст целиком и каждой перерисовкой возвращала его обратно,
 * затирая свежие данные.
 *
 * Теперь хранится не текст, а разница: `from` → `to` и место `at` (нужно для
 * чистой вставки, где `from` пуст). Применяется она к СВЕЖЕМУ тексту, который
 * экран только что нарисовал. Убрали слово «цена» — оно будет убрано на любой
 * планете, а цифры цены останутся живыми. Поменяли число — на другой планете
 * такой подстроки нет, замена просто не сработает, и правка не сломает данные.
 */
type Op = { from: string; to: string; at?: number };;

type Store = Record<string, Record<string, UiStyle>>;

const KEY = 'elite-idle-ui-edits-v1';

/**
 * §132.8: метка сборки в шапке панели.
 *
 * Пользователь дважды подряд видел уже исправленный баг — почти наверняка
 * страница оставалась в кеше. Метка показывает, какая версия редактора
 * открыта, и снимает спор: «не обновилось» или «старая страница».
 */
const BUILD = '§132.13';

let store: Store = {};
let editing = false;
let picked: string | null = null;
/**
 * §132.13: какое состояние кнопки правим — активное или недоступное.
 *
 * Панель показывает цвета ТОГО состояния, которое выбрано, а не «сейчас на
 * экране»: иначе цвет неактивной кнопки пришлось бы ловить в момент, когда
 * она случайно окажется недоступной.
 */
let editState: 'on' | 'off' = 'on';
let deps: { render: () => void; screen: () => string } | null = null;
/** §132.6: живой текст каждого ключа — база для правок, снятая с последней отрисовки. */
const liveText = new Map<string, string>();

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
 * Свой текст элемента — только прямые текстовые узлы, без детей.
 *
 * §132.5: именно поэтому функция нужна. Название товара на рынке — это
 * `<div class="name with-chip">Еда<span class="chip">дёшево</span></div>`:
 * текст «Еда» лежит прямо в `div`, а рядом стоит пилюля. Если считать такой
 * `div` контейнером (как было до §132.5), «Еда» не получает ключа и выбрать
 * заголовок нельзя — клик по нему попадает в саму карточку.
 */
/** Свой текст элемента как есть, со всеми пробелами: по нему считаются правки. */
function rawText(el: Element): string {
  let out = '';
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === 3 /* Node.TEXT_NODE */) out += n.textContent ?? '';
  }
  return out;
}

function textNodes(el: Element): Text[] {
  return Array.from(el.childNodes).filter((n) => n.nodeType === 3 /* Node.TEXT_NODE */) as Text[];
}

function directText(el: Element): string {
  let out = '';
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === 3 /* Node.TEXT_NODE */) out += n.textContent ?? '';
  }
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Строки текста — элементы, у которых есть СВОЙ текст.
 *
 * §132.5: раньше листом считался только элемент без детей, и заголовок с
 * пилюлей («Еда · дёшево») выпадал. Теперь лист — тот, у кого есть прямой
 * текст, даже если рядом стоят дочерние элементы. Внутрь такого элемента
 * обход всё равно заходит: пилюля — тоже своя строка, и её видно отдельно.
 *
 * Кнопки в этот список не попадают: у кнопки свой режим (размер и текст), и
 * если считать её текст строкой, правки дрались бы друг с другом.
 */
function textLeaves(root: Element): HTMLElement[] {
  const out: HTMLElement[] = [];
  const walk = (el: Element): void => {
    for (const child of Array.from(el.children)) {
      if (child.tagName === 'BUTTON') continue;
      if (directText(child) !== '') out.push(child as HTMLElement);
      if (child.children.length) walk(child);
    }
  };
  walk(root);
  return out;
}

/**
 * §132.5: записать текст, не стерев соседей.
 *
 * `textContent = ...` унёс бы с собой пилюлю «дёшево». Поэтому текст пишется
 * в прямые текстовые узлы, а дочерние элементы остаются как были. §132.6:
 * границы узлов сохраняются — `<br>` между строками карточки не схлопываются,
 * даже если правка укоротила одну строку.
 */
function applyOpsToNodes(el: HTMLElement, ops: Op[]): void {
  const nodes = textNodes(el);
  if (!ops.length) return;
  if (!nodes.length) {
    const live = '';
    el.insertBefore(document.createTextNode(applyOps(live, ops)), el.firstChild);
    return;
  }
  const live = nodes.map((n) => n.data).join('');
  // Границы между узлами в координатах живого текста.
  const bounds: number[] = [];
  let acc = 0;
  for (let i = 0; i < nodes.length - 1; i++) {
    acc += nodes[i].data.length;
    bounds.push(acc);
  }
  const moved = bounds.map((b) => b);
  let text = live;
  let shift = 0;
  for (const op of ops) {
    const at = op.from === '' ? Math.min(op.at ?? text.length, text.length) : text.indexOf(op.from);
    if (at < 0) continue;
    bounds.forEach((b, i) => {
      if (b <= at) return;
      if (b >= at + op.from.length) moved[i] = b + shift + (op.to.length - op.from.length);
      else moved[i] = at + shift + op.to.length;
    });
    text = text.slice(0, at) + op.to + text.slice(at + op.from.length);
    shift += op.to.length - op.from.length;
  }
  let pos = 0;
  nodes.forEach((n, i) => {
    if (i === nodes.length - 1) {
      n.data = text.slice(pos);
      return;
    }
    const end = Math.max(pos, Math.min(moved[i], text.length));
    n.data = text.slice(pos, end);
    pos = end;
  });
}

function applyOps(live: string, ops: Op[]): string {
  let out = live;
  for (const op of ops) {
    if (op.from === '') {
      const at = Math.min(op.at ?? out.length, out.length);
      out = out.slice(0, at) + op.to + out.slice(at);
      continue;
    }
    const at = out.indexOf(op.from);
    if (at < 0) continue; // живой текст ушёл — замену не навязываем
    out = out.slice(0, at) + op.to + out.slice(at + op.from.length);
  }
  return out;
}

/**
 * §132.6: разница между живым и желаемым текстом — общий префикс и общий
 * хвост, а между ними одна замена. Этого хватает на реальные правки (убрать
 * слово, поменять подпись) и не требует ничего умного.
 */
function diffOps(live: string, next: string): Op[] {
  if (live === next) return [];
  const min = Math.min(live.length, next.length);
  let p = 0;
  while (p < min && live[p] === next[p]) p++;
  let s = 0;
  while (s < live.length - p && s < next.length - p && live[live.length - 1 - s] === next[next.length - 1 - s]) s++;
  return [{ from: live.slice(p, live.length - s), to: next.slice(p, next.length - s), at: p }];
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
  if (s.ops?.length) applyOpsToNodes(el, s.ops);
  shift(el, s);
}

/**
 * §132.13: недоступна ли кнопка ПРЯМО СЕЙЧАС.
 *
 * В игре это атрибут `disabled`. В режиме правки его снимают (§132.3), чтобы
 * кнопку можно было выбрать, а признак остаётся в `data-ui-disabled`. Обе
 * приметы значат одно и то же, поэтому проверяем обе — иначе цвет
 * «неактивной» кнопки в редакторе не применялся бы вовсе.
 */
function isOff(el: Element): boolean {
  return el.getAttribute('data-ui-disabled') === '1' || (el as HTMLButtonElement).disabled === true;
}

/**
 * §132.13: цвет по умолчанию — без учёта наших же правок.
 *
 * Фон и окантовка ставятся inline. Значит, если сейчас на кнопке стоит цвет
 * ДРУГОГО состояния, `getComputedStyle` вернёт его, и панель подставит в
 * поле активного состояния чужой цвет. Поэтому на мгновение снимаем свои
 * inline-значения, читаем настоящий цвет из стилей экрана и возвращаем всё
 * как было.
 */
function cssDefault(el: HTMLElement, read: (cs: CSSStyleDeclaration) => string): string {
  const bg = el.style.background;
  const shadow = el.style.boxShadow;
  el.style.background = '';
  el.style.boxShadow = '';
  const value = read(getComputedStyle(el));
  el.style.background = bg;
  el.style.boxShadow = shadow;
  return value;
}

/** §132.13: окантовка — внутренняя тень, чтобы кнопка не меняла размер. */
const ringOf = (color: string): string => `inset 0 0 0 2px ${color}`;

function applyButton(el: HTMLElement, s?: UiStyle): void {
  if (!s) return;
  if (s.w !== undefined) el.style.width = `${s.w}px`;
  if (s.h !== undefined) el.style.height = `${s.h}px`;
  // §132.3: цвет шрифта внутри кнопки — отдельная правка, не цвет всей кнопки.
  if (s.color) el.style.color = s.color;
  // §132.8: текст кнопки правится так же, как строка. Иначе подпись с ценой
  // («Доплатить 120 000 CR») замерзала бы на одном числе.
  if (s.ops?.length) applyOpsToNodes(el, s.ops);
  /*
   * §132.13: фон и окантовка — по состоянию кнопки. Неактивная берёт свою
   * пару, если она задана, иначе активную (и остаётся приглушённой штатным
   * `opacity: .38` из стилей игры).
   */
  const off = isOff(el);
  const bg = off ? s.bgOff ?? s.bg : s.bg;
  const bd = off ? s.bdOff ?? s.bd : s.bd;
  el.style.background = bg ?? '';
  el.style.boxShadow = bd ? ringOf(bd) : '';
  shift(el, s);
}

/**
 * §132.3: НЕДОСТУПНЫЕ КНОПКИ ТОЖЕ ПРАВЯТСЯ.
 *
 * Пользователь: «Надо редактировать так же и недоступные для нажатия кнопки».
 * У `disabled` кнопки браузер вообще не присылает события мыши: нажать на неё
 * нельзя, значит и выбрать нельзя. На время правки снимаем сам атрибут —
 * вреда нет, потому что в режиме правки все действия всё равно перехвачены
 * (см. `onClick`), а нажатие работает только как выбор. Признак «была
 * недоступной» запоминаем атрибутом, чтобы кнопка выглядела приглушённой, как
 * раньше.
 */
function unfreezeButtons(content: HTMLElement): void {
  content.querySelectorAll<HTMLButtonElement>('button[disabled]').forEach((btn) => {
    /*
     * §132.4: ВИД НЕДОСТУПНОЙ КНОПКИ НАДО ЗАМОРОЗИТЬ.
     *
     * Пользователь (скриншот): «выбрал неактивную кнопку, но цвет текста в
     * редакторе там для активной». Причина: сняв `disabled`, мы снимали и
     * правило `.btn:disabled { opacity: .38 }` — кнопка в редакторе выглядела
     * живой, а цвет в панели читался с этого «живого» вида.
     *
     * Поэтому перед снятием атрибута запоминаем вычисленную прозрачность и
     * ставим её inline: кнопка остаётся приглушённой, как в игре. Цвет при
     * этом честный — он и в игре такой же, тускнеет только прозрачность.
     */
    const cs = getComputedStyle(btn);
    btn.dataset.uiDisabled = '1';
    btn.dataset.uiDeadOpacity = cs.opacity;
    btn.disabled = false;
    btn.style.opacity = cs.opacity;
  });
}

/**
 * Разметить экран и наложить правки. Вызывается в конце `render()`, то есть
 * после каждой перерисовки: правки живут вне узлов и должны возвращаться сами.
 */
export function applyUiEdits(content: HTMLElement, screen: string): void {
  const edits = editsFor(screen);
  // §132.3: до разметки — иначе недоступные кнопки останутся без ключей
  // (disabled-кнопка событий не получает, но ключ ей всё равно нужен).
  if (editing) unfreezeButtons(content);
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
      // §132.6: живой текст запоминаем ДО подстановки — по нему считается правка.
      liveText.set(`${screen}|${k}`, rawText(el));
      const s = edits[k];
      if (s && s.text !== undefined && !s.ops) {
        // Старый формат «текст целиком» переводим в замену — иначе он снова
        // заморозил бы блок. Делается один раз, на первой перерисовке.
        s.ops = diffOps(rawText(el), s.text);
        delete s.text;
        save();
      }
      applyText(el, s);
    });
    Array.from(card.querySelectorAll<HTMLElement>('button')).forEach((el, j) => {
      const k = `${key}.b${j}`;
      if (editing) el.dataset.uiKey = k;
      liveText.set(`${screen}|${k}`, rawText(el));
      const s = edits[k];
      if (s && s.text !== undefined && !s.ops) {
        s.ops = diffOps(rawText(el), s.text);
        delete s.text;
        save();
      }
      applyButton(el, s);
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
    /*
     * §132.6: многострочный текст правим в textarea.
     *
     * Блок «Преимущественно промышленная…» — это один элемент с `<br>`: строк
     * три, а в однострочном поле видна только первая, и правка стирала бы
     * остальные. Ещё и переводы строк нужны, чтобы правка оставалась заменой
     * куска, а не всего блока.
     */
    /*
     * §132.11: многострочность — это не только перевод строки в тексте.
     * Строки карточки «Груз» разделены `<br>`, а не «\n», и в поле-строке
     * видна была бы только первая.
     */
    const value = esc(rawText(el));
    const multi = /\n/.test(rawText(el)) || !!el.querySelector('br');
    const field = multi
      ? `<textarea rows="3" data-ui-prop="text" data-ui-kind="text">${value}</textarea>`
      : `<input type="text" value="${value}" data-ui-prop="text" data-ui-kind="text">`;
    const note = s.ops?.length
      ? '<div class="uied-note">Правка — замена куска: всё остальное, включая цифры, обновляется само.</div>'
      : '';
    body =
      note +
      `<div class="uied-row"><label>Текст</label>${field}</div>` +
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
    const dead = el.hasAttribute('data-ui-disabled')
      ? `<div class="uied-note">Кнопка недоступна в игре — она остаётся приглушённой (opacity ${esc(
          el.dataset.uiDeadOpacity ?? '',
        )}). Цвета ниже — те, что будут под этой дымкой.</div>`
      : '';
    /*
     * §132.13: фон и окантовка — двумя парами, по состоянию кнопки.
     * Показываем цвета выбранного состояния; «по умолчанию» читаем из стилей
     * экрана, сняв на миг свои inline-значения (см. `cssDefault`).
     */
    const defBg = cssDefault(el, (cs) => cs.backgroundColor);
    // У кнопки из стилей игры границы нет, и `border-color` равен цвету
    // текста — это и есть понятная «нулевая» окантовка.
    const defBd = cssDefault(el, (cs) => cs.borderTopColor) || color;
    const bgOn = s.bg ?? defBg;
    const bdOn = s.bd ?? defBd;
    const bgOff = s.bgOff ?? s.bg ?? defBg;
    const bdOff = s.bdOff ?? s.bd ?? defBd;
    const isOn = editState === 'on';
    const stateRow = `<div class="uied-row"><label>Состояние</label>
        <button class="btn small" data-ui-act="state" data-ui-val="on" aria-pressed="${isOn}">активная</button>
        <button class="btn small" data-ui-act="state" data-ui-val="off" aria-pressed="${!isOn}">неактивная</button></div>`;
    const colorsNote =
      '<div class="uied-note">Фон и окантовка задаются отдельно для активной и недоступной кнопки: недоступная в игре гасится до 38 %.</div>';
    body =
      dead +
      stateRow +
      numRow('Ширина', 'w', w, 40, 400) +
      numRow('Высота', 'h', h, 24, 160) +
      numRow('Сдвиг X', 'dx', s.dx ?? 0, -160, 160) +
      numRow('Сдвиг Y', 'dy', s.dy ?? 0, -80, 80) +
      colorRow(isOn ? 'Фон' : 'Фон · неакт.', isOn ? 'bg-on' : 'bg-off', isOn ? bgOn : bgOff) +
      colorRow(isOn ? 'Окантовка' : 'Окантовка · неакт.', isOn ? 'bd-on' : 'bd-off', isOn ? bdOn : bdOff) +
      colorsNote +
      colorRow('Цвет текста', 'color', color) +
      `<div class="uied-row"><label>Текст</label>
         <input type="text" value="${esc(rawText(el))}" data-ui-prop="text" data-ui-kind="text"></div>`;
  }

  const stamp = `<span class="uied-build" title="Версия редактора">${BUILD}</span>`;
  return `<div class="uied-head"><b>${title}</b><span class="uied-key">${key}</span>${stamp}
      <span class="spacer"></span>
      <button class="btn small tonal" data-ui-act="reset">Сбросить</button>
      <button class="btn small" data-ui-act="done">Готово</button></div>
    ${body}
    <div class="uied-row"><span class="spacer"></span>
      <button class="btn small tonal" data-ui-act="export">Скачать JSON</button>
      <button class="btn small text" data-ui-act="reset-all">Сбросить всё</button></div>`;
}

function box(): HTMLElement | null {
  return document.getElementById('ui-editor');
}

/**
 * §132.5: НИЗ ЭКРАНА ПРИВЯЗАН К ВЕРХУ ПАНЕЛИ.
 *
 * Пользователь: «если прокрутить список карточек до самого низа, то окно
 * редактора закрывает собой низ списка. Надо чтобы низ любого окна был
 * привязан к верху меню редактора».
 *
 * Панель висит поверх прокрутки (`position: fixed`), поэтому последние
 * карточки уезжали под неё. Меряем панель и отдаём её высоту в CSS-переменную,
 * а `main` в режиме правки получает ровно такой отступ снизу: докрутив до
 * конца, игрок видит низ экрана прямо над панелью. Переменная живёт на
 * `<body>` и равна нулю, когда панели нет.
 */
function syncHeight(): void {
  const el = box();
  if (!el) return;
  const h = el.hidden ? 0 : el.offsetHeight || el.scrollHeight || 0;
  document.body.style.setProperty('--ui-editor-h', `${h}px`);
}

function paint(): void {
  const el = box();
  if (!el) return;
  const node = editing && picked ? document.querySelector<HTMLElement>(`[data-ui-key="${picked}"]`) : null;
  document.querySelectorAll('.ui-picked').forEach((n) => n.classList.remove('ui-picked'));
  if (!node) {
    el.hidden = true;
    el.innerHTML = '';
    syncHeight();
    return;
  }
  node.classList.add('ui-picked');
  el.hidden = false;
  el.innerHTML = panel(node, picked!);
  syncHeight();
}

function setProp(prop: string, raw: string): void {
  if (!picked) return;
  const node = document.querySelector<HTMLElement>(`[data-ui-key="${picked}"]`);
  if (!node) return;
  const edits = editsFor(currentScreen());
  const s: UiStyle = (edits[picked] ??= {});
  const kind = kindOf(picked);

  if (prop === 'text') {
    /*
     * §132.6 / §132.10: правки КОПЯТСЯ, а не заменяют друг друга.
     *
     * Каждая новая замена считается от того, что сейчас на экране, и
     * добавляется к прежним. Применяются они по очереди: живой текст → первая
     * замена → вторая. Иначе вторая правка съедала первую, и стоило сделать
     * две разные правки в одном блоке, как на другой планете не срабатывала ни
     * одна: между ними оставались цифры прежней планеты.
     */
    const shown = rawText(node);
    const ops = diffOps(shown, raw);
    delete s.text;
    if (!ops.length) {
      save();
      return;
    }
    s.ops = [...(s.ops ?? []), ...ops];
    applyOpsToNodes(node, ops);
    save();
    return;
  }
  /*
   * §132.13: четыре цветовые настройки кнопки. `on`/`off` — состояние, а не
   * «номер кнопки»: у активной и недоступной свои фон и окантовка.
   */
  if (prop === 'bg-on') s.bg = raw;
  else if (prop === 'bg-off') s.bgOff = raw;
  else if (prop === 'bd-on') s.bd = raw;
  else if (prop === 'bd-off') s.bdOff = raw;
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
  /*
   * §132.13: у кнопки сразу открывается то состояние, в котором она сейчас
   * на экране: выбрать недоступную и увидеть цвета активной — та же ошибка,
   * что была с цветом текста в §132.4.
   */
  editState = isOff(node) ? 'off' : 'on';
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
  /*
   * §132.13: переключение состояния кнопки в панели. Сама кнопка на экране не
   * меняется — меняется то, какую пару цветов мы сейчас правим.
   */
  if (act === 'state') {
    editState = btn.dataset.uiVal === 'off' ? 'off' : 'on';
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
  if (act === 'reset-all') {
    /*
     * §132.8: чистка всех правок сразу.
     *
     * Нужна после смены формата хранения (§132.6): старые правки могли
     * заморозить текст, и по одной их выискивать — мучение. Два нажатия, как у
     * покупок: сумма потерь здесь — весь черновик вида.
     */
    if (btn.dataset.uiArmed !== '1') {
      btn.dataset.uiArmed = '1';
      btn.textContent = 'Точно?';
      return;
    }
    store = {};
    save();
    picked = null;
    deps?.render();
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
  if (!editing) syncHeight();
  deps?.render();
  if (editing) syncHeight();
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
  // §132.5: панель меняет высоту при повороте экрана — отступ должен поспеть.
  window.addEventListener('resize', syncHeight);
}
