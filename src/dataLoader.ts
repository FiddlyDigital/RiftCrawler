import visualRegistryData from './data/visual-registry.json';
import monstersData       from './data/monsters.json';
import bossesData         from './data/bosses.json';
import itemsData          from './data/items.json';
import shapesData         from './data/shapes.json';
import { Cell, type CellValue, type StatusType, type RelicDef, type ModifierDef, type ClassDef, type BiomeDef, type FloorEventDef, type RangedAbility, type BoonDef, type BrandDef, type OfferRole } from './types';
import type { Player } from './entities';
import type { MonsterDef, BossDef, ItemDef } from './types';

// ── Visual registry ───────────────────────────────────────────────────────────

export const VISUAL_REGISTRY: Record<string, string> = visualRegistryData as Record<string, string>;

function vis(assetId: string): string {
  return VISUAL_REGISTRY[assetId] ?? '❓';
}

// ── Raw JSON shapes (local — not exposed) ─────────────────────────────────────

interface RawMonster {
  id: string; displayName: string; visualAsset: string; cellTypeId: string;
  combatLevel?: number;
  baseHp: number; baseAtk: number;
  hpScaleCoefficient: number; atkScaleCoefficient: number;
  xpValue: number; spawnMsg: string;
  statusInflict?: { type: string; chance: number; duration: number; power: number };
  behaviorType?: string;
  attackRange?: number;
  moveSpeed?: number;
}

interface RawBoss {
  id: string; displayName: string; visualAsset: string;
  hpMult: number; atkMult: number; xpValue: number; flavorText: string;
}

interface RawItem {
  id: string; displayName: string; visualAsset: string; cellTypeId: string;
  effectType: string; effectValue: number;
}

interface RawShape {
  matrix: number[][]; color: string; preview: string;
}

// ── Cell type ID → CellValue ──────────────────────────────────────────────────

const CELL_MAP: Record<string, CellValue> = {
  MONSTER_RAT:    Cell.MONSTER_RAT,
  MONSTER_SKEL:   Cell.MONSTER_SKEL,
  ITEM_POTION:    Cell.ITEM_POTION,
  ITEM_SWORD:     Cell.ITEM_SWORD,
  MONSTER_ARCHER: Cell.MONSTER_ARCHER,
  MONSTER_SLIME:  Cell.MONSTER_SLIME,
  MONSTER_ORC:    Cell.MONSTER_ORC,
  MONSTER_BAT:    Cell.MONSTER_BAT,
};

// ── Monsters ──────────────────────────────────────────────────────────────────

export const MONSTERS: Record<string, MonsterDef> = Object.fromEntries(
  Object.entries(monstersData as Record<string, RawMonster>).map(([key, raw]) => [
    key,
    {
      char:         vis(raw.visualAsset),
      name:         raw.displayName,
      combatLevel:  raw.combatLevel ?? 2,
      baseHp:       raw.baseHp,
      hpPerLevel:   raw.hpScaleCoefficient,
      baseAtk:      raw.baseAtk,
      atkPerLevel:  raw.atkScaleCoefficient,
      cellState:    CELL_MAP[raw.cellTypeId] ?? Cell.FLOOR,
      spawnMsg:     raw.spawnMsg,
      xpReward:     raw.xpValue,
      statusInflict: raw.statusInflict
        ? {
            type:     raw.statusInflict.type as StatusType,
            chance:   raw.statusInflict.chance,
            duration: raw.statusInflict.duration,
            power:    raw.statusInflict.power,
          }
        : undefined,
      behaviorType: raw.behaviorType,
      attackRange:  raw.attackRange,
      moveSpeed:    raw.moveSpeed,
    } satisfies MonsterDef,
  ])
);

export const MONSTER_DEFS: MonsterDef[] = Object.values(MONSTERS);

// ── Bosses ────────────────────────────────────────────────────────────────────

