/**
 * Бой «одно решение» (§38.1, §39.1, §40).
 *
 * Отличие от `combat.ts`: там пошаговый бой с раундами и действиями.
 * Здесь решение принимается ОДИН раз и исход определяется сразу.
 *
 * Решения:
 *   attack — напасть. Доступно только на СЛАБЫЙ корабль (§39.1).
 *   flee   — бежать. Тратит спасательную капсулу (§37). Без капсулы
 *            решения нет (см. `availableDecisions`).
 *   skip   — пропустить. Всегда доступно.
 *
 * Смерти игрока в этом бою нет (решение §32/§38): «напасть» на слабого
 * = победа, «напасть» на сильного просто недоступно.
 *
 * Порог «слабый» (§39.1) выведен из модели урона `combat.ts`, а не выбран
 * на глаз: «слабый» — тот, кого игрок успевает убить раньше, чем убьют его,
 * имея ЛУЧШИЙ доступный лазер. Проверка зафиксирована тестом
 * `test/one-decision.test.ts`, вывод — в `SLOWEST_ENEMY`.
 */

import { LASER_POWER, LASER_RATE, MAX_ENERGY, MAX_SHIELDS } from './combat.ts';
import {
  enemyById,
  SHIPS,
  type EnemyType,
  type LaserType,
  type PlayerShip,
  type ShipId,
} from './ships.ts';
import { ALIEN_ITEMS_INDEX } from './market.ts';

/** Что игрок может сделать при встрече. */
export type Decision = 'attack' | 'flee' | 'skip';

/** Чем закончилось. */
export type DecisionOutcome =
  | 'won'          // напал и победил
  | 'fled'         // бежал на капсуле
  | 'skipped'      // пропустил
  | 'auto-victory' // не решил вовремя, слабый враждебный — победа
  | 'auto-skip';   // не решил вовремя, сильный или нейтральный — пропуск

/** Попадания игрока за раунд в модели `combat.ts`. */
const PLAYER_HIT = 0.65;
const BASE_SHOTS = LASER_RATE.pulse;

/** Сколько раундов нужно, чтобы убить врага данным лазером. */
export function roundsToKill(enemyEnergy: number, laser: LaserType): number {
  const shots = LASER_RATE[laser] / BASE_SHOTS;
  const perRound = LASER_POWER[laser] * shots * PLAYER_HIT;
  if (perRound <= 0) return Number.POSITIVE_INFINITY;
  return enemyEnergy / perRound;
}

/**
 * Сколько раундов игрок продержится под огнём врага.
 *
 * Та же регенерация, что в `combat.ts`: +2 щит, +1 энергия за раунд.
 * Учитываем, что щиты и энергия — один буфер (в idle они объединены).
 */
export function roundsToDie(enemyLaser: number): number {
  if (enemyLaser <= 0) return Number.POSITIVE_INFINITY;
  let shields = MAX_SHIELDS;
  let energy = MAX_ENERGY;
  let n = 0;
  while (energy > 0 && n < 500) {
    let dmg = enemyLaser;
    const toShield = Math.min(shields, dmg);
    shields -= toShield;
    dmg -= toShield;
    energy -= dmg;
    shields = Math.min(MAX_SHIELDS, shields + 2);
    energy = Math.min(MAX_ENERGY, energy + 1);
    n += 1;
  }
  return n;
}

/**
 * Какую долю запаса игрока сожжёт бой с этим врагом лучшим лазером.
 * 0.4 = сорок процентов щитов и энергии.
 */
export function damageShare(
  enemy: EnemyType,
  laser: LaserType,
  toughness: number = MAX_SHIELDS + MAX_ENERGY,
): number {
  const rounds = roundsToKill(enemy.energy, laser);
  if (!Number.isFinite(rounds)) return Number.POSITIVE_INFINITY;
  return (rounds * enemy.laser) / toughness;
}

/**
 * ПРОЧНОСТЬ КОРАБЛЯ ИГРОКА (§102).
 *
 * До §102 все летали на одной Кобре, и запас щита с энергией был общей
 * константой `MAX_SHIELDS + MAX_ENERGY` = 383. Теперь корабли разные, и
 * держать эту константу в знаменателе `damageShare` нельзя: он превращался
 * в фильтр «какой корабль можешь бить», хотя задумывался как «сколько боя
 * выдержишь».
 *
 * Прочность берём из Elite-A (`new_details`, поле Shields): у Кобры 7,
 * у Фер-де-Ланса 8, у Аспа 10, у Питона 11, у Анаконды 13. Масштабируем
 * относительно Кобры, чтобы числа §39.1 остались прежними: Кобра = 383.
 */
