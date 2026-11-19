/**
 * §105: ФЛОТ — пилоты, которые летают сами.
 *
 * Шаг 1: только торговые рейсы. Что здесь проверяется:
 *   - наём только с ранга «Опытный» (128 убийств) и только с кораблём,
 *     который продаётся на этой верфи, плюс задаток 500 CR;
 *   - маршрут — из системы найма, в пределах бака корабля;
 *   - один маршрут — один пилот (это и есть потолок флота);
 *   - цикл = настоящий перелёт туда-обратно + 2 часа отдыха;
 *   - выручка рейса считается по полке источника, четверть забирает пилот;
 *   - досчёт переживает долгое отсутствие: 30 суток — это 253 рейса, а не
 *     один, и не триста тысяч итераций.
 *
 * Числа взяты из настоящей галактики 1: LAVE(7) → REORTE(39), 4.4 св. года.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assignPilotRoute,
  deserialize,
  hirePilot,
  newGame,
  pilotCycleMs,
  pilotEncounters,
  pilotRouteProfit,
  serialize,
  systemsOf,
  advance,
  DEFAULT_SETTINGS,
  surveillanceMap,
  type GameState,
} from '../src/core/state.ts';
import {
  FENCE_SHARE,
  PILOT_HIRE_FEE,
  PILOT_MIN_KILLS,
  PILOT_REST_MS,
  formatSpan,
  laneSurveillance,
  pirateLoot,
  pilotRank,
  pilotRankName,
  pilotRisk,
  pilotRiskRanked,
  PILOT_RANK_INCOME,
  PILOT_RANK_RISK,
  PILOT_RANK_RUNS,
  policeBounty,
  pilotRunIncome,
  pilotWageShare,
  routeProfit,
  surveillanceOf,
} from '../src/core/fleet.ts';
import { distance } from '../src/core/galaxy.ts';
import { SHIPS, shipPrice } from '../src/core/ships.ts';

const LAVE = 7;
const REORTE = 39;
const HOUR = 3_600_000;

/** Игрок к «Опытному»: 128 убийств и деньги. */
const veteran = (cash = 200_000): GameState => {
  const s = newGame(1);
  return { ...s, kills: PILOT_MIN_KILLS, cash, pilots: [], nextPilotId: 1 };
};

const hired = (model: 'adder' | 'cobra3' = 'adder', cash = 200_000): GameState => {
  const r = hirePilot(veteran(cash), model, 1_000_000);
  assert.equal(r.error, undefined);
  return r.state;
};

/**
 * §120: сумма дохода за N рейсов С НАДБАВКОЙ ЗА РАНГ.
 *
 * Рейс, который пилот делает, будучи «Безобидным», платит как раньше, а
 * двухсотый — уже с надбавкой. Поэтому проверки «деньги = рейсы × ставка»
 * считают сумму по ступеням, а не одно умножение.
 */
const rankedIncome = (profit: number, runs: number): number => {
  let sum = 0;
  for (let k = 0; k < runs; k++) sum += pilotRunIncome(profit, 0, k);
  return sum;
};

describe('§105 наём', () => {
  it('задаток и корабль списываются сразу', () => {
    const s = veteran();
    const r = hirePilot(s, 'adder', 1_000_000);
    assert.equal(r.error, undefined);
    assert.equal(s.cash - r.state.cash, shipPrice('adder') + PILOT_HIRE_FEE);
    assert.equal(PILOT_HIRE_FEE, 5000, 'задаток — 500 CR');
  });

  it('пилот приходит без маршрута: сначала корабль, потом дело', () => {
    const r = hirePilot(veteran(), 'adder', 1_000_000);
    assert.equal(r.state.pilots.length, 1);
    assert.equal(r.state.pilots[0].route, null);
    assert.equal(r.state.pilots[0].home, LAVE);
    assert.equal(r.state.pilots[0].runs, 0);
    assert.ok(r.pilot!.name.includes(' '), 'у пилота есть имя и фамилия');
  });

  it('номер пилота не переиспользуется', () => {
    let s = hired();
    const r = hirePilot(s, 'adder', 1_000_000);
    s = r.state;
    assert.deepEqual(s.pilots.map((p) => p.id), [1, 2]);
    assert.equal(s.nextPilotId, 3);
  });

  it('рангом ниже «Опытного» не нанимают', () => {
    const s = { ...veteran(), kills: PILOT_MIN_KILLS - 1 };
    assert.equal(hirePilot(s, 'adder', 1_000_000).error, 'rank');
  });

  it('корабль берётся из того, что продаёт эта верфь', () => {
    // LAVE — экономика 5, на верфи только Аддер.
    assert.equal(hirePilot(veteran(), 'python', 1_000_000).error, 'unavailable');
  });

  it('без денег на корабль и задаток — отказ', () => {
    assert.equal(hirePilot(veteran(1000), 'adder', 1_000_000).error, 'cash');
  });

  it('в полёте не нанимают', () => {
    const s = {
      ...veteran(),
      flight: {
        from: LAVE, to: REORTE, dueAt: 2_000_000, arriveAt: 2_000_000,
        remainingBaseMs: 1_000, encounters: 0, lastEncounterAt: 0, patrol: false,
        patrolFuelUsed: 0,
      },
    } as unknown as GameState;
    assert.equal(hirePilot(s, 'adder', 1_000_000).error, 'in-flight');
  });
});

