/**
 * Извлекает характеристики кораблей из разобранного исходного кода Elite
 * (reference/elite-source-code-library-main) и печатает таблицу.
 *   node tools/extract-ships.ts          таблица
 *   node tools/extract-ships.ts --json   JSON
 *
 * Берутся значения основной версии (ветка IF NOT(_ELITE_A_VERSION)),
 * т. е. как в оригинальной дисковой Elite.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../reference/elite-source-code-library-main/library/', import.meta.url);

export interface Blueprint {
  id: string;
  maxCanisters: number;
  bounty: number;
  energy: number;
  speed: number;
  laserPower: number;
  missiles: number;
}

function filesIn(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => /^ship_.*\.asm$/.test(f)).map((f) => join(dir, f));
  } catch {
    return [];
  }
}

/** Первое число в строке, содержащей комментарий с этим ключом */
function field(lines: string[], key: RegExp): number | undefined {
  for (const line of lines) {
    if (!key.test(line)) continue;
    const m = line.match(/EQU[BW]\s+(-?\d+)\b/);
    if (m && !line.trim().startsWith('\\')) return Number(m[1]);
  }
  return undefined;
}

export function extractShips(): Blueprint[] {
  const dirs = [
    new URL('common/main/variable', ROOT).pathname,
    new URL('enhanced/main/variable', ROOT).pathname,
  ].map((p) => decodeURIComponent(p.replace(/^\//, '')));
  const out: Blueprint[] = [];
  for (const file of dirs.flatMap(filesIn)) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    const id = file.match(/ship_(.*)\.asm$/)![1];
    const energy = field(lines, /Max\. energy/);
    const bounty = field(lines, /\\ Bounty\s+=/);
    const speed = field(lines, /Max\. speed/);
    const canisters = field(lines, /Max\. canisters on demise/);
    const li = lines.findIndex((l) => /Laser power\s+=/.test(l) && !l.trim().startsWith('\\'));
    if (energy === undefined || bounty === undefined || speed === undefined || canisters === undefined || li < 0) {
      continue; // не боевой объект (станция, астероид и т. п. без части полей)
    }
    const bits = lines[li].match(/%([01]{8})/);
    if (!bits) continue;
    const byte = parseInt(bits[1], 2);
    out.push({ id, maxCanisters: canisters, bounty, energy, speed, laserPower: byte >> 3, missiles: byte & 7 });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

if (import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
  const ships = extractShips();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(ships, null, 2));
  } else {
    console.log('id'.padEnd(16), 'энерг.', 'лазер', 'ракет', 'награда', 'скор.', 'конт.');
    for (const s of ships) {
      console.log(
        s.id.padEnd(16),
        String(s.energy).padEnd(6),
        String(s.laserPower).padEnd(5),
        String(s.missiles).padEnd(5),
        String(s.bounty).padEnd(7),
        String(s.speed).padEnd(5),
        s.maxCanisters,
      );
    }
  }
}

