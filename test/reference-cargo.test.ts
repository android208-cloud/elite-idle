/**
 * Эталонный тест вместимости трюма — подпрограмма `tnpr`.
 *
 * Источник: elite-source.asm, подпрограмма `tnpr` (строки 17409–17512).
 *
 *   .tnpr
 *    PHA                  \\ сохранить A
 *    LDX #12
 *    CPX QQ29             \\ если QQ29 > 12 → ветка kg
 *    BCC kg
 *
 *   .Tml                  \\ ветка тоннажных товаров (индексы 0–12)
 *    ADC QQ20,X           \\ A = A + количество товара X в трюме
 *    DEX
 *    BPL Tml              \\ сложить все 13 позиций, начиная с 12
 *    CMP CRGO             \\ A < CRGO → место есть
 *    PLA
 *    RTS
 *
 *   .kg                  \\ ветка индивидуального лимита (индексы 13–16)
 *    LDY QQ29
 *    ADC QQ20,Y           \\ A = A + количество этого товара в трюме
 *    CMP #200             \\ больше 200 → места нет
 *    PLA
 *    RTS
 *
 * Комментарий Моксона к `tnpr`:
 *   «For standard tonne canisters, the limit is given by the type of cargo
 *    hold we have, with a standard cargo hold having a capacity of 20t and an
 *    extended cargo bay being 35t.
 *    For items measured in kg (gold, platinum), g (gem-stones) and alien
 *    items, the individual limit on each of these is 200 units.»
 *
 * Обратите внимание: ветка лимита определяется ИНДЕКСОМ (QQ29 > 12), а не
 * единицей измерения. «Предметы пришельцев» печатаются в тоннах
 * (`ITEM 53, 15, 't', 192` в QQ23), но в `tnpr` попадают в ветку лимита 200.
 *
 * Про CRGO: он хранит ёмкость + 2 (см. `EQUB 22 + (15 AND Q%)`), потому что
 * `tnpr` сравнивает `a+1 < c+2`, что эквивалентно `a <= c`. Отсюда 22 → 20 т
 * и 37 → 35 т.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buy, cargoRoom, cargoTons, newGame, sell, type GameState } from '../src/core/state.ts';
import {
  ALIEN_ITEMS_INDEX,
  COMMODITIES,
  INDIVIDUAL_ITEM_LIMIT,
  isTonneCargo,
  TONNE_MAX_INDEX,
} from '../src/core/market.ts';
import { HOLD_BASE, HOLD_EXTENDED, holdCapacity } from '../src/core/ships.ts';

/** Товар с гарантированно большим запасом на рынке и дешёвой ценой. */
function withMarket(state: GameState, index: number, quantity = 1000, price = 1): GameState {
  return {
    ...state,
    cash: 10_000_000,
    market: state.market.map((m, i) => (i === index ? { price, quantity } : m)),
  };
}

describe('tnpr: граница веток', () => {
  it('индексы 0–12 идут по тоннажу, 13–16 — по индивидуальному лимиту', () => {
    assert.equal(TONNE_MAX_INDEX, 12);
    for (let i = 0; i <= TONNE_MAX_INDEX; i++) assert.equal(isTonneCargo(i), true, `индекс ${i}`);
    for (let i = TONNE_MAX_INDEX + 1; i < COMMODITIES.length; i++) {
      assert.equal(isTonneCargo(i), false, `индекс ${i}`);
    }
  });

  it('«Предметы пришельцев» печатаются в тоннах, но лимит у них — 200', () => {
    // QQ23: ITEM 53, 15, 't', 192 → единица «тонны»
    assert.equal(COMMODITIES[ALIEN_ITEMS_INDEX].unit, 0);
    // …но tnpr относит их к ветке kg, потому что индекс 16 > 12
    assert.equal(isTonneCargo(ALIEN_ITEMS_INDEX), false);
    assert.equal(INDIVIDUAL_ITEM_LIMIT, 200);
  });
});

