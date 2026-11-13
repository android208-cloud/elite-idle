/**
 * Пошаговый бой без графики. Один раунд примерно 10 секунд игрового времени.
 * Модуль самодостаточный: хранит копии ресурсов игрока и ничего не знает о GameState.
 *
 * Модель урона из оригинала (tactics_part_6_of_7.asm + oops.asm):
 * - Урон врага = byte#19 >> 1, где byte#19 = (laserPower << 3) | missiles
 *   Значение поля `laser` у EnemyType уже содержит готовый урон за раунд.
 * - Щиты FSH и ASH в оригинале: 0-255 каждый. В idle-версии один щит 0-255.
 * - Энергия ENERGY: 0-255 (не 0-128, как было раньше).
 * - Лазерная мощь игрока (elite-source-docked.asm):
 *     Pulse:    POW = 15
 *     Mining:   Mlas = 50
 *     Military: INT(128.5 + 1.5*POW) = 151
 *     Beam:     POW+32 = 47  (см. WPSHPS: ORA #32 на base POW)
 */

import { nextFloat } from './rng.ts';
import { enemyById, type LaserType, type PlayerShip } from './ships.ts';

export const MAX_SHIELDS = 128; // оригинал: FSH/ASH 0-255 (каждый); в idle объединили в один буфер
export const MAX_ENERGY  = 255; // оригинал: ENERGY 0-255
export const MAX_ROUNDS  = 60;

/**
 * Мощность лазера игрока за один раунд боя.
 *
 * ВАЖНО: это НЕ значения констант POW/Mlas/Armlas как есть, а биты 0–6
 * байта LASER — именно их оригинал использует как силу удара:
 *
 *   elite-source-docked.asm:  POW = 15, Mlas = 50, Armlas = INT(128.5 + 1.5*POW)
 *   main_flight_loop_part_3_of_16.asm:
 *     PHA                        \ мощность лазера текущего вида
 *     AND #%01111111             \ LAS = биты 0–6 (бит 7 = «луч, а не импульс»)
 *     STA LAS
 *   main_flight_loop_part_11_of_16.asm:
 *     LDA #LASER,X
 *     SEC : SBC LAS              \ урон = энергия цели − LAS
 *
 * Отсюда реальные значения:
 *   импульсный  LASER = POW        = 15           → LAS = 15
 *   луч         LASER = POW + 128  = 143          → LAS = 143 & 127 = 15
 *   военный     LASER = Armlas     = 151          → LAS = 151 & 127 = 23
 *   добывающий  LASER = Mlas       = 50           → LAS = 50
 *
 * Раньше у нас стояли 47 и 151 — это сами константы, без маски. Луч и
 * военный лазер из-за этого были в 3 и 6.5 раза мощнее оригинала.
 * Подтверждение из оригинала же: `CMP #(Armlas AND 127)` — автор сравнивает
 * силу удара именно с 23, а не с 151.
 *
 * В idle-игре за раунд стреляем один раз, урон = LAS.
 */

export type CombatAction = 'laser' | 'missile' | 'ecm' | 'bomb' | 'pod' | 'flee' | 'dump';

export type CombatOutcome = 'won' | 'fled' | 'enemy-fled' | 'enemy-left' | 'pod' | 'died';

export interface CombatState {
  enemyId: string;
  enemyEnergy: number;
  enemyMissiles: number;
  shields: number;
  energy: number;
  /** Копии оборудования игрока на момент начала боя */
  laser: LaserType;
  playerMissiles: number;
  hasEcm: boolean;
  hasBomb: boolean;
  hasPod: boolean;
  hasEnergyUnit: boolean;
  cargoTons: number;
  incomingMissile: boolean;
  bombUsed: boolean;
  cargoDumped: boolean;
  fleeFailures: number;
  round: number;
  outcome: CombatOutcome | null;
  log: string[];
  rng: number;
}

/**
 * Сила удара лазера (биты 0–6 байта LASER, см. пояснение в шапке файла).
 * Значения выведены из констант оригинала, а не списаны напрямую.
 */
export const LASER_POWER: Record<LaserType, number> = {
  none:     0,
  pulse:    15,  // POW       = 15  → 15 & 127
  beam:     15,  // POW + 128 = 143 → 143 & 127
  military: 23,  // Armlas    = 151 → 151 & 127
  mining:   50,  // Mlas      = 50  → 50 & 127
};