export const BOSSES: BossDef[] = [
  ...(bossesData as RawBoss[]).map(raw => ({
    char:       vis(raw.visualAsset),
    name:       raw.displayName,
    hpMult:     raw.hpMult,
    atkMult:    raw.atkMult,
    xpReward:   raw.xpValue,
    flavorText: raw.flavorText,
  })),
  // Biome-specific bosses — never appear outside their biome
  {
    biomeId:    'cavern',
    char:       '💎',
    name:       'Crystal Golem',
    hpMult:     4.5,
    atkMult:    2.0,
    xpReward:   240,
    flavorText: 'It cannot be destroyed... only shattered.',
    onDeath:    (game, x, y) => game.spawnCrystalShards(x, y),
  },
  {
    biomeId:    'rift',
    char:       '👁️',
    name:       'Rift Tyrant',
    hpMult:     5.0,
    atkMult:    2.5,
    xpReward:   280,
    flavorText: 'Reality bends around it...',
    onHalfHp:   (game) => game.triggerGravityBurst(),
  },
];

// ── Items ─────────────────────────────────────────────────────────────────────

const ITEM_EFFECT_TO_TYPE: Record<string, 'heal' | 'stat' | 'mana' | 'grenade' | 'cure' | 'shock'> = {
  heal:    'heal',
  atk:     'stat',
  mana:    'mana',
  grenade: 'grenade',
  cure:    'cure',
  shock:   'shock',
};

export const ITEMS: Record<string, ItemDef> = Object.fromEntries(
  Object.entries(itemsData as Record<string, RawItem>).map(([key, raw]) => [
    key,
    {
      char:      vis(raw.visualAsset),
      name:      raw.displayName,
      type:      ITEM_EFFECT_TO_TYPE[raw.effectType] ?? 'heal',
      statValue: raw.effectValue,
      cellState: CELL_MAP[raw.cellTypeId] ?? Cell.FLOOR,
    } satisfies ItemDef,
  ])
);

// ── Boons ─────────────────────────────────────────────────────────────────────

export const BOONS: BoonDef[] = [
  // ── Tier I — Shards ──────────────────────────────────────────────────────
  { id: 'whetstone',     char: '⚔️',  name: 'Whetstone',     tier: 1, role: 'offense', desc: '+2 ATK per stack',              onAdd: (p) => { p.atk += 2; } },
  { id: 'vital_crystal', char: '❤️',  name: 'Vital Crystal', tier: 1, role: 'defense', desc: '+8 Max HP per stack',           onAdd: (p) => { p.maxHp += 8; p.hp += 8; } },
  { id: 'iron_scale',    char: '🛡️',  name: 'Iron Scale',    tier: 1, role: 'defense', desc: '+1 damage reduction per stack', onAdd: (p) => { p.damageReduction += 1; } },
  { id: 'mending_drip',  char: '💧',  name: 'Mending Drip',  tier: 1, role: 'defense', desc: '+0.5 HP regen/tick per stack',  onAdd: (p) => { p.regenPerTick += 0.5; } },
  { id: 'sight_shard',   char: '👁️',  name: 'Sight Shard',   tier: 1, role: 'utility', desc: '+1 vision radius per stack',   onAdd: (p) => { p.visionRadius += 1; } },
  { id: 'gravity_well',  char: '⏳',  name: 'Gravity Well',  tier: 1, role: 'utility', desc: '5% slower gravity per stack',   onAdd: (p) => { p.tickSlowPercent += 5; } },
  { id: 'iron_ward',     char: '🧪',  name: 'Iron Ward',     tier: 1, role: 'defense', desc: 'Immune to poison',              onAdd: (p) => { p.poisonImmune = true; } },
  // ── Tier II — Cores ───────────────────────────────────────────────────────
  { id: 'bloodtap',  char: '🩸', name: 'Bloodtap Core',  tier: 2, role: 'defense', desc: '+3 HP on kill per stack',           onAdd: (p) => { p.killHeal += 3; } },
  { id: 'thornweave', char: '🌵', name: 'Thornweave Core', tier: 2, role: 'offense', desc: '+3 thorn dmg to attacker per stack', onAdd: (p) => { p.thornDamage += 3; } },
  { id: 'riftblast',  char: '💥', name: 'Riftblast Core', tier: 2, role: 'offense', desc: '+4 line-clear monster dmg per stack', onAdd: (p) => { p.lineClearDamage += 4; } },
  { id: 'ghost_step', char: '🌀', name: 'Ghost Step',     tier: 2, role: 'defense', desc: '+10% dodge (max 75%) per stack',   onAdd: (p) => { p.dodgeChance = Math.min(0.75, p.dodgeChance + 0.10); } },
  { id: 'cruelty',    char: '⚡', name: 'Cruelty Core',   tier: 2, role: 'offense', desc: '+1 ATK per kill this floor (per stack)', onAdd: (p) => { p.killAtkBonus += 1; } },
  {
    id: 'void_loop', char: '🔮', name: 'Void Loop', tier: 2, role: 'offense', desc: 'Every Nth attack crits (N decreases per stack)',
    onAdd: (p, stacks) => {
      if (stacks === 1) { p.critEvery = 6; p.critCount = 0; }
      else p.critEvery = Math.max(2, p.critEvery - 1);
    },
  },
  // ── Tier III — Runes ─────────────────────────────────────────────────────
  { id: 'annihilation', char: '☄️', name: 'Annihilation Rune', tier: 3, role: 'offense', desc: 'Line clears deal floor×4 dmg to ALL monsters per stack', onAdd: (p) => { p.lineClearAoeDmgMult += 4; } },
  { id: 'deathward',    char: '💀', name: 'Deathward Rune',    tier: 3, role: 'defense', desc: 'Survive a killing blow once per floor per stack',         onAdd: (p) => { p.deathwardCharges += 1; } },
  { id: 'rift_tide',    char: '🌊', name: 'Rift Tide',         tier: 3, role: 'utility', desc: '20% slower gravity, +0.3× line-clear XP per stack',      onAdd: (p) => { p.tickSlowPercent += 20; p.lineClearXpMult += 0.3; } },
  { id: 'void_prism',   char: '🌌', name: 'Void Prism',        tier: 3, role: 'offense', desc: '+1 ATK & +2 HP per distinct boon per stack',              onAdd: (_p, _s) => { /* handled by recomputeVoidPrism */ } },
];