export function toughnessOf(ship: PlayerShip): number {
  const spec = SHIPS[ship.model];
  const base = SHIPS.cobra3.shields;
  return Math.round(((MAX_SHIELDS + MAX_ENERGY) * spec.shields) / base);
}

/**
 * Порог «слабый»: бой не должен сжигать больше 40 % запаса.
 *
 * Почему не «успею ли убить раньше, чем убьют меня». Такой критерий
 * слишком мягкий: с регенерацией игрок выживает даже против Python,
 * и «сильных» кораблей не остаётся вовсе. Порог по доле урона сохраняет
 * исходный замысел §39.1 — «напасть только на слабый корабль».
 *
 * Сверка с §39.1 (порог по лазерам): там «слабый» — Sidewinder, Krait,
 * Thargon при импульсном; Python и Thargoid — никогда. Здесь при
 * военном лазере проходят все, кроме Python и Anaconda. Расхождение
 * только в том, что §39.1 рассматривал импульсный как базовый; с ростом
 * лазера список законно расширяется. Совпадает главное: Python и
 * Anaconda не проходят НИКОГДА, при любом лазере.
 */
export const WEAK_DAMAGE_SHARE = 0.4;

/**
 * «Боссовый набор» — что нужно, чтобы справиться с Python и Анакондой (§78).
 *
 * Правило пользователя: победа над этими двумя возможна только с полным
 * боекомплектом — военный лазер, ECM, энергобомба и хотя бы одна ракета.
 * Проверяется наличием предметов, без симуляции раундов: в патруле игрок
 * не смотрит на экран, и разыгранный бой с шансом провала там неуместен.
 *
 * Ракета расходуется: кончились ракеты — большие снова пропускаются.
 */
export interface BossKit {
  militaryLaser: boolean;
  ecm: boolean;
  energyBomb: boolean;
  missiles: number;
}

/** Большие корабли, против которых нужен полный боекомплект. */
const BIG_SHIPS = new Set(['python', 'anaconda']);

/**
 * Нужна ли ракета, чтобы одолеть этого противника.
 *
 * Только для больших: на Sidewinder'e ракета бессмысленна, её и не
 * тратим. Именно поэтому в патруле ракеты считаются отдельно от топлива —
 * они уходят не на каждый бой, а на те, где без них не справиться.
 */
export function needsMissile(enemy: EnemyType): boolean {
  return BIG_SHIPS.has(enemy.id);
}

/**
 * Хватает ли снаряжения на Python или Анаконду — с учётом корабля (§102).
 *
 * До §102 набор был один на всех: военный лазер + ECM + бомба + ракета.
 * Он и был костылём: все летали на Кобре с одинаковыми 383 очками, и
 * Питона нельзя было взять иначе как «предметами».
 *
 * С §102 снаряжение требуется ступенями по классу корабля:
 *
 *   Кобра Mk III        — полный набор (как было, §78);
 *   Питон, Асп, ФдЛ     — военный лазер + ECM + ракета, бомба не нужна;
 *   Анаконда            — военный лазер + ракета.
 *
 * Почему не «ничего не надо» на Анаконде: прочность корпуса растёт всего в
 * 1.86 раза (13 щитов против 7), и без лазера с ракетой Питон всё равно
 * остаётся непобедимым в расчёте. Почему не «всё как на Кобре»: требовать
 * бомбу от корабля за 130 000 — наказывать за прогресс.
 */
export function hasBossKit(kit: BossKit, model: ShipId = 'cobra3'): boolean {
  const laser = kit.militaryLaser && kit.missiles > 0;
  switch (model) {
    case 'anaconda':
      return laser;
    case 'python':
    case 'asp':
    case 'ferdelance':
      return laser && kit.ecm;
    default:
      return laser && kit.ecm && kit.energyBomb;
  }
}

/**
 * Можно ли одолеть этого противника в патруле.
 *
 * Три ступени, по возрастанию требований:
 * - Python и Anaconda — только с полным набором;
 * - Asp Mk II, Cobra Mk III, Fer-de-Lance — только с военным лазером;
 * - все остальные — с любым лазером (импульсного достаточно).
 *
 * §79: в режиме пиратства в зачёт идут ЛЮБЫЕ встречные корабли, а не только
 * пираты. Поэтому `pirate` больше не обязательное условие — его проверяет
 * вызывающая сторона, которая знает режим.
 */
