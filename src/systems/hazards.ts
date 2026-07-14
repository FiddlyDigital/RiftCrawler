import { GameConfig } from '../config';
import { Tile } from '../types';
import type { Game } from '../game';
import { triggerDeath } from './combat';
import { Balance } from '../balance';

export function processHazards(game: Game): void {
  const spikeFirePositions: typeof game.hazards = [];

  for (const h of game.hazards) {
    if (h.type !== 'spike') continue;
    h.timer--;
    h.warning = h.timer <= Balance.HAZARD.spike.warningThreshold;
    if (h.timer <= 0) {
      h.timer = Balance.HAZARD.spike.rearmMinTurns + Math.floor(Math.random() * Balance.HAZARD.spike.rearmRandomTurns);
      h.warning = false;
      spikeFirePositions.push(h);
    }
  }

  for (const h of spikeFirePositions) {
    const damage = Math.max(Balance.HAZARD.spike.minDamage, game.dungeonLevel * Balance.HAZARD.spike.damagePerDungeonLevel);
    if (game.player.x === h.x && game.player.y === h.y) {
      const actual = game.player.takeDamage(damage);
      game.damageTaken += actual;
      game.cb.log(`Spikes fire! -${actual} HP`, 'log-damage', 'trap_spike');
      game.cb.onParticle(h.x, h.y, `-${actual}`, '#ff5722', undefined, 'trap_spike');
      game.cb.onAudio?.('playerDamage');
      if (game.player.hp <= 0) { triggerDeath(game, 'SPIKED', 'Impaled by floor spikes.'); return; }
    }
    for (const m of game.monsters) {
      if (m.x === h.x && m.y === h.y) {
        m.hp -= damage;
        game.cb.onParticle(m.x, m.y, `-${damage}`, '#ff5722', undefined, 'trap_spike');
      }
    }
    game.monsters = game.monsters.filter(m => m.hp > 0);
  }
}

export function checkHazardTrigger(entity: { x: number; y: number }, game: Game, isPlayer: boolean): void {
  const h = game.hazards.find(hz => hz.x === entity.x && hz.y === entity.y);
  if (!h) return;
  if (h.type === 'teleport') {
    if (isPlayer && game.player.teleportImmune) {
      game.cb.log('Teleport rune — you resist!', 'log-success', 'trap_teleport');
      game.cb.onParticle(entity.x, entity.y, '', '#7e57c2', undefined, 'sprite_equip_buckler');
      return;
    }
    game.hazards = game.hazards.filter(hz => hz !== h);
    const oldX = entity.x, oldY = entity.y;
    teleportEntity(entity, game);
    game.cb.onParticle(oldX, oldY, '', '#673ab7', undefined, 'trap_teleport');
    if (isPlayer) {
      game.cb.log('Teleport trap! You vanish in a swirl!', 'log-damage', 'trap_teleport');
      game.cb.onParticle(entity.x, entity.y, '', '#673ab7', undefined, 'fx_impact');
      game.cb.onAudio?.('teleport');
    }
  }
}

export function teleportEntity(entity: { x: number; y: number }, game: Game): void {
  const floorTiles: Array<{ x: number; y: number }> = [];
  for (let x = 0; x < GameConfig.COLS; x++) {
    for (let y = 0; y < GameConfig.ROWS; y++) {
      if (game.map[x]![y] !== Tile.FLOOR) continue;
      if (game.getMonsterAt(x, y)) continue;
      if (game.player.x === x && game.player.y === y && entity !== game.player) continue;
      floorTiles.push({ x, y });
    }
  }
  if (floorTiles.length === 0) return;
  const dest = floorTiles[Math.floor(Math.random() * floorTiles.length)]!;
  entity.x = dest.x;
  entity.y = dest.y;
}
