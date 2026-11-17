import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CANISTER_COMMODITIES,
  autoScoop,
  canisterCount,
  rollCanisters,
  scoopOne,
  systemCommodities,
} from '../src/core/cargo-canisters.ts';
import {
  DEFAULT_SETTINGS,
  advance,
  cargoTons,
  jettisonCargo,
  newGame,
  salvageClose,
  salvageTake,
  salvageTakeAll,
  startJump,
  serialize,
  deserialize,
  jumpDuration,
  type GameState,
  type Salvage,
} from '../src/core/state.ts';
import { distance } from '../src/core/galaxy.ts';
import { ENEMIES, enemyById } from '../src/core/ships.ts';
import { generateMarket, isTonneCargo } from '../src/core/market.ts';
import { systemsOf } from '../src/core/state.ts';

/** Ближайшая другая система — чтобы прыжок гарантированно был возможен. */
function nearestOther(sys: ReturnType<typeof systemsOf>, from: number): number {
  let best = -1;
  let d = Infinity;
  for (let i = 0; i < sys.length; i++) {
    if (i === from) continue;
    const dd = distance(sys[from], sys[i]);
    if (dd < d) { d = dd; best = i; }
  }
  return best;
}

/* ---------- Данные оригинала ---------- */

test('контейнеры совпадают с блюпринтами BBC Elite', () => {
  // Значения из docs/cargo-canisters.md (elite-ships-*.asm, байт $00).
  const expected: Record<string, { trader: number; pirate: number }> = {
    sidewinder: { trader: 0, pirate: 0 },
    gecko: { trader: 0, pirate: 0 },
    adder: { trader: 0, pirate: 0 },
    cobra1: { trader: 3, pirate: 3 },
    mamba: { trader: 1, pirate: 1 },
    krait: { trader: 1, pirate: 1 },
    moray: { trader: 1, pirate: 1 },
    cobra3: { trader: 3, pirate: 1 },
    asp: { trader: 0, pirate: 0 },
    ferdelance: { trader: 0, pirate: 0 },
    python: { trader: 5, pirate: 2 },
    anaconda: { trader: 7, pirate: 7 },
    viper: { trader: 0, pirate: 0 },
  };
  for (const e of ENEMIES) {
    assert.deepEqual(e.canisters, expected[e.id], `контейнеры ${e.id}`);
  }
});

test('Sidewinder не роняет ничего — это не баг', () => {
  assert.equal(canisterCount('sidewinder', 'pirate'), 0);
});

test('Python-торговец роняет пять, Python-пират — два', () => {
  assert.equal(canisterCount('python', 'trader'), 5);
  assert.equal(canisterCount('python', 'pirate'), 2);
});

test('Cobra Mk III: торговец три, пират один', () => {
  assert.equal(canisterCount('cobra3', 'trader'), 3);
  assert.equal(canisterCount('cobra3', 'pirate'), 1);
});

test('полиция и охотники считаются по боевой ветке', () => {
  assert.equal(canisterCount('viper', 'police'), 0);
  assert.equal(canisterCount('python', 'hunter'), 2);
});

/* ---------- Товар из ассортимента системы ---------- */

test('в контейнере только то, что продаётся в системе', () => {
  const systems = systemsOf(1);
  const market = generateMarket(systems[0], 42);
  const pool = systemCommodities(market);
  const { canisters } = rollCanisters(20, market, 12345);
  for (const c of canisters) {
    assert.ok(pool.includes(c.commodity), `товар ${c.commodity} должен быть в ассортименте`);
  }
});

test('товар не выходит за «дешёвую» половину таблицы', () => {
  const systems = systemsOf(1);
  let rng = 999;
  for (let round = 0; round < 20; round++) {
    const market = generateMarket(systems[round % systems.length], round * 7);
    const { canisters, rng: next } = rollCanisters(15, market, rng);
    rng = next;
    for (const c of canisters) {
      assert.ok(CANISTER_COMMODITIES.includes(c.commodity), `товар ${c.commodity} вне списка`);
    }
  }
});

