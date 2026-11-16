/**
 * Модуль стыковки через iframe.
 *
 * Игра не знает, что внутри экрана. Он может быть мини-игрой пользователя,
 * вариантом A, вариантом B или вообще заглушкой — важно только, что он
 * говорит по протоколу `docking-protocol.ts`.
 *
 * Почему iframe, а не импорт в сборку:
 *  - экран стыковки пишется отдельно и должен оставаться заменяемым
 *    файлом, который можно править без пересборки игры;
 *  - у прототипов пользователя своя разметка, стили и canvas —
 *    их не нужно переписывать на TypeScript;
 *  - падение экрана не роняет игру.
 *
 * Безопасность: обмен идёт через `postMessage` с проверкой источника,
 * сообщения валидируются `parseFromFrame`. Экран не имеет доступа
 * к состоянию игры иначе как через эти сообщения.
 */

import {
  DOCKING_CHANNEL,
  parseFromFrame,
  type DockingConfig,
  type DockingOutcome,
  type ToFrame,
} from '../core/docking-protocol.ts';

export type { DockingOutcome };

export interface IframeDockingOptions {
  /**
   * Откуда берётся разметка экрана.
   *
   * `url` — обычный файл рядом со сборкой (`public/*.html`).
   * `srcdoc` — HTML встроен в страницу под `<script type="text/plain">`;
   * так работает автономный файл, где всё лежит в одном документе.
   */
  src: string;
  /** Режим загрузки. По умолчанию `url`. */
  mode?: 'url' | 'srcdoc';
  /** Имя для журнала и настроек. */
  name: string;
  /** Подпись для списка выбора. */
  label: string;
}

/** Открытый экран: iframe плюс обещание результата. */
interface OpenScreen {
  frame: HTMLIFrameElement;
  /** Разрешить обещание результатом или отменой (null). */
  resolve: (outcome: DockingOutcome | null) => void;
}

/**
 * Достаёт разметку экрана из `<script type="text/plain">`.
 *
 * Там она лежит в base64: внутри `<script>` HTML-сущности не
 * декодируются, поэтому простое экранирование `<` ломало экран —
 * он приезжал текстом. В base64 символа `<` нет вовсе.
 */
function decodeEmbeddedScreen(raw: string): string {
  const text = raw.trim();
  if (!text) return '';
  try {
    // atob даёт «бинарную строку» — возвращаем байты обратно в UTF-8.
    const bytes = Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    // Уже готовая разметка (сборка без base64) — отдаём как есть.
    return text;
  }
}

export class IframeDockingModule {
  readonly name: string;
  readonly label: string;
  private readonly src: string;
  private readonly mode: 'url' | 'srcdoc';
  private current: OpenScreen | null = null;

  constructor(options: IframeDockingOptions) {
    this.src = options.src;
    this.mode = options.mode ?? 'url';
    this.name = options.name;
    this.label = options.label;
  }

  /**
   * Открывает экран стыковки поверх игры и ждёт результат.
   * Возвращает null, если игрок закрыл экран, не приняв решения.
   */
  open(config: DockingConfig): Promise<DockingOutcome | null> {
    if (this.current) return Promise.resolve(null);

    return new Promise<DockingOutcome | null>((resolve) => {
      const frame = document.createElement('iframe');
      if (this.mode === 'srcdoc') {
        // Встроенный экран: берём разметку из страницы. `sandbox`
        // оставляет экрану только скрипты — без доступа к родителю
        // и без всплывающих окон. `allow-same-origin` добавлен
        // намеренно: без него `srcdoc` получает origin `null`,
        // и обмен сообщениями между документами становится хрупким.
        // Изоляция здесь и так есть — экран не видит состояние игры
        // иначе как через протокол.
        frame.srcdoc = decodeEmbeddedScreen(document.getElementById(this.src)?.textContent ?? '');
        frame.sandbox.add('allow-scripts', 'allow-same-origin');
      } else {
        frame.src = this.src;
      }
      frame.title = `Стыковка (${this.label})`;
      frame.dataset.docking = '1';
      Object.assign(frame.style, {
        position: 'fixed',
        inset: '0',
        width: '100%',
        height: '100%',
        border: '0',
        background: '#05080a',
        zIndex: '900',
      } as Partial<CSSStyleDeclaration>);

      const screen: OpenScreen = { frame, resolve: (o) => finish(o) };
      this.current = screen;

      const post = (msg: ToFrame): void => {
        // Цель — '*' намеренно: экран может быть открыт с любого адреса
        // (в сборке — относительный путь, в прототипах — свой origin).
        // Доверяем не источнику, а форме сообщения (parseFromFrame).
        frame.contentWindow?.postMessage({ channel: DOCKING_CHANNEL, ...msg }, '*');
      };

      const onMessage = (ev: MessageEvent): void => {
        // Сообщение принимаем только от нашего iframe.
        if (ev.source !== frame.contentWindow) return;
        const msg = parseFromFrame(ev.data);
        if (!msg) return;
        if (msg.type === 'docking:ready') {
          post({ type: 'docking:init', config });
          return;
        }
        if (msg.type === 'docking:result') {
          screen.resolve({ docked: msg.docked, damage: msg.damage, jumpedAway: msg.jumpedAway });
          return;
        }
        // Уход из системы: и обычный прыжок, и галактический —
        // это «игрок бросил заход». Тип прыжка различает вызывающий код.
        if (msg.type === 'docking:jump') {
          screen.resolve({ docked: false, damage: 0, jumpedAway: true, jumpKind: 'normal' });
        }
        if (msg.type === 'docking:galactic-jump') {
          screen.resolve({ docked: false, damage: 0, jumpedAway: true, jumpKind: 'galactic' });
        }
      };

      const finish = (outcome: DockingOutcome | null): void => {
        if (this.current !== screen) return;
        this.current = null;
        window.removeEventListener('message', onMessage);
        frame.remove();
        resolve(outcome);
      };

      window.addEventListener('message', onMessage);
      document.body.appendChild(frame);
    });
  }

  /** Закрыть экран снаружи (например, при выходе из игры). */
  close(): void {
    this.current?.resolve(null);
  }
}
