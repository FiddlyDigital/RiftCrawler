import { Tile, type InspectInfo } from '../types';
import { GameConfig } from '../config';
import { CombatSystem } from '../systems/combat';
import type { Game } from '../game';

/**
 * Builds the tap-to-inspect tooltip for a tile. A read-only projection over the
 * {@link Game} it's composed onto — it looks up whatever occupies a cell (hero,
 * monster, hazard, or floor feature) and never mutates state.
 */
export class InspectView {
  constructor(private readonly game: Game) {}

  /**
   * The inspect-tooltip content for whatever occupies `(x, y)`, or null.
   * @throws {TypeError} If `x` or `y` is not a finite number.
   */
  build(x: number, y: number): InspectInfo | null {
    if (typeof x !== 'number' || !Number.isFinite(x)) throw new TypeError('InspectView.build: "x" must be a finite number');
    if (typeof y !== 'number' || !Number.isFinite(y)) throw new TypeError('InspectView.build: "y" must be a finite number');
    if (x < 0 || x >= GameConfig.COLS || y < 0 || y >= GameConfig.ROWS) return null;
    const g = this.game;

    if (g.player.x === x && g.player.y === y) {
      const lines = [
        `HP ${Math.round(g.player.hp)}/${Math.round(g.player.maxHp)}`,
        `ATK ${Math.round(g.player.totalAtk)}  DEF ${g.player.totalDef}`,
        `Lv.${g.player.playerLevel}`,
      ];
      if (g.player.boons.length > 0) lines.push(`Geasa: ${g.player.boons.map(b => `[[icon:${b.def.char}]]×${b.stacks}`).join(' ')}`);
      return { icon: g.player.char, title: 'You', lines };
    }

    const monster = g.getMonsterAt(x, y);
    if (monster) {
      const hitPct = Math.round(CombatSystem.estimateHitChance(g.player.combatLevel, monster.combatLevel) * 100);
      const lines = [
        `HP ${Math.max(0, monster.hp)}/${monster.maxHp}`,
        `ATK ${monster.atk}`,
        `Your hit chance: ${hitPct}%`,
        `Type: ${monster.behaviorType}`,
      ];
      if (monster.statuses.length > 0) lines.push(`Status: ${monster.statuses.map(s => s.type).join(', ')}`);
      return { icon: monster.char, title: monster.name, lines };
    }

    const hazard = g.getHazardAt(x, y);
    if (hazard) {
      if (hazard.type === 'spike') {
        const line = hazard.warning ? `Firing in ${hazard.timer}!` : `Arms in ${hazard.timer} turns`;
        return { icon: 'trap_spike', title: 'Spike Trap', lines: [line] };
      }
      if (hazard.type === 'smoke') {
        return { icon: 'trap_smoke', title: 'Smoke Cloud', lines: ['Limits vision while standing inside'] };
      }
      if (hazard.type === 'teleport') {
        return { icon: 'trap_teleport', title: 'Teleport Rune', lines: ['Warps whoever steps on it to a random floor tile'] };
      }
    }

    if (g.map[x]![y] === Tile.STAIRS) {
      return { icon: 'tile_stairs', title: 'Stairs', lines: ['Descend to the next floor'] };
    }

    if (g.isTattooTile(x, y)) {
      return g.player.brandsCapped
        ? { icon: 'tile_merchant', title: 'Occult Tattoo Artist', lines: ['No room left — you already bear 5 Ogham Marks'] }
        : { icon: 'tile_merchant', title: 'Occult Tattoo Artist', lines: ['Receive a permanent Ogham Mark'] };
    }

    const altarInfo = g.altarTiles.find(a => a.x === x && a.y === y);
    if (altarInfo) {
      const tierName = altarInfo.tier === 3 ? 'Grand Altar (Tier III)' : altarInfo.tier === 2 ? 'Ruined Altar (Tier II)' : 'Minor Altar (Tier I)';
      return { icon: 'tile_altar', title: tierName, lines: ['Step on to choose a stackable geis'] };
    }

    const npcInfo = g.npcTiles.find(n => n.x === x && n.y === y);
    if (npcInfo) {
      return npcInfo.npcId === '__ghost__'
        ? { icon: 'sprite_boss_wraith', title: 'A Restless Ghost', lines: ['A fallen wanderer... something about them is familiar'] }
        : { icon: 'npc_sidhe', title: 'A Wandering Stranger', lines: ['Step closer to speak with them'] };
    }

    const special = g.specialTiles.find(t => t.x === x && t.y === y);
    if (special) {
      if (special.type === 'swamp')  return { icon: 'special_swamp',  title: 'Swamp',         lines: ['Deals 1 dmg/turn to monsters'] };
      if (special.type === 'sacred') return { icon: 'special_sacred', title: 'Sacred Ground', lines: ['Wait here for +2 bonus HP per rest'] };
      if (special.type === 'ice')    return { icon: 'special_ice',    title: 'Ice',           lines: ['Slide uncontrollably in direction of travel'] };
    }

    return null;
  }
}