test('бедная система не даёт пустой список', () => {
  const empty = Array.from({ length: 17 }, () => ({ price: 0, quantity: 0 }));
  const pool = systemCommodities(empty);
  assert.ok(pool.length > 0, 'иначе контейнеры были бы пустыми');
  assert.deepEqual(pool, [...CANISTER_COMMODITIES]);
});

test('rollCanisters детерминирован', () => {
  const market = Array.from({ length: 17 }, () => ({ price: 100, quantity: 5 }));
  const a = rollCanisters(5, market, 777);
  const b = rollCanisters(5, market, 777);
  assert.deepEqual(a.canisters, b.canisters);
  assert.equal(a.rng, b.rng);
});

test('rollCanisters выдаёт ровно столько контейнеров, сколько просили', () => {
  const market = Array.from({ length: 17 }, () => ({ price: 100, quantity: 5 }));
  for (const n of [0, 1, 2, 5, 7]) {
    assert.equal(rollCanisters(n, market, 1).canisters.length, n);
  }
});

/* ---------- Взятие ---------- */

const emptyCargo = () => Array.from({ length: 17 }, () => 0);

test('scoopOne уменьшает свободное место ровно на тонну', () => {
  const got = scoopOne(emptyCargo(), 20, { commodity: 0, amount: 1 });
  assert.ok(got);
  assert.equal(got.cargo[0], 1);
  assert.equal(got.holdSpace, 19);
});

test('scoopOne без места возвращает null', () => {
  assert.equal(scoopOne(emptyCargo(), 0, { commodity: 0, amount: 1 }), null);
});

test('нетоннажный товар место в трюме не занимает', () => {
  const gold = 13; // золото — килограммы
  assert.equal(isTonneCargo(gold), false);
  const got = scoopOne(emptyCargo(), 3, { commodity: gold, amount: 1 });
  assert.ok(got);
  assert.equal(got.holdSpace, 3, 'место не изменилось');
});

test('autoScoop берёт что влезает и считает оставшееся', () => {
  const canisters = [
    { commodity: 0, amount: 1 },
    { commodity: 1, amount: 1 },
    { commodity: 2, amount: 1 },
  ];
  const got = autoScoop(emptyCargo(), 2, canisters);
  assert.equal(got.taken, 2);
  assert.equal(got.left, 1);
  assert.equal(got.holdSpace, 0);
});

/* ---------- Фаза подбора в состоянии ---------- */

function withSalvage(state: GameState, canisters: Salvage['canisters']): GameState {
  return {
    ...state,
    salvage: { canisters, taken: 0, left: 0, pausedAt: 0, pausedMs: 0, enemyName: 'Krait' },
  };
}

test('salvageTake убирает контейнер из обломков', () => {
  const state = withSalvage(newGame(1), [
    { commodity: 0, amount: 1 },
    { commodity: 1, amount: 1 },
  ]);
  const r = salvageTake(state, 0, 1000);
  assert.equal(r.error, 'none');
  assert.equal(r.state.cargo[0], 1);
  assert.equal(r.state.salvage?.canisters.length, 1);
  assert.equal(r.state.salvage?.taken, 1);
});

test('salvageTake последнего контейнера закрывает подбор', () => {
  const state = withSalvage(newGame(1), [{ commodity: 0, amount: 1 }]);
  const r = salvageTake(state, 0, 1000);
  assert.equal(r.state.salvage, null, 'иначе экран подбора останется пустым');
});

test('salvageTake без места не тратит контейнер', () => {
  const state = { ...withSalvage(newGame(1), [{ commodity: 0, amount: 1 }]), holdSpace: 0 };
  const r = salvageTake(state, 0, 1000);
  assert.equal(r.error, 'no-room');
  assert.equal(r.state, state, 'состояние не должно меняться');
});

test('salvageTakeAll забирает всё и закрывает подбор', () => {
  const state = withSalvage(newGame(1), [
    { commodity: 0, amount: 1 },
    { commodity: 1, amount: 1 },
  ]);
  const r = salvageTakeAll(state, 1000);
  assert.equal(r.taken, 2);
  assert.equal(r.state.salvage, null);
  assert.equal(cargoTons(r.state), 2);
});