export const BOONS_BY_TIER: Record<1 | 2 | 3, BoonDef[]> = {
  1: BOONS.filter(b => b.tier === 1),
  2: BOONS.filter(b => b.tier === 2),
  3: BOONS.filter(b => b.tier === 3),
};

export function getBoonTierForFloor(floor: number): 1 | 2 | 3 {
  const r = Math.random();
  if (floor <= 3) {
    if (r < 0.82) return 1;
    if (r < 0.98) return 2;
    return 3;
  }
  if (floor <= 7) {
    if (r < 0.40) return 1;
    if (r < 0.85) return 2;
    return 3;
  }
  if (r < 0.15) return 1;
  if (r < 0.55) return 2;
  return 3;
}

interface OfferItem { id: string; role: OfferRole; }

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

// Build a 3-choice offer that (a) nudges one pick toward a type the player
// already owns (synergy / set completion) and (b) guarantees at least two
// distinct roles, so no offer is three of the same flavour and every run can
// commit to a build. Input randomness stays high; only coherence is enforced.
function buildOffer<T extends OfferItem>(pool: T[], ownedIds: string[]): T[] {
  const shuffled = shuffleInPlace([...pool]);
  if (shuffled.length <= 3) return shuffled;

  const chosen: T[] = [];
  // Synergy nudge: ~55% of the time seed one owned type when it's in the pool.
  if (ownedIds.length && Math.random() < 0.55) {
    const owned = shuffled.find(x => ownedIds.includes(x.id));
    if (owned) chosen.push(owned);
  }
  for (const x of shuffled) {
    if (chosen.length >= 3) break;
    if (!chosen.includes(x)) chosen.push(x);
  }
  // Guarantee >=2 distinct roles: swap the last pick for a different-role
  // candidate if all three ended up sharing a role.
  if (new Set(chosen.map(c => c.role)).size < 2) {
    const alt = shuffled.find(x => !chosen.includes(x) && x.role !== chosen[0]!.role);
    if (alt) chosen[chosen.length - 1] = alt;
  }
  return chosen.slice(0, 3);
}

export function getThreeRandomBoons(pool: BoonDef[], ownedIds: string[] = []): BoonDef[] {
  return buildOffer(pool, ownedIds);
}

// ── Sacred Brands ─────────────────────────────────────────────────────────────