/**
 * Байт `LASER` для каждого лазера — то, что оригинал пишет при покупке
 * (`eqshp.asm`: `LDA #POW : STA LASER,X`, `LDA #POW+128`, `LDA #Armlas`,
 * `LDA #Mlas`). Бит 7 означает «луч», а не добавку к мощности.
 */
const LASER_BYTE: Record<LaserType, number> = {
  none:     0,
  pulse:    15,   // POW
  beam:     143,  // POW + 128
  military: 151,  // Armlas = INT(128.5 + 1.5*15)
  mining:   50,   // Mlas
};

/**
 * Темп огня — точная модель `LASCT` **и** перегрева `GNTMP`.
 *
 * Почему нужны оба. Счётчик `LASCT` ограничивает частоту выстрелов:
 * главный цикл стреляет только при `LASCT == 0`, иначе декрементирует его;
 * после выстрела `LASCT = (power & %11111010)`, а у лазеров с установленным
 * битом 7 — ноль, то есть «не пульсирует».
 *
 * Но одного `LASCT` мало. Луч и военный лазер имеют `LASCT = 0` и в теории
 * стреляли бы непрерывно, 50 раз в секунду — это в 10 раз быстрее
 * импульсного. На деле их сдерживает температура: каждый выстрел добавляет
 * `GNTMP += 8`, охлаждение даёт `DEC GNTMP` раз за проход, а при `GNTMP >= 242`
 * (`CMP #242`) стрелять нельзя. Так что темп выходит ограничен перегревом.
 *
 * Ниже — симуляция одного этого контура на 600 игровых секунд с частотой
 * главного цикла 50 Гц (VSYNC, `irq1.asm`). Значения получаются такие:
 *
 *     импульсный   ≈ 4.55 выстр/сек   (база)
 *     луч/военный  ≈ 6.30 выстр/сек   (x1.39)
 *     добывающий   ≈ 0.98 выстр/сек   (x0.22)
 *
 * Маска `& %11111010` ничего не меняет у наших значений (у добывающего
 * 50 = %00110010 младший бит уже нулевой), но она важна как часть механики:
 * именно поэтому счётчик всегда чётный и импульсы не «съезжают».
 */
export const LASER_RATE: Record<LaserType, number> = (() => {
  const FPS = 50;            // частота главного цикла (VSYNC)
  const SIM_SECONDS = 600;   // достаточно, чтобы контур вышел на режим
  const OVERHEAT = 242;      // CMP #242 в main_flight_loop_part_3_of_16
  const HEAT_PER_SHOT = 8;   // LDA GNTMP : ADC #8 : STA GNTMP (lasli.asm)
  const result = {} as Record<LaserType, number>;
  for (const key of Object.keys(LASER_BYTE) as LaserType[]) {
    const byte = LASER_BYTE[key];
    if (byte === 0) {
      result[key] = 0;
      continue;
    }
    const power = byte & 0x7f;
    const isBeam = (byte & 0x80) !== 0;
    const lasctAfterShot = isBeam ? 0 : power & 0xfa;
    let lasct = 0;
    let heat = 0;
    let shots = 0;
    for (let frame = 0; frame < FPS * SIM_SECONDS; frame++) {
      if (lasct === 0 && heat < OVERHEAT) {
        lasct = lasctAfterShot;
        heat += HEAT_PER_SHOT;
        shots += 1;
      } else if (lasct > 0) {
        lasct -= 1;
      }
      if (heat > 0) heat -= 1; // DEC GNTMP в main_game_loop_part_5_of_6
    }
    result[key] = shots / SIM_SECONDS;
  }
  return result;
})();

/** Опорный темп: импульсный лазер = 1 выстрел за раунд. */
const PULSE_SHOTS_PER_ROUND = LASER_RATE.pulse;
// Вероятность попадания игрока (адаптировано для idle: один выстрел в раунд)
const PLAYER_HIT     = 0.65;
// Раньше было SHOTS=3 попыток × ENEMY_HIT × лазер.
// Теперь: 1 выстрел в раунд, урон=LASER_POWER[laser] при попадании.
// Вероятность попадания противника — из оригинала враг всегда стреляет
// (tactics_part_6_of_7.asm), но в idle-версии даём небольшой шанс промаха.
const ENEMY_HIT      = 0.85; // адаптировано: оригинал стреляет почти всегда
const MISSILE_DAMAGE = 70;   // ракета игрока → урон по врагу (баланс)
const MISSILE_HIT    = 0.85;
const INCOMING_MISSILE_DAMAGE = 60; // ракета врага по игроку (баланс)
const FLEE_CHANCE    = 0.55;
const DUMP_CHANCE    = 0.60;

