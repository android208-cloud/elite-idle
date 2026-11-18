/**
 * Грузовые контейнеры после боя.
 *
 * Оригинал (BBC Elite, `elite-ships-*.asm`): у каждого блюпринта первый байт
 * `$00` — два ниббла. Младший — сколько контейнеров корабль выбрасывает при
 * уничтожении, старший — какой товар внутри. Полная таблица и разбор:
 * `docs/cargo-canisters.md`.
 *
 * Отступления от оригинала (каждое — сознательное):
 *
 *  1. **Товар берётся из ассортимента системы**, а не случайный 0–7.
 *     В оригинале старший ниббл почти везде нулевой, и товар — лотерея
 *     из «еды и компьютеров». Пользователь выбрал привязку к системе:
 *     контейнеры становятся мини-рынком, а не рулеткой, и подбор связан
 *     с торговлей, ради которой игра и делается.
 *  2. **Подбор — решение игрока, а не автодействие.** В оригинале
 *     контейнер подбирается касанием в полёте. У нас полётов нет,
 *     поэтому после победы появляется список контейнеров и выбор.
 *  3. **Автоподбор в настройках.** Если игрок не хочет решать каждый раз,
 *     контейнеры подбираются сами — ровно как в оригинале, где выбора
 *     не было вовсе.
 */

import { COMMODITIES, isTonneCargo } from './market.ts';
import { enemyById, type EnemyType } from './ships.ts';
import { nextFloat } from './rng.ts';

/**
 * Индексы товаров, которые могут лежать в контейнере, — «дешёвая» половина
 * таблицы (Food..Computers, 0–7), как в оригинале при нулевом старшем ниббле.
 *
 * Почему не все 17: золото, платина, камни и предметы пришельцев в оригинале
 * в контейнерах не попадаются — они scooped только с особых объектов
 * (обломки, таргоны). Расширять список значило бы обесценить эти товары.
 */
export const CANISTER_COMMODITIES: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7];

/** Один контейнер в космосе после боя. */
export interface CargoCanister {
  /** Индекс товара в COMMODITIES */
  commodity: number;
  /** Сколько единиц товара внутри (1 для тоннажных — контейнер = 1 т) */
  amount: number;
}

/**
 * Сколько контейнеров выпадает из конкретного корабля в конкретной роли.
 *
 * Роль важна: по оригиналу гружёный торговец-Питон роняет пять контейнеров,
 * а пиратский — два. В нашей игре роль известна на момент боя.
 */
export function canisterCount(enemyId: string, role: 'trader' | 'pirate' | 'police' | 'hunter'): number {
  const enemy: EnemyType = enemyById(enemyId);
  // Полиция и охотники за головами в оригинале отдельными блюпринтами не
  // выделены: полиция летает на Viper (0 контейнеров), охотники — на
  // произвольных кораблях. Считаем их по «военной» ветке, то есть по
  // пиратской: охотник снаряжён, но не торгует.
  const branch = role === 'trader' ? 'trader' : 'pirate';
  return enemy.canisters[branch];
}

/**
 * Какие товары вообще можно купить или продать в данной системе.
 *
 * В оригинале товар в контейнере не зависит от системы. У нас зависит:
 * берём те товары из списка контейнерных, которые система производит
 * или хотя бы продаёт (quantity > 0). Если таких не нашлось (бедная
 * система с нулями по всем позициям), откатываемся на весь список —
 * пустой контейнер был бы издевательством.
 */
export function systemCommodities(
  market: readonly { quantity: number }[],
  allowed: readonly number[] = CANISTER_COMMODITIES,
): number[] {
  const present = allowed.filter((i) => (market[i]?.quantity ?? 0) > 0);
  return present.length > 0 ? present : [...allowed];
}

/**
 * Раскладывает выпавшие контейнеры по товарам системы.
 *
 * Товар для каждого контейнера тянется из `systemCommodities` — так в
 * контейнере оказывается то, что в этой системе действительно ходовой
 * товар. Несколько контейнеров могут содержать один и тот же товар: в
 * оригинале так и было, каждая канистра разыгрывалась отдельно.
 *
 * Функция чистая: генератор передаётся состоянием и возвращается.
 */
export function rollCanisters(
  count: number,
  market: readonly { quantity: number }[],
  rng: number,
): { canisters: CargoCanister[]; rng: number } {
  const pool = systemCommodities(market);
  const canisters: CargoCanister[] = [];
  let r = rng;
  for (let i = 0; i < count; i++) {
    const [v, next] = nextFloat(r);
    r = next;
    const commodity = pool[Math.min(pool.length - 1, Math.floor(v * pool.length))];
    // Тоннажный товар — ровно одна тонна: контейнер и есть тонна.
    // Нетоннажный (золото, камни) в контейнерах нам не встречается,
    // но на всякий случай кладём 1 единицу.
    canisters.push({ commodity, amount: 1 });
  }
  return { canisters, rng: r };
}

