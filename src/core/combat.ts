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
 * Значения из elite-source-docked.asm:
 *   POW=15 (pulse), Mlas=50 (mining), Armlas=151 (military), beam=POW|32=47
 * В idle-игре за раунд стреляем один раз, урон = laserPower.
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

// Мощность лазеров игрока (elite-source-docked.asm, строки POW/Mlas/Armlas)
const LASER_POWER: Record<LaserType, number> = {
  none:     0,
  pulse:    15,  // POW = 15
  beam:     47,  // POW | 32 = 15 | 32 = 47
  military: 151, // INT(128.5 + 1.5*POW) = INT(128.5 + 22.5) = 151
  mining:   50,  // Mlas = 50
};
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
        // Один выстрел за раунд. Мощность = LASER_POWER[тип].
        const dmg = LASER_POWER[c.laser];
        if (dmg > 0 && rand() < PLAYER_HIT) {
          c.enemyEnergy -= dmg;
          c.log.push(`Лазер: попадание, урон ${dmg}`);
        } else {
          c.log.push('Лазер: промах');
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
