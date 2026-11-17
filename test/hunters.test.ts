/**
 * Охотники за головами и ступени побега (§84).
 *
 * Пользователь: «три статуса, побег дороже для беглеца, награда охотникам
 * увеличена».
 *
 * Награда охотникам в игре не выплачивается игроку — она определяет,
 * сколько желающих на него охотится. Поэтому «увеличена» реализовано как
 * рост частоты: чем больше статус, тем больше охотников.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  advance,
  DEFAULT_SETTINGS,
  newGame,
  startJump,
  systemsOf,
  MAX_FUEL,
} from '../src/core/state.ts';
import { distance } from '../src/core/galaxy.ts';

const START = 1_000_000;
const HOUR = 3_600_000;

function near(galaxy: number, from: number): number {
  const systems = systemsOf(galaxy);
  return systems
    .map((_, i) => i)
    .filter((i) => i !== from && distance(systems[from], systems[i]) <= 70)
    .sort((a, b) => distance(systems[from], systems[a]) - distance(systems[from], systems[b]))[0]!;
}

/** Доля охотников среди всех встреч за долгий полёт. */
function hunterShare(legal: number, seeds = 20): { hunters: number; total: number } {
  let hunters = 0;
  let total = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const g = { ...newGame(seed), legal, fuel: MAX_FUEL };
    const started = startJump(g, near(1, g.system), START, DEFAULT_SETTINGS);
    if (!started.state.flight) continue;
    const r = advance(started.state, START + 6 * HOUR, DEFAULT_SETTINGS);
    for (const e of r.events) {
      if (e.type !== 'detected') continue;
      total++;
      if (/Охотник/.test(e.text)) hunters++;
    }
  }
  return { hunters, total };
}

describe('§84: охотники и ступени побега', () => {
  it('на беглеца охотятся чаще, чем на чистого', () => {
    const clean = hunterShare(0);
    const fugitive = hunterShare(60);
    const cleanRate = clean.hunters / Math.max(1, clean.total);
    const fugRate = fugitive.hunters / Math.max(1, fugitive.total);
    assert.ok(fugRate > cleanRate, `беглец ${(fugRate * 100).toFixed(1)}% против чистого ${(cleanRate * 100).toFixed(1)}%`);
  });

  it('на нарушителя охотятся чаще, чем на чистого', () => {
    const clean = hunterShare(0);
    const offender = hunterShare(30);
    const cleanRate = clean.hunters / Math.max(1, clean.total);
    const offRate = offender.hunters / Math.max(1, offender.total);
    assert.ok(offRate > cleanRate, `нарушитель ${(offRate * 100).toFixed(1)}% против ${(cleanRate * 100).toFixed(1)}%`);
  });

  it('чистого тоже ищут охотники — иначе промысла нет', () => {
    // Базовые 10% оставлены намеренно: награда за голову существует всегда.
    const clean = hunterShare(0, 40);
    assert.ok(clean.hunters > 0, `охотников ${clean.hunters} на ${clean.total} встреч`);
  });
});
