import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { COMMODITIES } from '../src/core/market.ts';

const REF = new URL('../reference/txtelite.c', import.meta.url);

// В исходнике есть «политкорректные» дубли некоторых строк, их пропускаем
const SKIP = new Set(['Robot Slaves', 'Beverages', 'Rare Species']);

test('таблица товаров совпадает с txtelite.c Яна Белла', { skip: !existsSync(REF) }, () => {
  const src = readFileSync(REF, 'utf8');
  const re = /\{\s*0x([0-9A-Fa-f]+)\s*,\s*([+-])\s*0x([0-9A-Fa-f]+)\s*,\s*0x([0-9A-Fa-f]+)\s*,\s*0x([0-9A-Fa-f]+)\s*,\s*(\d)\s*,\s*"([^"]+)"\s*\}/g;
  const rows = [...src.matchAll(re)]
    .map((m) => ({
      basePrice: parseInt(m[1], 16),
      gradient: (m[2] === '-' ? -1 : 1) * parseInt(m[3], 16),
      baseQuantity: parseInt(m[4], 16),
      mask: parseInt(m[5], 16),
      unit: Number(m[6]),
      name: m[7].trim(),
    }))
    .filter((r) => !SKIP.has(r.name));

  assert.equal(rows.length, COMMODITIES.length);
  rows.forEach((r, i) => {
    const c = COMMODITIES[i];
    assert.deepEqual(
      { basePrice: c.basePrice, gradient: c.gradient, baseQuantity: c.baseQuantity, mask: c.mask, unit: c.unit },
      { basePrice: r.basePrice, gradient: r.gradient, baseQuantity: r.baseQuantity, mask: r.mask, unit: r.unit },
      `товар ${i} (${r.name}) не совпадает с эталоном`,
    );
  });
});

