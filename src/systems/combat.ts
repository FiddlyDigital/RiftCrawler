import type { Game } from '../game';
import type { Monster } from '../entities';

export function triggerDeath(game: Game, title: string, reason: string): void {
  // Deathward Rune: survive the killing blow once per floor per charge
  if (game.player.deathwardCharges > 0) {
    game.player.deathwardCharges--;
    game.player.hp = Math.max(1, Math.floor(game.player.maxHp * 0.30));
    game.cb.log('💀 Deathward activates — pulled back from the brink!', 'log-success');
    game.cb.onParticle?.(game.player.x, game.player.y, '💀 REVIVED', '#b71c1c', 16);
    return;
  }
  // Life Brand: free revive but erases all brands
  if (game.player.lifeBrandRevive) {
    game.player.lifeBrandRevive = false;
    const brandCount = game.player.brands.length;
    game.player.brands = [];
    game.player.hp = Math.max(1, Math.floor(game.player.maxHp * 0.30));
    game.cb.log(`❤️ Life Brand activates — ${brandCount} brands consumed, death averted!`, 'log-perk');
    game.cb.onParticle?.(game.player.x, game.player.y, '❤️ REVIVED', '#e53935', 16);
    return;
  }
  game.cb.onDeath(title, reason, game.dungeonLevel, game.player.totalXpEarned, game.getRunStats());
}

// ── Dice engine ───────────────────────────────────────────────────────────────
// Level 1→D4, 2→D6, 3→D8, 4→D10, 5→D12, 6→D20

const COMBAT_DICE = [0, 4, 6, 8, 10, 12, 20] as const;

function dieSides(level: number): number {
  return COMBAT_DICE[Math.max(1, Math.min(6, level))] ?? 4;
}

function rollDie(level: number): number {
  return Math.floor(Math.random() * dieSides(level)) + 1;
}

type CombatOutcome = 'miss' | 'weak' | 'normal' | 'power' | 'critical';

const OUTCOME_MULT: Record<CombatOutcome, number> = {
  miss: 0, weak: 0.5, normal: 1.0, power: 1.5, critical: 2.0,
};

function resolveCombatRoll(
  attackerLevel: number,
  defenderLevel: number,
  forceCrit = false,
): { outcome: CombatOutcome; aRoll: number; dRoll: number } {
  if (forceCrit) {
    return { outcome: 'critical', aRoll: dieSides(attackerLevel), dRoll: 0 };
  }
  const aRoll = rollDie(attackerLevel);
  const dRoll = rollDie(defenderLevel);
  if (aRoll === dieSides(attackerLevel)) return { outcome: 'critical', aRoll, dRoll };
  if (aRoll <= dRoll) return { outcome: 'miss', aRoll, dRoll };
  const margin = aRoll - dRoll;
  if (margin <= 2) return { outcome: 'weak', aRoll, dRoll };
  if (margin <= 5) return { outcome: 'normal', aRoll, dRoll };
  return { outcome: 'power', aRoll, dRoll };
}

// Base per-swing chance the player lands a hit (any non-miss) vs a defender.
// Ignores miss-pity (which only rescues streaks) — this is the honest single-roll odds.
export function estimateHitChance(attackerLevel: number, defenderLevel: number): number {
  const sa = dieSides(attackerLevel);
  const sd = dieSides(defenderLevel);
  let hits = 0;
  for (let a = 1; a <= sa; a++) {
    for (let d = 1; d <= sd; d++) {
      if (a === sa || a > d) hits++;  // natural-max crit, or beat the defender roll
    }
  }
  return hits / (sa * sd);
}

// ── Player attacks monster ────────────────────────────────────────────────────

