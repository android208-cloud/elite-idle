/**
 * §133.2: КОНТРАКТЫ — ЯДРО.
 *
 * Записка с планом: `docs/missions.md`. Здесь только то, что можно проверить
 * без экрана: предложения на станции, взятие, сдача, отказ и срыв по сроку.
 *
 * Решения пользователя, принятые до кода (2026-11-22):
 *   * репутация — отдельным числом (`missionRep`), систему проработаем позже;
 *   * одновременно держим три контракта;
 *   * секретные миссии — только по триггеру (в этом шаге их ещё нет).
 *
 * Пока реализованы два вида — курьер и пассажиры. Контрабанда, разведка и
 * перехват ждут своих шагов (§133.4–§133.5): им нужны досмотр, таймер съёма и
 * назначенная встреча, а это отдельная работа.
 *
 * ЕДИНИЦЫ как везде в игре: деньги в десятых кредита, время — миллисекунды.
 * Сроки заданы в «базовых» часах и переводятся в реальные через темп игры так
 * же, как длительность прыжка: на ×200 контракт на 4 часа горит через 72 с.
 */

import { buildGalaxy, distance, type StarSystem } from './galaxy.ts';
import { nextByte } from './rng.ts';
import { maxFuel } from './ships.ts';
import type { GameEvent, GameState, Settings } from './state.ts';

/*
 * Своя копия кэша систем, а не `systemsOf` из `state.ts`: это разорвало бы
 * цикл импортов (состояние тянет контракты, контракты — состояние). Карта
 * систем строится из одного зерна детерминированно, так что копия не может
 * разойтись с оригиналом — это одна и та же карта, посчитанная дважды.
 */
const galaxyCache = new Map<number, StarSystem[]>();
function systemsOf(galaxy: number): StarSystem[] {
  let systems = galaxyCache.get(galaxy);
  if (!systems) {
    systems = buildGalaxy(galaxy);
    galaxyCache.set(galaxy, systems);
  }
  return systems;
}

export type MissionKind = 'courier' | 'passenger';

export interface Mission {
  id: number;
  kind: MissionKind;
  /** Где взяли. */
  from: number;
  /** Куда лететь. */
  to: number;
  /** Сколько тонн трюма занимает. Курьер — 0: документы места не просят. */
  tons: number;
  /**
   * Срок в «базовых» часах. Именно он хранится в предложении; конкретный
   * момент берётся при взятии, когда известен темп игры.
   */
  hours: number;
  /** Момент срыва (реальное время, мс). У предложения — 0. */
  deadline: number;
  /** Награда, десятые кредита. */
  reward: number;
  /** Штраф за срыв, десятые кредита. */
  penalty: number;
  /** Секретные не выкладываются на доску — только по триггеру (§133.7). */
  secret: boolean;
}

export type MissionError = 'no-offer' | 'no-hold' | 'wrong-system' | 'no-mission';

export interface MissionResult {
  state: GameState;
  error?: MissionError;
}

/** Сколько предложений висит на станции. Решение пользователя: три. */
export const MISSION_OFFERS = 3;

const HOUR_MS = 3_600_000;

/** Темп игры: тот же делитель, что у `baseToReal` в `state.ts`. */
const speedOf = (settings: Settings): number => Math.max(1, settings.speed || 1);

const hoursToReal = (hours: number, settings: Settings): number =>
  Math.round((hours * HOUR_MS) / speedOf(settings));

export const missionsOf = (state: GameState): Mission[] => state.missions ?? [];
export const offersOf = (state: GameState): Mission[] => state.missionOffers ?? [];
export const missionRepOf = (state: GameState): number => state.missionRep ?? 0;

/** Сколько тонн занято контрактами: трюм ими занят по-настоящему. */
export function missionTons(state: GameState): number {
  return missionsOf(state).reduce((sum, m) => sum + m.tons, 0);
}