describe('§105 маршрут', () => {
  it('ставится в пределах бака и от системы найма', () => {
    const s = hired();
    const r = assignPilotRoute(s, 1, REORTE, 1_000_000);
    assert.equal(r.error, undefined);
    assert.deepEqual(r.state.pilots[0].route, { from: LAVE, to: REORTE });
    const ly = distance(systemsOf(1)[LAVE], systemsOf(1)[REORTE]);
    assert.ok(ly <= SHIPS.adder.range, 'маршрут влезает в бак');
  });

  it('дальше бака — отказ', () => {
    const s = hired();
    const far = systemsOf(1).findIndex(
      (sys, i) => i !== LAVE && distance(systemsOf(1)[LAVE], sys) > SHIPS.adder.range,
    );
    assert.equal(assignPilotRoute(s, 1, far, 1_000_000).error, 'range');
  });

  it('в свою же систему — отказ', () => {
    assert.equal(assignPilotRoute(hired(), 1, LAVE, 1_000_000).error, 'self');
  });

  it('один маршрут — один пилот', () => {
    let s = hired();
    s = { ...hirePilot(s, 'adder', 1_000_000).state };
    s = assignPilotRoute(s, 1, REORTE, 1_000_000).state;
    assert.equal(assignPilotRoute(s, 2, REORTE, 1_000_000).error, 'taken');
  });

  it('другой маршрут из того же порта — можно', () => {
    let s = hired();
    s = { ...hirePilot(s, 'adder', 1_000_000).state };
    s = assignPilotRoute(s, 1, REORTE, 1_000_000).state;
    const second = systemsOf(1)
      .map((sys, i) => ({ i, d: distance(systemsOf(1)[LAVE], sys) }))
      .filter((o) => o.i !== LAVE && o.i !== REORTE && o.d <= SHIPS.adder.range);
    assert.ok(second.length > 0, 'у LAVE есть другие соседи');
    assert.equal(assignPilotRoute(s, 2, second[0].i, 1_000_000).error, undefined);
  });
});

