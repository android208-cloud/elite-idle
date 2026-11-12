import { autoCombat, startCombat } from '../src/core/combat.ts';
import { STARTER_SHIP } from '../src/core/ships.ts';

const rate = (enemy: string) => {
  let died=0, fled=0, won=0, efled=0, eleft=0;
  for (let seed=1; seed<=300; seed++) {
    const r = autoCombat(startCombat(enemy, STARTER_SHIP, false, 0, seed)).outcome;
    if (r==='died')       died++;
    if (r==='fled')       fled++;
    if (r==='won')        won++;
    if (r==='enemy-fled') efled++;
    if (r==='enemy-left') eleft++;
  }
  return { died, fled, won, efled, eleft };
};

console.log('Sidewinder:', rate('sidewinder'));
console.log('Python:',     rate('python'));
console.log('Anaconda:',   rate('anaconda'));
console.log('Asp:',        rate('asp'));