/**
 * §133.3: оплата растёт с расстоянием, но не линейно.
 *
 * `0,75 + 0,25 × d / 7 св. г.` — ближний контракт остаётся не пустым, дальний
 * выгоднее, но вдвое, а не в десять раз. Иначе выгодно брать только дальние, а
 * ближние никто не берёт.
 */
function distanceFactor(distanceTenths: number): number {
  const ly = distanceTenths / 10;
  return Math.min(2, Math.max(0.75, 0.75 + 0.25 * (ly / 7)));
}

/** Репутация даёт ±20 % при ±10 очках. Дальше не растёт — потолок честности. */
function repFactor(rep: number): number {
  const clamped = Math.max(-10, Math.min(10, rep));
  return 1 + clamped * 0.02;
}

interface Rolled {
  offers: Mission[];
  rng: number;
  nextId: number;
}

/**
 * Три предложения для текущей станции.
 *
 * Чистая функция: всё случайное берётся из `state.rng`, а новый генератор
 * возвращается наружу. Так предложения детерминированы и не «мерцают» при
 * каждой перерисовке.
 */
export function rollOffers(state: GameState): Rolled {
  const systems = systemsOf(state.galaxy);
  const here = systems[state.system];
  const reach = maxFuel(state.ship);
  const near = systems
    .map((s, i) => ({ i, d: distance(here, s) }))
    .filter((o) => o.i !== state.system && o.d > 0 && o.d <= reach)
    .sort((a, b) => a.i - b.i);

  /*
   * Свой генератор для доски: основной `rng` двигает рынок и встречи, и
   * трогать его здесь нельзя — предложения сдвинули бы всю их череду.
   */
  let rng = state.missionRng ?? state.rng;
  let nextId = state.nextMissionId ?? 1;
  const offers: Mission[] = [];
  if (near.length === 0) return { offers, rng, nextId };

  const rep = repFactor(missionRepOf(state));
  for (let n = 0; n < MISSION_OFFERS; n++) {
    const [kindByte, r1] = nextByte(rng);
    rng = r1;
    // Пассажиры реже курьеров: они занимают трюм и требуют спешки.
    const kind: MissionKind = kindByte % 4 === 0 ? 'passenger' : 'courier';

    const [targetByte, r2] = nextByte(rng);
    rng = r2;
    const target = near[targetByte % near.length];

    const [priceByte, r3] = nextByte(rng);
    rng = r3;
    // Курьер 400–900 CR, пассажиры 700–1600 CR (в десятых кредита).
    const base = kind === 'courier' ? 400 + (priceByte % 500) : 700 + (priceByte % 900);
    const reward = Math.round(base * 10 * distanceFactor(target.d) * rep);

    const [hoursByte, r4] = nextByte(rng);
    rng = r4;
    const hours = kind === 'courier' ? 2 + (hoursByte % 3) : 3 + (hoursByte % 4);

    const [tonsByte, r5] = nextByte(rng);
    rng = r5;
    const tons = kind === 'courier' ? 0 : 1 + (tonsByte % 3);

    offers.push({
      id: nextId++,
      kind,
      from: state.system,
      to: target.i,
      tons,
      hours,
      deadline: 0,
      reward,
      penalty: Math.round(reward * (kind === 'passenger' ? 0.25 : 0.2)),
      secret: false,
    });
  }

  return { offers, rng, nextId };
}

/** Разложить новые предложения в состояние (после прибытия на станцию). */
export function refreshOffers(state: GameState): GameState {
  const rolled = rollOffers(state);
  return {
    ...state,
    missionOffers: rolled.offers,
    missionRng: rolled.rng,
    nextMissionId: rolled.nextId,
  };
}

/**
 * ВЗЯТЬ КОНТРАКТ.
 *
 * Тонны занимаются по-настоящему: `holdSpace` уменьшается, а инвариант
 * «свободно + груз + контракты = вместимость» держится. Поэтому взятый
 * пассажирский контракт действительно мешает грузить товар — в этом и смысл.
 */