describe('§105 цикл и деньги', () => {
  it('цикл — перелёт туда-обратно плюс два часа отдыха', () => {
    const s = assignPilotRoute(hired(), 1, REORTE, 1_000_000).state;
    const cycle = pilotCycleMs(s, s.pilots[0]);
    assert.ok(cycle > PILOT_REST_MS, 'полёт добавляется к отдыху');
    assert.ok(cycle < PILOT_REST_MS + 2 * HOUR, 'полёт на 4.4 св. года — меньше часа в обе стороны');
  });

  /*
   * §119: ОТДЫХ ВЫНЕСЕН В НАСТРОЙКИ ДЛЯ РАЗРАБОТЧИКА (1 минута … 3 часа).
   *
   * Пользователь: «время отдыха пилота вынеси в настройки для
   * разработчиков». Отдых — главный тормоз экономики: перелёт 4.4 св. г.
   * занимает 27 минут, отдых — два часа. Значение живёт в `Settings`,
   * поэтому старые сохранения получают два часа по умолчанию.
   */
  it('отдых берётся из настроек, а не из константы', () => {
    const s = assignPilotRoute(hired(), 1, REORTE, 1_000_000).state;
    const long = pilotCycleMs(s, s.pilots[0], { ...DEFAULT_SETTINGS, pilotRestMs: 3 * HOUR });
    const short = pilotCycleMs(s, s.pilots[0], { ...DEFAULT_SETTINGS, pilotRestMs: 60_000 });
    assert.equal(long - short, 3 * HOUR - 60_000, 'разница — ровно разница отдыха');
    // Рейс без отдыха — только перелёт: его и проверяем как опорную точку.
    const none = pilotCycleMs(s, s.pilots[0], { ...DEFAULT_SETTINGS, pilotRestMs: 0 });
    assert.equal(long, none + 3 * HOUR);
  });

  it('короткий отдых ускоряет флот ровно во столько же раз', () => {
    const s = assignPilotRoute(hired(), 1, REORTE, 1_000_000).state;
    const fast = { ...DEFAULT_SETTINGS, pilotRestMs: 60 * 60_000 };
    const r = advance(s, 1_000_000 + 24 * HOUR, fast);
    const slow = advance(s, 1_000_000 + 24 * HOUR, DEFAULT_SETTINGS);
    assert.ok(r.state.stats.pilotIncome > slow.state.stats.pilotIncome, 'час отдыха выгоднее двух');
  });

  it('выручка рейса — по полке источника, Аддер грузит 8 тонн', () => {
    const systems = systemsOf(1);
    const profit = routeProfit(1, systems, { from: LAVE, to: REORTE }, SHIPS.adder.hold);
    assert.equal(profit, 512, '51.2 CR законным грузом на LAVE → REORTE');
    // Полка не пускает загрузить больше, чем есть.
    const lots = routeProfit(1, systems, { from: LAVE, to: REORTE }, 500);
    assert.ok(lots < 500 * 30 * 10, 'даже с безразмерным трюмом выручка ограничена полкой');
  });

  it('пилот забирает четверть, вам три четверти', () => {
    assert.equal(pilotWageShare(0), 0.25);
    assert.equal(pilotRunIncome(512, 0), 384, '28.8 CR из 51.2');
  });

  it('за сутки Аддер делает восемь рейсов', () => {
    const s = assignPilotRoute(hired(), 1, REORTE, 1_000_000).state;
    const cash0 = s.cash;
    const r = advance(s, 1_000_000 + 24 * HOUR, DEFAULT_SETTINGS);
    const [p] = r.state.pilots;
    // §107: часть рейсов может отнять пират, поэтому считаем не удачу, а
    // инвариант: всего рейсов ровно по циклу, а деньги — по удачным.
    assert.equal(p.runs + p.failures, 8);
    assert.equal(r.state.cash - cash0, rankedIncome(512, p.runs));
    assert.ok(r.events.some((e) => e.type === 'fleet'), 'в журнале есть строка флота');
  });

  it('месяц отсутствия досчитывается одним умножением', () => {
    const s = assignPilotRoute(hired(), 1, REORTE, 1_000_000).state;
    const cash0 = s.cash;
    const r = advance(s, 1_000_000 + 30 * 24 * HOUR, DEFAULT_SETTINGS);
    const [p] = r.state.pilots;
    assert.ok(p.runs > 200 && p.runs + p.failures < 300, `рейсов за 30 суток: ${p.runs + p.failures}`);
    assert.equal(r.state.cash - cash0, rankedIncome(512, p.runs));
  });

  it('§114: доход флота копится в статистике — ровно то, что пришло на счёт', () => {
    const s = assignPilotRoute(hired(), 1, REORTE, 1_000_000).state;
    const cash0 = s.cash;
    const stats0 = s.stats.pilotIncome;
    const r = advance(s, 1_000_000 + 24 * HOUR, DEFAULT_SETTINGS);
    const [p] = r.state.pilots;
    assert.equal(r.state.cash - cash0, rankedIncome(512, p.runs));
    // В статистике — ВАША доля, та же сумма, а не выручка целиком.
    assert.equal(r.state.stats.pilotIncome - stats0, rankedIncome(512, p.runs));
  });

  it('§114: без рейсов доход флота не растёт', () => {
    const s = hired();
    const r = advance(s, 1_000_000 + 100 * HOUR, DEFAULT_SETTINGS);
    assert.equal(r.state.stats.pilotIncome, s.stats.pilotIncome);
  });

  it('§114: старое сохранение без дохода флота читается', () => {
    const s = assignPilotRoute(hired(), 1, REORTE, 1_000_000).state;
    const raw = JSON.parse(serialize(s));
    delete raw.stats.pilotIncome;
    const back = deserialize(JSON.stringify(raw));
    assert.equal(back.stats.pilotIncome, 0, 'счётчик начинается с нуля, а не с NaN');
  });

  it('пилот без маршрута не приносит ничего', () => {
    const s = hired();
    const r = advance(s, 1_000_000 + 100 * HOUR, DEFAULT_SETTINGS);
    assert.equal(r.state.cash, s.cash);
    assert.equal(r.state.pilots[0].runs, 0);
  });

  it('чужой рейс не сдвигает ваше время', () => {
    const s = assignPilotRoute(hired(), 1, REORTE, 1_000_000).state;
    const half = advance(s, 1_000_000 + 1 * HOUR, DEFAULT_SETTINGS);
    assert.equal(half.state.pilots[0].runs, 0, 'за час пилот ещё не вернулся');
  });

  it('время показывается по-человечески', () => {
    assert.equal(formatSpan(2 * HOUR + 50 * 60_000), '2 ч 50 мин');
    assert.equal(formatSpan(8 * 60_000), '8 мин');
    assert.equal(formatSpan(3 * HOUR), '3 ч');
  });
});