export const BRANDS: BrandDef[] = [
  {
    id: 'war', char: '⚔️', name: 'War', setSize: 3, role: 'offense',
    desc: '+2 ATK per brand',
    setDesc: 'Set: +10 ATK',
    onEquip:      (p) => { p.atk += 2; },
    onSetComplete:(p) => { p.atk += 10; },
  },
  {
    id: 'cryo', char: '❄️', name: 'Cryo', setSize: 3, role: 'utility',
    desc: '+5% tick slow per brand',
    setDesc: 'Set: +25% more tick slow',
    onEquip:      (p) => { p.tickSlowPercent += 5; },
    onSetComplete:(p) => { p.tickSlowPercent += 25; },
  },
  {
    id: 'sick', char: '☠️', name: 'Sick', setSize: 3, role: 'offense',
    desc: '+8% chance to poison on hit',
    setDesc: 'Set: 100% poison on hit',
    onEquip:      (p) => { p.poisonAttackChance = Math.min(1.0, p.poisonAttackChance + 0.08); },
    onSetComplete:(p) => { p.poisonAttackChance = 1.0; },
  },
  {
    id: 'sight', char: '👁️', name: 'Sight', setSize: 2, role: 'utility',
    desc: '+1 vision radius per brand',
    setDesc: 'Set: +2 more vision radius',
    onEquip:      (p) => { p.visionRadius += 1; },
    onSetComplete:(p) => { p.visionRadius += 2; },
  },
  {
    id: 'speed', char: '💨', name: 'Speed', setSize: 2, role: 'utility',
    desc: 'Collecting the set grants extra move',
    setDesc: 'Set: move twice per turn',
    onEquip:      (_p) => { /* set bonus only */ },
    onSetComplete:(p) => { p.bonusHeroMoves += 1; },
  },
  {
    id: 'life', char: '❤️', name: 'Life', setSize: 3, role: 'defense',
    desc: '+5 max HP per brand',
    setDesc: 'Set: free revive (erases all brands!)',
    onEquip:      (p) => { p.maxHp += 5; p.hp = Math.min(p.hp + 5, p.maxHp); },
    onSetComplete:(p) => { p.lifeBrandRevive = true; },
  },
  {
    id: 'guard', char: '🛡️', name: 'Guard', setSize: 2, role: 'defense',
    desc: '+1 damage reduction per brand',
    setDesc: 'Set: +3 more damage reduction',
    onEquip:      (p) => { p.damageReduction += 1; },
    onSetComplete:(p) => { p.damageReduction += 3; },
  },
  {
    id: 'leech', char: '🩸', name: 'Leech', setSize: 2, role: 'defense',
    desc: '+2 HP on kill per brand',
    setDesc: 'Set: +5 more HP on kill',
    onEquip:      (p) => { p.killHeal += 2; },
    onSetComplete:(p) => { p.killHeal += 5; },
  },
  {
    id: 'forge', char: '🔥', name: 'Forge', setSize: 3, role: 'offense',
    desc: '+2 line-clear damage per brand',
    setDesc: 'Set: +8 more line-clear damage',
    onEquip:      (p) => { p.lineClearDamage += 2; },
    onSetComplete:(p) => { p.lineClearDamage += 8; },
  },
  {
    id: 'ghost', char: '👻', name: 'Ghost', setSize: 2, role: 'defense',
    desc: '+5% dodge chance per brand',
    setDesc: 'Set: +20% more dodge',
    onEquip:      (p) => { p.dodgeChance = Math.min(0.75, p.dodgeChance + 0.05); },
    onSetComplete:(p) => { p.dodgeChance = Math.min(0.75, p.dodgeChance + 0.20); },
  },
];

export function getThreeRandomBrands(ownedIds: string[] = []): BrandDef[] {
  return buildOffer([...BRANDS], ownedIds);
}

// ── Relics ────────────────────────────────────────────────────────────────────

