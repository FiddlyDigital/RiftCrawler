import { GameConfig } from './config';
import { Tile } from './types';
import { Monster } from './entities';
import { MONSTERS } from './content';
import { Balance } from './balance';
import { Colors } from './colors';
import type { Game } from './game';

/**
 * Monster spawning and dungeon-room generation. Scales a `MonsterTemplate` by
 * dungeon level, biome, elite roll, omens, difficulty and heat before placing
 * the `Monster`; and carves the optional lateral vault/den rooms off the start
 * platform. Composed onto {@link Game}; holds no state of its own — all the run
 * state it reads (monsters, dungeonLevel, omens, difficulty, heat) lives on Game.
 */
export class Spawner {
  constructor(private readonly game: Game) {}

  /**
   * Scales a `MonsterTemplate` by dungeon level/biome/elite-roll and places the
   * resulting `Monster` at `(tx, ty)`.
   * `elite`: true forces an elite, false forbids one, undefined rolls the normal chance.
   */
  monster(key: string, tx: number, ty: number, elite?: boolean, nameOverride?: string): void {
    const g = this.game;
    const def = MONSTERS[key];
    if (!def) return;
    const isElite = elite ?? (Math.random() < Balance.CONFIG.eliteMonsters.spawnChance + g.heatAdd('eliteChanceBonus'));
    const diff = g.difficultyTuning();
    const baseHp  = Math.floor((def.baseHp  + (g.dungeonLevel - 1) * def.hpPerLevel) * g.biomeMonsterHpMult * diff.monsterHpMult);
    const baseAtk = def.baseAtk + (g.dungeonLevel - 1) * def.atkPerLevel;
    const hp  = isElite ? baseHp * Balance.CONFIG.eliteMonsters.hpMult : baseHp;
    // Omens like the Morrígan's Ravens or Crom's Tithe harden every spawn;
    // New Game+ geasa stack on top of both omen and difficulty.
    const omenAtkMult = g.activeOmen?.num('monsterAtkMult', 1) ?? 1;
    const atk = Math.floor((isElite ? baseAtk * Balance.CONFIG.eliteMonsters.atkMult : baseAtk) * omenAtkMult * diff.monsterAtkMult * g.heatMult('monsterAtkMult'));
    const name = nameOverride ?? (isElite ? `Elite ${def.name}` : def.name);
    const m = new Monster(
      tx, ty, def.char, name, hp, hp, atk, def.xpReward,
      false,
      def.behaviorType ?? 'melee',
      def.attackRange  ?? 1,
      def.moveSpeed    ?? 1,
      def.statusInflict,
    );
    m.isElite = isElite;
    m.combatLevel = Math.min(6, def.combatLevel + (isElite ? Balance.CONFIG.eliteMonsters.combatLevelBonus : 0));
    if (g.frozenRift) {
      m.statuses.push({ type: 'stun', duration: 1, power: 0 });
    }
    // Abcán's suantraí (sleep-strain) lulls everything that arrives on the
    // floor it was played for.
    if (g.dungeonLevel === g.harperLullFloor) {
      m.statuses.push({ type: 'stun', duration: 2, power: 0 });
    }
    g.monsters.push(m);
    if (isElite) {
      g.cb.onParticle(tx, ty, 'ELITE!', '#ffd700', undefined, 'special_sacred');
      g.cb.log(`Elite ${def.name} stalks out of the dark!`, 'log-boss', 'special_sacred');
    } else {
      g.cb.onParticle(tx, ty, def.spawnMsg, '#e57373', undefined, def.char);
    }
  }

  /** Rolls the per-floor chance to carve a lateral vault/den room off the start platform. */
  maybeSpawnRoom(): void {
    if (Math.random() > Balance.CONFIG.floors.dungeonRoomChance) return;
    this.spawnRoom(Math.random() < 0.5 ? 'vault' : 'den');
  }

  /** A monster key, weighted toward tougher species as the dungeon deepens. */
  randomMonsterKey(): string {
    const all = ['rat', 'skeleton', 'goblin_archer', 'cave_slime', 'berserker_orc', 'plague_bat'];
    const maxIdx = Math.min(all.length - 1, 1 + Math.floor(this.game.dungeonLevel / 3));
    return all[Math.floor(Math.random() * (maxIdx + 1))]!;
  }

  private spawnRoom(type: 'vault' | 'den'): void {
    const g = this.game;
    // Rooms are lateral 2×3 extensions of the starting platform (x=2..7, y=23..24).
    // Left side: x=0..1. Right side: x=8..9. y=22..24 (one row above platform top).
    // This keeps the centre columns clear so falling blocks are never intercepted.
    const colors = { vault: '#3d2b00', den: '#2d0000' } as const;
    const side = Math.random() < 0.5 ? 'left' : 'right';
    const roomX = side === 'left' ? 0 : GameConfig.COLS - 2;  // 0 or 8
    const roomY = GameConfig.ROWS - 3;                         // 22 (rows 22..24)
    const color = colors[type];

    for (let dx = 0; dx < 2; dx++) {
      for (let dy = 0; dy < 3; dy++) {
        const x = roomX + dx, y = roomY + dy;
        g.map[x]![y]    = Tile.FLOOR;
        g.colors[x]![y] = color;
      }
    }

    const innerX = roomX + (side === 'left' ? 1 : 0);  // column closer to starting platform
    const midY   = roomY + 1;                           // middle row of the room

    if (type === 'vault') {
      // Place a bonus altar in the vault, guarded by a monster.
      const altarX = roomX + (side === 'left' ? 0 : 1);
      const altarTier: 1 | 2 | 3 = g.dungeonLevel >= Balance.CONFIG.altars.vaultTierMinFloorT3 ? 3 : g.dungeonLevel >= Balance.CONFIG.altars.vaultTierMinFloorT2 ? 2 : 1;
      const altarColor = Colors.forTier(altarTier).bg;
      g.colors[altarX]![midY] = altarColor;
      g.altarTiles.push({ x: altarX, y: midY, tier: altarTier });
      this.monster(this.randomMonsterKey(), innerX, roomY);
      g.cb.log(`A Treasure Vault lies to the ${side} — guarded.`, 'log-perk', 'item_gold_pouch');
    } else {
      const positions: Array<[number, number]> = [[0, 0], [1, 0], [0, 1]];
      for (const [pdx, pdy] of positions) {
        this.monster(this.randomMonsterKey(), roomX + pdx, roomY + pdy);
      }
      g.cb.log(`A Monster Den lurks to the ${side}...`, 'log-damage', 'status_poison');
    }
  }
}
