import { Tile, type RangedAbility, type SpecialTile } from '../types';
import { Monster, StatMath } from '../entities';
import { GameConfig } from '../config';
import { CombatSystem } from './combat';
import { HazardSystem } from './hazards';
import { MonsterAiSystem } from './monsterAI';
import type { Game } from '../game';

/**
 * The player's ranged abilities / patron spells. Stateless — every method reads
 * and mutates the passed {@link Game} (its player, monsters, and callback
 * stream), so nothing here needs saving. Dispatched from {@link Game.handleRangedAttack}.
 */
export class AbilitySystem {
  /** Reads a numeric tuning param off an ability, or `fallback` if absent/non-numeric. */
  private static num(ability: RangedAbility, key: string, fallback: number): number {
    const v = ability.params?.[key];
    return typeof v === 'number' ? v : fallback;
  }

  /** Reads a string tuning param off an ability, or `fallback` if absent/non-string. */
  private static str(ability: RangedAbility, key: string, fallback: string): string {
    const v = ability.params?.[key];
    return typeof v === 'string' ? v : fallback;
  }

  /**
   * Removes every monster in `targets` that an AoE spell just dropped to ≤0 HP,
   * routing each through {@link CombatSystem.killMonster} so line-of-death
   * rewards/victory still fire. Shared by the multi-target spells.
   */
  private static reap(game: Game, targets: Monster[]): void {
    const killed = targets.filter(m => m.hp <= 0);
    game.monsters = game.monsters.filter(m => m.hp > 0);
    for (const m of killed) CombatSystem.killMonster(m, game);
  }

  /**
   * Kills a single-target victim through {@link CombatSystem.killMonster} and
   * fires its biome death hook (once). Shared by the single-target spells.
   */
  private static slayWithHooks(game: Game, target: Monster): void {
    const bx = target.x, by = target.y;
    CombatSystem.killMonster(target, game);
    if (target.isBoss && game.activeBossOnDeath) {
      game.activeBossOnDeath(game, bx, by);
      game.activeBossOnDeath = null;
    }
  }

  /** Casts the player's active ranged ability/spell, dispatched by `abilityType`. HP-pact spells pre-check a valid target before charging the cost. */
  static cast(game: Game): void {
    if (game.player.hp <= 0 || game.paused) return;
    const ability = game.player.rangedAbility;
    if (!ability) {
      game.cb.log('Your class has no ranged ability. (Q)', 'log-neutral');
      return;
    }
    if (game.player.isStunned) {
      game.cb.log('You are stunned!', 'log-damage');
      game.advanceTurn();
      return;
    }
    if (game.player.rangedCooldown > 0) {
      game.cb.log(`${ability.name} on cooldown (${game.player.rangedCooldown} turns).`, 'log-neutral', ability.emoji);
      return;
    }

    // HP-pact gate (An Draoi): spells are paid for in life, as a fraction of
    // Max HP. The cost bypasses damage reduction — a pact ignores armor — and
    // is deducted up front; the activation receives the amount paid so spell
    // power can scale off it (Max HP is both mana pool and spellpower).
    let hpPaid = 0;
    const hpCostPctRaw = ability.params?.['hpCostPct'];
    if (typeof hpCostPctRaw === 'number' && hpCostPctRaw > 0) {
      const cost = StatMath.pctOf(game.player.maxHp, hpCostPctRaw);
      if (game.player.hp <= cost) {
        game.cb.log(`The pact will not take your last breath. (${ability.name} costs ${cost} HP — you have ${Math.round(game.player.hp)})`, 'log-neutral', ability.emoji);
        return;
      }
      // Targeted spells need a target BEFORE the price is paid — a whiffed
      // cast shouldn't cost blood.
      if (ability.abilityType === 'drain' && !AbilitySystem.findTarget(game, ability.range)) {
        game.cb.log(`No target in range (${ability.range} tiles).`, 'log-neutral', ability.emoji);
        return;
      }
      if (ability.abilityType === 'gravity_well') {
        const anyInRange = game.monsters.some(m =>
          Math.abs(m.x - game.player.x) + Math.abs(m.y - game.player.y) <= ability.range
          && (game.visibility[m.x]?.[m.y] ?? false));
        if (!anyInRange) {
          game.cb.log(`Nothing within reach of the tide (${ability.range} tiles).`, 'log-neutral', ability.emoji);
          return;
        }
      }
      game.player.hp -= cost;
      hpPaid = cost;
      game.damageTaken += cost;
      game.cb.onParticle(game.player.x, game.player.y, `-${cost}`, '#c1443c', 14);
      game.cb.onAudio?.('playerDamage');
    }

    switch (ability.abilityType) {
      case 'time_dilation': AbilitySystem.timeDilation(game, ability); break;
      case 'gravity_well':  AbilitySystem.gravityWell(game, ability);  break;
      case 'consecrate':    AbilitySystem.consecrate(game, ability);    break;
      case 'overload':      AbilitySystem.overload(game, ability);      break;
      case 'shriek':        AbilitySystem.shriek(game, ability, hpPaid); break;
      case 'veil':          AbilitySystem.veil(game, ability);           break;
      case 'drain':         AbilitySystem.drain(game, ability, hpPaid);  break;
      case 'blight':        AbilitySystem.blight(game, ability, hpPaid); break;
      case 'blink':         AbilitySystem.blink(game, ability);          break;
      case 'spear_bolt':    AbilitySystem.spearBolt(game, ability);      break;
      default:              AbilitySystem.bolt(game, ability);          break;
    }
  }