/**
 * Товары, из-за которых трюм становится криминальным.
 *
 * Индексы те же, что в `contrabandLevel`: рабы (3), наркотики (6),
 * оружие (10). Держим их здесь, а не в `state.ts`, потому что фильтр
 * нужен именно подбору — рядом с остальными правилами контейнеров.
 */
export const CONTRABAND_INDEXES: readonly number[] = [3, 6, 10];

/** Делает ли этот товар игрока преступником, если он в трюме. */
export const isContraband = (commodity: number): boolean => CONTRABAND_INDEXES.includes(commodity);

/**
 * Автоподбор: забирает всё, что влезает в трюм, остальное бросает.
 *
 * §93: ЗАПРЕЩЁНКУ АВТОМАТ НЕ БЕРЁТ.
 *
 * Пользователь заметил ловушку: в патруле груз подбирается сам, без
 * участия игрока. Если среди обломков лежат рабы или наркотики, они
 * молча падают в трюм — и это уже преступление, которого игрок не
 * выбирал. Хуже того, контрабанда в трюме запрещает побег от статуса
 * (§80.1), то есть автоматика отнимала возможность бежать.
 *
 * Правило, которое из этого выведено: **автоматика не делает игрока
 * преступником**. Запрещённый товар остаётся в космосе, а в журнал
 * попадает причина — иначе решение выглядело бы потерей груза.
 *
 * Фильтр живёт здесь, а не в вызывающем коде, чтобы правило нельзя было
 * забыть применить в одном из двух мест (обычный бой и патруль).
 *
 * Ручной подбор (`scoopOne`) НЕ фильтруется: там решает игрок, и статус
 * за груз растёт честно.
 */
export function autoScoop(
  cargo: readonly number[],
  holdSpace: number,
  canisters: readonly CargoCanister[],
): { cargo: number[]; holdSpace: number; taken: number; left: number } {
  const next = cargo.slice();
  let space = holdSpace;
  let taken = 0;
  let left = 0;
  for (const c of canisters) {
    // Запрещёнку автоматика не трогает вовсе: она не «не поместилась»,
    // она осталась по другой причине, и путать эти две причины нельзя —
    // игрок увидит разное объяснение.
    if (isContraband(c.commodity)) continue;
    const tonne = isTonneCargo(c.commodity);
    if (tonne && space < c.amount) {
      left += 1;
      continue;
    }
    next[c.commodity] += c.amount;
    if (tonne) space -= c.amount;
    taken += 1;
  }
  return { cargo: next, holdSpace: space, taken, left };
}

/**
 * Подбор ВСЕГО, что влезает, без фильтра запрещёнки.
 *
 * В отличие от `autoScoop` вызывается только по явному решению игрока
 * (кнопка «Взять всё» на экране обломков). Автоматика такого не делает
 * — см. `autoScoop`.
 */
export function scoopAll(
  cargo: readonly number[],
  holdSpace: number,
  canisters: readonly CargoCanister[],
): { cargo: number[]; holdSpace: number; taken: number; left: number } {
  const next = cargo.slice();
  let space = holdSpace;
  let taken = 0;
  let left = 0;
  for (const c of canisters) {
    const tonne = isTonneCargo(c.commodity);
    if (tonne && space < c.amount) {
      left += 1;
      continue;
    }
    next[c.commodity] += c.amount;
    if (tonne) space -= c.amount;
    taken += 1;
  }
  return { cargo: next, holdSpace: space, taken, left };
}

/**
 * Сколько запрещённых контейнеров среди обломков — для честного текста в
 * журнале.
 *
 * Отдельная функция, а не подсчёт на месте: одна и та же цифра нужна и
 * обычному бою, и патрулю, и она не должна разъезжаться.
 */
export function countContraband(canisters: readonly CargoCanister[]): number {
  return canisters.filter((c) => isContraband(c.commodity)).length;
}

/**
 * Подбор одного контейнера из списка.
 *
 * Возвращает `null`, если места нет, — вызывающая сторона покажет причину.
 * Список контейнеров при этом не меняется: убирает выбранный вызывающая
 * сторона, чтобы у неё была возможность показать «взято».
 */
export function scoopOne(
  cargo: readonly number[],
  holdSpace: number,
  canister: CargoCanister,
): { cargo: number[]; holdSpace: number } | null {
  const tonne = isTonneCargo(canister.commodity);
  if (tonne && holdSpace < canister.amount) return null;
  const next = cargo.slice();
  next[canister.commodity] += canister.amount;
  return { cargo: next, holdSpace: tonne ? holdSpace - canister.amount : holdSpace };
}

/** Название товара в контейнере — для показа игроку. */
export const canisterName = (c: CargoCanister): string => COMMODITIES[c.commodity].name;