export function playerAttackMonster(monster: Monster, game: Game, forceCrit = false, damageMult = 1.0): number {
  const roll = resolveCombatRoll(game.player.combatLevel, monster.combatLevel, forceCrit);
  let { outcome } = roll;
  const { aRoll, dRoll } = roll;

  // Miss-pity: never whiff three times running. Two consecutive misses arm the
  // pity; the next miss is upgraded to a guaranteed glancing (weak) hit so a cold
  // dice streak can't stall you to death. Any landed hit disarms it.
  let pityHit = false;
  if (outcome === 'miss') {
    if (game.player.missStreak >= 2) {
      outcome = 'weak';
      pityHit = true;
      game.player.missStreak = 0;
    } else {
      game.player.missStreak++;
    }
  } else {
    game.player.missStreak = 0;
  }

  if (outcome === 'miss') {
    // Graze floor: even a whiff chips for a little damage so no swing is wasted
    // while a block is bearing down on you. The miss-pity above still escalates a
    // cold streak from graze → weak hit, so poor rolls sting but never stall you.
    const graze = Math.max(1, Math.round(game.player.totalAtk * 0.25 * damageMult));
    monster.hp -= graze;
    game.cb.log(`Graze on ${monster.name} (${aRoll} vs ${dRoll}) — ${graze} dmg`, 'log-neutral');
    game.cb.onParticle(monster.x, monster.y, `-${graze}`, '#b0bec5', 14);
    game.cb.onAudio?.('hit');
    return graze;
  }

  const dmg = Math.max(1, Math.round(game.player.totalAtk * OUTCOME_MULT[outcome] * damageMult));
  monster.hp -= dmg;

  const rollNote = outcome === 'critical' ? `nat ${aRoll}` : `${aRoll} vs ${dRoll}`;
  const bossTag = monster.isBoss ? ' (BOSS)' : '';

  if (outcome === 'weak') {
    const note = pityHit ? `${rollNote}, pity` : rollNote;
    game.cb.log(`Glancing blow on ${monster.name} (${note}) — ${dmg} dmg${bossTag}`, 'log-success');
    game.cb.onParticle(monster.x, monster.y, `-${dmg}`, '#aed581', 16);
  } else if (outcome === 'normal') {
    game.cb.log(`Hit ${monster.name} (${rollNote}) — ${dmg} dmg${bossTag}`, 'log-success');
    game.cb.onParticle(monster.x, monster.y, `-${dmg}`, '#69f0ae', 16);
  } else if (outcome === 'power') {
    game.cb.log(`Power strike on ${monster.name}! (${rollNote}) — ${dmg} dmg${bossTag}`, 'log-success');
    game.cb.onParticle(monster.x, monster.y, `-${dmg}`, '#ff9100', 16);
  } else {
    game.cb.log(`CRITICAL on ${monster.name}! (${rollNote}) — ${dmg} dmg${bossTag}`, 'log-combo');
    game.cb.onParticle(monster.x, monster.y, '💥 CRIT!', '#ffd54f', 18);
    if (!monster.isStunned) {
      monster.statuses.push({ type: 'stun', duration: 1, power: 0 });
      game.cb.log(`${monster.name} is stunned!`, 'log-success');
    }
  }

  // Sick brand: chance to inflict poison on hit
  if (dmg > 0 && game.player.poisonAttackChance > 0 && Math.random() < game.player.poisonAttackChance) {
    if (!monster.statuses.some(s => s.type === 'poison')) {
      monster.statuses.push({ type: 'poison', duration: 3, power: 3 });
      game.cb.log(`☠️ Poisoned ${monster.name}!`, 'log-success');
    }
  }

  game.cb.onAudio?.('hit');
  return dmg;
}

// ── Monster attacks player ────────────────────────────────────────────────────