  // Badb's Shriek (the Morrígan): raining fire and mass terror — damage every
  // visible monster for a multiple of the HP paid; survivors may be stunned.
  private static shriek(game: Game, ability: RangedAbility, hpPaid: number): void {
    const dmgMult = AbilitySystem.num(ability, 'dmgMult', 2);
    // dmgMult 0 = a pure-terror variant (Fog of Blood): stun-only, no damage
    const dmg = dmgMult > 0 ? Math.max(1, Math.round(hpPaid * dmgMult)) : 0;
    const stunChance = AbilitySystem.num(ability, 'stunChance', 0.35);
    const stunDuration = AbilitySystem.num(ability, 'stunDuration', 1);
    const targets = game.monsters.filter(m => game.visibility[m.x]?.[m.y]);
    for (const m of targets) {
      if (dmg > 0) {
        m.hp -= dmg;
        game.cb.onParticle(m.x, m.y, `-${dmg}`, '#c3272a', 16, 'fx_fire');
      }
      if (m.hp > 0 && !m.isStunned && Math.random() < stunChance) {
        m.statuses.push({ type: 'stun', duration: stunDuration, power: 0 });
        game.cb.onParticle(m.x, m.y, 'TERROR', '#b98fc4', 11);
      }
    }
    AbilitySystem.reap(game, targets);
    game.player.rangedCooldown = ability.cooldownMax;
    game.cb.log(
      dmg > 0
        ? `${ability.name.toUpperCase()}! ${targets.length} foe(s) seared for ${dmg} — the Morrígan takes her due.`
        : `${ability.name.toUpperCase()}! Terror grips ${targets.length} foe(s) — the Morrígan takes her due.`,
      'log-combo', ability.emoji,
    );
    game.cb.onRingPulse?.(game.player.x, game.player.y, '195,39,42');
    game.cb.onParticleBurst?.(game.player.x, game.player.y, 12, '#c3272a', 'fx_fire');
    game.cb.onAudio?.('bossWarn');
    game.advanceTurn();
  }

  // Blight of the Deep (Tethra): poison every visible monster; the venom's
  // power scales with the HP paid.
  private static blight(game: Game, ability: RangedAbility, hpPaid: number): void {
    const duration = AbilitySystem.num(ability, 'poisonDuration', 4);
    const power = Math.max(1, Math.round(hpPaid * AbilitySystem.num(ability, 'poisonPowerPct', 0.5)));
    const targets = game.monsters.filter(m => game.visibility[m.x]?.[m.y]);
    for (const m of targets) {
      m.statuses = m.statuses.filter(s => s.type !== 'poison');
      m.statuses.push({ type: 'poison', duration, power });
      game.cb.onParticle(m.x, m.y, 'BLIGHT', '#7cb342', 11, 'status_poison');
    }
    game.player.rangedCooldown = ability.cooldownMax;
    game.cb.log(`${ability.name}! ${targets.length} foe(s) wither — ${power} poison/turn for ${duration} turns.`, 'log-combo', ability.emoji);
    game.cb.onRingPulse?.(game.player.x, game.player.y, '124,179,66');
    game.cb.onAudio?.('poison');
    game.advanceTurn();
  }