export const RELICS: RelicDef[] = [
  {
    id: 'vampire_ring',
    char: '💍',
    name: 'Vampire Ring',
    desc: '+2 HP on every kill',
    onPickup: (p: Player) => { p.killHeal += 2; },
  },
  {
    id: 'echo_stone',
    char: '🌀',
    name: 'Echo Stone',
    desc: '20% chance to dodge attacks',
    onPickup: (p: Player) => { p.dodgeChance += 0.20; },
  },
  {
    id: 'ember_core',
    char: '🔥',
    name: 'Ember Core',
    desc: 'Line clears deal 5 dmg to all visible monsters',
    onPickup: (p: Player) => { p.lineClearDamage += 5; },
  },
  {
    id: 'soul_lantern',
    char: '🕯️',
    name: 'Soul Lantern',
    desc: 'Vision radius +3',
    onPickup: (p: Player) => { p.visionRadius += 3; },
  },
  {
    id: 'talisman',
    char: '🪬',
    name: 'Talisman',
    desc: 'Status effects expire 1 turn sooner',
    onPickup: (p: Player) => { p.statusDurationBonus += 1; },
  },
  {
    id: 'lodestone',
    char: '🧲',
    name: 'Lodestone',
    desc: 'Stun adjacent monsters each tick',
    onPickup: (p: Player) => { p.auraStunRadius = 1; },
  },
  {
    id: 'mana_beads',
    char: '📿',
    name: 'Mana Beads',
    desc: 'Every 5th attack deals double damage',
    onPickup: (p: Player) => { p.critEvery = 5; p.critCount = 0; },
  },
  {
    id: 'blood_pact',
    char: '🩸',
    name: 'Blood Pact',
    desc: '+8 ATK, -10 Max HP',
    onPickup: (p: Player) => {
      p.atk += 8;
      p.maxHp = Math.max(10, p.maxHp - 10);
      p.hp = Math.min(p.hp, p.maxHp);
    },
  },
  {
    id: 'reflex_coil',
    char: '⚡',
    name: 'Reflex Coil',
    desc: 'Dodging an attack restores 4 HP  (great with Rift Weaver)',
    onPickup: (p: Player) => { p.dodgeHeal += 4; },
  },
  {
    id: 'rift_shard',
    char: '💎',
    name: 'Rift Shard',
    desc: 'Each row cleared grants +2 Max HP permanently  (great with Architect)',
    onLineClear: (p: Player, count: number) => {
      p.maxHp += 2 * count;
      p.hp = Math.min(p.hp, p.maxHp);
    },
  },
  {
    id: 'divine_seal',
    char: '✨',
    name: 'Divine Seal',
    desc: 'Triples your kill-heal (min 4 HP)  (great with Cascade)',
    onPickup: (p: Player) => {
      p.killHeal = Math.max(p.killHeal * 3, 4);
    },
  },
];

// ── Modifiers ─────────────────────────────────────────────────────────────────

export const MODIFIERS: ModifierDef[] = [
  {
    id: 'glass_cannon',
    emoji: '🩸',
    name: 'Glass Cannon',
    desc: '+8 ATK, −15 Max HP',
    apply: (g) => { g.player.atk += 8; g.player.maxHp = Math.max(10, g.player.maxHp - 15); g.player.hp = g.player.maxHp; },
  },
  {
    id: 'blessed',
    emoji: '🍀',
    name: 'Blessed',
    desc: 'Potions heal double',
    apply: (g) => { g.potionHealMult = 2; },
  },
  {
    id: 'overclock',
    emoji: '⚡',
    name: 'Overclock',
    desc: 'Gravity 20% faster, XP ×1.5',
    apply: (g) => { g.player.tickSlowPercent -= 20; g.xpMultiplier = 1.5; },
  },
  {
    id: 'cursed',
    emoji: '💀',
    name: 'Cursed',
    desc: 'XP ×2 — but line clears don\'t heal',
    apply: (g) => { g.xpMultiplier = 2.0; g.noLineHeal = true; },
  },
  {
    id: 'blind_run',
    emoji: '🌑',
    name: 'Blind Run',
    desc: 'Vision radius halved',
    apply: (g) => { g.player.visionRadius = Math.max(1, Math.floor(g.player.visionRadius / 2)); },
  },
  {
    id: 'ironclad',
    emoji: '🛡️',
    name: 'Ironclad',
    desc: '+3 Damage Reduction, −3 ATK',
    apply: (g) => { g.player.damageReduction += 3; g.player.atk = Math.max(1, g.player.atk - 3); },
  },
  {
    id: 'haunted',
    emoji: '👁️',
    name: 'Haunted',
    desc: 'Double monster spawn rate',
    apply: (g) => { g.haunted = true; },
  },
  {
    id: 'frozen_rift',
    emoji: '🧊',
    name: 'Frozen Rift',
    desc: 'All monsters spawn stunned for 1 turn',
    apply: (g) => { g.frozenRift = true; },
  },
  {
    id: 'lucky',
    emoji: '✨',
    name: 'Lucky',
    desc: 'Every 5th block contains a guaranteed item',
    apply: (g) => { g.luckyEvery = 0; },
  },
  {
    id: 'berserker',
    emoji: '🔥',
    name: 'Berserker',
    desc: 'ATK doubled, Max HP halved',
    apply: (g) => { g.player.atk = g.player.atk * 2; g.player.maxHp = Math.max(10, Math.floor(g.player.maxHp / 2)); g.player.hp = g.player.maxHp; },
  },
];

