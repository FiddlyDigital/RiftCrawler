import { Tile } from '../types';
import { GameConfig } from '../config';
import type { Game } from '../game';
import type { Monster } from '../entities';
import { CombatSystem } from './combat';
import { HazardSystem } from './hazards';
import { Balance } from '../balance';

/**
 * Per-behavior-type monster AI: melee/ranged/healer/berserker/swift/Gorgoth
 * movement and attack decisions. Called every game turn by `Game` — these
 * are hot-path methods and trust the caller's state rather than
 * re-validating on every turn.
 */
export class MonsterAiSystem {
  /** Runs one AI turn for every living monster, dispatched by `behaviorType`. */
  static processMonsterTurns(game: Game): void {
    if (game.player.hp <= 0) return;
    const veiled = game.player.veiledTurns > 0;
    for (const m of game.monsters) {
      if (game.player.hp <= 0) return;
      if (m.isStunned) {
        m.statuses = m.statuses
          .map(s => s.type === 'stun' ? { ...s, duration: s.duration - 1 } : s)
          .filter(s => s.duration > 0);
        continue;
      }
      // Féth Fíada: the god-mist blinds every mortal creature — no chasing, no
      // attacks — but Bres is divine and sees straight through it.
      if (veiled && !m.isGorgoth) continue;
      switch (m.behaviorType) {
        case 'ranged':    MonsterAiSystem.processRangedMonster(m, game);    break;
        case 'healer':    MonsterAiSystem.processHealerMonster(m, game);    break;
        case 'berserker': MonsterAiSystem.processBerserkerMonster(m, game); break;
        case 'swift':     MonsterAiSystem.processSwiftMonster(m, game);     break;
        case 'gorgoth':   MonsterAiSystem.processGorgoth(m, game);          break;
        default:          MonsterAiSystem.processMeleeMonster(m, game);     break;
      }
    }
  }

  private static moveMonsterToward(m: Monster, game: Game): void {
    const sx = Math.sign(game.player.x - m.x);
    const sy = Math.sign(game.player.y - m.y);
    let nx = m.x + sx, ny = m.y;
    if (!game.isValidMove(nx, ny) || game.getMonsterAt(nx, ny)) { nx = m.x; ny = m.y + sy; }
    if (!game.isValidMove(nx, ny) || game.getMonsterAt(nx, ny)) return;
    const dx = nx - m.x, dy = ny - m.y;
    m.x = nx; m.y = ny;
    HazardSystem.checkHazardTrigger(m, game, false);
    // Ice sliding
    while (game.isIceTile(m.x, m.y)) {
      const slideX = m.x + dx, slideY = m.y + dy;
      if (!game.isValidMove(slideX, slideY) || game.getMonsterAt(slideX, slideY)) break;
      if (slideX === game.player.x && slideY === game.player.y) break;
      m.x = slideX; m.y = slideY;
      HazardSystem.checkHazardTrigger(m, game, false);
    }
  }

  // Base contact = orthogonally adjacent (Manhattan distance 1). Movement and
  // attacks are strictly 4-directional for the hero and every monster alike — no
  // diagonal reach either way — so a diagonally-touching enemy must first step
  // onto an orthogonal tile before it can strike.
  private static inBaseContact(m: Monster, game: Game): boolean {
    return MonsterAiSystem.manhattanToPlayer(m, game) === Balance.MONSTER_AI.common.contactDistance;
  }

  private static manhattanToPlayer(m: Monster, game: Game): number {
    return Math.abs(m.x - game.player.x) + Math.abs(m.y - game.player.y);
  }

