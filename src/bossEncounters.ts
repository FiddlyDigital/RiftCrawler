import { GameConfig } from './config';
import { Tile } from './types';
import { Monster } from './entities';
import { Balance } from './balance';
import type { Game } from './game';

/**
 * Boss-encounter set pieces: the Bres/Gorgoth finale (summoned when the stack
 * tops out), its half-HP roar and its victory trigger, plus the two per-boss
 * hook helpers other bosses fire (Cailleach's shard adds, Balor's Herald's
 * gravity surge), the near-ceiling "top out to win" nudge, and the boss-floor
 * ambush announcement. Composed onto {@link Game}; holds no state of its own —
 * the boss flags (gorgothSummoned, won, pendingBossFloor, …) live on Game and
 * are saved.
 */
export class BossEncounters {
  constructor(private readonly game: Game) {}

  /**
   * One-time teaching nudge: when the stack climbs near the ceiling, tell the
   * player that topping out summons Gorgoth — the win condition.
   */
  maybeHintGorgoth(): void {
    const g = this.game;
    if (g.gorgothHintShown || g.blockBuildingSuspended) return;
    if (g.stackTopRow() <= 5) {
      g.gorgothHintShown = true;
      g.cb.log('The stack climbs high — let it top out to summon BRES THE BEAUTIFUL and win the Rift!', 'log-boss', 'ui_warning');
    }
  }

  /** Ambient heads-up on entering a boss-eligible floor — mirrors the smith-floor announcement. The boss itself doesn't spawn until the floor is built up (see `instantiateRider`'s `Cell.BOSS` case). */
  announceFloor(): void {
    const g = this.game;
    g.pendingBossFloor = true;
    g.cb.onToast?.('You sense dark forces lie in ambush!', 'ui_warning');
  }

  /** Spawns up to two Crystal Shard adds beside a fallen Cailleach's Stoneward. Called by that boss's `onDeath` hook. */
  spawnCrystalShards(bx: number, by: number): void {
    const g = this.game;
    const shardHp  = Balance.CONFIG.crystalShards.baseHp + g.dungeonLevel * Balance.CONFIG.crystalShards.hpPerDungeonLevel;
    const shardAtk = Balance.CONFIG.crystalShards.baseAtk + Math.floor(g.dungeonLevel * Balance.CONFIG.crystalShards.atkPerDungeonLevel);
    const dirs: Array<[number, number]> = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    let spawned = 0;
    for (const [dx, dy] of dirs) {
      if (spawned >= 2) break;
      const sx = bx + dx, sy = by + dy;
      if (g.isValidMove(sx, sy) && !g.getMonsterAt(sx, sy)) {
        const shard = new Monster(sx, sy, 'sprite_crystal_shard', 'Crystal Shard', shardHp, shardHp, shardAtk, 30);
        shard.combatLevel = 3;
        g.monsters.push(shard);
        g.cb.onParticle(sx, sy, '', '#80d8ff', undefined, 'sprite_crystal_shard');
        spawned++;
      }
    }
    g.cb.log("Cailleach's Stoneward shatters — shards emerge!", 'log-boss', 'sprite_boss_crystal_golem');
  }

  /** Yanks the falling piece 5 rows down. Called by Balor's Herald's `onHalfHp` hook. */
  triggerGravityBurst(): void {
    const g = this.game;
    g.blockY = Math.max(0, g.blockY - 5);
    g.cb.log("Balor's Herald tears the weave — gravity surges!", 'log-boss', 'fx_impact');
    g.cb.onParticle(g.player.x, g.player.y, 'SURGE!', '#aa00ff', undefined, 'fx_impact');
    g.cb.onAudio?.('bossWarn');
  }