export function takeMission(state: GameState, id: number, now: number, settings: Settings): MissionResult {
  // §133.6: во время «Сверхновой» брать контракты негде и некогда.
  if (state.supernova && !state.supernova.escaped) return { state, error: 'no-offer' };
  const offer = offersOf(state).find((o) => o.id === id);
  if (!offer) return { state, error: 'no-offer' };
  if (missionsOf(state).length >= MISSION_OFFERS) return { state, error: 'no-hold' };
  if (offer.tons > state.holdSpace) return { state, error: 'no-hold' };

  const mission: Mission = {
    ...offer,
    deadline: now + hoursToReal(offer.hours, settings),
  };
  return {
    state: {
      ...state,
      missions: [...missionsOf(state), mission],
      missionOffers: offersOf(state).filter((o) => o.id !== id),
      holdSpace: state.holdSpace - offer.tons,
    },
  };
}

/**
 * СДАТЬ КОНТРАКТ. Только в целевой системе — иначе это не сдача.
 *
 * Награда начисляется здесь, а не при взятии: в оригинале продажа была
 * отдельным действием, и игрок должен видеть, за что заплатили.
 */
export function deliverMission(state: GameState, id: number): MissionResult {
  const mission = missionsOf(state).find((m) => m.id === id);
  if (!mission) return { state, error: 'no-mission' };
  if (mission.to !== state.system) return { state, error: 'wrong-system' };
  return {
    state: {
      ...state,
      missions: missionsOf(state).filter((m) => m.id !== id),
      holdSpace: state.holdSpace + mission.tons,
      cash: state.cash + mission.reward,
      missionRep: missionRepOf(state) + 2,
    },
  };
}

/**
 * ОТКАЗАТЬСЯ. До срока — бесплатно, только репутация: иначе взятый по ошибке
 * контракт превращается в ловушку.
 */
export function abandonMission(state: GameState, id: number): MissionResult {
  const mission = missionsOf(state).find((m) => m.id === id);
  if (!mission) return { state, error: 'no-mission' };
  return {
    state: {
      ...state,
      missions: missionsOf(state).filter((m) => m.id !== id),
      holdSpace: state.holdSpace + mission.tons,
      missionRep: missionRepOf(state) - 1,
    },
  };
}

/**
 * §133.2: СРЫВ ПО СРОКУ.
 *
 * Вызывается из `advance`, поэтому срок течёт и в закрытой вкладке — это
 * честно, время идёт. Штраф списывается, но деньги не уходят в минус:
 * инвариант «денег не бывает меньше нуля» важнее строгости наказания.
 */
export function tickMissions(
  state: GameState,
  now: number,
): { state: GameState; events: GameEvent[] } {
  const active = missionsOf(state);
  if (active.length === 0) return { state, events: [] };

  const events: GameEvent[] = [];
  const failed = active.filter((m) => m.deadline > 0 && m.deadline <= now);
  if (failed.length === 0) return { state, events };

  const systems = systemsOf(state.galaxy);
  let cash = state.cash;
  let holdSpace = state.holdSpace;
  for (const m of failed) {
    cash = Math.max(0, cash - m.penalty);
    holdSpace += m.tons;
    events.push({
      type: 'mission-failed',
      at: now,
      text: `Контракт ${systems[m.to].name} сорван: срок вышел, штраф ${(m.penalty / 10).toFixed(1)} CR`,
    });
  }

  return {
    state: {
      ...state,
      cash,
      holdSpace,
      missions: active.filter((m) => !failed.includes(m)),
      missionRep: missionRepOf(state) - 2 * failed.length,
    },
    events,
  };
}

/**
 * §132.12-совместимая справка: сколько места останется, если взять контракт.
 * Нужна экрану, чтобы причина отказа была честной (§123), а не «серая кнопка».
 */
export function canTake(state: GameState, mission: Mission): MissionError | null {
  if (missionsOf(state).length >= MISSION_OFFERS) return 'no-hold';
  if (mission.tons > state.holdSpace) return 'no-hold';
  return null;
}