export function monsterAttackPlayer(m: Monster, game: Game): void {
  if (game.player.dodgeChance > 0 && Math.random() < game.player.dodgeChance) {
    game.cb.log(`${m.name} attacks — you dodge!`, 'log-success');
    game.cb.onParticle(game.player.x, game.player.y, 'DODGE!', '#29b6f6');
    if (game.player.dodgeHeal > 0) {
      const healed = game.player.heal(game.player.dodgeHeal);
      if (healed > 0) game.cb.onParticle(game.player.x, game.player.y, `+${healed} HP`, '#69f0ae');
    }
    return;
  }

  const { outcome, aRoll, dRoll } = resolveCombatRoll(m.combatLevel, game.player.combatLevel);

  if (outcome === 'miss') {
    game.cb.log(`${m.name} attacks — you block! (${aRoll} vs ${dRoll})`, 'log-success');
    game.cb.onParticle(game.player.x, game.player.y, 'BLOCK!', '#29b6f6');
    return;
  }

  const rawDmg = Math.max(1, Math.round(m.atk * OUTCOME_MULT[outcome]));
  const actual = game.player.takeDamage(rawDmg);
  game.damageTaken += actual;

  const rollNote = outcome === 'critical' ? `nat ${aRoll}` : `${aRoll} vs ${dRoll}`;

  if (outcome === 'weak') {
    game.cb.log(`${m.name} grazes you (${rollNote}) — ${actual} HP`, 'log-damage');
  } else if (outcome === 'normal') {
    game.cb.log(`${m.name} hits you (${rollNote}) — ${actual} HP`, 'log-damage');
  } else if (outcome === 'power') {
    game.cb.log(`${m.name} SLAMS you! (${rollNote}) — ${actual} HP`, 'log-damage');
  } else {
    game.cb.log(`${m.name} CRITICAL! (${rollNote}) — ${actual} HP`, 'log-damage');
  }

  game.cb.onParticle(game.player.x, game.player.y, `-${actual}`, '#ef5350', 16);
  game.cb.onAudio?.('playerDamage');

  // Thornweave Core: reflect damage back to attacker
  if (game.player.thornDamage > 0 && actual > 0) {
    m.hp -= game.player.thornDamage;
    game.cb.onParticle(m.x, m.y, `🌵-${game.player.thornDamage}`, '#66bb6a');
    if (m.hp <= 0) {
      killMonster(m, game);
      return;
    }
  }

  // Criticals always inflict status; others use normal chance
  const inflictStatus = outcome === 'critical' || (m.statusInflict != null && Math.random() < m.statusInflict.chance);
  if (inflictStatus && m.statusInflict && !game.player.statuses.some(s => s.type === m.statusInflict!.type)) {
    game.player.statuses.push({
      type:     m.statusInflict.type,
      duration: m.statusInflict.duration,
      power:    m.statusInflict.power,
    });
    game.cb.log(`You are ${m.statusInflict.type}ed!`, 'log-damage');
  }

  if (game.player.hp <= 0) triggerDeath(game, 'HERO DEFEATED', 'Your health pool dropped to zero.');
}

// ── Kill resolution ───────────────────────────────────────────────────────────

export function killMonster(m: Monster, game: Game): void {
  game.cb.onAudio?.('kill');
  game.monstersKilled++;
  game.killsThisFloor++;
  if (m.isBoss) game.bossesKilled++;
  game.gold += m.isBoss ? 500 : 80;
  game.monsters = game.monsters.filter(x => x !== m);
  const levelled = game.player.gainXP(Math.floor(m.xpReward * game.xpMultiplier));
  if (levelled) {
    game.cb.log(`✨ LEVEL UP! Now level ${game.player.playerLevel}!`, 'log-perk');
    game.openLevelUpBoons();
  }
  const killHeal = game.player.heal(game.player.killHeal);
  if (killHeal > 0) game.cb.onParticle(game.player.x, game.player.y, `+${killHeal} HP`, '#69f0ae');
  // Cruelty Core: gain ATK per kill (tracked for reset on floor change)
  if (game.player.killAtkBonus > 0) {
    game.player.atk += game.player.killAtkBonus;
    game.player.killAtkFloorBonus += game.player.killAtkBonus;
  }
  for (const relic of game.player.relics) {
    relic.onKill?.(game.player);
  }
  if (m.isBoss) {
    game.cb.log(`⚔️ BOSS SLAIN: ${m.name}!`, 'log-boss');
    game.cb.onParticle(m.x, m.y, '🏆 BOSS!', '#ffd54f');
  } else {
    if (m.isElite) {
      game.dropRelicAt(m.x, m.y);
      game.cb.onParticle(m.x, m.y, '🏆 RELIC!', '#ffd700');
      game.cb.log(`⭐ Elite vanquished! A relic drops...`, 'log-perk');
    }
    const healBonus = game.player.heal(3);
    if (healBonus > 0) {
      game.cb.onParticle(game.player.x, game.player.y, `+${healBonus} HP`, '#69f0ae');
      if (!m.isElite) game.cb.log(`Siphoned essence of ${m.name}! +${healBonus} HP`, 'log-success');
    } else if (!m.isElite) {
      game.cb.log(`Defeated ${m.name}!`, 'log-success');
    }
  }
}