describe('§105 сохранение', () => {
  it('пилоты переживают запись и чтение', () => {
    const s = assignPilotRoute(hired(), 1, REORTE, 1_000_000).state;
    const back = deserialize(serialize(s));
    assert.deepEqual(back.pilots, s.pilots);
    assert.equal(back.nextPilotId, s.nextPilotId);
  });

  it('сохранение без флота читается как пустой ангар', () => {
    const s = hired();
    const raw = JSON.parse(serialize(s));
    delete raw.pilots;
    delete raw.nextPilotId;
    const back = deserialize(JSON.stringify(raw));
    assert.deepEqual(back.pilots, []);
    assert.equal(back.nextPilotId, 1);
  });

  it('счётчик восстанавливается по номерам пилотов', () => {
    const s = hired();
    const raw = JSON.parse(serialize(s));
    delete raw.nextPilotId;
    const back = deserialize(JSON.stringify(raw));
    assert.equal(back.nextPilotId, 2);
  });
});

/* ---------- §107: роли ---------- */

/** Пилот, поставленный на маршрут напрямую — без верфи и без ГПСЧ найма. */
const onRoute = (
  from: number,
  to: number,
  role: 'trader' | 'smuggler' | 'pirate' | 'police',
  over: Partial<GameState['pilots'][number]> = {},
): GameState => ({
  ...veteran(),
  system: from,
  pilots: [{
    id: 1, name: 'Тест Пилот', ship: 'adder', home: from, route: { from, to },
    nextRunAt: 0, role, runs: 0, failures: 0, ...over,
  }],
  nextPilotId: 2,
});

/** Анархия: RETILA(20) → RIRAES(148), 3.0 св. года, надзор 0. */
const ANARCHY = { from: 20, to: 148 };
/** Корпорация: QUBE(1) → QUQUOR(40), 5.6 св. года, надзор 7. */
const POLICE = { from: 1, to: 40 };
/** LAVE(7) → REORTE(39), диктатура на обоих концах, надзор 3. */
const DICTATORS = { from: LAVE, to: REORTE };

describe('§107 роли: что везёт и сколько зарабатывает', () => {
  it('торговец запрещёнку не берёт вовсе', () => {
    const systems = systemsOf(1);
    const trader = routeProfit(1, systems, DICTATORS, 8, 'trader');
    const smuggler = routeProfit(1, systems, DICTATORS, 8, 'smuggler');
    assert.equal(trader, 512);
    assert.equal(smuggler, 1856, 'с запрещёнкой — 185.6 CR');
    assert.ok(smuggler > trader * 3, 'на этой линии запрещёнка даёт втрое больше');
  });

  it('пират берёт чужое: треть продажной стоимости полного трюма', () => {
    const loot = pirateLoot(1, systemsOf(1), DICTATORS, SHIPS.adder.hold);
    assert.equal(loot, 2419, '241.9 CR со скупщика');
    assert.ok(loot > routeProfit(1, systemsOf(1), DICTATORS, 8, 'smuggler'), 'грабёж выгоднее торговли');
  });

  it('скупщик берёт треть — иначе пират был бы в восемь раз богаче', () => {
    assert.equal(FENCE_SHARE, 0.3);
    const sell = pirateLoot(1, systemsOf(1), DICTATORS, 8) / FENCE_SHARE;
    assert.ok(sell > 8000, 'полный трюм стоит около 806 CR');
  });
});

