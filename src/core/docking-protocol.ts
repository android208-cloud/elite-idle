/**
 * Протокол обмена между игрой и экраном стыковки (iframe).
 *
 * Почему не прямое подключение модуля в сборку: мини-игру пишет
 * пользователь, и она должна оставаться заменяемой без пересборки игры.
 * iframe даёт ровно это — любой HTML-файл с нужным протоколом.
 *
 * Обмен строго через `postMessage` с проверкой origin, чтобы экран
 * не мог дёргать игру произвольными сообщениями.
 *
 * Схема:
 *
 *   игра  → экран   { type: 'docking:init',   config }
 *   экран → игра    { type: 'docking:ready' }
 *   экран → игра    { type: 'docking:result', docked, damage, jumpedAway? }
 *   экран → игра    { type: 'docking:jump',   to }   (игрок улетел)
 *   игра  → экран   { type: 'docking:close' }
 */

/** Настройки, которые игра передаёт экрану стыковки. */
export interface DockingConfig {
  /** Имя системы, где идёт стыковка — для заголовка на экране. */
  systemName: string;
  /** Есть ли у игрока стыковочный компьютер. */
  hasComputer: boolean;
  /** Можно ли улететь прямо из мини-игры (прыжок живёт в космосе). */
  canJump: boolean;
  /** Система, выбранная на карте как цель прыжка (null — не выбрана). */
  jumpTarget: number | null;
  /** Имя выбранной системы для подсказки. */
  jumpTargetName: string | null;
}

/** Результат, который экран возвращает игре. */
export interface DockingOutcome {
  docked: boolean;
  damage: number;
  jumpedAway?: boolean;
}

export const DOCKING_CHANNEL = 'elite-idle-docking';

/* ---------- Сообщения (дискриминированные объединения) ---------- */

export type ToFrame =
  | { type: 'docking:init'; config: DockingConfig }
  | { type: 'docking:close' };

export type FromFrame =
  | { type: 'docking:ready' }
  | ({ type: 'docking:result' } & DockingOutcome)
  | { type: 'docking:jump'; to: number };

/** Проверка формы сообщения от экрана. Возвращает null, если это не наше. */
export function parseFromFrame(data: unknown): FromFrame | null {
  if (typeof data !== 'object' || data === null) return null;
  const m = data as Record<string, unknown>;
  if (m.channel !== DOCKING_CHANNEL) return null;
  switch (m.type) {
    case 'docking:ready':
      return { type: 'docking:ready' };
    case 'docking:result':
      return {
        type: 'docking:result',
        docked: Boolean(m.docked),
        damage: Number(m.damage) || 0,
        jumpedAway: m.jumpedAway ? true : undefined,
      };
    case 'docking:jump': {
      const to = Number(m.to);
      return Number.isInteger(to) && to >= 0 ? { type: 'docking:jump', to } : null;
    }
    default:
      return null;
  }
}
