/**
 * Полоска топлива и красная рамка в патруле (§83).
 *
 * Требования пользователя:
 *  1. в патруле полоска топлива — как полоска времени в обычном полёте;
 *  2. статус нарушителя — красная рамка у бокса;
 *  3. контрабанда в трюме — тоже красная рамка.
 *
 * §83.1: те же рамки и на блоках «Статус» и «Груз» экрана «Корабль» —
 * там, где причина написана, а не только на карточке патруля.
 */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = readFileSync('/home/user/elite-idle/standalone/elite-idle.html', 'utf8');
const vc = new VirtualConsole();

function make(store) {
  return new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://elite.test/',
    virtualConsole: vc,
    beforeParse(win) {
      win.HTMLCanvasElement.prototype.getContext = () => ({
        setTransform(){}, clearRect(){}, beginPath(){}, closePath(){}, moveTo(){}, lineTo(){}, stroke(){}, fill(){},
        arc(){}, save(){}, restore(){}, setLineDash(){}, strokeRect(){}, fillText(){},
        measureText: (t) => ({ width: String(t).length * 6 }),
        set lineWidth(v){}, set strokeStyle(v){}, set fillStyle(v){}, set font(v){},
        set textAlign(v){}, set textBaseline(v){}, set lineJoin(v){},
      });
      Object.defineProperty(win.HTMLElement.prototype, 'clientWidth', { get() { return 360; }, configurable: true });
      win.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
      win.cancelAnimationFrame = clearTimeout;
      if (store) win.localStorage.setItem('elite-idle-save-v1', store);
    },
  });
}

let ok = 0, bad = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('✅ ' + name + (extra ? ' · ' + extra : '')); }
  else { bad++; console.log('❌ ' + name + (extra ? ' · ' + extra : '')); }
};

const base = make(null);
await new Promise((r) => setTimeout(r, 900));
const template = JSON.parse(base.window.localStorage.getItem('elite-idle-save-v1'));
/*
 * §102.3: стартовый корабль стал Аддером — один слот ракет, бак 6.0 ly.
 * Эти проверки писались про Кобру (4 ракеты, 7.0 ly), поэтому в шаблоне
 * явно ставим её: иначе «3 ракеты» уже полный боекомплект, а полоска
 * топлива считается от другого бака.
 */
{
  const st = JSON.parse(template.state);
  st.ship.model = 'cobra3';
  st.holdSpace = 20;
  template.state = JSON.stringify(st);
}

/** Патруль с заданными статусом/трюмом/топливом. */
async function patrol({ legal = 0, cargo = null, fuel = 35 } = {}) {
  const save = JSON.parse(JSON.stringify(template));
  const st = JSON.parse(save.state);
  st.ship.missiles = 4;
  st.fuel = fuel;
  st.legal = legal;
  st.cargo = cargo ?? Array(17).fill(0);
  st.escapeRoute = [];
  st.escapeStatus = -1;
  save.state = JSON.stringify(st);

  const dom = make(JSON.stringify(save));
  await new Promise((r) => setTimeout(r, 900));
  const w = dom.window;
  const dest = () => [...w.document.querySelectorAll('#content > .card')].find((c) => c.textContent.includes('Пункт назначения'));
  [...(dest()?.querySelectorAll('button') ?? [])]
    .find((b) => /Патрулировать|Пиратство/.test(b.textContent))
    ?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 600));

  const card = [...w.document.querySelectorAll('#content > .card')].find((c) => /Патруль:|Пиратство:/.test(c.textContent));
  return { w, card, bar: w.document.getElementById('flight-fuel'), text: w.document.getElementById('content').textContent };
}

/* 1. Полоска топлива */
{
  const { card, bar } = await patrol({ fuel: 35 });
  check('в патруле есть полоска топлива', !!bar);
  check('полоска заполнена наполовину', bar?.style.width === '50%', `ширина ${bar?.style.width}`);
  check('рядом подпись топлива', /Топливо\s*3\.5/.test(card?.textContent ?? ''));
  check('нет «Прибытие через»', !/Прибытие через/.test(card?.textContent ?? ''));
  check('нет Infinity', !/Infinity/.test(card?.textContent ?? ''));
  check('обычный патруль без рамки', !card?.className.includes('danger'));
}

/* 2. Нарушитель — красная рамка */
{
  const { card } = await patrol({ legal: 60 });
  check('нарушитель: красная рамка', card?.className.includes('danger'), `class="${card?.className}"`);
}