// ── Shapes ────────────────────────────────────────────────────────────────────

export type ShapeKey = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';

export interface ShapeDef {
  matrix: number[][];
  color: string;
}

export const SHAPES = shapesData as Record<ShapeKey, ShapeDef>;

export const NEXT_PREVIEWS: Record<ShapeKey, string> = Object.fromEntries(
  Object.entries(shapesData as Record<ShapeKey, RawShape>).map(([k, v]) => [k, v.preview])
) as Record<ShapeKey, string>;

// ── Starting classes ──────────────────────────────────────────────────────────

export const CLASSES: ClassDef[] = [
  {
    id: 'chronomancer',
    emoji: '⌛',
    name: 'Chronomancer',
    tagline: 'Bend time to your will. Slow the rift, outlast everything.',
    statPreview: '−5 HP  gravity 25% slower  D6 dice  ⌛ Time Dilation (Q, +100 slow/15t, cd 14)',
    apply: (p: Player) => {
      p.maxHp = Math.max(10, p.maxHp - 5); p.hp = Math.min(p.hp, p.maxHp);
      p.tickSlowPercent += 25;
      p.baseCombatLevel = 2;
      p.rangedAbility = { name: 'Time Dilation', emoji: '⌛', range: 0, damageMult: 0, cooldownMax: 14, abilityType: 'time_dilation' } satisfies RangedAbility;
    },
  },
  {
    id: 'rift_weaver',
    emoji: '🌀',
    name: 'Rift Weaver',
    tagline: 'Command spatial forces. Pull enemies to their doom.',
    statPreview: '−10 HP  +2 ATK  +2 vision  teleport immune  D8 dice  🌀 Gravity Well (Q, 4-tile pull×2+stun, cd 8)',
    apply: (p: Player) => {
      p.maxHp = Math.max(10, p.maxHp - 10); p.hp = Math.min(p.hp, p.maxHp);
      p.atk += 2;
      p.visionRadius += 2;
      p.teleportImmune = true;
      p.baseCombatLevel = 3;
      p.rangedAbility = { name: 'Gravity Well', emoji: '🌀', range: 4, damageMult: 0, cooldownMax: 8, abilityType: 'gravity_well' } satisfies RangedAbility;
    },
  },
  {
    id: 'architect',
    emoji: '🏗️',
    name: 'The Architect',
    tagline: 'Master the Tetris layer. Every clear is your weapon.',
    statPreview: '+15 HP  −2 ATK  line XP ×2  O vault 80%  T cd −4  D8 dice  ✨ Consecrate (Q, vision-wide, cd 10)',
    apply: (p: Player) => {
      p.maxHp += 15; p.hp += 15;
      p.atk = Math.max(1, p.atk - 2);
      p.lineClearXpMult = 2;
      p.baseCombatLevel = 3;
      p.rangedAbility = { name: 'Consecrate', emoji: '✨', range: 0, damageMult: 0, cooldownMax: 10, abilityType: 'consecrate' } satisfies RangedAbility;
    },
  },
  {
    id: 'cascade',
    emoji: '💥',
    name: 'Cascade',
    tagline: 'Stack kills, then unleash. Pure explosive potential.',
    statPreview: '−20 HP  +10 ATK  line clears deal 4×rows×floor dmg  D10 dice  💥 Overload (Q, 8×kills min floor×5, cd 12)',
    apply: (p: Player) => {
      p.maxHp = Math.max(10, p.maxHp - 20); p.hp = Math.min(p.hp, p.maxHp);
      p.atk += 10;
      p.baseCombatLevel = 4;
      p.rangedAbility = { name: 'Overload', emoji: '💥', range: 0, damageMult: 0, cooldownMax: 12, abilityType: 'overload' } satisfies RangedAbility;
    },
  },
];

// ── Biomes ────────────────────────────────────────────────────────────────────
// Ordered highest minFloor first so getBiomeForFloor can use .find()

