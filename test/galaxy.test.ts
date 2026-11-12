import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGalaxy, galaxySeed, distance, GALAXY_SIZE } from '../src/core/galaxy.ts';
import { generateMarket, COMMODITIES, ALIEN_ITEMS_INDEX } from '../src/core/market.ts';

const galaxy1 = buildGalaxy(1);
const byName = (name: string) => {
  const s = galaxy1.find((g) => g.name === name);
  assert.ok(s, `система ${name} должна существовать в галактике 1`);
  return s;
};

test('галактика содержит 256 систем с уникальными именами', () => {
  assert.equal(galaxy1.length, GALAXY_SIZE);
  assert.equal(new Set(galaxy1.map((s) => s.name)).size, GALAXY_SIZE);
});

test('первая система первой галактики: Tibedied', () => {
  assert.equal(galaxy1[0].name, 'TIBEDIED');
});

test('Lave существует в галактике 1 и имеет известные координаты (20, 173)', () => {
  const lave = byName('LAVE');
  assert.equal(lave.x, 20);
  assert.equal(lave.y, 173);
});

test('известные системы первой галактики существуют', () => {
  for (const name of ['LAVE', 'DISO', 'LEESTI', 'TIBEDIED']) byName(name);
});

test('8 галактик строятся без ошибок и различаются', () => {
  const firsts = new Set<string>();
  for (let g = 1; g <= 8; g++) {
    const systems = buildGalaxy(g);
    assert.equal(systems.length, GALAXY_SIZE);
    firsts.add(systems[0].name);
  }
  assert.equal(firsts.size, 8);
});

test('зерно галактики 9 (ещё одно скручивание) совпадает с зерном галактики 1', () => {
  // Байты вращаются на 1 бит за переход, период 8
  const first = galaxySeed(1);
  const { w0, w1, w2 } = galaxySeed(8);
  const rot = (x: number) => ((x & 0x80) !== 0 ? 2 * (x & 0x7f) + 1 : 2 * x);
  const tw = (x: number) => ((256 * rot(x >> 8) + rot(x & 255)) & 0xffff);
  assert.deepEqual({ w0: tw(w0), w1: tw(w1), w2: tw(w2) }, first);
});

test('расстояние: Lave - Diso плюс неравенство треугольника', () => {
  const lave = byName('LAVE');
  const diso = byName('DISO');
  const leesti = byName('LEESTI');
  assert.equal(distance(lave, lave), 0);
  assert.equal(distance(lave, diso), distance(diso, lave));
  assert.ok(distance(lave, leesti) <= distance(lave, diso) + distance(diso, leesti) + 2);
});

test('рынок: 17 товаров, предметы пришельцев всегда в количестве 0', () => {
  const lave = byName('LAVE');
  for (const fluct of [0, 1, 77, 255]) {
    const market = generateMarket(lave, fluct);
    assert.equal(market.length, COMMODITIES.length);
    assert.equal(market[ALIEN_ITEMS_INDEX].quantity, 0);
    for (const m of market) {
      assert.ok(m.quantity >= 0 && m.quantity <= 63);
      assert.ok(m.price >= 0 && m.price <= 1020);
    }
  }
});

test('рынок: детерминирован и зависит от колебания', () => {
  const lave = byName('LAVE');
  assert.deepEqual(generateMarket(lave, 42), generateMarket(lave, 42));
  assert.notDeepEqual(generateMarket(lave, 0), generateMarket(lave, 255));
});
