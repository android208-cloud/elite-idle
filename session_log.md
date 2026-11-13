# Журнал разработки проекта Elite Idle (Session Log)

Дата фиксации: 13 ноября 2026 г.  
Репозиторий проекта: [https://github.com/android208-cloud/elite-idle](https://github.com/android208-cloud/elite-idle)

---

## 1. Контекст и хронология диалога

### 1.1. Цель проекта
Разработка **Elite Idle** — браузерной idle / captain-manager игры по мотивам классической игры **Elite (1984/1985, BBC Micro)** Дэвида Брабена и Яна Белла.

**Ключевой критерий качества:**
- Все механики (генерация 8 галактик, торговля, рынок, параметры кораблей, формулы урона, цены оборудования, правовой статус и боевые ранги) должны строго соответствовать оригинальному ассемблерному коду BBC Micro (репозитории `markmoxon/elite-beebasm` и `elite-source-code-library`) и эталону `txtelite.c` Яна Белла.
- Любое извлечённое значение из оригинала покрывается референсным автотестом.

---

### 1.2. Хронология этапов

#### Этап 1. Базовая реализация игры
1. Создан детерминированный генератор псевдослучайных чисел (Mulberry32 PRNG) для стабильности вселенной.
2. Реализована процедурная генерация 8 галактик по 256 звездных систем с аутентичными названиями, координатами и характеристиками.
3. Построена экономика и рынок 17 оригинальных товаров с детерминированными колебаниями цен.
4. Разработан модуль кораблей, оборудования и пошагового боя.
5. Создано состояние игры (`GameState`), полёты в реальном времени, офлайн-досчёт прогресса, система сохранения v2 в `localStorage`.
6. Реализован веб-интерфейс на чистом TypeScript/CSS с интерактивной картой галактики (Canvas API), вкладками «Корабль», «Карта», «Рынок», «Ангар», «Журнал» и экраном пошагового боя.

#### Этап 2. Сверка с оригинальными ассемблерными исходниками
1. Загружены и подключены эталонные библиотеки:
   - `reference/txtelite.c` (эталон Яна Белла)
   - `reference/elite-source-code-bbc-micro-cassette-main/`
   - `reference/elite-source-code-library-main/` (полный аннотированный архив исходников)
2. Создан скрипт `tools/extract-ships.ts`, автоматически парсящий таблицы чертежей кораблей из оригинального ASM-кода (`ship_*.asm`).
3. Заменены все первоначально приблизительные значения:
   - Энергия, щиты, лазеры, ракеты и награды кораблей.
   - Цены оборудования по таблице `PRXS`.
   - Пороги рангов по анализу подпрограммы `STATUS` (`status.asm`).
   - Механика урона противников по формуле `byte#19 >> 1` из `tactics_part_6_of_7.asm`.
4. Написан набор эталонных тестов `test/reference-ships.test.ts` (26 тестов), сверяющий каждый корабль и предмет с оригиналом. Общее количество тестов доведено до 71/71.

#### Этап 3. Публикация на GitHub и настройка CI/CD
1. Настроен `.gitignore` (исключены `node_modules`, `dist` и 23 МБ эталонных архивов `reference/`).
2. Оформлен подробный `README.md`.
3. Репозиторий опубликован на GitHub: `https://github.com/android208-cloud/elite-idle.git`.
4. Создан GitHub Actions workflow (`.github/workflows/deploy.yml`) для сборки, тестирования и деплоя на GitHub Pages.

---

## 2. Принятые архитектурные решения

### 2.1. Парадигма кода
- **Функциональный подход и иммутабельность:** функции ядра (`buy`, `sell`, `refuel`, `startJump`, `advance`, `combatRound`, `combatAction`) принимают состояние и возвращают новое, никогда не мутируя входной объект.
- **Отсутствие сторонних UI-фреймворков:** проект собран на легковесном стеке Vite + TypeScript + Native DOM API без React/Vue, что обеспечивает мгновенную загрузку (< 40 КБ JS).
- **Разделение слоев:** ядро (`src/core/`) полностью изолировано от DOM и браузерных API, что позволяет запускать все тесты в чистом Node.js окружении без эмуляции браузера.

### 2.2. Единицы измерения
- **Деньги:** целочисленные десятые доли кредита (`100 = 10.0 CR`, `1 = 0.1 CR`). Это исключает ошибки округления с плавающей точкой IEEE 754 и в точности соответствует `txtelite.c`.
- **Топливо и расстояния:** десятые доли светового года (`70 = 7.0 LY`, максимальный бак Cobra Mk III = 70).
- **Время в пути:** рассчитывается из расстояния и темпа игры (`settings.speed`). Поддерживается фоновый офлайн-досчёт при открытии вкладки.

### 2.3. Игровая механика и математика из оригинала

#### Экономика и галактика
- **Алгоритм Фибоначчи для галактики:** три 16-битных числа (`w0, w1, w2`) генерируют имя, координаты, тип экономики, форму правления и техуровень каждой системы.
- **Цены рынка:** базовая цена, экономический градиент, плюс случайное колебание от `fluctuation` системы.

#### Параметры кораблей (источник: `ship_*.asm`)
| Корабль | Энергия | Урон лазера за раунд | Ракеты | Награда (0.1 CR) | Особенности |
|---|---|---|---|---|---|
| Sidewinder | 70 | 8 | 0 | 50 | Базовый пират |
| Gecko | 70 | 8 | 0 | 55 | Легкий пират |
| Adder | 85 | 8 | 0 | 40 | Курьер / пират |
| Cobra Mk I | 90 | 9 | 2 | 75 | Пират |
| Mamba | 90 | 9 | 2 | 150 | Быстрый перехватчик |
| Krait | 80 | 8 | 0 | 100 | Маневренный истребитель |
| Moray | 100 | 8 | 0 | 50 | В оригинале баг спавна |
| Cobra Mk III | 150 | 9 | 2 | 175 | Пиратская версия `cobra_mk_3_p` |
| Asp Mk II | 150 | 20 | 1 | 200 | Опасный военный корабль |
| Fer-de-Lance | 160 | 9 | 2 | 0 | В оригинале награды нет |
| Python | 250 | 13 | 3 | 200 | Тяжелый крейсер |
| Anaconda | 252 | 31 | 7 | 0 | Сверхтяжелый транспорт/рейдер |
| Viper | 120 | 8 | 1 | 0 | Полиция (Fugitive при атаке) |

#### Модель боя и урона
- **Урон врага по игроку:** рассчитывается по байту конфигурации вооружения корабля `byte#19`:
  $$\text{Damage} = \text{byte\#19} \gg 1 = ((\text{laserPower} \ll 3) \mid \text{missiles}) \gg 1$$
- **Лазеры игрока** (из `elite-source-docked.asm`):
  - Импульсный (Pulse): $\text{POW} = 15$
  - Добывающий (Mining): $\text{Mlas} = 50$
  - Лучевой (Beam): $\text{POW} \mid 32 = 47$
  - Военный (Military): $\lfloor 128.5 + 1.5 \times \text{POW} \rfloor = 151$
- **Щиты и энергия:** щиты 0–255 (адаптировано в единый буфер), энергия 0–255. Урон сначала поглощается щитами, излишек переходит в энергию.

#### Цены оборудования (таблица `PRXS`)
- Ракета: 30.0 CR (300)
- Увеличенный трюм: 400.0 CR (4000)
- ECM: 600.0 CR (6000)
- Импульсный лазер: 400.0 CR (4000)
- Лучевой лазер: 1000.0 CR (10000)
- Топливосборщик: 525.0 CR (5250)
- Спасательная капсула: 1000.0 CR (10000)
- Энергобомба: 900.0 CR (9000)
- Доп. энергоблок: 1500.0 CR (15000)
- Стыковочный компьютер: 1000.0 CR (10000) *(исправлено: было 15000)*
- Галактический гипердвигатель: 5000.0 CR (50000)
- Военный лазер: 6000.0 CR (60000)
- Добывающий лазер: 800.0 CR (8000)

#### Система рангов (`status.asm`)
16-битный счетчик убийств `TALLY`:
- **Безобидный (Harmless):** 0–3
- **Почти безобидный (Mostly Harmless):** 4–15
- **Слабый (Poor):** 16–31
- **Средний (Average):** 32–63
- **Выше среднего (Above Average):** 64–127
- **Опытный (Competent):** 128–511
- **Опасный (Dangerous):** 512–2559
- **Смертельный (Deadly):** 2560–6399
- **ЭЛИТА (Elite):** 6400+

#### Правовой статус (`FIST`)
- $0$: Чист (Clean)
- $1 \dots 49$: Нарушитель (Offender)
- $\ge 50$: Беглец (Fugitive)
- При каждом гиперпрыжке статус делится на два (`LSR FIST`, `solar.asm`).
- Уничтожение полицейского (Viper) накладывает `ORA #64` — мгновенный статус Беглеца.

---

## 3. Реестр файлов проекта

### Корневые файлы конфигурации
- [.gitignore](file:///C:/Users/Alexandr/.gemini/antigravity/scratch/elite-idle/.gitignore) — правила исключения временных файлов, зависимостей и референс-каталога.
- [README.md](file:///C:/Users/Alexandr/.gemini/antigravity/scratch/elite-idle/README.md) — обзорная документация проекта, стек, запуск, тесты.
- [package.json](file:///C:/Users/Alexandr/.gemini/antigravity/scratch/elite-idle/package.json) — конфигурация скриптов (`dev`, `build`, `test`) и зависимостей.
- [package-lock.json](file:///C:/Users/Alexandr/.gemini/antigravity/scratch/elite-idle/package-lock.json) — фиксация версий зависимостей.
- [tsconfig.json](file:///C:/Users/Alexandr/.gemini/antigravity/scratch/elite-idle/tsconfig.json) — настройки TypeScript (strict mode, ESNext).
- [vite.config.ts](file:///C:/Users/Alexandr/.gemini/antigravity/scratch/elite-idle/vite.config.ts) — конфигурация сборщика Vite (`base: './'` для GitHub Pages).
- [index.html](file:///C:/Users/Alexandr/.gemini/antigravity/scratch/elite-idle/index.html) — HTML-каркас веб-приложения.

### CI/CD
- [.github/workflows/deploy.yml](file:///C:/Users/Alexandr/.gemini/antigravity/scratch/elite-idle/.github/workflows/deploy.yml) — автоматический деплой на GitHub Pages при пуше в `main`.

### Исходный код ядра (`src/core/`)
- [src/core/rng.ts](file:///C:/Users/Alexandr/.gemini/antigravity/scratch/elite-idle/src/core/rng.ts) — детерминированный PRNG (Mulberry32).
- [src/core/galaxy.ts](file:///C:/Users/Alexandr/.gemini/antigravity/scratch/elite-idle/src/core/galaxy.ts) — генерация 8 галактик по 256 звездных систем, расчет расстояний.
- [src/core/market.ts](file:///C:/Users/Alexandr/.gemini/antigravity/scratch/elite-idle/src/core/market.ts) — расчет рыночных цен и запасов товаров для текущей системы.
- [src/core/ships.ts](file:///C:/Users/Alexandr/.gemini/antigravity/scratch/elite-idle/src/core/ships.ts) — параметры кораблей, оборудования, рангов и правового статуса.
- [src/core/combat.ts](file:///C:/Users/Alexandr/.gemini/antigravity/scratch/elite-idle/src/core/combat.ts) — пошаговый боевой движок, действия игрока, автобой.
- [src/core/state.ts](file:///C:/Users/Alexandr/.gemini/antigravity/scratch/elite-idle/src/core/state.ts) — управление полным состоянием игры, покупки, прыжки, случайные встречи, спасение/гибель, сериализация/десериализация.

### Пользовательский интерфейс (`src/ui/`)
- [src/ui/main.ts](file:///C:/Users/Alexandr/.gemini/antigravity/scratch/elite-idle/src/ui/main.ts) — рендеринг экранов, обработка кликов, отрисовка карты галактики на Canvas, тикер реального времени.
- [src/ui/styles.css](file:///C:/Users/Alexandr/.gemini/antigravity/scratch/elite-idle/src/ui/styles.css) — стили в стиле ретро-интерфейса Elite (темная тема, янтарные и бирюзовые акценты).
- [src/vite-env.d.ts](file:///C:/Users/Alexandr/.gemini/antigravity/scratch/elite-idle/src/vite-env.d.ts) — типизация Vite клиентского окружения.

### Автотесты (`test/`)
- [test/galaxy.test.ts](file:///C:/Users/Alexandr/.gemini/antigravity/scratch/elite-idle/test/galaxy.test.ts) — тесты структуры галактики, Lave, Diso, 8 галактик.
- [test/reference.test.ts](file:///C:/Users/Alexandr/.gemini/antigravity/scratch/elite-idle/test/reference.test.ts) — сверка рынка с `txtelite.c`.
- [test/reference-ships.test.ts](file:///C:/Users/Alexandr/.gemini/antigravity/scratch/elite-idle/test/reference-ships.test.ts) — сверка параметров кораблей и цен оборудования с исходниками.
- [test/encounters.test.ts](file:///C:/Users/Alexandr/.gemini/antigravity/scratch/elite-idle/test/encounters.test.ts) — боевой баланс, встречи, ECM, бомба, спасательная капсула.
- [test/state.test.ts](file:///C:/Users/Alexandr/.gemini/antigravity/scratch/elite-idle/test/state.test.ts) — торговля, топливо, прыжки, темп игры, сохранение/загрузка.

### Вспомогательные скрипты (`tools/`)
- [tools/extract-ships.ts](file:///C:/Users/Alexandr/.gemini/antigravity/scratch/elite-idle/tools/extract-ships.ts) — автоматический парсер характеристик кораблей из ассемблерных исходников.
- [tools/balance.ts](file:///C:/Users/Alexandr/.gemini/antigravity/scratch/elite-idle/tools/balance.ts) — симуляция сотен боев для анализа винрейта против различных врагов.
- [tools/diag-combat.ts](file:///C:/Users/Alexandr/.gemini/antigravity/scratch/elite-idle/tools/diag-combat.ts) — диагностический скрипт детализации исходов боев.

---

## 4. Текущий статус качества

- **Тесты:** 71/71 успешно пройдены (`node --test test/`).
- **TypeScript:** 0 ошибок компиляции (`tsc --noEmit`).
- **Сборка:** чистый production-билд (`dist/` — 35.8 КБ JS gzip 12.9 КБ, 3.7 КБ CSS).
- **Git:** ветка `main` синхронизирована с `origin/main` на GitHub.

---

## 5. Бэклог и следующие шаги

1. **Контрабанда при взлёте:**
   - Реализовать формулу оригинальной проверки контрабанды: `(slaves + narcotics) * 2 + firearms` добавляется к `FIST` при вылете со станции.
2. **Технологические уровни оборудования из `eqshp.asm`:**
   - Проверить точную таблицу минимальных технологических уровней для покупки оборудования на верфи.
3. **Обработка бага спавна Moray:**
   - В оригинале Moray никогда не спавнился из-за ошибки смещения на 1 в генераторе случайных встреч. Принять решение: оставить аутентичный баг или исправить его опциональной настройкой.
4. **Визуальные улучшения боевого интерфейса:**
   - Анимированные полосы щитов и энергии, детализированный лог попаданий и промахов.
5. **Галактический гипердвигатель:**
   - Добавить полноценный переход между галактиками 1–8 с сохранением прогресса корабля и генерацией соответствующей карты.
