/**
 * Сохранение и восстановление прогресса через файл (§74).
 *
 * Проверяется то, что видит игрок: в настройках есть карточка «Прогресс в
 * файле», кнопка выгрузки действительно отдаёт файл с правильным именем, а
 * загрузка спрашивает подтверждение и применяет прогресс.
 *
 * `URL.createObjectURL` в jsdom нет — подставляем свою, иначе выгрузка
 * упадёт на первой строке. Ссылку с `download` перехватываем: нам нужен
 * факт клика и имя файла, а не настоящее скачивание.
 */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = readFileSync('/home/user/elite-idle/standalone/elite-idle.html', 'utf8');

let ok = 0, bad = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('✅ ' + name + (extra ? ' · ' + extra : '')); }
  else { bad++; console.log('❌ ' + name + (extra ? ' · ' + extra : '')); }
};

let downloaded = null;
let confirmAnswer = true;
let confirmText = '';

const vc = new VirtualConsole();
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'https://elite.test/',
  virtualConsole: vc,
  beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = () => ({
      setTransform(){}, clearRect(){}, beginPath(){}, closePath(){}, moveTo(){}, lineTo(){}, stroke(){}, fill(){},
      arc(){}, save(){}, restore(){}, setLineDash(){}, strokeRect(){}, fillText(){},
      measureText: (t) => ({ width: String(t).length * 6 }),
      set lineWidth(v){}, set strokeStyle(v){}, set fillStyle(v){}, set font(v){}, set textAlign(v){}, set textBaseline(v){}, set lineJoin(v){},
    });
    w.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
    w.cancelAnimationFrame = clearTimeout;
    // Файловые API, которых нет в jsdom
    w.URL.createObjectURL = (blob) => { downloaded = { blob }; return 'blob:test'; };
    w.URL.revokeObjectURL = () => {};
    w.HTMLAnchorElement.prototype.click = function () {
      if (this.download) downloaded = { ...downloaded, name: this.download };
    };
    w.confirm = (text) => { confirmText = text; return confirmAnswer; };
  },
});

const w = dom.window;
await new Promise((r) => setTimeout(r, 900));
const doc = w.document;
const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const title = () => doc.getElementById('title').textContent;
const text = () => doc.getElementById('content').textContent;
const goSettings = async () => {
  click([...doc.querySelectorAll('[data-action="tab"]')].find((t) => t.dataset.tab === 'log'));
  await new Promise((r) => setTimeout(r, 200));
};

await goSettings();
check('в настройках есть карточка сохранения', /Прогресс в файле/.test(text()));
check('есть кнопка «Сохранить в файл»', !!doc.querySelector('[data-action="save-file"]'));
check('есть кнопка «Загрузить из файла»', !!doc.querySelector('[data-action="load-file"]'));
check('есть скрытый выбор файла', !!doc.getElementById('load-file-input'));

// 1. Выгрузка
click(doc.querySelector('[data-action="save-file"]'));
await new Promise((r) => setTimeout(r, 400));
check('выгрузка отдала файл', !!downloaded?.blob, downloaded?.name ?? 'имени нет');
check('имя файла похоже на сохранение', /^elite-idle-.*\.json$/.test(downloaded?.name ?? ''), downloaded?.name);
const saved = downloaded?.blob ? JSON.parse(await downloaded.blob.text()) : null;
check('в файле наша метка', saved?.app === 'elite-idle', saved?.app);
check('в файле есть сводка', !!saved?.summary?.systemName, saved?.summary?.systemName);
check('в файле есть состояние игры', typeof saved?.state === 'string' && saved.state.includes('"version"'));
check('после выгрузки показано подтверждение', /Файл сохранён/.test(text()));

// 2. Загрузка: подсовываем файл с другим прогрессом
const fake = JSON.parse(saved.state);
fake.cash = 98765;
fake.system = 3;
const fileData = { ...saved, state: JSON.stringify(fake), summary: { ...saved.summary, cash: 98765 } };
/*
 * ВАЖНО: `#load-file-input` пересоздаётся при каждой перерисовке экрана.
 * Поэтому элемент берём заново перед каждым выбором, а не один раз: после
 * загрузки игра уходит на «Корабль», и старая ссылка уже никуда не ведёт.
 */
const pickFile = (file, name) => {
  const input = doc.getElementById('load-file-input');
  if (!input) throw new Error('нет поля выбора файла — экран настроек не открыт');
  Object.defineProperty(input, 'files', { value: [file], configurable: true, writable: true });
  input.dispatchEvent(new w.Event('change', { bubbles: true }));
};
await goSettings();
pickFile(new w.File([JSON.stringify(fileData)], 'my-save.json', { type: 'application/json' }));
await new Promise((r) => setTimeout(r, 500));

check('загрузка спросила подтверждение', confirmText.length > 0);
check('в question показана сводка', /Система:/.test(confirmText) && /Текущий прогресс будет заменён/.test(confirmText));
check('деньги применились из файла', doc.getElementById('top-info').textContent.includes('9876.5'), doc.getElementById('top-info').textContent);
// После загрузки игра переходит на «Корабль» — сообщение живёт в настройках,
// значит возвращаемся туда и читаем.
await goSettings();
check('после загрузки показано подтверждение', /Загружено из my-save\.json/.test(text()), text().match(/Загружено[^<]*/)?.[0] ?? 'нет');

// 3. Отмена не должна менять прогресс
confirmAnswer = false;
const fake2 = JSON.parse(fileData.state);
fake2.cash = 1000;
await goSettings();
pickFile(new w.File([JSON.stringify({ ...fileData, state: JSON.stringify(fake2) })], 'other.json', { type: 'application/json' }));
await new Promise((r) => setTimeout(r, 500));
check('отказ сохраняет текущий прогресс', doc.getElementById('top-info').textContent.includes('9876.5'), doc.getElementById('top-info').textContent);
await goSettings();
check('отказ честно сообщён', /Загрузка отменена/.test(text()), text().match(/Загрузка[^<]*/)?.[0] ?? 'нет');

// 4. Битый файл не должен ничего ломать
confirmAnswer = true;
await goSettings();
pickFile(new w.File(['{"app":"elite-idle","fileVersion":1,"state":"{сломано"}'], 'broken.json', { type: 'application/json' }));
await new Promise((r) => setTimeout(r, 500));
await goSettings();
check('битый файл отвергнут с объяснением', /повреждён|не читается/.test(text()), text().match(/broken\.json[^<]*/)?.[0] ?? '');
check('битый файл не тронул прогресс', doc.getElementById('top-info').textContent.includes('9876.5'));

console.log(`\nитог: ${ok} ✅ / ${bad} ❌`);
w.close();
process.exit(bad ? 1 : 0);