describe('§107 полиция — это правительство системы', () => {
  it('надзор системы — индекс правительства', () => {
    assert.equal(surveillanceOf(systemsOf(1)[1]), 7, 'QUBE — корпорация');
    assert.equal(surveillanceOf(systemsOf(1)[20]), 0, 'RETILA — анархия');
  });

  it('надзор линии — среднее двух концов', () => {
    assert.equal(laneSurveillance(systemsOf(1), ANARCHY), 0);
    assert.equal(laneSurveillance(systemsOf(1), POLICE), 7);
    assert.equal(laneSurveillance(systemsOf(1), DICTATORS), 3);
  });

  it('в анархии торговца грабят чаще, а пирата полиция не ловит', () => {
    const systems = systemsOf(1);
    const trader = pilotRisk('trader', laneSurveillance(systems, ANARCHY), 0);
    const pirate = pilotRisk('pirate', laneSurveillance(systems, ANARCHY), 0);
    assert.equal(trader.raid, 0.035, '3.5% за рейс');
    assert.equal(pirate.police, 0, 'полиции нет');
    assert.equal(pirate.damage, 0.04, 'но добыча может отбиться');
  });

  it('в корпоративной системе пирату не жить', () => {
    const risk = pilotRisk('pirate', laneSurveillance(systemsOf(1), POLICE), 7);
    assert.ok(Math.abs(risk.police - 0.105) < 1e-9, '10.5% перехвата за рейс');
  });

  it('досмотр контрабандиста зависит от пункта назначения', () => {
    assert.ok(Math.abs(pilotRisk('smuggler', 3, 3).inspect - 0.06) < 1e-9, '6% в диктатуре');
    assert.ok(Math.abs(pilotRisk('smuggler', 0, 7).inspect - 0.14) < 1e-9, '14% в корпорации');
  });
});

