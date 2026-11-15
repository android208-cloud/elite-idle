/**
 * Стыковка — правила, отдельно от рендера.
 *
 * Модель взята из прототипа пользователя (`user-docking.html`) и приведена
 * к чистой функции без canvas и DOM. Это то, что раздел 43.5 требовал:
 * правила отдельно, картинка отдельно.
 *
 * Отступления от прототипа пользователя, каждое обосновано:
 *  1. Ограничение по времени — нет (пользователь: «ограничения времени нет»).
 *  2. Шлюз прямоугольный — из-за этого крен влияет на успех (настоящий Кориолис).
 *  3. Провал = урон + второй круг (раздел 45), а не смерть.
 */

/* ---------- Настройки ---------- */

export const CFG = {
  // Управление смещением (X/Y). Ньютонова модель с «автоторможением».
  THRUST: 0.08,
  // Трение X/Y. Максимальная скорость = THRUST/(1−DRAG) = 1.0 ед/кадр.
  // При 0.985 (как у пользователя) было 5.3 ед/кадр — корабль проносило
  // мимо створа и точное позиционирование было невозможно.
  DRAG_XY: 0.92,

  // Вращение. В оригинале $FE01 без затухания, НО там игрок управляет
  // самим положением (две кнопки влево/вправо поворачивают корабль),
  // а не угловой скоростью. В прототипе пользователя кнопки меняют
  // vAngle, и без затухания корабль раскручивается до 0.8 рад/кадр
  // и не может остановиться — стыковка становится неуправляемой.
  //
  // Решение: угловая скорость затухает, но слабо — руль «держит»
  // установившуюся скорость, а не разгоняется бесконечно.
  // Импульс крена. Кнопки меняют УГЛОВУЮ СКОРОСТЬ, скорость НЕ затухает —
  // как $FE01 в оригинале, где тоже нет демпфирования.
  // Мелкий импульс нужен, чтобы точно попасть в допуск синхронизации 0.005.
  ROT: 0.0006,
  // Затухания НЕТ. Тап добавляет угловую скорость навсегда: подобрал
  // нужную — держится. Раскрутился — гасишь обратной кнопкой.
  // Это ровно модель оригинала ($FE01).
  DRAG_ROT: 1,
  // Потолок оставляем только как защиту от раскрутки до бесконечности.
  // Он ВЫШЕ диапазона станции (0.0097) и не мешает синхронизации.
  MAX_VANGLE: 0.020,

  // Тяга по Z (сближение).
  Z_THRUST: 0.015,
  DRAG_Z: 0.99,

  // Дистанция.
  START_Z: 120,

  // Контакт считаем на подлёте, а не в точке z=0: иначе перспектива
  // вырождается и станция «занимает весь экран».
  DOCK_CONTACT: 2,
  MAX_Z: 150,

  // --- Критерии успеха (как в оригинале: |Z| < $1E из 128 = 23 %) ---
  // Смещение центра — в радиусах станции, ровно как в оригинале
  // (там |Z| < $1E из $80, то есть доля от радиуса).
  // Порог = полуширина шлюза / радиус = 10/32 = 0.31 радиуса.
  // Игрок должен попасть в створ, а не в центр станции.
  STATION_RADIUS: 32,
  POS_TOL_RATIO: 0.31,
  // Синхронизация вращения: допуск 0.005 рад/кадр (из прототипа пользователя).
  SPIN_TOL: 0.005,
  // Угол маркеров: 15°.
  ANGLE_TOL_DEG: 15,
  // Скорость сближения: 0.6 (в оригинале порог ~0.55).
  // Порог скорости сближения. В оригинале сравнивается PlayerSpeed,
  // у которого терминальная скорость иная. Наш масштаб: 0.6 ед/кадр
  // соответствует «медленно, почти вползая». Терминальная 1.5.
  SPEED_TOL: 0.6,

  // Сколько кадров держится «створ» для проверки: контакт фиксируется
  // при пересечении DOCK_ZONE, и скорость берётся СРЕДНЯЯ за последние
  // кадры, а не мгновенная — иначе нужно попасть в один кадр.
  SPEED_WINDOW: 12,

  // --- Крен и прямоугольный шлюз ---
  // Угол крена относительно створа. Крен 0 = шлюз «лежит» правильно.
  ROLL_TOL_DEG: 25,

  // Потолок урона за один провал
  MAX_CRASH_DAMAGE: 60,
  // Насколько вытянут шлюз: 20 × 60 → 3.0
  DOCK_ASPECT: 3.0,
};

/* ---------- Состояние ---------- */

/**
 * @typedef {object} DockingState
 * @property {{x,y,vx,vy,angle,vAngle,z,vz}} player
 * @property {{x,y,vx,vy,angle,vAngle,roll,vRoll}} target
 * @property {boolean} done
 * @property {'ok'|'crash'|null} outcome
 * @property {object|null} errors  — отклонения на момент провала/успеха
 */

