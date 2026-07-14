import type { Game } from '../game';
import type { Monster } from '../entities';
import { pctOf } from '../entities';
import { Balance } from '../balance';
import { BOONS_BY_TIER } from '../content';

export function triggerDeath(game: Game, title: string, reason: string): void {
  // Deathward Rune: survive the killing blow once per floor per charge
  if (game.player.deathwardCharges > 0) {
    game.player.deathwardCharges--;
    game.player.hp = Math.max(1, Math.floor(game.player.maxHp * 0.30));
    game.cb.log('Deathward activates — pulled back from the brink!', 'log-success', 'status_poison');
    game.cb.onParticle?.(game.player.x, game.player.y, 'REVIVED', '#b71c1c', 16, 'status_poison');
    return;
  }
  // Life Brand: free revive but erases all brands
  if (game.player.lifeBrandRevive) {
    game.player.lifeBrandRevive = false;
    const brandCount = game.player.brands.length;
    game.player.brands = [];
    game.player.hp = Math.max(1, Math.floor(game.player.maxHp * 0.30));
    game.cb.log(`Life Brand activates — ${brandCount} brands consumed, death averted!`, 'log-perk', 'item_heart');
    game.cb.onParticle?.(game.player.x, game.player.y, 'REVIVED', '#e53935', 16, 'item_heart');
    return;
  }
  game.cb.onDeath(title, reason, game.dungeonLevel, game.player.totalXpEarned, game.getRunStats(), game.buildRunStory());
}

// ── Dice engine ───────────────────────────────────────────────────────────────
// Level 1→D4, 2→D6, 3→D8, 4→D10, 5→D12, 6→D20 (combat.json: diceSidesByLevel)

export function dieSides(level: number): number {
  // The `6` cap is coupled to diceSidesByLevel's fixed 7-entry length (indices
  // 0-6) — see also the boss/Gorgoth/elite combatLevel caps in game.ts.
  return Balance.numOr(Balance.COMBAT.diceSidesByLevel[Math.max(1, Math.min(6, level))], 4);
}

function rollDie(level: number): number {
  return Math.floor(Math.random() * dieSides(level)) + 1;
}

type CombatOutcome = 'miss' | 'weak' | 'normal' | 'power' | 'critical';

const OUTCOME_MULT = Balance.COMBAT.outcomeMultipliers;

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
  if (margin <= Balance.COMBAT.marginThresholds.weakMax) return { outcome: 'weak', aRoll, dRoll };
  if (margin <= Balance.COMBAT.marginThresholds.normalMax) return { outcome: 'normal', aRoll, dRoll };
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
    if (game.player.missStreak >= Balance.COMBAT.missPityStreak) {
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
    const graze = Math.max(1, Math.round(game.player.totalAtk * Balance.COMBAT.grazeDamagePct * damageMult));
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
    game.cb.onParticle(monster.x, monster.y, 'CRIT!', '#ffd54f', 18, 'fx_impact');
    game.cb.onParticleBurst?.(monster.x, monster.y, 6, '#d9a441', 'fx_impact');
    game.cb.onHitStop?.(3);
    if (!monster.isStunned) {
      monster.statuses.push({ type: 'stun', duration: Balance.COMBAT.critStun.duration, power: Balance.COMBAT.critStun.power });
      game.cb.log(`${monster.name} is stunned!`, 'log-success');
    }
  }

  // Sick Mark: chance to inflict poison on hit
  if (dmg > 0 && game.player.poisonAttackChance > 0 && Math.random() < game.player.poisonAttackChance) {
    if (!monster.statuses.some(s => s.type === 'poison')) {
      monster.statuses.push({ type: 'poison', duration: 3, power: 3 });
      game.cb.log(`Poisoned ${monster.name}!`, 'log-success', 'status_poison');
    }
  }

  // Cryo Mark: chance to freeze the target on hit
  if (dmg > 0 && game.player.stunAttackChance > 0 && Math.random() < game.player.stunAttackChance) {
    if (!monster.isStunned) {
      monster.statuses.push({ type: 'stun', duration: 1, power: 0 });
      game.cb.log(`${monster.name} is frozen solid!`, 'log-success', 'special_ice');
    }
  }

  game.cb.onAudio?.('hit');
  return dmg;
}

// ── Monster attacks player ────────────────────────────────────────────────────