  /** Bresenham line-of-sight check between two board cells. */
  static hasLineOfSight(x1: number, y1: number, x2: number, y2: number, game: Game): boolean {
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

  private static processMeleeMonster(m: Monster, game: Game): void {
    if (MonsterAiSystem.inBaseContact(m, game)) { CombatSystem.monsterAttackPlayer(m, game); }
    else if (MonsterAiSystem.manhattanToPlayer(m, game) <= Balance.MONSTER_AI.melee.chaseRange) { MonsterAiSystem.moveMonsterToward(m, game); }
  }

  private static processRangedMonster(m: Monster, game: Game): void {
    const dx   = game.player.x - m.x;
    const dy   = game.player.y - m.y;
    const dist = Math.abs(dx) + Math.abs(dy);
    if (dist <= m.attackRange && MonsterAiSystem.hasLineOfSight(m.x, m.y, game.player.x, game.player.y, game)) {
      CombatSystem.monsterAttackPlayer(m, game);
    } else if (dist <= Balance.MONSTER_AI.ranged.retreatDistance) {
      const nx = m.x - Math.sign(dx), ny = m.y - Math.sign(dy);
      if (game.isValidMove(nx, ny) && !game.getMonsterAt(nx, ny)) { m.x = nx; m.y = ny; }
    } else if (dist <= m.attackRange + Balance.MONSTER_AI.ranged.advanceRangeBonus) {
      MonsterAiSystem.moveMonsterToward(m, game);
    }
  }

  private static processHealerMonster(m: Monster, game: Game): void {
    const wounded = game.monsters.find(other =>
      other !== m && other.hp < other.maxHp &&
      Math.abs(other.x - m.x) + Math.abs(other.y - m.y) <= Balance.MONSTER_AI.healer.healRadius,
    );
    if (wounded) {
      const healAmt = Math.max(1, Math.floor(wounded.maxHp * Balance.MONSTER_AI.healer.healFraction));
      wounded.hp = Math.min(wounded.maxHp, wounded.hp + healAmt);
      game.cb.onParticle(wounded.x, wounded.y, `+${healAmt}`, '#4caf50');
      game.cb.log(`${m.name} heals ${wounded.name}!`, 'log-damage');
      return;
    }
    MonsterAiSystem.processMeleeMonster(m, game);
  }

  private static processBerserkerMonster(m: Monster, game: Game): void {
    if (MonsterAiSystem.inBaseContact(m, game)) {
      const enraged = m.hp < m.maxHp * Balance.MONSTER_AI.berserker.enrageHpFraction;
      CombatSystem.monsterAttackPlayer(m, game);
      if (enraged && game.player.hp > 0) {
        game.cb.log(`${m.name} rages and strikes again!`, 'log-damage');
        CombatSystem.monsterAttackPlayer(m, game);
      }
    } else if (MonsterAiSystem.manhattanToPlayer(m, game) <= Balance.MONSTER_AI.berserker.chaseRange) {
      MonsterAiSystem.moveMonsterToward(m, game);
    }
  }

  private static processSwiftMonster(m: Monster, game: Game): void {
    if (MonsterAiSystem.inBaseContact(m, game)) {
      CombatSystem.monsterAttackPlayer(m, game);
    } else if (MonsterAiSystem.manhattanToPlayer(m, game) <= Balance.MONSTER_AI.swift.chaseRange) {
      MonsterAiSystem.moveMonsterToward(m, game);
      if (Balance.MONSTER_AI.swift.doubleMoveOnChase && game.player.hp > 0 && !MonsterAiSystem.inBaseContact(m, game)) {
        MonsterAiSystem.moveMonsterToward(m, game);
      }
    }
  }

  // Gorgoth the Returned: a slow, unstoppable descent from the top of the arena.
  // He pursues from ANY distance (unlike the melee chase-range gate) and
  // phases through terrain — walls and void never wall him out of the stack — so
  // his arrival is inevitable. One tile every Balance.MONSTER_AI.gorgoth.stepTurns turns.
  private static processGorgoth(m: Monster, game: Game): void {
    if (MonsterAiSystem.inBaseContact(m, game)) { CombatSystem.monsterAttackPlayer(m, game); return; }

    if (++m.stepCharge < Balance.MONSTER_AI.gorgoth.stepTurns) return;
    m.stepCharge = 0;

    const sx = Math.sign(game.player.x - m.x);
    const sy = Math.sign(game.player.y - m.y);
    // Orthogonal steps only — favour vertical so he visibly "comes down", then lateral.
    const tries: Array<[number, number]> = sy !== 0
      ? [[0, sy], [sx, 0]]
      : [[sx, 0]];
    for (const [ddx, ddy] of tries) {
      if (ddx === 0 && ddy === 0) continue;
      const nx = m.x + ddx, ny = m.y + ddy;
      if (nx < 0 || nx >= GameConfig.COLS || ny < 0 || ny >= GameConfig.ROWS) continue;
      if (nx === game.player.x && ny === game.player.y) continue;  // don't stand on the hero
      if (game.getMonsterAt(nx, ny)) continue;                     // don't stack on adds
      m.x = nx; m.y = ny;
      return;
    }
  }
}