  // Sea-Road (Manannán): step through the Otherworld to a random floor tile,
  // trailing a brief wisp of the Féth Fíada.
  private static blink(game: Game, ability: RangedAbility): void {
    const fromX = game.player.x, fromY = game.player.y;
    HazardSystem.teleportEntity(game.player, game);
    game.player.veiledTurns = Math.max(game.player.veiledTurns, AbilitySystem.num(ability, 'veilTurns', 2));
    game.player.rangedCooldown = ability.cooldownMax;
    game.cb.onParticle(fromX, fromY, '', '#9fe3c0', undefined, 'trap_smoke');
    game.cb.onParticle(game.player.x, game.player.y, '', '#9fe3c0', undefined, 'trap_teleport');
    game.cb.log(`${ability.name} — you step through the Otherworld and out again.`, 'log-perk', ability.emoji);
    game.cb.onAudio?.('teleport');
    game.updateVisibility();
    game.advanceTurn();
  }

  // Féth Fíada (Manannán mac Lir): the god-mist — monsters cannot see, chase,
  // or strike you while veiled. Bres alone sees through it.
  private static veil(game: Game, ability: RangedAbility): void {
    game.player.veiledTurns = AbilitySystem.num(ability, 'veilTurns', 6);
    game.player.rangedCooldown = ability.cooldownMax;
    game.cb.log(`The Féth Fíada rises — you fade from mortal sight for ${game.player.veiledTurns} turns.`, 'log-perk', ability.emoji);
    if (game.gorgothSummoned) game.cb.log('Bres laughs — a god-king sees through god-mist.', 'log-boss', 'sprite_boss_gorgoth');
    game.cb.onRingPulse?.(game.player.x, game.player.y, '63,158,147');
    game.cb.onParticleBurst?.(game.player.x, game.player.y, 8, '#9fe3c0', 'trap_smoke');
    game.cb.onAudio?.('teleport');
    game.advanceTurn();
  }

  // Tethra's Tithe: parasitic drain — a multiple of the HP paid as damage to
  // the nearest target, healing back a share; a kill refunds the entire cost.
  private static drain(game: Game, ability: RangedAbility, hpPaid: number): void {
    const target = AbilitySystem.findTarget(game, ability.range);
    if (!target) {
      // Only reachable for a cost-free drain variant; paid casts pre-check the target.
      game.cb.log(`No target in range (${ability.range} tiles).`, 'log-neutral', ability.emoji);
      return;
    }
    let dmg = Math.max(1, Math.round(hpPaid * AbilitySystem.num(ability, 'dmgMult', 2)));
    const healPct = AbilitySystem.num(ability, 'healPct', 0);
    const refundOnKill = AbilitySystem.num(ability, 'refundOnKill', 0) > 0;
    // Tethra's Maw: a target already near death is devoured outright
    const executeBelowPct = AbilitySystem.num(ability, 'executeBelowPct', 0);
    const executed = executeBelowPct > 0 && target.hp <= target.maxHp * executeBelowPct;
    if (executed) dmg = target.hp;

    AbilitySystem.trail(game, target.x, target.y, ability.emoji);
    target.hp -= dmg;
    game.cb.onParticle(target.x, target.y, executed ? 'DEVOURED' : `-${dmg}`, '#8d6fd4', 16, ability.emoji);
    game.cb.log(
      executed
        ? `${ability.name} DEVOURS ${target.name} whole!`
        : `${ability.name} rends ${target.name} for ${dmg}!`,
      'log-combo', ability.emoji,
    );

    if (healPct > 0) {
      const healed = game.player.heal(Math.round(dmg * healPct));
      if (healed > 0) game.cb.onParticle(game.player.x, game.player.y, `+${healed} HP`, '#69f0ae');
    }

    if (target.hp <= 0) {
      if (refundOnKill && hpPaid > 0) {
        const refunded = game.player.heal(hpPaid);
        if (refunded > 0) game.cb.log(`Tethra returns the tithe — +${refunded} HP.`, 'log-perk', ability.emoji);
      }
      AbilitySystem.slayWithHooks(game, target);
    }

    game.player.rangedCooldown = ability.cooldownMax;
    game.advanceTurn();
  }

