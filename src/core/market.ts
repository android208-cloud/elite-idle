/**
 * Рынок оригинальной Elite: 17 товаров, цена и количество зависят от экономики
 * системы и случайного байта «колебания», который выбирается при прибытии.
 * Цены хранятся в десятых долях кредита, как в оригинале.
 */

import type { StarSystem } from './galaxy.ts';

export interface Commodity {
  name: string;
  basePrice: number;
  /** Влияние экономики системы на цену и количество */
  gradient: number;
  baseQuantity: number;
  /** Маска случайного колебания */
  mask: number;
  /** 0 = тонны, 1 = килограммы, 2 = граммы */
  unit: 0 | 1 | 2;
}

export const COMMODITIES: readonly Commodity[] = [
  { name: 'Еда', basePrice: 0x13, gradient: -0x02, baseQuantity: 0x06, mask: 0x01, unit: 0 },
  { name: 'Текстиль', basePrice: 0x14, gradient: -0x01, baseQuantity: 0x0a, mask: 0x03, unit: 0 },
  { name: 'Радиоактивные материалы', basePrice: 0x41, gradient: -0x03, baseQuantity: 0x02, mask: 0x07, unit: 0 },
  { name: 'Рабы / роботы-рабы', basePrice: 0x28, gradient: -0x05, baseQuantity: 0xe2, mask: 0x1f, unit: 0 },
  { name: 'Спиртное и вина', basePrice: 0x53, gradient: -0x05, baseQuantity: 0xfb, mask: 0x0f, unit: 0 },
  { name: 'Предметы роскоши', basePrice: 0xc4, gradient: 0x08, baseQuantity: 0x36, mask: 0x03, unit: 0 },
  { name: 'Наркотики', basePrice: 0xeb, gradient: 0x1d, baseQuantity: 0x08, mask: 0x78, unit: 0 },
  { name: 'Компьютеры', basePrice: 0x9a, gradient: 0x0e, baseQuantity: 0x38, mask: 0x03, unit: 0 },
  { name: 'Оборудование', basePrice: 0x75, gradient: 0x06, baseQuantity: 0x28, mask: 0x07, unit: 0 },
  { name: 'Сплавы', basePrice: 0x4e, gradient: 0x01, baseQuantity: 0x11, mask: 0x1f, unit: 0 },
  { name: 'Оружие', basePrice: 0x7c, gradient: 0x0d, baseQuantity: 0x1d, mask: 0x07, unit: 0 },
  { name: 'Меха', basePrice: 0xb0, gradient: -0x09, baseQuantity: 0xdc, mask: 0x3f, unit: 0 },
  { name: 'Минералы', basePrice: 0x20, gradient: -0x01, baseQuantity: 0x35, mask: 0x03, unit: 0 },
  { name: 'Золото', basePrice: 0x61, gradient: -0x01, baseQuantity: 0x42, mask: 0x07, unit: 1 },
  { name: 'Платина', basePrice: 0xab, gradient: -0x02, baseQuantity: 0x37, mask: 0x1f, unit: 1 },
  { name: 'Драгоценные камни', basePrice: 0x2d, gradient: -0x01, baseQuantity: 0xfa, mask: 0x0f, unit: 2 },
  { name: 'Предметы пришельцев', basePrice: 0x35, gradient: 0x0f, baseQuantity: 0xc0, mask: 0x07, unit: 0 },
] as const;

export const ALIEN_ITEMS_INDEX = 16;

/**
 * Последний индекс «тоннажного» товара (по `tnpr`). Товары 0–12 считаются
 * по вместимости трюма, а 13–16 (золото, платина, камни, артефакты) имеют
 * собственный лимит. Внимание: единица измерения для показа и ветка лимита
 * в оригинале — РАЗНЫЕ вещи. «Предметы пришельцев» печатаются в тоннах
 * (`ITEM 53, 15, 't', ...`), но в `tnpr` всё равно попадают в ветку лимита.
 */
export const TONNE_MAX_INDEX = 12;

/** Предел на каждый вид товара из ветки `kg` — `CMP #200` в `tnpr`. */
export const INDIVIDUAL_ITEM_LIMIT = 200;

/**
 * Ветка лимита `tnpr`: индексы 0–12 ограничены трюмом, 13–16 — по 200 штук.
 *
 * Определяется именно ИНДЕКСОМ, а не единицей измерения: у «Предметов
 * пришельцев» единица — тонны, но лимит всё равно 200.
 */
export const isTonneCargo = (index: number): boolean => index <= TONNE_MAX_INDEX;

export interface MarketEntry {
  /** Цена за единицу в десятых долях кредита */
  price: number;
  /** Доступное количество, 0..63 */
  quantity: number;
}

/**
 * Рынок системы при заданном колебании fluct (байт 0..255).
 * Предметы пришельцев никогда не продаются на рынке.
 */
export function generateMarket(system: StarSystem, fluct: number): MarketEntry[] {
  const fl = fluct & 0xff;
  return COMMODITIES.map((c, i) => {
    const product = system.economy * c.gradient;
    const changing = fl & c.mask;

    let q = (c.baseQuantity + changing - product) & 0xff;
    if ((q & 0x80) !== 0) q = 0;
    let quantity = q & 0x3f;

    q = (c.basePrice + changing + product) & 0xff;
    const price = q * 4;

    if (i === ALIEN_ITEMS_INDEX) quantity = 0;
    return { price, quantity };
  });
}

