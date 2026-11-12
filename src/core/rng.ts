/** Детерминированный генератор случайных чисел (mulberry32), чистые функции. */

/** Возвращает 32-битное число и новое состояние генератора. */
export function nextUint32(rng: number): [value: number, next: number] {
  let t = (rng + 0x6d2b79f5) >>> 0;
  const next = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = (t ^ (t >>> 14)) >>> 0;
  return [value, next];
}

export function nextByte(rng: number): [byte: number, next: number] {
  const [v, next] = nextUint32(rng);
  return [v & 0xff, next];
}

/** Число в диапазоне [0, 1). */
export function nextFloat(rng: number): [value: number, next: number] {
  const [v, next] = nextUint32(rng);
  return [v / 4294967296, next];
}