/* 3. §86: контрабанда при чистом статусе — ЖЁЛТАЯ («следят»), не красная */
{
  const cargo = Array(17).fill(0);
  cargo[3] = 5; // рабы
  const { card } = await patrol({ legal: 0, cargo });
  check('§86: контрабанда — жёлтая рамка', card?.className.includes('warn'), `class="${card?.className}"`);
}

/* 4. Полный бак — полная полоска */
{
  const { bar } = await patrol({ fuel: 70 });
  check('полный бак — полоска 100%', bar?.style.width === '100%', `ширина ${bar?.style.width}`);
}

/* 5. §83.1: блоки «Статус» и «Груз» на экране «Корабль» */
{
  /** Экран «Корабль» без запуска патруля. */
  async function shipScreen({ legal = 0, cargo = null } = {}) {
    const save = JSON.parse(JSON.stringify(template));
    const st = JSON.parse(save.state);
    st.legal = legal;
    st.cargo = cargo ?? Array(17).fill(0);
    st.escapeRoute = [];
    st.escapeStatus = -1;
    save.state = JSON.stringify(st);
    const dom = make(JSON.stringify(save));
    await new Promise((r) => setTimeout(r, 900));
    const w = dom.window;
    const stats = [...w.document.querySelectorAll('.stat')];
    const status = stats.find((e) => e.textContent.includes('Статус'));
    const cargoCard = [...w.document.querySelectorAll('#content > .card')].find((c) => c.querySelector('h2')?.textContent === 'Груз');
    return { status, cargoCard, text: w.document.getElementById('content').textContent };
  }

  const slaves = Array(17).fill(0);
  slaves[3] = 5;

  {
    const { status, cargoCard } = await shipScreen({ legal: 0 });
    check('§83.2: чистый — «Статус» без рамки', !status?.className.includes('danger'));
    check('§83.1: чистый — «Груз» без рамки', !cargoCard?.className.includes('danger'));
  }
  /*
   * §83.2: «Статус» больше НЕ красится — пользователь сказал «тогда ладно,
   * не крась». Плитка сетки с цветной полосой смотрелась чужеродно.
   * Красится только «Груз», и только за контрабанду.
   */
  /*
   * §86: развели два красных. Патруль с розыском — ЖЁЛТЫЙ («следят»),
   * пиратство — КРАСНЫЙ («я сам хищник»).
   */
  {
    const { card } = await patrol({ legal: 60 });
    check('§86: пиратство — красная', card?.className.includes('danger'), `class="${card?.className}"`);
  }
  {
    const slavesCargo = Array(17).fill(0);
    slavesCargo[3] = 5;
    const { card } = await patrol({ legal: 0, cargo: slavesCargo });
    check('§86: патруль с контрабандой — жёлтая', card?.className.includes('warn'), `class="${card?.className}"`);
  }
  {
    const { status, cargoCard } = await shipScreen({ legal: 60 });
    check('§83.2: нарушитель — «Статус» без рамки', !status?.className.includes('danger'));
    check('§83.2: нарушитель — «Груз» без рамки', !cargoCard?.className.includes('danger'));
  }
  {
    const { status, cargoCard } = await shipScreen({ legal: 0, cargo: slaves });
    check('§83.1: контрабанда — «Груз» с рамкой', cargoCard?.className.includes('danger'));
    check('§83.2: контрабанда — «Статус» без рамки', !status?.className.includes('danger'));
  }
}

/*
 * 6. §83.1: текст причины вместо подробностей про ракеты.
 *
 * Проверяем ДО старта патруля: после старта кнопки уже нет, значит и
 * причины нет. Раньше здесь стояло «Нужно 4 ракеты: в арсенале 3» —
 * пользователь просил короткую формулировку.
 */
{
  const save = JSON.parse(JSON.stringify(template));
  const st = JSON.parse(save.state);
  st.ship.missiles = 3;
  st.cargo = Array(17).fill(0);
  st.legal = 0;
  save.state = JSON.stringify(st);
  const dom = make(JSON.stringify(save));
  await new Promise((r) => setTimeout(r, 900));
  const text = dom.window.document.getElementById('content').textContent;
  check('причина: «Не полный боекомплект»', text.includes('Не полный боекомплект'));
  check('без подробностей про ракеты', !/Нужно 4 ракеты/.test(text));
}

console.log(`\nитог: ${ok} ✅ / ${bad} ❌`);
process.exit(bad === 0 ? 0 : 1);