/** Пороги автоматического режима: энергия, при которой используется капсула и попытка уйти */
const AUTO_POD_ENERGY  = 50;  // ~20% от 255
const AUTO_FLEE_ENERGY = 90;  // ~35% от 255

export function startCombat(enemyId: string, ship: PlayerShip, allowPod: boolean, cargoTons: number, rng: number): CombatState {
  const e = enemyById(enemyId);
  return {
    enemyId,
    enemyEnergy: e.energy,
    enemyMissiles: e.missiles,
    shields: MAX_SHIELDS,
    energy: MAX_ENERGY,
    laser: ship.laser,
    playerMissiles: ship.missiles,
    hasEcm: ship.ecm,
    hasBomb: ship.energyBomb,
    hasPod: ship.escapePod && allowPod,
    hasEnergyUnit: ship.energyUnit,
    cargoTons,
    incomingMissile: false,
    bombUsed: false,
    cargoDumped: false,
    fleeFailures: 0,
    round: 0,
    outcome: null,
    log: [`Бой начался: ${e.name}`],
    rng,
  };
}

export function canDo(c: CombatState, action: CombatAction): boolean {
  if (c.outcome) return false;
  switch (action) {
    case 'laser':
      return c.laser !== 'none';
    case 'missile':
      return c.playerMissiles > 0;
    case 'ecm':
      return c.hasEcm && c.incomingMissile;
    case 'bomb':
      return c.hasBomb && !c.bombUsed;
    case 'pod':
      return c.hasPod;
    case 'flee':
      return true;
    case 'dump':
      return c.cargoTons > 0 && !c.cargoDumped;
  }
}

/** Выбор действия в автоматическом режиме. */
export function chooseAuto(c: CombatState): CombatAction {
  if (canDo(c, 'pod') && c.energy <= AUTO_POD_ENERGY) return 'pod';
  if (canDo(c, 'ecm')) return 'ecm';
  if (canDo(c, 'missile') && c.enemyEnergy >= 100 && c.round % 2 === 0) return 'missile';
  if (c.energy <= AUTO_FLEE_ENERGY && c.fleeFailures < 2) return 'flee';
  if (canDo(c, 'laser')) return 'laser';
  return 'flee';
}

function hitPlayer(c: CombatState, damage: number): void {
  if (c.shields >= damage) {
    c.shields -= damage;
  } else {
    const rest = damage - c.shields;
    c.shields = 0;
    c.energy -= rest;
  }
}

