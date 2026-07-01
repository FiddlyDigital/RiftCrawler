import { Tile } from '../types';
import type { Game } from '../game';
import type { Monster } from '../entities';
import { monsterAttackPlayer } from './combat';
import { checkHazardTrigger } from './hazards';

export function processMonsterTurns(game: Game): void {
  if (game.player.hp <= 0) return;
  for (const m of game.monsters) {
    if (game.player.hp <= 0) return;
    if (m.isStunned) {
      m.statuses = m.statuses
        .map(s => s.type === 'stun' ? { ...s, duration: s.duration - 1 } : s)
        .filter(s => s.duration > 0);
      continue;
    }
    switch (m.behaviorType) {
      case 'ranged':    processRangedMonster(m, game);    break;
      case 'healer':    processHealerMonster(m, game);    break;
      case 'berserker': processBerserkerMonster(m, game); break;
      case 'swift':     processSwiftMonster(m, game);     break;
      default:          processMeleeMonster(m, game);     break;
    }
  }
}

function moveMonsterToward(m: Monster, game: Game): void {
  const sx = Math.sign(game.player.x - m.x);
  const sy = Math.sign(game.player.y - m.y);
  let nx = m.x + sx, ny = m.y;
  if (!game.isValidMove(nx, ny) || game.getMonsterAt(nx, ny)) { nx = m.x; ny = m.y + sy; }
  if (!game.isValidMove(nx, ny) || game.getMonsterAt(nx, ny)) return;
  const dx = nx - m.x, dy = ny - m.y;
  m.x = nx; m.y = ny;
  checkHazardTrigger(m, game, false);
  // Ice sliding
  while (game.isIceTile(m.x, m.y)) {
    const slideX = m.x + dx, slideY = m.y + dy;
    if (!game.isValidMove(slideX, slideY) || game.getMonsterAt(slideX, slideY)) break;
    if (slideX === game.player.x && slideY === game.player.y) break;
    m.x = slideX; m.y = slideY;
    checkHazardTrigger(m, game, false);
  }
}

export function hasLineOfSight(x1: number, y1: number, x2: number, y2: number, game: Game): boolean {
  const absDx = Math.abs(x2 - x1);
  const absDy = Math.abs(y2 - y1);
  const sx = x1 < x2 ? 1 : -1;
  const sy = y1 < y2 ? 1 : -1;
  let err = absDx - absDy;
  let x = x1, y = y1;
  for (;;) {
    if (x === x2 && y === y2) break;
    if (game.map[x]?.[y] === Tile.VOID && !(x === x1 && y === y1)) return false;
    const e2 = 2 * err;
    if (e2 > -absDy) { err -= absDy; x += sx; }
    if (e2 < absDx)  { err += absDx; y += sy; }
  }
  return true;
}

function processMeleeMonster(m: Monster, game: Game): void {
  const dist = Math.abs(m.x - game.player.x) + Math.abs(m.y - game.player.y);
  if (dist === 1) { monsterAttackPlayer(m, game); }
  else if (dist <= 5) { moveMonsterToward(m, game); }
}

function processRangedMonster(m: Monster, game: Game): void {
  const dx   = game.player.x - m.x;
  const dy   = game.player.y - m.y;
  const dist = Math.abs(dx) + Math.abs(dy);
  if (dist <= m.attackRange && hasLineOfSight(m.x, m.y, game.player.x, game.player.y, game)) {
    monsterAttackPlayer(m, game);
  } else if (dist <= 2) {
    const nx = m.x - Math.sign(dx), ny = m.y - Math.sign(dy);
    if (game.isValidMove(nx, ny) && !game.getMonsterAt(nx, ny)) { m.x = nx; m.y = ny; }
  } else if (dist <= m.attackRange + 3) {
    moveMonsterToward(m, game);
  }
}

function processHealerMonster(m: Monster, game: Game): void {
  const wounded = game.monsters.find(other =>
    other !== m && other.hp < other.maxHp &&
    Math.abs(other.x - m.x) + Math.abs(other.y - m.y) <= 1,
  );
  if (wounded) {
    const healAmt = Math.max(1, Math.floor(wounded.maxHp * 0.25));
    wounded.hp = Math.min(wounded.maxHp, wounded.hp + healAmt);
    game.cb.onParticle(wounded.x, wounded.y, `+${healAmt}`, '#4caf50');
    game.cb.log(`${m.name} heals ${wounded.name}!`, 'log-damage');
    return;
  }
  processMeleeMonster(m, game);
}

function processBerserkerMonster(m: Monster, game: Game): void {
  const dist = Math.abs(m.x - game.player.x) + Math.abs(m.y - game.player.y);
  if (dist === 1) {
    const enraged = m.hp < m.maxHp * 0.5;
    monsterAttackPlayer(m, game);
    if (enraged && game.player.hp > 0) {
      game.cb.log(`${m.name} rages and strikes again!`, 'log-damage');
      monsterAttackPlayer(m, game);
    }
  } else if (dist <= 5) {
    moveMonsterToward(m, game);
  }
}

function processSwiftMonster(m: Monster, game: Game): void {
  const dist = Math.abs(m.x - game.player.x) + Math.abs(m.y - game.player.y);
  if (dist === 1) {
    monsterAttackPlayer(m, game);
  } else if (dist <= 7) {
    moveMonsterToward(m, game);
    if (game.player.hp > 0 && Math.abs(m.x - game.player.x) + Math.abs(m.y - game.player.y) > 1) {
      moveMonsterToward(m, game);
    }
  }
}