export function canBeat(
  enemy: EnemyType,
  kit: BossKit,
  bestLaser: LaserType,
  model: ShipId = 'cobra3',
): boolean {
  if (BIG_SHIPS.has(enemy.id)) return hasBossKit(kit, model);
  if (enemy.id === 'asp' || enemy.id === 'cobra3' || enemy.id === 'ferdelance') {
    return bestLaser === 'military';
  }
  return bestLaser !== 'none';
}

/**
 * Можно ли напасть на этот корабль в обычном патруле (§79).
 *
 * Обычный патруль бьёт только пиратов: торговец — не добыча, полиция — тем
 * более. Но грабёж разрешён отдельным решением: торговца можно атаковать,
 * зная, что это преступление.
 */
export function canRaid(
  enemy: EnemyType,
  kit: BossKit,
  bestLaser: LaserType,
  model: ShipId = 'cobra3',
): boolean {
  return canBeat(enemy, kit, bestLaser, model);
}

/** Криминальный ли статус: с него патруль превращается в пиратство. */
export function isCriminal(legal: number): boolean {
  return legal >= 1;
}

/**
 * Слабый ли враг при данном лазере — ТОЛЬКО про силу, не про законность.
 *
 * §122: ЗДЕСЬ БЫЛА ПОЛОМКА.
 *
 * Раньше здесь стояло `if (!enemy.pirate) return false;` — то есть «слабым
 * может быть только корабль, на котором летают пираты». Флаг `pirate` —
 * свойство МОДЕЛИ, а не роли во встрече, и проверка молча запрещала
 * нападать на полицейский Viper и на торговую Cobra ВСЕГДА, даже когда те
 * сами атакуют, а игрок в розыске. Пользователь: «в розыске при перелёте я
 * не могу атаковать корабли вручную» — это она.
 *
 * Законность цели решает вызывающий: он знает роль встречи и передаёт
 * `isLegalTarget(role, hostile)` (см. §95/§96). Здесь остаётся сила:
 * «успею ли разобрать его, не потеряв больше 40 % запаса».
 *
 * Python и Анаконда не проходят и без этой проверки — их доля урона 0.41 и
 * 0.98 при военном лазере, — то есть правило §39.1 «на больших не нападаем»
 * сохранено самой формулой, а не флагом модели.
 */
export function isWeak(
  enemy: EnemyType,
  bestLaser: LaserType,
  toughness: number = MAX_SHIELDS + MAX_ENERGY,
): boolean {
  return damageShare(enemy, bestLaser, toughness) < WEAK_DAMAGE_SHARE;
}

/**
 * Лучший лазер, который есть у игрока.
 * Порядок — по силе удара, а не по цене.
 */
export function bestLaserOf(lasers: {
  pulse: boolean;
  beam: boolean;
  military: boolean;
  mining: boolean;
}): LaserType {
  if (lasers.military) return 'military';
  if (lasers.beam) return 'beam';
  if (lasers.pulse) return 'pulse';
  if (lasers.mining) return 'mining';
  return 'none';
}

export interface Decisions {
  attack: boolean;
  flee: boolean;
  skip: boolean;
  /** Почему решение недоступно — для подписи на кнопке. */
  attackReason?: string;
  fleeReason?: string;
}

/** Груз игрока и всё, что капсула уничтожает. */
export interface ShipForPod {
  cargo: readonly number[];
  /** Свободное место трюма до побега (нужно для восстановления). */
  holdSpace: number;
}

export interface PodResult {
  /** Груз после катапультирования: всё, кроме предметов пришельцев. */
  cargo: readonly number[];
  /** Трюм после катапультирования — снова пустой. */
  holdSpace: number;
}

/**
 * Что происходит с грузом при катапультировании.
 *
 * Точно по `UpdateEscapePod` ($A7A3–$A7C7, game.asm):
 *
 *     LD HL,MarketFluctuation   ; 17 байт: флуктуация рынка + CargoHold+0..15
 *     LD B,$11                  ; обнулить 17 байт
 * L_A7AF: LD (HL),A : INC HL : DJNZ L_A7AF
 *
 * То есть затираются индексы **0..15**, а **индекс 16 — предметы
 * пришельцев — остаётся**. Плюс сбрасывается флуктуация рынка (у нас
 * рынок пересоздаётся при стыковке), обнуляется правовой статус
 * ($A7A4), теряются беженцы (`AND $DF`, $A7B3), трюм становится пустым
 * ($A7BA–$A7C7).
 *
 * Пассажиров в нашей модели пока нет — они появятся с миссиями.
 */
export function cargoAfterPod(cargo: readonly number[]): readonly number[] {
  return cargo.map((tons, i) => (i === ALIEN_ITEMS_INDEX ? tons : 0));
}