/** Новое состояние: корабль далеко, станция дрейфует и вращается. */
export function createState(seed = Math.random) {
  const s = () => seed() * 2 - 1;
  const targetX = s() * 20;
  const targetY = s() * 20;
  return {
    player: {
      x: s() * 40,
      y: s() * 40,
      vx: 0, vy: 0,
      angle: 0,
      vAngle: s() * 0.02,
      z: CFG.START_Z,
      vz: 0,
    },
    target: {
      x: targetX,
      y: targetY,
      vx: s() * 0.2,
      vy: s() * 0.2,
      angle: seed() * Math.PI * 2,
      vAngle: (seed() > 0.5 ? 1 : -1) * (seed() * 0.02 + 0.015),
      // Крен станции — то, что делает шлюз прямоугольным, а не круглым.
      roll: seed() * Math.PI * 2,
      vRoll: (seed() > 0.5 ? 1 : -1) * (seed() * 0.006 + 0.004),
    },
    done: false,
    outcome: null,
    errors: null,
    vzHistory: [],
  };
}

/* ---------- Шаг ---------- */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Один кадр физики. Мутирует переданное состояние (для скорости в кадре),
 * но не трогает DOM и canvas.
 *
 * @param {DockingState} st
 * @param {{up,down,left,right,ccw,cw,forward,backward}} input
 * @param {number} dt — множитель времени; в прототипе 1 кадр = 1, оставляем
 *                      так для совместимости с ощущениями пользователя.
 */
export function step(st, input, dt = 1) {
  if (st.done) return st;
  const p = st.player;
  const t = st.target;

  /* --- смещение X/Y относительно текущего поворота корабля --- */
  let moveX = 0;
  let moveY = 0;
  if (input.up) moveY -= CFG.THRUST;
  if (input.down) moveY += CFG.THRUST;
  if (input.left) moveX -= CFG.THRUST;
  if (input.right) moveX += CFG.THRUST;

  // Тяга в мировых осях: экран не вращается, «вверх» всегда вверх.
  // Иначе при vAngle≠0 корабль уносит вкось и позицию не удержать.
  p.vx += moveX * dt;
  p.vy += moveY * dt;

  /* --- вращение: без затухания --- */
  if (input.cw) p.vAngle += CFG.ROT * dt;
  if (input.ccw) p.vAngle -= CFG.ROT * dt;
  // Затухания нет (DRAG_ROT = 1): скорость держится сама.
  if (CFG.DRAG_ROT !== 1) p.vAngle *= Math.pow(CFG.DRAG_ROT, dt);
  // Потолок: не даём раскрутиться до бесконечности.
  p.vAngle = Math.max(-CFG.MAX_VANGLE, Math.min(CFG.MAX_VANGLE, p.vAngle));

  /* --- сближение --- */
  if (input.forward) p.vz -= CFG.Z_THRUST * dt;
  if (input.backward) p.vz += CFG.Z_THRUST * dt;

  /* --- интегрирование --- */
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.vx *= Math.pow(CFG.DRAG_XY, dt);
  p.vy *= Math.pow(CFG.DRAG_XY, dt);

  p.z += p.vz * dt;
  p.vz *= Math.pow(CFG.DRAG_Z, dt);
  p.angle += p.vAngle * dt;

  /* --- станция: дрейф с отскоком от стенок --- */
  t.x += t.vx * dt;
  t.y += t.vy * dt;
  if (Math.abs(t.x) > 100) t.vx *= -1;
  if (Math.abs(t.y) > 100) t.vy *= -1;
  t.angle += t.vAngle * dt;
  t.roll += t.vRoll * dt;

  /* --- границы --- */
  if (p.z > CFG.MAX_Z) {
    p.z = CFG.MAX_Z;
    p.vz = 0;
  }
  // Улететь назад можно, но не бесконечно
  if (p.z < -CFG.MAX_Z) {
    p.z = -CFG.MAX_Z;
    p.vz = 0;
  }

  /* --- история скорости для средней оценки на контакте --- */
  st.vzHistory.push(Math.abs(p.vz));
  if (st.vzHistory.length > CFG.SPEED_WINDOW) st.vzHistory.shift();

  /* --- контакт --- */
  if (p.z <= CFG.DOCK_CONTACT) {
    p.z = CFG.DOCK_CONTACT;
    st.done = true;
    st.errors = measure(st);
    st.outcome = isClean(st.errors) ? 'ok' : 'crash';
  }

  return st;
}

/* ---------- Измерения ---------- */

/** Нормализует угол в диапазон (−π, π]. */
export function wrapAngle(a) {
  let x = a % (Math.PI * 2);
  if (x <= -Math.PI) x += Math.PI * 2;
  if (x > Math.PI) x -= Math.PI * 2;
  return x;
}