  private static bolt(game: Game, ability: RangedAbility): void {
    if (game.player.rangedAmmo === 0) {
      game.cb.log(`No ${ability.name}s left! (Replenish on next floor)`, 'log-neutral');
      return;
    }

    const target = AbilitySystem.findTarget(game, ability.range);
    if (!target) {
      game.cb.log(`No target in range (${ability.range} tiles).`, 'log-neutral', ability.emoji);
      return;
    }

    AbilitySystem.trail(game, target.x, target.y, ability.emoji);
    CombatSystem.playerAttackMonster(target, game, false, ability.damageMult);

    if (ability.statusEffect === 'stun' && target.hp > 0 && !target.isStunned) {
      target.statuses.push({ type: 'stun', duration: AbilitySystem.num(ability, 'stunDuration', 1), power: 0 });
      game.cb.log(`${target.name} is smited and stunned!`, 'log-success');
    }

    if (game.player.rangedAmmo > 0) game.player.rangedAmmo--;
    if (ability.cooldownMax > 0) game.player.rangedCooldown = ability.cooldownMax;

    if (target.hp <= 0) AbilitySystem.slayWithHooks(game, target);

    game.advanceTurn();
  }

  private static timeDilation(game: Game, ability: RangedAbility): void {
    const slowTurns = AbilitySystem.num(ability, 'slowTurns', 15);
    game.timeDilationTurns = slowTurns;
    game.timeDilationSlowPct = AbilitySystem.num(ability, 'slowPct', 100);
    game.player.rangedCooldown = ability.cooldownMax;
    game.cb.log(`Time Dilation! Gravity slowed for ${slowTurns} turns.`, 'log-perk', ability.emoji);
    game.cb.onParticle(game.player.x, game.player.y, 'SLOW!', '#b39ddb', 16, ability.emoji);
    game.cb.onRingPulse?.(game.player.x, game.player.y, '63,158,147');  // time ripples outward
    game.cb.onAction();  // immediately restart tick interval with new slow value
    game.advanceTurn();
  }

  private static gravityWell(game: Game, ability: RangedAbility): void {
    const pullSteps = AbilitySystem.num(ability, 'pullSteps', 2);
    const stunDuration = AbilitySystem.num(ability, 'stunDuration', 1);
    const mdist = (m: Monster): number => Math.abs(m.x - game.player.x) + Math.abs(m.y - game.player.y);
    const eligible = [...game.monsters]
      .filter(m => mdist(m) <= ability.range && (game.visibility[m.x]?.[m.y] ?? false))
      .sort((a, b) => mdist(a) - mdist(b));
    const moved = new Set<Monster>();
    for (let step = 0; step < pullSteps; step++) {
      for (const m of eligible) {
        const sx = Math.sign(game.player.x - m.x);
        const sy = Math.sign(game.player.y - m.y);
        for (const [dx, dy] of [[sx, 0], [0, sy]] as [number, number][]) {
          if (dx === 0 && dy === 0) continue;
          const nx = m.x + dx, ny = m.y + dy;
          if (game.map[nx]?.[ny] === Tile.FLOOR && !game.getMonsterAt(nx, ny)) {
            m.x = nx; m.y = ny; moved.add(m);
            game.cb.onParticle(nx, ny, '', '#7e57c2', undefined, 'trap_teleport');
            break;
          }
        }
      }
    }
    for (const m of moved) {
      if (!m.isStunned) m.statuses.push({ type: 'stun', duration: stunDuration, power: 0 });
    }
    game.player.rangedCooldown = ability.cooldownMax;
    game.cb.log(`Gravity Well! ${moved.size} monster(s) pulled & stunned.`, 'log-perk', 'trap_teleport');
    game.advanceTurn();
  }

  private static consecrate(game: Game, ability: RangedAbility): void {
    const radiusParam = ability.params?.['radius'];
    const r = typeof radiusParam === 'number' ? radiusParam : game.player.visionRadius;
    const tileType = AbilitySystem.str(ability, 'tileType', 'sacred') as SpecialTile['type'];
    let count = 0;
    for (let cx = 0; cx < GameConfig.COLS; cx++) {
      for (let cy = 0; cy < GameConfig.ROWS; cy++) {
        if (Math.hypot(cx - game.player.x, cy - game.player.y) > r) continue;
        if (game.map[cx]?.[cy] !== Tile.FLOOR) continue;
        if (game.specialTiles.some(t => t.x === cx && t.y === cy)) continue;
        game.specialTiles.push({ x: cx, y: cy, type: tileType });
        count++;
      }
    }
    game.player.rangedCooldown = ability.cooldownMax;
    game.cb.log(`Sacred Grounds! ${count} tiles consecrated.`, 'log-perk', 'special_sacred');
    game.cb.onParticle(game.player.x, game.player.y, 'HOLY', '#fff176', 18, 'special_sacred');
    game.cb.onRingPulse?.(game.player.x, game.player.y, '217,164,65');  // golden blessing wave
    game.cb.onParticleBurst?.(game.player.x, game.player.y, 10, '#ffd98a', 'special_sacred');
    game.advanceTurn();
  }