export const BIOMES: BiomeDef[] = [
  {
    id: 'rift',
    name: 'Corrupted Rift',
    minFloor: 10,
    tileRgb: '100,40,140',
    monsterHpMult: 1.0,
    gravityPctBonus: -25,
    desc: 'Reality fractures. Blocks fall 25% faster.',
  },
  {
    id: 'cavern',
    name: 'Crystal Caverns',
    minFloor: 5,
    tileRgb: '30,90,160',
    monsterHpMult: 1.25,
    gravityPctBonus: 0,
    desc: 'Ancient crystals harden foes. Monsters have +25% HP.',
  },
  {
    id: 'stone',
    name: 'Stone Halls',
    minFloor: 1,
    tileRgb: '',
    monsterHpMult: 1.0,
    gravityPctBonus: 0,
    desc: 'Familiar ruins. Standard difficulty.',
  },
];

export function getBiomeForFloor(floor: number): BiomeDef {
  return BIOMES.find(b => floor >= b.minFloor) ?? BIOMES[BIOMES.length - 1]!;
}

// ── Floor events ──────────────────────────────────────────────────────────────

export const FLOOR_EVENTS: FloorEventDef[] = [
  {
    id: 'ancient_shrine',
    emoji: '🏛️',
    title: 'Ancient Shrine',
    flavor: 'A worn altar pulses with faint magic. Power can be bought — for a price.',
    options: [
      {
        label: 'Offer HP (20)',
        desc: 'Sacrifice 20 HP for a random boon.',
        apply: (game) => {
          game.player.hp = Math.max(1, game.player.hp - 20);
          game.damageTaken += 20;
          const pool = [...BOONS_BY_TIER[1], ...BOONS_BY_TIER[2]];
          const boon = pool[Math.floor(Math.random() * pool.length)]!;
          game.player.addBoon(boon);
          return `The shrine grants: ${boon.char} ${boon.name}! (${boon.desc})`;
        },
      },
      {
        label: 'Leave undisturbed',
        desc: 'Nothing happens.',
        apply: () => 'You leave the shrine undisturbed.',
      },
    ],
  },
  {
    id: 'healing_spring',
    emoji: '💧',
    title: 'Healing Spring',
    flavor: 'A clear pool bubbles up from the stone floor. Its waters shimmer with life.',
    options: [
      {
        label: 'Drink deeply',
        desc: 'Restore to full HP.',
        apply: (game) => {
          const gained = game.player.heal(game.player.maxHp);
          return `The spring restores you fully. +${gained} HP`;
        },
      },
      {
        label: 'Fill your flask',
        desc: 'Heal 25 HP and gain +1 regen per tick.',
        apply: (game) => {
          const gained = game.player.heal(25);
          game.player.regenPerTick += 1;
          return `Healed ${gained} HP and gained passive regeneration.`;
        },
      },
    ],
  },
  {
    id: 'fallen_champion',
    emoji: '⚔️',
    title: 'Fallen Champion',
    flavor: 'The corpse of a warrior lies here, still clutching their belongings.',
    options: [
      {
        label: 'Take their boon',
        desc: 'Absorb the power of a fallen hero.',
        apply: (game) => {
          const tier = game.dungeonLevel >= 5 ? 2 : 1;
          const pool = BOONS_BY_TIER[tier as 1 | 2];
          const def = pool[Math.floor(Math.random() * pool.length)]!;
          game.player.addBoon(def);
          return `You absorb the champion's power: ${def.name}!`;
        },
      },
      {
        label: 'Take their rations',
        desc: 'Heal 35 HP.',
        apply: (game) => {
          const gained = game.player.heal(35);
          return `You eat the champion's rations. +${gained} HP`;
        },
      },
    ],
  },
  {
    id: 'dark_bargain',
    emoji: '👁️',
    title: 'Dark Bargain',
    flavor: 'A disembodied voice whispers from the shadows, offering terrible power.',
    options: [
      {
        label: 'Accept the deal',
        desc: '+12 ATK, −25 Max HP.',
        apply: (game) => {
          game.player.atk += 12;
          game.player.maxHp = Math.max(10, game.player.maxHp - 25);
          game.player.hp = Math.min(game.player.hp, game.player.maxHp);
          return 'Power surges through you — at terrible cost. +12 ATK, −25 Max HP.';
        },
      },
      {
        label: 'Refuse the voice',
        desc: 'Nothing happens. Some deals aren\'t worth making.',
        apply: () => 'You refuse the dark voice. It fades, frustrated.',
      },
    ],
  },
  {
    id: 'tome_of_knowledge',
    emoji: '📖',
    title: 'Tome of Knowledge',
    flavor: 'A dusty tome lies open to a marked page, its text glowing faintly.',
    options: [
      {
        label: 'Study tactics',
        desc: 'Gain 150 XP.',
        apply: (game) => {
          const levelled = game.player.gainXP(150);
          if (levelled) {
            game.cb.log(`✨ LEVEL UP! Now level ${game.player.playerLevel}!`, 'log-perk');
            game.openLevelUpBoons();
          }
          return `You absorb the battle tactics. +150 XP`;
        },
      },
      {
        label: 'Learn from lore',
        desc: '+2 vision radius permanently.',
        apply: (game) => {
          game.player.visionRadius += 2;
          return 'Your perception expands. +2 vision radius.';
        },
      },
    ],
  },
  {
    id: 'abandoned_cache',
    emoji: '💰',
    title: 'Abandoned Cache',
    flavor: 'A hidden stash behind a loose stone. Someone left in a hurry.',
    options: [
      {
        label: 'Search carefully',
        desc: 'Gain 800 gold.',
        apply: (game) => {
          game.gold += 800;
          return 'You find 800 gold worth of loot!';
        },
      },
      {
        label: 'Grab quickly',
        desc: '50/50: gain 2000 gold OR trigger a trap (−30 HP).',
        apply: (game) => {
          if (Math.random() < 0.5) {
            game.gold += 2000;
            return '🎉 Jackpot! +2000 gold!';
          }
          const dmg = game.player.takeDamage(30);
          game.damageTaken += dmg;
          return `💥 It was booby-trapped! −${dmg} HP`;
        },
      },
    ],
  },
  {
    id: 'mystic_font',
    emoji: '✨',
    title: 'Mystic Font',
    flavor: 'Runes carved into the floor glow with trapped rift energy.',
    options: [
      {
        label: 'Purify',
        desc: 'Cure all status effects and gain poison immunity.',
        apply: (game) => {
          game.player.statuses = [];
          game.player.poisonImmune = true;
          return 'All afflictions cleansed. Poison cannot touch you.';
        },
      },
      {
        label: 'Empower',
        desc: '+2 ATK permanently.',
        apply: (game) => {
          game.player.atk += 2;
          return 'Rift energy floods your muscles. +2 ATK.';
        },
      },
    ],
  },
];

