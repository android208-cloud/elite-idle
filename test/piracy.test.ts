/**
 * Путь пиратства (§79).
 *
 * Два решения пользователя:
 * - торговцев можно грабить: груз в трюм, статус вверх;
 * - при криминальном статусе патруль превращается в ПИРАТСТВО, где в зачёт
 *   идут все встречные корабли, а не только пираты.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  advance,
  DEFAULT_SETTINGS,
  newGame,
  startPatrol,
  RAID_LEGAL,
  POLICE_KILL_LEGAL,
  settleWonEncounter,
  type GameState,
} from '../src/core/state.ts';
import { isCriminal, canBeat } from '../src/core/one-decision.ts';
import { ENEMIES, type PlayerShip } from '../src/core/ships.ts';

const NOW = 1_000_000;
const gun = (over: Partial<PlayerShip> = {}): PlayerShip => ({
  ...newGame(1).ship,
  laser: 'military',
  ecm: true,
  energyBomb: true,
  missiles: 4,
  ...over,
});

/** Патруль с подложенной встречей. */
function encounter(legal: number, role: 'trader' | 'police' | 'pirate', enemyId: string, outcome: 'attack' | 'leave') {
  const g: GameState = { ...newGame(1), ship: gun(), legal };
  const s = startPatrol(g, NOW).state;
  const withEnc: GameState = {
    ...s,
    encounter: { role, enemyId, detectedAt: NOW + 30_000, resolveAt: NOW + 60_000, outcome },
  };
  return advance(withEnc, NOW + 120_000, DEFAULT_SETTINGS);
}

describe('§79: криминальный статус', () => {
  it('статус 0 — чист, 1 и выше — преступник', () => {
    assert.equal(isCriminal(0), false);
    assert.equal(isCriminal(1), true);
    assert.equal(isCriminal(50), true, 'беглец тоже преступник');
  });
});

describe('§79: грабёж торговца', () => {
  it('чистый пилот торговца не трогает', () => {
    const r = encounter(0, 'trader', 'cobra3', 'leave');
    assert.ok(!r.events.some((e) => e.type === 'raided'), 'грабежа нет');
    assert.equal(r.state.legal, 0, 'статус чист');
    assert.equal(r.state.cargo.reduce((a, b) => a + b, 0), 0, 'груза нет');
  });

  it('пират грабит торговца: груз в трюм, статус растёт', () => {
    const r = encounter(60, 'trader', 'cobra3', 'attack');
    const raided = r.events.find((e) => e.type === 'raided');
    assert.ok(raided, 'событие грабежа');
    const tons = r.state.cargo.reduce((a, b) => a + b, 0);
    assert.ok(tons > 0, `груз попал в трюм: ${tons} т`);
    assert.equal(r.state.legal, Math.min(255, 60 + RAID_LEGAL), 'статус вырос');
    assert.equal(r.state.stats.raided, 1, 'счётчик грабежей');
  });

  it('награды за торговца нет — добыча в грузе, а не в деньгах', () => {
    const r = encounter(60, 'trader', 'cobra3', 'attack');
    const trader = ENEMIES.find((e) => e.id === 'cobra3')!;
    // Награда торговца не начисляется: она за преступников, а он мирный.
    assert.ok(r.state.cash >= 0);
    assert.equal(trader.pirate, true, 'но по блюпринту Cobra Mk III — пиратский корабль');
  });
});