  private static overload(game: Game, ability: RangedAbility): void {
    const perKillDmg = AbilitySystem.num(ability, 'perKillDmg', 8);
    const perFloorMinDmg = AbilitySystem.num(ability, 'perFloorMinDmg', 5);
    const dmg = Math.max(game.dungeonLevel * perFloorMinDmg, perKillDmg * game.killsThisFloor);
    const targets = game.monsters.filter(m => game.visibility[m.x]?.[m.y]);
    for (const m of targets) {
      m.hp -= dmg;
      game.cb.onParticle(m.x, m.y, `-${dmg}`, '#ff6d00', 16, 'fx_impact');
    }
    AbilitySystem.reap(game, targets);
    game.cb.log(`Overload! ${targets.length} monsters hit for ${dmg} dmg (${game.killsThisFloor} kills × ${perKillDmg}, min floor×${perFloorMinDmg}).`, 'log-combo', 'fx_impact');
    game.cb.onParticle(game.player.x, game.player.y, 'BOOM!', '#ff6d00', 18, 'fx_impact');
    game.killsThisFloor = 0;
    game.player.rangedCooldown = ability.cooldownMax;
    game.advanceTurn();
  }

  // Spear of Lugh (Lugh's Spear questline, reforged by Goibniu): pierces
  // straight up the hero's own vertical column, skewering every monster
  // standing on a built tile above them — a direct answer to a lane packed
  // with enemies, rather than another flat-damage nuke.
  private static spearBolt(game: Game, ability: RangedAbility): void {
    const dmg = Math.max(1, Math.round(game.player.atk * AbilitySystem.num(ability, 'dmgMult', 3)));
    const targets = game.monsters.filter(m => m.x === game.player.x && m.y < game.player.y);
    AbilitySystem.trail(game, game.player.x, 0, ability.emoji);
    for (const m of targets) {
      m.hp -= dmg;
      game.cb.onParticle(m.x, m.y, `-${dmg}`, '#ffd54f', 16, 'fx_arcane');
    }
    AbilitySystem.reap(game, targets);
    game.cb.log(`${ability.name}! ${targets.length} foe(s) skewered for ${dmg} in the column above.`, 'log-combo', ability.emoji);
    game.cb.onParticleBurst?.(game.player.x, game.player.y, 10, '#ffd54f', 'fx_arcane');
    game.player.rangedCooldown = ability.cooldownMax;
    game.advanceTurn();
  }

  /** The nearest visible, line-of-sight monster within `range`, or `null`. */
  private static findTarget(game: Game, range: number): Monster | null {
    const inRange = game.monsters.filter(m => {
      const dist = Math.abs(m.x - game.player.x) + Math.abs(m.y - game.player.y);
      return dist <= range
        && (game.visibility[m.x]?.[m.y] ?? false)
        && MonsterAiSystem.hasLineOfSight(game.player.x, game.player.y, m.x, m.y, game);
    });
    inRange.sort((a, b) => {
      const da = Math.abs(a.x - game.player.x) + Math.abs(a.y - game.player.y);
      const db = Math.abs(b.x - game.player.x) + Math.abs(b.y - game.player.y);
      return da - db;
    });
    return inRange[0] ?? null;
  }

  /** Emits a dotted particle trail from the player to `(tx, ty)`, for ranged-attack visual feedback. */
  private static trail(game: Game, tx: number, ty: number, icon: string): void {
    // Bresenham path from player to target, emit a dot particle at each step
    let x = game.player.x, y = game.player.y;
    const dx = Math.abs(tx - x), dy = Math.abs(ty - y);
    const sx = x < tx ? 1 : -1, sy = y < ty ? 1 : -1;
    let err = dx - dy;
    while (!(x === tx && y === ty)) {
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx)  { err += dx; y += sy; }
      if (x !== tx || y !== ty) game.cb.onParticle(x, y, '·', '#ffcc02');
    }
    game.cb.onParticle(tx, ty, '', '#ffcc02', undefined, icon);
  }
}