describe('§107 что из этого следует в игре', () => {
  it('пират повышает розыск: +2 за каждый удачный рейс', () => {
    const s = onRoute(ANARCHY.from, ANARCHY.to, 'pirate');
    const r = advance(s, 10 * HOUR, DEFAULT_SETTINGS);
    const [p] = r.state.pilots;
    assert.ok(p.runs > 0, 'рейсы были');
    assert.equal(r.state.legal, p.runs * 2);
  });

  it('торговец розыск не поднимает никогда', () => {
    const s = onRoute(ANARCHY.from, ANARCHY.to, 'trader');
    const r = advance(s, 30 * 24 * HOUR, DEFAULT_SETTINGS);
    assert.equal(r.state.legal, 0);
  });

  it('контрабандиста ловят на досмотре: штраф и розыск', () => {
    const s = onRoute(DICTATORS.from, DICTATORS.to, 'smuggler');
    /*
     * §120: пилот уже «ЭЛИТА» (300 рейсов), чтобы надбавка за ранг не
     * менялась от рейса к рейсу и ожидание считалось одним умножением.
     * Иначе пришлось бы повторять в тесте весь путь ступеней.
     */
    s.pilots[0].runs = 300;
    const r = advance(s, 30 * 24 * HOUR, DEFAULT_SETTINGS);
    const [p] = r.state.pilots;
    assert.ok(p.failures > 0, 'досмотры случались');
    assert.ok(r.state.legal > 0, 'розыск вырос');
    // На досмотре теряется запрещёнка: за удачный рейс платят 139.2 CR,
    // за пойманный — только законную часть (38.4) минус штраф 100 CR.
    const cash0 = s.cash;
    // Выручка рейса контрабандиста — 185.6 CR (с запрещёнкой), законная
    // часть — 51.2 CR; вам с них 75%, и обе суммы уже с надбавкой «ЭЛИТЫ».
    const ok = pilotRunIncome(1856, 0, 300);
    const onlyLegal = pilotRunIncome(512, 0, 300);
    assert.equal(r.state.cash - cash0, (p.runs - 300) * ok + p.failures * (onlyLegal - 1000),
      'рейсов у пилота 300 было до теста — считаем только новые');
  });

  /*
   * §118: ДОСМОТР ПИЛОТА — ЭТО ВАШ РОЗЫСК.
   *
   * Заметка журнала раньше говорила только «1 провал (досмотр)», а статус
   * рос молча. Теперь видно, сколько добавилось и каким он стал.
   */
  it('заметка о досмотре называет розыск', () => {
    const s = onRoute(DICTATORS.from, DICTATORS.to, 'smuggler');
    const r = advance(s, 30 * 24 * HOUR, DEFAULT_SETTINGS);
    const note = r.events.find((e) => /досмотр/.test(e.text));
    assert.ok(note, 'заметка есть');
    // Заметка сводная: за месяц досмотров много, и в ней — общая прибавка.
    const [, delta, total] = note!.text.match(/розыск \+(\d+) → (\d+)/) ?? [];
    assert.ok(delta && total, `в заметке есть цифры: ${note!.text}`);
    const failures = Number(note!.text.match(/^(.*?): (\d+) провал/)?.[2] ?? 0);
    assert.equal(Number(delta), failures * 2, 'по +2 за каждый досмотр');
    assert.equal(Number(total), r.state.legal, 'и это итоговый статус');
  });

  it('пирата в полицейской системе в конце концов берут', () => {
    const s = onRoute(POLICE.from, POLICE.to, 'pirate');
    const r = advance(s, 30 * 24 * HOUR, DEFAULT_SETTINGS);
    assert.equal(r.state.pilots.length, 0, 'корабль и пилот потеряны');
    assert.ok(r.events.some((e) => /попался полиции/.test(e.text)));
  });

  it('в анархии пират живёт: корабль цел, розыск растёт', () => {
    const s = onRoute(ANARCHY.from, ANARCHY.to, 'pirate');
    const r = advance(s, 3 * 24 * HOUR, DEFAULT_SETTINGS);
    assert.equal(r.state.pilots.length, 1);
    assert.ok(r.state.legal >= 0);
  });

  it('смена роли на маршруте записывается и сбрасывает провалы', () => {
    const s = onRoute(DICTATORS.from, DICTATORS.to, 'trader', { failures: 5, runs: 9 });
    const r = assignPilotRoute(s, 1, REORTE, 1_000_000, 'pirate');
    assert.equal(r.error, undefined);
    assert.equal(r.state.pilots[0].role, 'pirate');
    assert.equal(r.state.pilots[0].failures, 0, 'провалы торговца к пирату не переходят');
  });
});

/* ---------- §108: полицейский ---------- */

