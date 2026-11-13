/**
 * Таблицы спавна из оригинала (main_game_loop_part_4_of_6.asm).
 *
 * 1) Группа пиратов (mt1): корабль выбирается как
 *        A = DORND;  T = DORND;  A = (A AND T) AND #7;  ship = A + PACK
 *    где PACK = SH3 = 17, то есть диапазон 17..24 в таблице XX21:
 *    Sidewinder, Mamba, Krait, Adder, Gecko, Cobra Mk I, Worm, Cobra Mk III.
 *    Два байта объединяются через AND, поэтому распределение сильно скошено:
 *    42% / 14% / 14% / 4.7% / 14% / 4.7% / 4.7% / 1.6%.
 *
 * 2) Одинокий охотник: AND #3 / ADC #CYL2, где CYL2 = 24, то есть 24..27 —
 *    Cobra Mk III (пират), Asp Mk II, Python (пират), Fer-de-lance.
 *    Moray в таблице XX21 стоит на 28 и потому никогда не выбирался.
 *
 * Обе таблицы хранят НОМЕРА чертежей XX21, а не индексы массива.
 */

import { ENEMIES } from './ships.ts';

/** XX21: 17..24 — пираты из группы (PACK = SH3 = 17). */
export const PIRATE_BLUEPRINTS: readonly number[] = [17, 18, 19, 20, 21, 22, 23, 24];

/** XX21: 24..28 — одинокие охотники с исправлением Моксона (LSR A). */
export const LONE_HUNTER_BLUEPRINTS: readonly number[] = [24, 25, 26, 27, 28];

/** Идентификаторы кораблей по номерам чертежей XX21 (нужные диапазоны). */
const BLUEPRINT_TO_ID: Record<number, string> = {
  17: 'sidewinder',
  18: 'mamba',
  19: 'krait',
  20: 'adder',
  21: 'gecko',
  22: 'cobra1',
  23: 'worm',
  24: 'cobra3',
  25: 'asp',
  26: 'python',
  27: 'ferdelance',
  28: 'moray',
};

/**
 * Исправление Моксона для одиноких охотников.
 *
 * В оригинале: AND #3 / ADC #CYL2  (24..27, Moray на 28 недостижим).
 * Предложено:  LSR A / AND #3 / ADC #CYL2.
 *
 * `LSR A` не только делит число на два, но и кладёт младший бит в флаг
 * переноса; `AND #3` флаг не меняет, а `ADC` прибавляет перенос. Поэтому
 * реальное распределение не равномерное, а 1:2:2:2:1, то есть Moray
 * появляется в 12.5% случаев (а Cobra Mk III — тоже 12.5%).
 *
 * @param roll случайный байт 0..255
 * @returns номер чертежа XX21 в диапазоне 24..28
 */
export function moxonLoneHunter(roll: number): number {
  const byte = roll & 0xff;
  const carry = byte & 1;                     // LSR A: младший бит уходит в C
  const index = ((byte >> 1) & 3) + carry;    // AND #3, затем ADC добавляет C
  return LONE_HUNTER_BLUEPRINTS[index];
}

/**
 * Выбор корабля-пирата из группы по правилу оригинала:
 * `(A AND T) AND #7` даёт индекс, к нему прибавляется PACK.
 *
 * Worm (23) в этому проекте отсутствует как противник, поэтому при его
 * выпадении берётся Sidewinder — это единственное сознательное отступление,
 * и оно отмечено в session_log.
 *
 * @param a первый случайный байт
 * @param t второй случайный байт (маска)
 */
export function pirateFromGroup(a: number, t: number): string {
  const index = (a & 0xff) & (t & 0xff) & 7;
  const id = BLUEPRINT_TO_ID[PIRATE_BLUEPRINTS[index]];
  return ENEMIES.some((e) => e.id === id) ? id : 'sidewinder';
}

/** Выбор одинокого охотника за головами по исправлению Моксона. */
export function loneHunter(roll: number): string {
  return BLUEPRINT_TO_ID[moxonLoneHunter(roll)];
}
