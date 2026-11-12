/**
 * Сводка исходов автобоя по типам противников. Запуск:
 *   node tools/balance.ts [число боёв]
 */
import { autoCombat, startCombat } from '../src/core/combat.ts';
import { ENEMIES, STARTER_SHIP, type PlayerShip } from '../src/core/ships.ts';

const N = Number(process.argv[2] ?? 500);

function report(title: string, ship: PlayerShip): void {
  console.log(`\n${title}`);
  console.log('противник'.padEnd(14), 'победа', 'ушёл', 'враг ушёл', 'гибель', 'раундов');
  for (const e of ENEMIES) {
    const counts: Record<string, number> = {};
    let rounds = 0;
    for (let seed = 1; seed <= N; seed++) {
      const r = autoCombat(startCombat(e.id, ship, false, 0, seed));
      counts[r.outcome!] = (counts[r.outcome!] ?? 0) + 1;
      rounds += r.round;
    }
    const pct = (k: string): string => `${Math.round(((counts[k] ?? 0) / N) * 100)}%`.padEnd(7);
    const leave = ((counts['fled'] ?? 0) + (counts['enemy-left'] ?? 0)) / N;
    console.log(
      e.name.padEnd(14),
      pct('won'),
      `${Math.round(leave * 100)}%`.padEnd(5),
      pct('enemy-fled').padEnd(9),
      pct('died').padEnd(6),
      (rounds / N).toFixed(1),
    );
  }
}

report('Стартовый корабль (импульсный лазер, 3 ракеты)', STARTER_SHIP);
report('С лучевым лазером и ECM', { ...STARTER_SHIP, laser: 'beam', ecm: true });

