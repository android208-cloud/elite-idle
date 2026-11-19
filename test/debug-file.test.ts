/**
 * §113: отладочный файл.
 *
 * Проверяем ровно то, ради чего он существует: по файлу должно быть
 * видно, ЧТО произошло и ПОЧЕМУ. Поэтому в проверках не «файл непустой»,
 * а «есть строка про пилота с доходом и риском», «настройки лежат как
 * есть», «журнал не потерян» и «имя файла не спутать с сохранением».
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newGame, serialize, systemsOf, DEFAULT_SETTINGS, SAVE_VERSION } from '../src/core/state.ts';
import { buildDebugFile, debugFileName, encodeDebugFile } from '../src/core/debug-file.ts';

/** Игра с двумя пилотами: торговец в рейсе и патрульный. */
function withFleet() {
  const base = newGame(1);
  const LAVE = base.system;
  const other = systemsOf(base.galaxy).findIndex((s, i) => i !== LAVE && Math.abs(s.x - systemsOf(base.galaxy)[LAVE].x) < 30);
  return {
    ...base,
    pilots: [
      {
        id: 1, name: 'Нина Ларк', ship: 'adder' as const, home: LAVE,
        route: { from: LAVE, to: other }, nextRunAt: 1_700_000_000_000,
        role: 'trader' as const, runs: 7, failures: 2,
      },
      {
        id: 2, name: 'Рэй Дорн', ship: 'adder' as const, home: LAVE,
        route: { from: LAVE, to: LAVE }, nextRunAt: 1_700_000_000_000,
        role: 'police' as const, runs: 3, failures: 0,
      },
    ],
    nextPilotId: 3,
  };
}

test('отладочный файл: полное состояние, настройки и журнал', () => {
  const s = withFleet();
  const log = [{ at: 1, text: 'первое событие' }, { at: 2, text: 'второе событие' }];
  const file = buildDebugFile(s, log, DEFAULT_SETTINGS, { userAgent: 'test' }, 1_700_000_000_000);

  assert.equal(file.kind, 'debug');
  assert.equal(file.stateVersion, SAVE_VERSION);
  assert.equal(file.savedAt, new Date(1_700_000_000_000).toISOString());
  assert.equal(file.env.userAgent, 'test');
  // Состояние целиком, а не выжимка: разбираться придётся по файлу.
  assert.deepEqual(file.state.pilots.map((p) => p.name), ['Нина Ларк', 'Рэй Дорн']);
  assert.deepEqual(file.settings, DEFAULT_SETTINGS);
  assert.equal(file.log.length, 2);
  assert.equal(file.counters.logLines, 2);
  assert.equal(file.counters.commodities, 17);
});

test('отладочный файл: у пилота видно доход и риски', () => {
  const s = withFleet();
  const file = buildDebugFile(s, [], DEFAULT_SETTINGS, {}, 1_700_000_000_000);
  const [trader, police] = file.fleet.pilotList;

  assert.equal(file.fleet.pilots, 2);
  assert.equal(file.fleet.withRoute, 2);
  assert.equal(trader.role, 'trader');
  assert.ok(trader.income > 0, 'доход за рейс посчитан');
  assert.ok(trader.cycleMs > 0, 'цикл рейса посчитан');
  assert.ok(trader.route && trader.route.distanceLy >= 0, 'расстояние в световых годах');
  assert.ok(trader.risk !== null, 'риски есть');
  // §120: в файле видно и ранг, и плотность встреч — по ним теперь
  // считается и доход, и риск.
  // Семь рейсов — четвёртая ступень таблицы («Средний»): 0, 1, 2, 4.
  assert.equal(trader.rank, 'Средний', 'ранг пилота назван');
  assert.ok(trader.encounters > 0, `встреч за рейс: ${trader.encounters}`);
  // Полицейскому рисуем риск гибели, а не перехвата.
  assert.ok(police.risk !== null);
  assert.equal((police.risk as Record<string, number>).death !== undefined, true);
});

test('отладочный файл: маршруты схлопнуты, как на карте', () => {
  const s = withFleet();
  const file = buildDebugFile(s, [], DEFAULT_SETTINGS);
  assert.equal(file.fleet.lanes.length, 2, 'два разных маршрута — две строки');
  assert.ok(file.fleet.lanes.every((l) => l.pilots === 1));
});

test('отладочный файл: текст — валидный JSON с отступами', () => {
  const text = encodeDebugFile(buildDebugFile(withFleet(), [], DEFAULT_SETTINGS));
  assert.ok(text.includes('\n  "app"'), 'с отступами: файл читают глазами');
  const back = JSON.parse(text);
  assert.equal(back.kind, 'debug');
  assert.ok(Array.isArray(back.log));
});

test('имя отладочного файла не путается с сохранением', () => {
  const s = { ...newGame(1), cash: 123450 };
  const name = debugFileName(s, Date.UTC(2026, 10, 13));
  assert.match(name, /^elite-idle-debug-[a-z0-9-]+-12345cr-2026-11-13\.json$/);
  assert.ok(!name.startsWith('elite-idle-lave'), 'префикс debug обязателен');
});

test('отладочный файл не ломается на пустом флоте', () => {
  const s = newGame(1);
  const file = buildDebugFile(s, [], DEFAULT_SETTINGS);
  assert.equal(file.fleet.pilots, 0);
  assert.deepEqual(file.fleet.lanes, []);
  assert.equal(file.counters.logLines, 0);
});

test('отладочный файл читает то же состояние, что сохранение', () => {
  const s = withFleet();
  const file = buildDebugFile(s, [], DEFAULT_SETTINGS);
  // Одна точка правды на сериализацию: файл не должен показывать другое.
  assert.equal(JSON.stringify(file.state), serialize(s));
});