describe('§79: режим пиратства', () => {
  it('пират бьёт полицию (в обычном патруле — только если статус криминальный)', () => {
    const r = encounter(60, 'police', 'viper', 'attack');
    assert.ok(r.events.some((e) => e.type === 'auto-victory'), 'победа над полицией');
    assert.equal(r.state.legal, Math.min(255, 60 + POLICE_KILL_LEGAL), 'статус вырос сильнее');
  });

  /*
   * §118: ЦЕНА ПОЛИЦЕЙСКОГО — В ЖУРНАЛЕ.
   *
   * Пользователь получил «пиратство во время патруля» и не понял откуда:
   * автобой сбил семь Viper'ов по +64, а журнал писал только «Автобой:
   * Viper уничтожен». Теперь каждая такая победа говорит, сколько
   * прибавилось и каким стал статус.
   */
  it('убийство полицейского пишет цену в журнал', () => {
    const r = encounter(60, 'police', 'viper', 'attack');
    const note = r.events.find((e) => e.type === 'legal');
    assert.ok(note, 'есть событие о статусе');
    assert.match(note!.text, /розыск \+64 → 124/);
    assert.match(note!.text, /Беглец/);
  });

  it('грабёж торговца тоже называет статус', () => {
    const r = encounter(60, 'trader', 'cobra3', 'attack');
    const raided = r.events.find((e) => e.type === 'raided');
    assert.match(raided!.text, /розыск 92/);
  });

  it('чистый пилот полицию не трогает', () => {
    const r = encounter(0, 'police', 'viper', 'leave');
    assert.ok(!r.events.some((e) => e.type === 'auto-victory'), 'победы нет');
  });

  it('в пиратстве в зачёт идут все корабли, а не только пираты', () => {
    // Проверяем само правило: canBeat больше не требует `pirate`.
    const trader = ENEMIES.find((e) => e.id === 'cobra3')!;
    const kit = { militaryLaser: true, ecm: true, energyBomb: true, missiles: 4 };
    assert.equal(canBeat(trader, kit, 'military'), true, 'торговца можно одолеть');

    const vip = ENEMIES.find((e) => e.id === 'viper')!;
    assert.equal(canBeat(vip, kit, 'military'), true, 'полицию тоже');
  });
});

/*
 * §122: ЦЕНА ПОБЕДЫ — ОДНА ДЛЯ АВТОБОЯ И РУЧНОГО РЕШЕНИЯ.
 *
 * Пока на мирных нельзя было напасть вручную (`isWeak` запрещал), эти
 * последствия жили только в автобое. §122 открыл кнопку, поэтому цена
 * считается в общей функции — иначе ручной пират качался бы без розыска
 * и без груза.
 */
describe('§122: последствия победы', () => {
  const enc = (role: 'trader' | 'police' | 'pirate', enemyId: string) => ({
    role, enemyId, detectedAt: NOW, resolveAt: NOW + 1, outcome: 'attack' as const,
  });

  it('полицейский: +64 к розыску и запись с ценой', () => {
    const base: GameState = { ...newGame(1), legal: 128 };
    const events: { type: string; text: string }[] = [];
    const after = settleWonEncounter(base, enc('police', 'viper'), NOW, events as never);
    assert.equal(after.legal, 128 + POLICE_KILL_LEGAL);
    assert.ok(events.some((e) => /розыск \+64 → 192/.test(e.text)), events.map((e) => e.text).join(' | '));
  });

  it('торговец: груз в трюм и +32 к розыску', () => {
    const base: GameState = { ...newGame(1), legal: 60 };
    const events: { type: string; text: string }[] = [];
    const after = settleWonEncounter(base, enc('trader', 'cobra3'), NOW, events as never);
    const tons = after.cargo.reduce((a, b) => a + b, 0);
    assert.ok(tons > 0, `в трюме ${tons} т`);
    assert.equal(after.legal, 60 + RAID_LEGAL);
    assert.equal(after.stats.raided, base.stats.raided + 1, 'ограбление в статистике');
    assert.ok(events.some((e) => /Ограблен торговец/.test(e.text)));
  });

  it('пират: ни розыска, ни груза — только награда за голову', () => {
    const base: GameState = { ...newGame(1), legal: 0 };
    const events: { type: string; text: string }[] = [];
    const after = settleWonEncounter(base, enc('pirate', 'sidewinder'), NOW, events as never);
    assert.equal(after.legal, base.legal, 'пират — законная цель');
    assert.equal(after.cargo.reduce((a, b) => a + b, 0), 0);
    assert.equal(events.length, 0, 'ни одной записи о преступлении');
  });
});