export function monsterAttackPlayer(m: Monster, game: Game): void {
  // Ghost Mark: guaranteed dodge once per floor, checked before the percentage roll
  if (game.player.ghostDodgeCharges > 0) {
    game.player.ghostDodgeCharges--;
    game.cb.log(`${m.name} attacks — you phase through the strike!`, 'log-success');
    game.cb.onParticle(game.player.x, game.player.y, 'PHASE!', '#b39ddb');
    return;
  }
  if (game.player.dodgeChance > 0 && Math.random() < game.player.dodgeChance) {
    game.cb.log(`${m.name} attacks — you dodge!`, 'log-success');
    game.cb.onParticle(game.player.x, game.player.y, 'DODGE!', '#29b6f6');
    // Mist Cloak: dodgeHeal is a fraction of maxHp, like the other sustain stats
    if (game.player.dodgeHeal > 0) {
      const healed = game.player.heal(pctOf(game.player.maxHp, game.player.dodgeHeal));
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

  // Thornweave Core: reflect a % of ATK back to attacker
  const thornDmg = pctOf(game.player.atk, game.player.thornDamage);
  if (thornDmg > 0 && actual > 0) {
    m.hp -= thornDmg;
    game.cb.onParticle(m.x, m.y, `-${thornDmg}`, '#66bb6a', undefined, 'special_swamp');
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
  game.cb.onMonsterDeath?.(m.x, m.y, m.char);  // white flash + poof at the corpse
  game.cb.onHitStop?.(2);
  // Gorgoth's fall wins the run — short-circuit before XP/level-up so the
  // victory screen isn't stepped on by a level-up modal. Covers every death
  // path (melee, ranged, poison, thorns) since they all route through here.
  if (m.isGorgoth) {
    game.monstersKilled++;
    game.bossesKilled++;
    game.monsters = game.monsters.filter(x => x !== m);
    game.triggerVictory();
    return;
  }
  game.monstersKilled++;
  game.killsThisFloor++;
  if (m.isBoss) game.bossesKilled++;
  game.gold += m.isBoss ? Balance.COMBAT.rewards.goldOnBossKill : Balance.COMBAT.rewards.goldOnKill;
  game.monsters = game.monsters.filter(x => x !== m);
  const levelled = game.player.gainXP(Math.floor(m.xpReward * game.xpMultiplier));
  if (levelled) {
    game.cb.log(`LEVEL UP! Now level ${game.player.playerLevel}!`, 'log-perk', 'special_sacred');
    game.openLevelUpBoons();
  }
  // Leech/Bloodtap: heal a % of maxHp on kill
  const killHeal = game.player.heal(pctOf(game.player.maxHp, game.player.killHeal));
  if (killHeal > 0) game.cb.onParticle(game.player.x, game.player.y, `+${killHeal} HP`, '#69f0ae');
  // Cruelty Core: gain a % of ATK per kill (tracked for reset on floor change)
  const atkGain = pctOf(game.player.atk, game.player.killAtkBonus);
  if (atkGain > 0) {
    game.player.atk += atkGain;
    game.player.killAtkFloorBonus += atkGain;
  }
  if (m.isBoss) {
    game.cb.log(`BOSS SLAIN: ${m.name}!`, 'log-boss', 'sprite_equip_iron_sword');
    game.cb.onParticle(m.x, m.y, 'BOSS!', '#ffd54f', undefined, 'item_trophy');
    game.cb.onParticleBurst?.(m.x, m.y, 14, '#c1443c');
    game.cb.onImpactGlow?.(m.x, m.y, '139,26,26', 20);
    game.storyBeats.push(`felled ${m.name}`);

    // Vengeance bounty fulfilled — covers every death path (melee, ranged,
    // poison, thorns, line-clear AoE) since they all route through here.
    const bounty = game.activeBountyQuest;
    if (bounty && bounty.bossName === m.name && game.dungeonLevel >= bounty.floor) {
      game.activeBountyQuest = null;
      const rewardPool = BOONS_BY_TIER[3];
      const reward = rewardPool[Math.floor(Math.random() * rewardPool.length)]!;
      game.player.addBoon(reward);
      game.cb.log(`An oath fulfilled — Otherworld power settles over you. Gained ${reward.name}!`, 'log-perk', reward.char);
      game.cb.onParticleBurst?.(m.x, m.y, 10, '#8d6fd4');
      game.cb.onAudio?.('bountyFulfilled');
      game.storyBeats.push('fulfilled a sworn vengeance');
    }
  } else {
    if (m.isElite) {
      const bonus = Balance.COMBAT.rewards.eliteGoldBonusPerFloor * game.dungeonLevel;
      game.gold += bonus;
      game.cb.onParticle(m.x, m.y, `+${bonus}`, '#ffd700', undefined, 'item_gold_pouch');
      game.cb.onParticleBurst?.(m.x, m.y, 8, '#d4af37');
      game.cb.log(`Elite vanquished! +${bonus} gold.`, 'log-perk', 'special_sacred');
    }
    const healBonus = game.player.heal(Balance.COMBAT.rewards.healOnKill);
    if (healBonus > 0) {
      game.cb.onParticle(game.player.x, game.player.y, `+${healBonus} HP`, '#69f0ae');
      if (!m.isElite) game.cb.log(`Siphoned essence of ${m.name}! +${healBonus} HP`, 'log-success');
    } else if (!m.isElite) {
      game.cb.log(`Defeated ${m.name}!`, 'log-success');
    }
  }
}