// Additional floor events
FLOOR_EVENTS.push(
  {
    id: 'cursed_armory',
    emoji: '🗡️',
    title: 'Cursed Armory',
    flavor: 'Weapons of the fallen gleam with dark purpose.',
    options: [
      {
        label: 'Take the cursed blade',
        desc: '+8 ATK — but suffer 3 turns of poison.',
        apply: (game) => {
          game.player.atk += 8;
          game.player.statuses.push({ type: 'poison', duration: 3, power: 4 });
          return 'Dark power flows through you. +8 ATK, but the blade bites back.';
        },
      },
      {
        label: 'Walk away',
        desc: 'Some power is not worth the price.',
        apply: () => 'You leave the cursed weapons untouched.',
      },
    ],
  },
  {
    id: 'rift_scholar',
    emoji: '📜',
    title: 'Rift Scholar',
    flavor: 'A fractured echo of intelligence lingers here.',
    options: [
      {
        label: 'Learn combat theory',
        desc: '+50 XP and +1 combat level.',
        apply: (game) => {
          const levelled = game.player.gainXP(50);
          game.player.baseCombatLevel += 1;
          if (levelled) {
            game.cb.log(`✨ LEVEL UP! Now level ${game.player.playerLevel}!`, 'log-perk');
            game.openLevelUpBoons();
          }
          return 'Combat mastery expands. +50 XP, +1 combat level.';
        },
      },
      {
        label: 'Absorb passive wisdom',
        desc: '+3 vision, +1 HP regen/tick permanently.',
        apply: (game) => {
          game.player.visionRadius += 3;
          game.player.regenPerTick += 1;
          return 'Ancient wisdom seeps in. +3 vision, +1 regen/tick.';
        },
      },
    ],
  },
);

export function getRandomFloorEvent(): FloorEventDef {
  return FLOOR_EVENTS[Math.floor(Math.random() * FLOOR_EVENTS.length)]!;
}