  /** Overflowing the stack summons the final boss into a cleared arena. */
  summonGorgoth(): void {
    const g = this.game;
    if (g.gorgothSummoned) return;
    g.gorgothSummoned = true;
    g.storyBeats.push('called Bres the Beautiful forth to battle');

    // The board the player built stays exactly as it is — no arena reset; only
    // the tetromino supply stops.
    g.blockMatrix = [];
    g.heldType = null;

    // The causeway is complete — there's no more "descend and try again
    // later." Every remaining stairs tile becomes plain floor, beaming away
    // like any other departing tile-feature (NPCs, altars, the tattoo artist).
    for (let x = 0; x < GameConfig.COLS; x++) {
      for (let y = 0; y < GameConfig.ROWS; y++) {
        if (g.map[x]![y] === Tile.STAIRS) {
          g.map[x]![y] = Tile.FLOOR;
          g.colors[x]![y] = g.blockColor;
          g.cb.onBeam?.(x, '109,63,122');
        }
      }
    }

    // Gorgoth looms in at the very top-centre and grinds his way down to the
    // hero — slow, unstoppable, phasing through the stack. Fixed, brutal stats
    // so descending floors only ever helps you.
    const gx = Math.floor(GameConfig.COLS / 2);
    const gDiff = g.difficultyTuning();
    const gHp = Math.floor(Balance.CONFIG.gorgoth.maxHp * gDiff.monsterHpMult);
    const gAtk = Math.floor(Balance.CONFIG.gorgoth.atk * gDiff.monsterAtkMult * g.heatMult('monsterAtkMult'));
    const boss = new Monster(gx, 0, 'sprite_boss_gorgoth', 'Bres the Beautiful', gHp, gHp, gAtk, Balance.CONFIG.gorgoth.xpReward, true, 'gorgoth', 1, 1);
    boss.combatLevel = Balance.CONFIG.gorgoth.combatLevel;  // D20 — even a maxed hero misses ~half the time
    boss.isGorgoth = true;
    g.monsters.push(boss);

    // Fomorian escort — an invasion party at his side, scaled the same as any
    // other floor monster (not buffed to match Bres) so it reads as a raiding
    // party, not a second boss.
    let escorts = 0;
    for (const [dx, dy] of [[-2, 0], [-1, 0], [1, 0], [2, 0]] as Array<[number, number]>) {
      if (escorts >= 3) break;
      const ex = gx + dx, ey = 0 + dy;
      if (ex >= 0 && ex < GameConfig.COLS && ey >= 0 && ey < GameConfig.ROWS && g.isValidMove(ex, ey) && !g.getMonsterAt(ex, ey)) {
        g.spawnMonster(g.getRandomMonsterKey(), ex, ey);
        escorts++;
      }
    }
    if (escorts > 0) g.cb.log('Fomorian raiders pour across the finished causeway behind him!', 'log-boss', 'sprite_boss_gorgoth');

    // Half-HP: roar and raise two of the Returned beside him — but only the
    // first time he crosses the threshold this run (persists across summons).
    g.activeBossOnHalfHp = this.makeGorgothOnHalfHp(boss);
    g.activeBossOnDeath = null;  // victory is fired from killMonster (covers every death path)
    g.bossHalfHpTriggered = g.gorgothHalfTriggered;

    g.revealAll();  // no fog for the finale

    g.cb.log('The causeway is complete! Bres the Beautiful now leads the charge to invade the Emerald Isle...', 'log-boss', 'ui_warning');
    g.cb.onParticle(gx, 0, 'BRES', '#ff1744', 18, 'sprite_boss_gorgoth');
    g.cb.onCodexDiscover?.('boss', 'gorgoth');

    g.paused = true;
    g.cb.onBossWarning?.(
      { char: 'sprite_boss_gorgoth', name: 'Bres the Beautiful', hpMult: 1, atkMult: 1, xpReward: Balance.CONFIG.gorgoth.xpReward, flavorText: 'The bridge home is finished — and he means to be first across it.' },
      () => { g.paused = false; },
    );
    g.pushUI();
  }

  /**
   * Bres's half-HP mechanic (roar + two Fomorian adds beside him), built as
   * a factory so both {@link summonGorgoth} and a mid-duel save restore can
   * attach it around the live boss instance.
   */
  makeGorgothOnHalfHp(boss: Monster): (game: Game) => void {
    return (g) => {
      g.gorgothHalfTriggered = true;
      g.cb.log('BRES ROARS — his Fomorian kin claw their way up!', 'log-boss', 'sprite_boss_gorgoth');
      for (const [dx, dy] of [[-1, 0], [1, 0]] as Array<[number, number]>) {
        const ax = boss.x + dx, ay = boss.y + dy;
        if (ax >= 0 && ax < GameConfig.COLS && ay >= 0 && ay < GameConfig.ROWS && g.isValidMove(ax, ay) && !g.getMonsterAt(ax, ay)) {
          g.spawnMonster(g.getRandomMonsterKey(), ax, ay);
        }
      }
    };
  }

  /** Gorgoth defeated — the run is won. Idempotent. */
  triggerVictory(): void {
    const g = this.game;
    if (g.won) return;
    g.won = true;
    g.cb.log('BRES THE BEAUTIFUL FALLS — the bridge collapses, the rift is sealed. You win!', 'log-boss', 'item_trophy');
    g.cb.onParticle(g.player.x, g.player.y, 'VICTORY', '#ffd54f', 20, 'item_trophy');
    g.cb.onVictory?.(g.dungeonLevel, g.player.totalXpEarned, g.getRunStats(), g.buildRunStory('victory'));
  }
}