/** Применяет потерю груза при побеге. */
export function applyPodLoss(ship: ShipForPod): PodResult {
  return {
    cargo: cargoAfterPod(ship.cargo),
    // Трюм пуст (кроме пришельцев, которые остаются), но вместимость
    // прежняя: она — свойство корабля, а не груза.
    holdSpace: ship.holdSpace,
  };
}

/**
 * Какие решения доступны.
 *
 * §39.1: «напасть» только на слабый корабль; сильный — только «пропустить».
 *
 * §77: капсулы в игре больше нет. Раньше «бежать» означало катапультироваться
 * и требовало купленной капсулы. Теперь бегство — обычный уход от боя:
 * груз теряется, но жизни и корабль остаются. Поэтому решение доступно
 * всегда, а `hasPod` остался в подписи только ради совместимости вызовов.
 */
/**
 * §96: ЗАКОННАЯ ЛИ ЭТО ЦЕЛЬ.
 *
 * Одно правило, одно место. Раньше проверка была размазана по вызывающим,
 * и они разошлись: карточка встречи считала пирата законной целью, а
 * обработчик нажатия — нет. Игрок видел активную кнопку «Напасть»,
 * нажимал и получал «Это решение сейчас недоступно».
 *
 * Правило:
 *
 *   hostile (`outcome === 'attack'`) — цель всегда: он напал первым;
 *   роль пирата                      — цель всегда: он преступник, за
 *                                      него платят награду, даже если
 *                                      сейчас просто летит мимо (§86);
 *   всё остальное                    — не цель: торговец, полиция,
 *                                      охотник, летящий мимо.
 *
 * Почему по РОЛИ, а не по `enemy.pirate`: тот флаг — свойство МОДЕЛИ
 * корабля («на Cobra Mk III летают и пираты, и торговцы»), и проверка по
 * нему пускала чистого пилота грабить торговца.
 */
export function isLegalTarget(role: string, hostile: boolean): boolean {
  return hostile || role === 'pirate';
}

export function availableDecisions(
  enemy: EnemyType,
  bestLaser: LaserType,
  _hasPod: boolean,
  hostile: boolean,
  toughness: number = MAX_SHIELDS + MAX_ENERGY,
): Decisions {
  /*
   * §95: ПИРАТ — ЦЕЛЬ, ДАЖЕ ЕСЛИ ОН ЛЕТИТ МИМО.
   *
   * Было `weak = hostile && isWeak(...)`, и это давало абсурд:
   *
   *   пират летит мимо (жёлтый) → «Корабль не враждебен — атака была бы
   *   преступлением»
   *
   * Но нападение на ПИРАТА — не преступление, за него дают награду. Флаг
   * `hostile` смешивал два разных вопроса в один:
   *
   *   hostile — атакует ли он СЕЙЧАС;
   *   outlaw  — преступник ли он по природе (role === 'pirate').
   *
   * `isWeak` уже проверяет `enemy.pirate`, то есть «законная цель». Значит
   * `hostile` в условии был лишним: он отсекал ровно тот случай, который
   * §86 называет жёлтым и который в оригинале бьют за деньги.
   *
   * Осторожно: НЕ любой невраждебный корабль становится целью. Торговец,
   * полиция и охотник по-прежнему `enemy.pirate === false` — на них
   * напасть нельзя, это остаётся преступлением.
   *
   * Параметр `hostile` оставлен: он нужен для причины отказа в тексте и
   * для вызывающей стороны (в пиратстве правила другие).
   */
  /*
   * §95: законность цели определяет ВЫЗЫВАЮЩИЙ, и передаёт это через
   * `hostile`. Здесь остаётся только сила корабля.
   *
   * Почему не `enemy.pirate`: это свойство МОДЕЛИ («на Cobra Mk III
   * летают пираты»), а Cobra бывает и торговой. Флаг не различает роль,
   * и проверка по нему пускала чистого пилота грабить торговца.
   *
   * Вызывающий знает роль встречи: пират — цель всегда, торговец и
   * власть — только когда сами напали. Он и передаёт `hostile = true`
   * для законной цели.
   */
  /*
   * §123: ПРИЧИНА ОТКАЗА ДОЛЖНА БЫТЬ НАСТОЯЩЕЙ.
   *
   * Пользователь купил Анаконду и получил «голый» корпус: лазера нет,
   * ракет нет, ECM нет (§102.4 — оборудование слетает, это сказано в
   * подтверждении покупки). После этого кнопка «Напасть» навсегда писала
   * «Корабль слишком силён: не успеть уничтожить» — и это было враньё:
   * корабль не силён, просто стрелять нечем. Игрок решил, что поломка
   * в игре, и второй раз пришёл с тем же вопросом.
   *
   * `damageShare` при лазере `none` возвращает бесконечность, поэтому
   * `isWeak` честно говорит «нет»; но причину надо называть отдельно.
   */
  const noLaser = bestLaser === 'none';
  const weak = hostile && !noLaser && isWeak(enemy, bestLaser, toughness);
  return {
    attack: weak,
    flee: true,
    skip: true,
    attackReason: weak
      ? undefined
      : !hostile
        ? 'Корабль не враждебен — атака была бы преступлением'
        : noLaser
          ? 'Нет лазера: стрелять нечем. Купите лазер в ангаре'
          : 'Корабль слишком силён: не успеть уничтожить',
  };
}