test('salvageClose просто убирает обломки', () => {
  const state = withSalvage(newGame(1), [{ commodity: 0, amount: 1 }]);
  assert.equal(salvageClose(state).salvage, null);
});

/* ---------- Выброс груза во время подбора ---------- */

test('jettisonCargo освобождает место в трюме', () => {
  const base = newGame(1);
  const state: GameState = { ...base, cargo: base.cargo.slice(), holdSpace: 19 };
  state.cargo[3] = 1;
  const r = jettisonCargo(state, 3, 1);
  assert.equal(r.dropped, 1);
  assert.equal(r.state.cargo[3], 0);
  assert.equal(r.state.holdSpace, 20);
});

test('jettisonCargo не выбрасывает больше, чем есть', () => {
  const base = newGame(1);
  const state: GameState = { ...base, cargo: base.cargo.slice(), holdSpace: 18 };
  state.cargo[0] = 2;
  const r = jettisonCargo(state, 0, 10);
  assert.equal(r.dropped, 2);
  assert.equal(r.state.holdSpace, 20);
});

test('jettisonCargo пустого товара ничего не делает', () => {
  const state = newGame(1);
  const r = jettisonCargo(state, 5, 1);
  assert.equal(r.dropped, 0);
  assert.equal(r.state, state);
});

test('выбросить и взять — рабочий сценарий тесного трюма', () => {
  const base = newGame(1);
  let state: GameState = { ...base, cargo: base.cargo.slice(), holdSpace: 0 };
  state.cargo[0] = 20; // полный трюм еды
  state = withSalvage(state, [{ commodity: 6, amount: 1 }]); // наркотики
  const noRoom = salvageTake(state, 0, 1000);
  assert.equal(noRoom.error, 'no-room');
  const dumped = jettisonCargo(state, 0, 1);
  const taken = salvageTake(dumped.state, 0, 1100);
  assert.equal(taken.error, 'none');
  assert.equal(taken.state.cargo[6], 1);
});

/* ---------- Настройка автоподбора ---------- */

test('автоподбор по умолчанию выключен', () => {
  assert.equal(DEFAULT_SETTINGS.autoScoop, false, 'иначе игрок не увидит выбор');
});

/* ---------- Пауза подбора не съедает путь ---------- */

test('время на подбор не сокращает полёт', () => {
  // Регресс: исходно пауза только правила `arriveAt`, а досчёт пересчитывал
  // его из `remainingBaseMs` и стирал сдвиг — время на выбор съедало путь.
  const settings = { ...DEFAULT_SETTINGS, speed: 100, encounterRate: 0 };
  const sys = systemsOf(1);
  const T0 = 1_000_000;
  let s = startJump(newGame(9), nearestOther(sys, newGame(9).system), T0, settings).state;
  const total = s.flight!.arriveAt - T0;
  const at = T0 + Math.round(total * 0.2);
  let cur = advance(s, at, settings).state;
  const before = cur.flight!.arriveAt - at;

  cur = {
    ...cur,
    salvage: { canisters: [{ commodity: 0, amount: 1 }], taken: 0, left: 0, pausedAt: at, pausedMs: 0, enemyName: 'Krait' },
  };
  cur = advance(cur, at + 5000, settings).state; // 5 с игрок решал
  cur = salvageClose(cur);
  cur = advance(cur, at + 10_000, settings).state; // ещё 5 с полёта
  const after = cur.flight!.arriveAt - (at + 10_000);
  const spent = before - after;
  assert.ok(spent >= 4900 && spent <= 5100, `ушло ${spent} мс — должно быть ~5000 (пауза бесплатна)`);
});

test('подбор держит полёт: без решения игра не летит', () => {
  const settings = { ...DEFAULT_SETTINGS, speed: 100, encounterRate: 0 };
  const sys = systemsOf(1);
  const T0 = 1_000_000;
  const start = newGame(9);
  let s = startJump(start, nearestOther(sys, start.system), T0, settings).state;
  s = {
    ...s,
    salvage: { canisters: [{ commodity: 0, amount: 1 }], taken: 0, left: 0, pausedAt: T0, pausedMs: 0, enemyName: 'Krait' },
  };
  const r = advance(s, T0 + 200_000, settings);
  assert.ok(r.state.flight !== null, 'полёт не должен завершиться, пока идут обломки');
  assert.equal(r.state.salvage?.pausedMs, 200_000, 'простой накоплен');
});

