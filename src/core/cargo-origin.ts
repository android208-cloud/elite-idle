/**
 * §98: откуда в трюме запрещённый товар.
 *
 * Пользователь: «В журнале нет записей о происхождении запрещёнки».
 *
 * Проблема была не в отсутствии записей, а в их содержании. Игра писала
 *
 *   «Контрабанда в трюме: правовой статус 32 → 64 (Нарушитель)»
 *
 * — то есть «что стало», но не «из-за чего». В трюме к этому моменту могли
 * лежать рабы, наркотики и оружие сразу, а куплены они могли быть на трёх
 * разных станциях. Понять, за что вырос статус и что выбрасывать, было
 * нельзя.
 *
 * Здесь хранится манифест: по каждому запрещённому товару — сколько и
 * откуда. Три пути, и все три есть в игре:
 *
 *   bought   — куплено на рынке (buy, у причала);
 *   salvage  — подобрано из обломков после боя (salvageTake / salvageTakeAll);
 *   drifting — дрейфующий контейнер в полёте (Flight, влёт).
 *
 * Дрейфующий путь в §97 закрыт для запрещёнки, но манифест про него всё
 * равно знает: если правило когда-нибудь изменится, запись обязана быть.
 *
 * Манифест — это НЕ правда о трюме, а справка о происхождении. Если игрок
 * выбросил груз, манифест уменьшается (см. `forgetCargo`), но расчёт статуса
 * от него не зависит: статус считается по `cargo`, как и раньше. Так
 * единственный источник правды о количестве остаётся один.
 */
import { COMMODITIES } from './market.ts';
import { isContraband } from './cargo-canisters.ts';

/** Пути, которыми запрещённый товар попадает в трюм. */
export type CargoPath = 'bought' | 'salvage' | 'drifting';

export const CARGO_PATH_NAMES: Record<CargoPath, string> = {
  bought: 'куплено на рынке',
  salvage: 'из обломков',
  drifting: 'дрейфующий контейнер',
};

/** Сколько единиц товара пришло каким путём. */
export interface CargoOrigin {
  commodity: number;
  amount: number;
  added: number;
  byPath: Record<CargoPath, number>;
}

/** Манифест: только запрещённые товары, только ненулевые количества. */
export type CargoManifest = CargoOrigin[];

/** Пустой манифест — так выглядит чистая новая игра. */
export const EMPTY_MANIFEST: CargoManifest = [];

/**
 * Записать поступление товара.
 *
 * Возвращает НОВЫЙ манифест: состояние игры неизменяемо, как и всё
 * остальное в `state.ts`. Не запрещённый товар не записывается вовсе —
 * иначе манифест распух бы до семнадцати позиций ради трёх нужных.
 */
export function noteCargo(manifest: CargoManifest, commodity: number, amount: number, path: CargoPath): CargoManifest {
  if (amount <= 0 || !isContraband(commodity)) return manifest;
  const next = manifest.map((e) => ({ ...e, byPath: { ...e.byPath } }));
  const found = next.find((e) => e.commodity === commodity);
  if (found) {
    found.amount += amount;
    found.added += amount;
    found.byPath[path] += amount;
  } else {
    next.push({
      commodity,
      amount,
      added: amount,
      byPath: { bought: 0, salvage: 0, drifting: 0, [path]: amount } as Record<CargoPath, number>,
    });
  }
  return next;
}

/**
 * Забыть товар, которого больше нет в трюме.
 *
 * Нужен после выброса и продажи: иначе журнал рассказывал бы о грузе,
 * которого нет. `added` не трогаем — это история, а не остаток.
 */
export function forgetCargo(manifest: CargoManifest, commodity: number): CargoManifest {
  return manifest.filter((e) => e.commodity !== commodity || e.amount > 0);
}

/**
 * Привести манифест в согласие с трюмом после произвольного действия.
 *
 * Вызывается там, где меняется трюм (продажа, выброс, потеря корабля,
 * подбор), и делает две вещи: убирает позиции, которых в трюме не осталось,
 * и срезает количество до фактического.
 *
 * Это не «второй источник правды», а страховка: если где-то поступление
 * забыли записать, манифест не начнёт врать про количество. Потери
 * (выброс, продажа) при этом не выдумываются — они просто исчезают.
 */
