import type { Game } from '../game';
import type { Monster } from '../entities';

export function triggerDeath(game: Game, title: string, reason: string): void {
  game.cb.onDeath(title, reason, game.dungeonLevel, game.score, game.getRunStats());
}

export function monsterAttackPlayer(m: Monster, game: Game): void {
  if (game.player.dodgeChance > 0 && Math.random() < game.player.dodgeChance) {
    game.cb.log(`${m.name} attacks — you dodge!`, 'log-success');
    game.cb.onParticle(game.player.x, game.player.y, 'DODGE!', '#29b6f6');
    return;
  }
  const actual = game.player.takeDamage(Math.max(1, m.atk));
  game.damageTaken += actual;
  game.cb.log(`${m.name} hits you! -${actual} HP`, 'log-damage');
  game.cb.onParticle(game.player.x, game.player.y, `-${actual}`, '#ef5350');
  game.cb.onAudio?.('playerDamage');
  if (m.statusInflict && Math.random() < m.statusInflict.chance) {
    if (!game.player.statuses.some(s => s.type === m.statusInflict!.type)) {
      game.player.statuses.push({ type: m.statusInflict.type, duration: m.statusInflict.duration, power: m.statusInflict.power });
      game.cb.log(`You are ${m.statusInflict.type}ed!`, 'log-damage');
    }
  }
  if (game.player.hp <= 0) triggerDeath(game, 'HERO DEFEATED', 'Your health pool dropped to zero.');
}

export function killMonster(m: Monster, game: Game): void {
  game.cb.onAudio?.('kill');
  game.monstersKilled++;
  if (m.isBoss) game.bossesKilled++;
  game.score += Math.floor((m.isBoss ? 500 : 80) * game.scoreMultiplier);
  game.monsters = game.monsters.filter(x => x !== m);
  const levelled = game.player.gainXP(m.xpReward);
  if (levelled) {
    game.cb.log(`✨ LEVEL UP! Now level ${game.player.playerLevel}!`, 'log-perk');
    game.paused = true;
    game.cb.onLevelUp(game.player.playerLevel);
  }
  const killHeal = game.player.heal(game.player.killHeal);
  if (killHeal > 0) game.cb.onParticle(game.player.x, game.player.y, `+${killHeal} HP`, '#69f0ae');
  for (const relic of game.player.relics) {
    relic.onKill?.(game.player);
  }
  if (m.isBoss) {
    game.cb.log(`⚔️ BOSS SLAIN: ${m.name}!`, 'log-boss');
    game.cb.onParticle(m.x, m.y, '🏆 BOSS!', '#ffd54f');
  } else {
    const healBonus = game.player.heal(3);
    if (healBonus > 0) {
      game.cb.onParticle(game.player.x, game.player.y, `+${healBonus} HP`, '#69f0ae');
      game.cb.log(`Siphoned essence of ${m.name}! +${healBonus} HP`, 'log-success');
    } else {
      game.cb.log(`Defeated ${m.name}!`, 'log-success');
    }
  }
}
