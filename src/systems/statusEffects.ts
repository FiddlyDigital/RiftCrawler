import type { Game } from '../game';
import { triggerDeath, killMonster } from './combat';
import { pctOf } from '../entities';

export function applyStatusEffects(game: Game): void {
  const next: typeof game.player.statuses = [];
  for (const s of game.player.statuses) {
    if (s.type === 'poison' && !game.player.poisonImmune) {
      const dmg = Math.max(0, s.power - game.player.totalDef);
      if (dmg > 0) {
        game.player.hp = Math.max(0, game.player.hp - dmg);
        game.damageTaken += dmg;
        game.cb.onParticle(game.player.x, game.player.y, `-${dmg}`, '#9c27b0', undefined, 'status_poison');
        game.cb.onAudio?.('poison');
        game.cb.log(`Poison deals ${dmg} damage!`, 'log-damage');
        if (game.player.hp <= 0) { triggerDeath(game, 'HERO DEFEATED', 'Succumbed to poison.'); return; }
      }
    }
    const remaining = s.duration - 1 - game.player.statusDurationBonus;
    if (remaining > 0) next.push({ ...s, duration: remaining + game.player.statusDurationBonus });
    else game.cb.log(`${s.type.charAt(0).toUpperCase() + s.type.slice(1)} wore off.`, 'log-neutral');
  }
  game.player.statuses = next;

  const poisonKilled: typeof game.monsters = [];
  for (const m of game.monsters) {
    const nextM: typeof m.statuses = [];
    for (const s of m.statuses) {
      if (s.type === 'poison') {
        m.hp -= s.power;
        game.cb.onParticle(m.x, m.y, `-${s.power}`, '#9c27b0', undefined, 'status_poison');
        if (m.hp <= 0) break;
      }
      if (s.duration > 1) nextM.push({ ...s, duration: s.duration - 1 });
    }
    m.statuses = nextM;
    if (m.hp <= 0) poisonKilled.push(m);
  }
  // Remove dead monsters first, then award kills (XP/gold/level-up)
  game.monsters = game.monsters.filter(m => m.hp > 0);
  for (const m of poisonKilled) killMonster(m, game);
}

export function applyRegen(game: Game): void {
  // regenPerTick is a fraction of maxHp (e.g. 0.02 = 2%/tick), not a flat number.
  const amt = pctOf(game.player.maxHp, game.player.regenPerTick);
  if (amt > 0) {
    const gained = game.player.heal(amt);
    if (gained > 0) game.cb.onParticle(game.player.x, game.player.y, `+${gained}`, '#2e7d32');
  }
}

export function applyAuraStun(game: Game): void {
  if (game.player.auraStunRadius <= 0) return;
  for (const m of game.monsters) {
    const dist = Math.abs(m.x - game.player.x) + Math.abs(m.y - game.player.y);
    if (dist <= game.player.auraStunRadius && !m.isStunned) {
      m.statuses.push({ type: 'stun', duration: 1, power: 0 });
    }
  }
}
