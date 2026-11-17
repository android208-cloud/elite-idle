import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IMPORT_ERROR_TEXT,
  SAVE_FILE_APP,
  SAVE_FILE_VERSION,
  buildSaveFile,
  encodeSaveFile,
  formatSavedAt,
  importSaveFile,
  saveFileName,
  summarize,
} from '../src/core/save-file.ts';
import { DEFAULT_SETTINGS, newGame, serialize, startJump, systemsOf } from '../src/core/state.ts';
import { distance } from '../src/core/galaxy.ts';

/** Ближайшая другая система — прыжок всегда возможен. */
function nearestOther(state: ReturnType<typeof newGame>): number {
  const sys = systemsOf(state.galaxy);
  let best = -1;
  let d = Infinity;
  for (let i = 0; i < sys.length; i++) {
    if (i === state.system) continue;
    const dd = distance(sys[state.system], sys[i]);
    if (dd < d) { d = dd; best = i; }
  }
  return best;
}

const log = [{ at: 1000, text: 'Прыжок' }];

test('файл собирается и читается обратно', () => {
  const state = newGame(42);
  const file = buildSaveFile(state, log, DEFAULT_SETTINGS, 1_763_300_000_000);
  const text = encodeSaveFile(file);
  const r = importSaveFile(text);
  assert.ok(r.ok, 'должен прочитаться');
  if (!r.ok) return;
  assert.equal(r.state.cash, state.cash);
  assert.equal(r.state.system, state.system);
  assert.equal(r.state.rng, state.rng, 'генератор должен пережить файл');
  assert.deepEqual(r.log, log);
});

test('в файле есть метка, версия и сводка', () => {
  const state = newGame(7);
  const file = buildSaveFile(state, log, DEFAULT_SETTINGS);
  assert.equal(file.app, SAVE_FILE_APP);
  assert.equal(file.fileVersion, SAVE_FILE_VERSION);
  assert.equal(file.version, state.version);
  assert.equal(file.summary.systemName, 'LAVE');
  assert.equal(file.summary.galaxy, state.galaxy);
  assert.equal(file.summary.cash, state.cash);
  assert.ok(file.summary.rank.length > 0);
});

test('сводка показывает полёт', () => {
  const s = newGame(3);
  assert.equal(summarize(s).inFlight, false);
  // Настоящий полёт через настоящий startJump: выдуманный объект ничего
  // не проверит, а сломается на первом же изменении структуры Flight.
  const jumped = startJump(s, nearestOther(s), 1000, DEFAULT_SETTINGS).state;
  assert.ok(jumped.flight, 'прыжок должен был начаться');
  assert.equal(summarize(jumped).inFlight, true);
});

test('чужой JSON отвергается и не трогает ничего', () => {
  const r = importSaveFile('{"hello":"world"}');
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, 'not-our-file');
});

test('не JSON отвергается с понятным текстом', () => {
  const r = importSaveFile('это просто текст');
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.error, 'not-json');
    assert.equal(r.message, IMPORT_ERROR_TEXT['not-json']);
  }
});

test('испорченное состояние отвергается, а не падает', () => {
  const good = buildSaveFile(newGame(1), log, DEFAULT_SETTINGS);
  const broken = { ...good, state: '{"version":2,"galaxy":1' };
  const r = importSaveFile(JSON.stringify(broken));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, 'broken-state');
});

test('состояние с неверной галактикой отвергается', () => {
  const state = newGame(1);
  const bad = { ...state, galaxy: 99 };
  const file = { ...buildSaveFile(state, log, DEFAULT_SETTINGS), state: serialize(bad) };
  const r = importSaveFile(JSON.stringify(file));
  assert.equal(r.ok, false, 'галактика 99 не существует');
});

test('состояние с отрицательными деньгами отвергается', () => {
  const state = newGame(1);
  const bad = { ...state, cash: -5 };
  const file = { ...buildSaveFile(state, log, DEFAULT_SETTINGS), state: serialize(bad) };
  assert.equal(importSaveFile(JSON.stringify(file)).ok, false);
});

test('длинный трюм неправильной длины отвергается', () => {
  const state = newGame(1);
  const bad = { ...state, cargo: [1, 2, 3] };
  const file = { ...buildSaveFile(state, log, DEFAULT_SETTINGS), state: serialize(bad) };
  assert.equal(importSaveFile(JSON.stringify(file)).ok, false);
});

test('файл будущей версии формата отвергается', () => {
  const file = { ...buildSaveFile(newGame(1), log, DEFAULT_SETTINGS), fileVersion: 99 };
  const r = importSaveFile(JSON.stringify(file));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, 'unsupported-version');
});

test('настройки из файла применяются, недостающие берутся по умолчанию', () => {
  const file = { ...buildSaveFile(newGame(1), log, { ...DEFAULT_SETTINGS, speed: 100 }), settings: { speed: 100 } };
  const r = importSaveFile(JSON.stringify(file));
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.settings.speed, 100);
  assert.equal(r.settings.dockingModule, DEFAULT_SETTINGS.dockingModule, 'остальное — по умолчанию');
});

test('мусор в логе отбрасывается, а не ломает загрузку', () => {
  const file = { ...buildSaveFile(newGame(1), log, DEFAULT_SETTINGS), log: [{ at: 1, text: 'ok' }, null, { foo: 1 }, { at: 2, text: 5 }] };
  const r = importSaveFile(JSON.stringify(file));
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.log.length, 1);
  assert.equal(r.log[0].text, 'ok');
});

test('имя файла отражает систему, деньги и дату', () => {
  const s = { ...newGame(1), cash: 12345 };
  const name = saveFileName(s, Date.UTC(2026, 10, 16, 12, 0, 0));
  assert.equal(name, 'elite-idle-lave-1234cr-2026-11-16.json');
});

test('имя файла безопасно для системы', () => {
  const s = newGame(1);
  const name = saveFileName(s);
  assert.ok(!/[\\/:*?"<>|]/.test(name), 'запрещённых символов быть не должно');
  assert.ok(name.endsWith('.json'));
});

test('дата в файле показывается по-русски', () => {
  const text = formatSavedAt('2026-11-16T18:40:00.000Z');
  assert.ok(/\d/.test(text) && text.includes('2026'), text);
  assert.equal(formatSavedAt(''), 'неизвестно когда');
  assert.equal(formatSavedAt('не дата'), 'неизвестно когда');
});

test('без даты файл всё равно читается', () => {
  const file = { ...buildSaveFile(newGame(1), log, DEFAULT_SETTINGS) };
  delete (file as { savedAt?: string }).savedAt;
  const r = importSaveFile(JSON.stringify(file));
  assert.ok(r.ok, 'дата — украшение, а не обязательное поле');
});