describe('tnpr: ветка тоннажных товаров', () => {
  it('еда ограничена свободным местом трюма, а не количеством на рынке', () => {
    const g = withMarket(newGame(1), 0, 1000, 1);
    assert.equal(buy(g, 0, 1000).amount, HOLD_BASE);
  });

  it('расширенный трюм поднимает планку до 35 т', () => {
    // Согласованное состояние: ёмкость 35 и свободно все 35
    const base = newGame(1);
    const g = withMarket(
      { ...base, ship: { ...base.ship, cargoBayExtended: true }, holdSpace: HOLD_EXTENDED },
      0,
      1000,
      1,
    );
    assert.equal(holdCapacity(g.ship), HOLD_EXTENDED);
    assert.equal(buy(g, 0, 1000).amount, HOLD_EXTENDED);
  });

  it('занятое место уменьшает доступное', () => {
    const g = withMarket({ ...newGame(1), holdSpace: 15, cargo: newGame(1).cargo.map((_, i) => (i === 0 ? 5 : 0)) }, 1);
    assert.equal(buy(g, 1, 1000).amount, 15);
  });
});

describe('tnpr: ветка индивидуального лимита (200)', () => {
  it('золото, платина, камни и артефакты не ограничены тоннажем', () => {
    for (const i of [13, 14, 15, 16]) {
      const g = withMarket(newGame(1), i, 1000, 1);
      const bought = buy(g, i, 1000);
      assert.equal(bought.amount, INDIVIDUAL_ITEM_LIMIT, `индекс ${i}`);
      // Тоннаж не тронут: эти товары не занимают место в трюме по tnpr
      assert.equal(bought.state.holdSpace, HOLD_BASE, `индекс ${i}: место в трюме`);
      assert.equal(cargoTons(bought.state), 0, `индекс ${i}: тоннаж`);
    }
  });

  it('200 — предел на каждый вид отдельно, а не на все вместе', () => {
    let g = withMarket(newGame(1), 13, 1000, 1);
    g = buy(g, 13, 200).state;
    assert.equal(g.cargo[13], 200);
    // Второй вид не упирается в лимит первого
    g = withMarket(g, 14);
    assert.equal(cargoRoom(g, 14), INDIVIDUAL_ITEM_LIMIT);
    g = buy(g, 14, 200).state;
    assert.equal(g.cargo[14], 200);
  });

  it('докупка сверх 200 не проходит', () => {
    let g = withMarket(newGame(1), 13, 1000, 1);
    g = buy(g, 13, 150).state;
    assert.equal(cargoRoom(g, 13), 50);
    assert.equal(buy(g, 13, 100).amount, 50);
    g = buy(g, 13, 100).state;
    assert.equal(g.cargo[13], 200);
    assert.equal(buy(g, 13, 1).amount, 0);
  });

  it('продажа освобождает лимит', () => {
    let g = withMarket(newGame(1), 13, 1000, 1);
    g = buy(g, 13, 200).state;
    g = sell(g, 13, 50).state;
    assert.equal(g.cargo[13], 150);
    assert.equal(cargoRoom(g, 13), 50);
  });
});

describe('tnpr: тоннаж не путается с единицей измерения', () => {
  it('артефакты в тоннах, но места в трюме не занимают и тоннаж не меняют', () => {
    let g = withMarket(newGame(1), ALIEN_ITEMS_INDEX, 1000, 1);
    g = buy(g, ALIEN_ITEMS_INDEX, 50).state;
    assert.equal(g.cargo[ALIEN_ITEMS_INDEX], 50);
    assert.equal(g.holdSpace, HOLD_BASE);
    assert.equal(cargoTons(g), 0);
    // …но лимит на них действует
    assert.equal(buy(g, ALIEN_ITEMS_INDEX, 200).amount, 150);
  });

  it('смешанный трюм: тоннажные считаются по месту, остальные — по 200', () => {
    let g = withMarket(newGame(1), 0, 1000, 1);
    g = buy(g, 0, 10).state; // 10 т еды
    assert.equal(cargoTons(g), 10);
    assert.equal(g.holdSpace, 10);
    g = withMarket(g, 13);
    g = buy(g, 13, 200).state; // 200 унций золота
    assert.equal(cargoTons(g), 10, 'золото не добавляет тонн');
    assert.equal(g.holdSpace, 10);
    // Еды влезет ещё ровно 10 т
    assert.equal(cargoRoom(g, 0), 10);
  });
});