/* ---------- §76: время и встречи ---------- */

test('полный бак на ×200 занимает ровно десять секунд', () => {
  const s = { ...DEFAULT_SETTINGS, speed: 200 };
  assert.equal(jumpDuration(s, 70), 10_000);
});

test('на ×1 полный бак — 2000 секунд', () => {
  assert.equal(jumpDuration(DEFAULT_SETTINGS, 70), 2_000_000);
});

test('медленнее — больше встреч, быстрее — меньше', () => {
  const sys = systemsOf(1);
  const count = (speed: number) => {
    let total = 0;
    for (let seed = 1; seed <= 5; seed++) {
      const g = newGame(seed);
      const target = nearestOther(sys, g.system);
      const st = { ...DEFAULT_SETTINGS, speed, encounterRate: 1 };
      let s = startJump(g, target, 0, st).state;
      const arrive = s.flight!.arriveAt;
      let t = 0;
      while (t < arrive + 5000 && s.flight) {
        t += 100;
        const r = advance(s, t, st);
        s = r.state;
        total += r.events.filter((e) => e.type === 'detected').length;
      }
    }
    return total / 5;
  };
  const slow = count(1);
  const fast = count(200);
  assert.ok(slow > fast, `на ×1 должно быть больше встреч, чем на ×200 (${slow} против ${fast})`);
});

test('на ×200 встреча хотя бы одна', () => {
  const sys = systemsOf(1);
  for (let seed = 1; seed <= 10; seed++) {
    const g = newGame(seed);
    const st = { ...DEFAULT_SETTINGS, speed: 200, encounterRate: 1 };
    let s = startJump(g, nearestOther(sys, g.system), 0, st).state;
    const arrive = s.flight!.arriveAt;
    let t = 0;
    let seen = 0;
    while (t < arrive + 5000 && s.flight) {
      t += 50;
      const r = advance(s, t, st);
      s = r.state;
      seen += r.events.filter((e) => e.type === 'detected').length;
    }
    assert.ok(seen >= 1, `seed ${seed}: перелёт на ×200 остался без встреч`);
  }
});

test('встречи не съедают путь: прибытие в срок при любой плотности', () => {
  const sys = systemsOf(1);
  for (const rate of [1, 3]) {
    for (let seed = 1; seed <= 5; seed++) {
      const settings = { ...DEFAULT_SETTINGS, encounterRate: rate };
      const g = newGame(seed);
      let s = startJump(g, nearestOther(sys, g.system), 0, settings).state;
      const planned = s.flight!.arriveAt;
      let t = 0;
      for (let i = 0; i < 5000 && s.flight; i++) {
        t += 1000;
        s = advance(s, t, settings).state;
      }
      assert.ok(Math.abs(t - planned) <= 1000, `rate=${rate} seed=${seed}: прибытие съехало на ${(t - planned) / 1000} с`);
    }
  }
});

test('старое сохранение с pending мигрирует и не даёт NaN', () => {
  const g = newGame(1);
  const raw = JSON.parse(serialize(g));
  raw.flight = {
    from: 7, to: 12, departAt: 0, arriveAt: 1000, dueAt: 0,
    remainingBaseMs: 1000, elapsedBaseMs: 0, pending: [100, 200], fuelUsed: 3,
  };
  const back = deserialize(JSON.stringify(raw));
  assert.equal(back.flight?.encounters, 0, 'счётчик восстановлен');
  assert.equal(back.flight?.lastEncounterAt, 0, 'отсчёт от начала полёта');
  const r = advance(back, 2000, DEFAULT_SETTINGS);
  assert.ok(Number.isFinite(r.state.flight?.remainingBaseMs ?? 0), 'досчёт не сломался');
});