/** Один раунд боя. Возвращает новое состояние, исходное не меняется. */
export function combatRound(prev: CombatState, action: CombatAction): CombatState {
  if (prev.outcome) return prev;
  const c: CombatState = { ...prev, log: [...prev.log] };
  const enemy = enemyById(c.enemyId);
  let rng = c.rng;
  const rand = (): number => {
    const [v, next] = nextFloat(rng);
    rng = next;
    return v;
  };
  const finish = (outcome: CombatOutcome, text: string): CombatState => {
    c.outcome = outcome;
    c.log.push(text);
    c.rng = rng;
    c.round += 1;
    return c;
  };

  let missileNeutralised = false;

  if (!canDo(c, action)) {
    c.log.push('Это действие сейчас недоступно');
  } else {
    switch (action) {
      case 'laser': {
        // Темп огня из оригинала: за раунд лазер успевает сделать столько
        // выстрелов, сколько соответствует отношению LASER_RATE. Импульсный —
        // ровно один (это наша базовая единица), луч и военный — в 10 раз
        // больше, добывающий — примерно в 5 раз меньше.
        const shots = LASER_RATE[c.laser] / PULSE_SHOTS_PER_ROUND;
        const dmg = LASER_POWER[c.laser];
        if (dmg <= 0) {
          c.log.push('Лазер не установлен');
          break;
        }
        let hits = 0;
        let total = 0;
        // Дробное число выстрелов разыгрываем вероятностно, чтобы добывающий
        // лазер (0.2 выстрела за раунд) не округлялся в ноль навсегда.
        const whole = Math.floor(shots);
        const frac = shots - whole;
        const count = whole + (rand() < frac ? 1 : 0);
        for (let i = 0; i < count; i++) {
          if (rand() < PLAYER_HIT) {
            hits += 1;
            total += dmg;
          }
        }
        if (count === 0) {
          c.log.push('Лазер: не успели выстрелить');
          break;
        }
        if (hits > 0) {
          c.enemyEnergy -= total;
          c.log.push(
            count === 1
              ? `Лазер: попадание, урон ${dmg}`
              : `Лазер: ${hits} из ${count} попали, урон ${total}`,
          );
        } else {
          c.log.push(count === 1 ? 'Лазер: промах' : `Лазер: ${count} промахов`);
        }
        break;
      }
      case 'missile': {
        c.playerMissiles -= 1;
        if (rand() < MISSILE_HIT) {
          c.enemyEnergy -= MISSILE_DAMAGE;
          c.log.push(`Ракета попала, урон ${MISSILE_DAMAGE}`);
        } else {
          c.log.push('Ракета ушла мимо');
        }
        break;
      }
      case 'ecm':
        c.incomingMissile = false;
        missileNeutralised = true;
        c.log.push('ECM сбила ракету противника');
        break;
      case 'bomb':
        c.bombUsed = true;
        c.enemyEnergy = 0;
        c.log.push('Энергобомба уничтожила всё вокруг');
        break;
      case 'pod':
        return finish('pod', 'Вы катапультировались в спасательной капсуле');
      case 'flee':
        if (rand() < FLEE_CHANCE) return finish('fled', 'Вам удалось оторваться от противника');
        c.fleeFailures += 1;
        c.log.push('Оторваться не удалось');
        break;
      case 'dump':
        c.cargoDumped = true;
        c.log.push('Груз сброшен');
        if (rand() < DUMP_CHANCE) return finish('enemy-left', 'Противник занялся грузом и оставил вас в покое');
        break;
    }
  }

  if (c.enemyEnergy <= 0) return finish('won', `${enemy.name} уничтожен`);

  if (enemy.fleeBelow > 0 && c.enemyEnergy < enemy.energy * enemy.fleeBelow && rand() < 0.35) {
    return finish('enemy-fled', `${enemy.name} отступает`);
  }

  // Ракета противника, выпущенная ранее, настигает, если её не сбили
  if (c.incomingMissile && !missileNeutralised) {
    hitPlayer(c, INCOMING_MISSILE_DAMAGE);
    c.incomingMissile = false;
    c.log.push(`Ракета противника попала, урон ${INCOMING_MISSILE_DAMAGE}`);
  }

  // Атака противника: урон = enemy.laser (уже = byte#19 >> 1 из источника)
  if (rand() < ENEMY_HIT) {
    hitPlayer(c, enemy.laser);
    c.log.push(`${enemy.name}: урон ${enemy.laser}`);
  }

  // Новая ракета противника
  if (c.enemyMissiles > 0 && !c.incomingMissile && rand() < 0.2) {
    c.enemyMissiles -= 1;
    c.incomingMissile = true;
    c.log.push('Внимание: ракета противника на подходе!');
  }

  if (c.energy <= 0) return finish('died', 'Корабль уничтожен');

  // Восстановление щитов и энергии (оригинал: главный цикл main_flight_loop_part_14)
  // В оригинале щиты восстанавливаются медленно от энергоблока.
  // Адаптация: +6 щит, +2 энергия за раунд (с доп. блоком удваивается).
  // При MAX_SHIELDS=255 и 60 раундах: суммарно +360 регенерации — достаточно для
  // баланса, когда Python (урон 13) опаснее Sidewinder (урон 8).
  c.shields = Math.min(MAX_SHIELDS, c.shields + (c.hasEnergyUnit ? 4  : 2));
  c.energy  = Math.min(MAX_ENERGY,  c.energy  + (c.hasEnergyUnit ? 2  : 1));

  c.round += 1;
  if (c.round >= MAX_ROUNDS) return finish('enemy-left', 'Противник потерял вас из виду');
  c.rng = rng;
  return c;
}

/** Доигрывает бой автоматически до конца. */
export function autoCombat(c: CombatState): CombatState {
  let cur = c;
  while (!cur.outcome) cur = combatRound(cur, chooseAuto(cur));
  return cur;
}