export function reconcile(manifest: CargoManifest, cargo: readonly number[]): CargoManifest {
  return manifest
    .map((e) => ({ ...e, amount: Math.min(e.amount, cargo[e.commodity] ?? 0) }))
    .filter((e) => e.amount > 0);
}

/**
 * Записать поступление сразу из двух источников, если они есть.
 *
 * Короткая обёртка для UI: там поступление — это разница «было/стало»,
 * и путь известен по месту нажатия.
 */
export function noteFrom(manifest: CargoManifest, cargoBefore: readonly number[], cargoAfter: readonly number[], path: CargoPath): CargoManifest {
  let next = manifest;
  for (let i = 0; i < cargoAfter.length; i++) {
    const delta = (cargoAfter[i] ?? 0) - (cargoBefore[i] ?? 0);
    if (delta > 0) next = noteCargo(next, i, delta, path);
  }
  return next;
}

/**
 * Строка «что именно» — «Рабы (3 т), Оружие (1 т)».
 *
 * Без слова «контрабанда»: по правилу пользователя оно в интерфейсе не
 * появляется — только цвет и названия товаров.
 */
export function contrabandGoods(cargo: readonly number[]): string {
  return COMMODITIES.map((c, i) => (isContraband(i) && (cargo[i] ?? 0) > 0 ? `${c.name} (${cargo[i]} ${c.unit === 0 ? 'т' : c.unit === 1 ? 'кг' : 'г'})` : ''))
    .filter(Boolean)
    .join(', ');
}

/** Строка «что и откуда» — для журнала. Пустой манифест даёт пустую строку. */
export function handoverLine(entries: readonly CargoOrigin[]): string {
  const parts = entries
    .filter((e) => e.amount > 0)
    .map((e) => {
      const name = COMMODITIES[e.commodity].name;
      const paths = (Object.keys(e.byPath) as CargoPath[])
        .filter((p) => e.byPath[p] > 0)
        .map((p) => CARGO_PATH_NAMES[p]);
      const uniq = [...new Set(paths)];
      return `${name} (${e.amount} т) — ${uniq.join(', ')}`;
    });
  return parts.join('; ');
}

/**
 * Цена вопроса: сколько стоит вся запрещёнка в трюме по рынку этой системы.
 *
 * Нужна, чтобы игрок понимал масштаб, прежде чем выбрасывать: «Денег в трюме:
 * 928.0 CR» — это про то, что теряется. Считается по текущему рынку; если
 * товар здесь не продают, цена всё равно известна (`market[i].price`).
 */
export function contrabandValue(cargo: readonly number[], market: readonly { price: number }[]): number {
  let sum = 0;
  for (let i = 0; i < cargo.length; i++) {
    if (isContraband(i) && (cargo[i] ?? 0) > 0) sum += (cargo[i] ?? 0) * (market[i]?.price ?? 0);
  }
  return sum;
}

/**
 * §98.1: сколько запрещёнки ЗАБЫЛИ записать.
 *
 * Манифест заводится на новых путях (§98), но трюм мог быть набран раньше —
 * сохранением до §98, покупкой в другой версии игры, подбором на пути,
 * который ещё не обёрнут. Тогда груз есть, а происхождения нет, и журнал
 * говорит только «в трюме запрещённое», без товара и пути.
 *
 * Это не повод молчать и не повод выдумывать путь. Считаем разницу между
 * трюмом и манифестом и говорим честно: «происхождение неизвестно».
 */
export function untrackedContraband(manifest: CargoManifest, cargo: readonly number[]): number {
  let missing = 0;
  for (let i = 0; i < cargo.length; i++) {
    const have = cargo[i] ?? 0;
    if (!isContraband(i) || have <= 0) continue;
    const tracked = manifest.find((e) => e.commodity === i)?.amount ?? 0;
    missing += Math.max(0, have - tracked);
  }
  return missing;
}

/** Позиции манифеста с положительным остатком — «что лежит сейчас». */
export function cargoManifest(state: { cargo: number[]; cargoOrigin?: CargoManifest }): CargoManifest {
  return reconcile(state.cargoOrigin ?? EMPTY_MANIFEST, state.cargo);
}