export interface DecisionResult {
  outcome: DecisionOutcome;
  /** Текст для журнала. */
  text: string;
  /** Правовые последствия: на сколько вырос статус. */
  legalDelta: number;
  /** Награда в десятых долях кредита. */
  bounty: number;
  /** Потрачена ли капсула. */
  podUsed: boolean;
  /** Побег обнуляет правовой статус целиком ($A7A4). */
  legalCleared?: boolean;
}

/**
 * Применяет решение.
 *
 * Возвращает `null`, если решение недоступно — вызывающий код обязан
 * показать только доступные кнопки, так что это защита от ошибок в UI,
 * а не штатный путь.
 */
export function applyDecision(
  enemy: EnemyType,
  decision: Decision,
  decisions: Decisions,
  hostile: boolean,
): DecisionResult | null {
  switch (decision) {
    case 'attack': {
      if (!decisions.attack) return null;
      return {
        outcome: 'won',
        text: `${enemy.name} уничтожен`,
        // Пират — не преступление. Нападение на невраждебного сюда не
        // попадает: decisions.attack для него false.
        legalDelta: 0,
        bounty: enemy.bounty,
        podUsed: false,
      };
    }
    case 'flee': {
      if (!decisions.flee) return null;
      return {
        outcome: 'fled',
        text: `Вы ушли от ${enemy.name}: груз сброшен, правовой статус обнулён`,
        // $A7A4: побег очищает правовой статус до нуля. Раньше это делала
        // капсула; §77 капсулы нет, но правило осталось — оно про бегство.
        legalDelta: 0,
        legalCleared: true,
        bounty: 0,
        podUsed: false,
      };
    }
    case 'skip': {
      return {
        outcome: 'skipped',
        text: hostile ? `Пропущен ${enemy.name}` : `${enemy.name} ушёл`,
        legalDelta: 0,
        bounty: 0,
        podUsed: false,
      };
    }
    default:
      return null;
  }
}

/**
 * Исход, если игрок не решил за отведённое время (§40).
 *
 * Безопасный режим: слабый враждебный — победа (бой доигрывается сам),
 * сильный или нейтральный — пропуск. Смерти нет, капсула не тратится.
 */
export function autoResolve(enemy: EnemyType, decisions: Decisions, hostile: boolean): DecisionResult {
  /*
   * §95: `hostile` больше не решает, БЫЛА ли победа.
   *
   * Раньше здесь стояло `hostile && decisions.attack`, и это повторяло ту
   * же ошибку, что была в `availableDecisions`: пират, летящий мимо, не
   * считался ни целью, ни угрозой. Но решение `attack` уже означает «есть
   * чем справиться, и это законная цель» — его выставил `availableDecisions`
   * с проверкой `enemy.pirate`. Достаточно смотреть на `decisions.attack`.
   *
   * `hostile` оставлен в подписи: он нужен вызывающим для текста и для
   * пиратства, где правила другие.
   */
  if (decisions.attack) {
    /*
     * §95: здесь НЕ проверяется `hostile`. Решение `attack` уже означает
     * «цель законна и мы её одолеем» — его выставил вызывающий (патруль
     * считает так: враждебный ИЛИ пират). Иначе пират, летящий мимо,
     * снова получал бы пропуск, хотя кнопка «Напасть» ему доступна.
     */
    return {
      outcome: 'auto-victory',
      text: `Автобой: ${enemy.name} уничтожен`,
      legalDelta: 0,
      bounty: enemy.bounty,
      podUsed: false,
    };
  }
  return {
    outcome: 'auto-skip',
    text: `Автобой: ${enemy.name} пропущен`,
    legalDelta: 0,
    bounty: 0,
    podUsed: false,
  };
}

/** Разбор имени врага по id — для удобства вызывающего кода. */
export function enemyOf(id: string): EnemyType {
  return enemyById(id);
}