/** Все отклонения в человеческих единицах. */
export function measure(st) {
  const p = st.player;
  const t = st.target;

  const posDist = Math.hypot(t.x - p.x, t.y - p.y);
  // Смещение в радиусах станции: 0 = точно в центре створа,
  // 1 = на краю станции. Так же нормировано, как $1E/$80 в оригинале.
  const posErr = posDist / CFG.STATION_RADIUS;

  // ── ВРАЩЕНИЕ ────────────────────────────────────────────────────────────
  // Почему не «angle + vAngle» как в прототипе пользователя:
  //
  // angle += vAngle, значит при РАВНЫХ vAngle разность углов НЕ МЕНЯЕТСЯ.
  // Получается задача «попасть в фазу», где нужно ОТКЛОНИТЬ скорость,
  // довернуть фазу и вернуть скорость обратно — всё в один кадр контакта.
  // Это не «синхронизация вращения», это лотерея.
  //
  // В реальной стыковке (и в Elite) створ — это ОРИЕНТАЦИЯ, а не фаза:
  // сравнивается, насколько шлюз повёрнут относительно корабля, и
  // насколько различаются угловые скорости. Ровно это и меряем.

  // 1. Насколько створ «повёрнут» относительно корабля, в градусах.
  //    Приводим к (−90°, 90°]: у станции 4-кратная симметрия по крену,
  //    но створ один, поэтому крен меряем от 0.
  const dockTilt = wrapAngle(t.roll - p.angle);
  const angleErr = Math.abs(dockTilt) * (180 / Math.PI);

  // 2. Разница угловых скоростей — «синхронность вращения».
  const spinErr = Math.abs(t.vRoll - p.vAngle);

  // 3. Крена как отдельного признака больше нет: он вошёл в angleErr.
  //    Оставляем поле 0, чтобы вызывающий код не ломался.
  const rollErr = 0;

  // Средняя скорость за последние кадры, а не мгновенная: иначе нужно
  // попасть в один кадр, что физически невозможно при импульсном управлении.
  const hist = st.vzHistory && st.vzHistory.length ? st.vzHistory : [Math.abs(p.vz)];
  const speedErr = hist.reduce((a, b) => a + b, 0) / hist.length;

  return { posErr, angleErr, spinErr, speedErr, rollErr, dockTilt };
}

/**
 * Чистая стыковка. Пять условий.
 *
 * Пятое (крен) — то, ради чего мы заменили круг на Кориолис:
 * прямоугольный шлюз не прощает перекос.
 */
export function isClean(e) {
  return (
    e.posErr < CFG.POS_TOL_RATIO &&
    e.angleErr < CFG.ANGLE_TOL_DEG &&
    e.spinErr < CFG.SPIN_TOL &&
    e.speedErr < CFG.SPEED_TOL &&
    e.rollErr < CFG.ROLL_TOL_DEG
  );
}

/** Какие именно условия провалены — для текста «почему». */
export function failures(e) {
  const out = [];
  if (e.posErr >= CFG.POS_TOL_RATIO) out.push('pos');
  if (e.angleErr >= CFG.ANGLE_TOL_DEG) out.push('angle');
  if (e.spinErr >= CFG.SPIN_TOL) out.push('spin');
  if (e.speedErr >= CFG.SPEED_TOL) out.push('speed');
  if (e.rollErr >= CFG.ROLL_TOL_DEG) out.push('roll');
  return out;
}

export const FAILURE_TEXT = {
  pos: 'смещение от центра шлюза',
  angle: 'не совмещены маркеры угла',
  spin: 'не синхронизировано вращение',
  speed: 'слишком высокая скорость сближения',
  roll: 'не выровнен крен — шлюз перекошен',
};

/**
 * Урон за провал — по формуле оригинала `$EB10`:
 *   12 + 2 × скорость
 * плюс надбавка за перекос (изобретение наше, обосновано: прямоугольный
 * шлюз наказывает за крен сильнее, чем круглый).
 */
export function crashDamage(e) {
  const base = 12 + 2 * e.speedErr;
  const rollPenalty = Math.max(0, e.rollErr - CFG.ROLL_TOL_DEG) * 0.4;
  const posPenalty = Math.max(0, e.posErr - CFG.POS_TOL_RATIO) * 40;
  // Потолок: одна ошибка не должна съедать весь корпус.
  return Math.round(Math.min(CFG.MAX_CRASH_DAMAGE, base + rollPenalty + posPenalty));
}

/** Допуск позиции как доля радиуса — для проверки соответствия оригиналу. */
export function posToleranceRatio() {
  // В оригинале порог стыковки $1E из $80 = 30/128 = 0.234.
  return 0x1e / 0x80;
}