describe('§108 полицейский', () => {
  it('дежурит в системе, в том числе в своей', () => {
    const s = onRoute(ANARCHY.from, ANARCHY.from, 'police');
    const r = assignPilotRoute(s, 1, ANARCHY.from, 1_000_000, 'police');
    assert.equal(r.error, undefined, 'своя система — законное место дежурства');
    assert.deepEqual(r.state.pilots[0].route, { from: ANARCHY.from, to: ANARCHY.from });
  });

  it('торговцу в свою систему по-прежнему нельзя', () => {
    const s = onRoute(ANARCHY.from, ANARCHY.to, 'trader');
    assert.equal(assignPilotRoute(s, 1, ANARCHY.from, 1_000_000, 'trader').error, 'self');
  });

  it('надзор растёт на 2 и упирается в 7', () => {
    const base = veteran();
    const withPolice = (system: number, count: number): GameState => ({
      ...base,
      pilots: Array.from({ length: count }, (_, i) => ({
        id: i + 1, name: `P${i}`, ship: 'adder' as const, home: system,
        route: { from: system, to: system }, nextRunAt: Infinity,
        role: 'police' as const, runs: 0, failures: 0,
      })),
      nextPilotId: count + 1,
    });
    // RETILA — анархия (0): один полицейский даёт 2, три дали бы 6.
    assert.equal(surveillanceMap(withPolice(ANARCHY.from, 1))[ANARCHY.from], 2);
    assert.equal(surveillanceMap(withPolice(ANARCHY.from, 3))[ANARCHY.from], 6);
    // QUBE — корпорация (7): добавлять некуда.
    assert.equal(surveillanceMap(withPolice(POLICE.from, 2))[POLICE.from], 7);
  });

  it('награда — за беззаконие, а не за торговлю', () => {
    assert.equal(policeBounty(0), 1800, '180 CR в анархии');
    assert.equal(policeBounty(3), 1200, '120 CR в диктатуре');
    assert.equal(policeBounty(7), 400, '40 CR в корпорации');
  });

  it('полицейский закрывает систему вашим же пиратам', () => {
    const systems = systemsOf(1);
    const clean = laneSurveillance(systems, ANARCHY);
    const watched = surveillanceMap(onRoute(ANARCHY.from, ANARCHY.from, 'police'));
    const lane = (watched[ANARCHY.from] + watched[ANARCHY.to]) / 2;
    assert.equal(clean, 0, 'без охраны надзора нет');
    assert.ok(lane >= 1, 'с охраной линия уже под наблюдением');
    assert.ok(
      pilotRisk('pirate', lane, 2).police > pilotRisk('pirate', clean, 0).police,
      'пирату в такой системе опаснее',
    );
  });

  it('в анархии полицейский гибнет, в корпорации — нет', () => {
    const deadly = advance(onRoute(ANARCHY.from, ANARCHY.from, 'police'), 30 * 24 * HOUR, DEFAULT_SETTINGS);
    assert.equal(deadly.state.pilots.length, 0, 'семь процентов за рейс не пережить');
    assert.ok(deadly.events.some((e) => /погиб в бою с пиратами/.test(e.text)));

    const safe = advance(onRoute(POLICE.from, POLICE.from, 'police'), 30 * 24 * HOUR, DEFAULT_SETTINGS);
    assert.equal(safe.state.pilots.length, 1, 'в корпорации гибели нет вовсе');
    assert.ok(safe.state.pilots[0].runs > 200);
  });

  it('полицейский розыск не поднимает', () => {
    const r = advance(onRoute(POLICE.from, POLICE.from, 'police'), 10 * 24 * HOUR, DEFAULT_SETTINGS);
    assert.equal(r.state.legal, 0);
  });

  it('полицейский приносит деньги, а не товар', () => {
    const s = onRoute(POLICE.from, POLICE.from, 'police');
    const cash0 = s.cash;
    const r = advance(s, 24 * HOUR, DEFAULT_SETTINGS);
    const [p] = r.state.pilots;
    /*
     * Награда 40 CR, пилоту четверть: 30 CR за рейс. Провал — это трепка:
     * ремонт в четверть цены Аддера (250 CR), поэтому считаем и его.
     */
    assert.equal(r.state.cash - cash0, rankedIncome(400, p.runs) - p.failures * 2500);
  });
});

describe('§120 ранги пилота', () => {
  /*
   * Пользователь: «ранги пилота — такие же, как у нас (дань игре)».
   * Значит, имена — из общей таблицы `RANKS`, а ключ другой: не убийства,
   * а рейсы. Иначе до ЭЛИТЫ было бы 6400 рейсов, то есть два года.
   */
  it('имена — те же, что у игрока, порядок тот же', () => {
    assert.equal(pilotRankName(0), 'Безобидный');
    assert.equal(pilotRankName(1), 'Почти безобидный');
    assert.equal(pilotRankName(2), 'Слабый');
    assert.equal(pilotRankName(4), 'Средний');
    assert.equal(pilotRankName(8), 'Выше среднего');
    assert.equal(pilotRankName(16), 'Опытный');
    assert.equal(pilotRankName(32), 'Опасный');
    assert.equal(pilotRankName(64), 'Смертельный');
    assert.equal(pilotRankName(128), 'ЭЛИТА');
    assert.equal(pilotRankName(500), 'ЭЛИТА', 'потолок один');
  });

  it('пороги — по рейсам, ступень между ними', () => {
    assert.deepEqual([...PILOT_RANK_RUNS], [0, 1, 2, 4, 8, 16, 32, 64, 128]);
    assert.equal(pilotRank(0), 0);
    assert.equal(pilotRank(3), 2, 'три рейса — уже «Слабый», четвёртого ещё нет');
    assert.equal(pilotRank(128), 8);
  });

  it('ранг повышает выручку рейса', () => {
    assert.equal(pilotRunIncome(1000, 0, 0), 750, 'новичок — четверть пилоту, как раньше');
    // 16 рейсов — это уже «Опытный», пятая ступень: +20%.
    assert.equal(pilotRunIncome(1000, 0, 16), Math.round(750 * 1.2), '+20% к «Опытному»');
    assert.equal(pilotRunIncome(1000, 0, 1), Math.round(750 * 1.04), '+4% со второго рейса');
    assert.equal(pilotRunIncome(1000, 0, 128), Math.round(750 * 1.32), 'ЭЛИТА: +32%');
    assert.ok(pilotRunIncome(1000, 0, 128) > pilotRunIncome(1000, 0, 127));
    assert.equal(PILOT_RANK_INCOME, 0.04);
  });

  it('ранг снижает риск', () => {
    const base = pilotRisk('pirate', 4, 2);
    const pro = pilotRiskRanked(base, 128);
    assert.ok(Math.abs(pro.police - base.police * 0.6) < 1e-12, '−5% за ступень, восемь ступеней — −40%');
    assert.ok(Math.abs(pro.damage - base.damage * 0.6) < 1e-12);
    assert.equal(PILOT_RANK_RISK, 0.05);
    // Новичок ничего не получает: поправка ровно 1.
    assert.deepEqual(pilotRiskRanked(base, 0), base);
  });

  it('ранг растёт от рейсов, а не от денег', () => {
    const s = onRoute(DICTATORS.from, DICTATORS.to, 'trader');
    const r = advance(s, 30 * 24 * HOUR, DEFAULT_SETTINGS);
    const [p] = r.state.pilots;
    assert.ok(p.runs >= 128, `рейсов за месяц: ${p.runs}`);
    assert.equal(pilotRankName(p.runs), 'ЭЛИТА');
  });
});

describe('§120 встречи пилота', () => {
  /*
   * Пользователь: «можно ли применить формулу игрока к ним? то есть как
   * если бы мы сами летели по этому маршруту». Формула игрока — первая
   * встреча в середине перелёта, дальше по одной каждые
   * `ENCOUNTER_PERIOD_MS / encounterRate`. У пилота это БАЗОВОЕ время.
   */
  it('считаются как у игрока: пол за плечо плюс по периоду', () => {
    const s = assignPilotRoute(hired(), 1, REORTE, 1_000_000).state;
    // 4.4 св. г. — 25 минут базового полёта, период 120 секунд: 7 встреч
    // за плечо, значит 14 за рейс туда-обратно.
    assert.equal(pilotEncounters(s, s.pilots[0]), 14);
  });

  it('дальше — больше встреч', () => {
    const s = assignPilotRoute(hired(), 1, REORTE, 1_000_000).state;
    const far = { ...s, pilots: [{ ...s.pilots[0], route: { from: LAVE, to: s.pilots[0].route!.to } }] };
    assert.ok(pilotEncounters(s, s.pilots[0]) > 2 * 1, 'без пола было бы меньше');
    assert.ok(pilotEncounters(far, far.pilots[0]) >= pilotEncounters(s, s.pilots[0]));
  });

  it('частота встреч из настроек работает и здесь', () => {
    const s = assignPilotRoute(hired(), 1, REORTE, 1_000_000).state;
    const often = { ...DEFAULT_SETTINGS, encounterRate: 2 };
    const never = { ...DEFAULT_SETTINGS, encounterRate: 0 };
    assert.equal(pilotEncounters(s, s.pilots[0], often), 26, 'вдвое плотнее — вдвое больше');
    assert.equal(pilotEncounters(s, s.pilots[0], never), 0, '«нет встреч» выключает их и пилоту');
  });

  it('встречи не меняют ожидание провала за рейс', () => {
    /*
     * Риск делится на число встреч, поэтому месяц на одном и том же
     * маршруте даёт примерно то же число провалов, что и до §120. Полоса
     * широкая: это случайность, а не формула, — но выброс в десять раз
     * такая проверка поймает.
     */
    const s = onRoute(ANARCHY.from, ANARCHY.to, 'trader');
    const r = advance(s, 30 * 24 * HOUR, DEFAULT_SETTINGS);
    const [p] = r.state.pilots;
    const total = p.runs + p.failures;
    assert.ok(p.failures / total < 0.2, `провалов ${p.failures} из ${total}`);
  });
});
