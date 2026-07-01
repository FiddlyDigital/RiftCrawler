import visualRegistryData from './data/visual-registry.json';
import monstersData       from './data/monsters.json';
import bossesData         from './data/bosses.json';
import itemsData          from './data/items.json';
import equipmentData      from './data/equipment.json';
import perksData          from './data/perks.json';
import merchantData       from './data/merchant.json';
import shapesData         from './data/shapes.json';
import { Cell, type CellValue, type StatusType, type EquipSlot, type RelicDef, type ModifierDef, type ClassDef, type BiomeDef, type FloorEventDef } from './types';
import { Equipment } from './entities';
import type { Player } from './entities';
import type { MonsterDef, BossDef, ItemDef, EquipmentDef } from './types';

// ── Visual registry ───────────────────────────────────────────────────────────

export const VISUAL_REGISTRY: Record<string, string> = visualRegistryData as Record<string, string>;

function vis(assetId: string): string {
  return VISUAL_REGISTRY[assetId] ?? '❓';
}

// ── Runtime interface types (exported for consumers) ──────────────────────────

export interface PerkDef {
  id: string;
  name: string;
  desc: string;
  apply: (player: Player) => void;
}

export interface MerchantItem {
  name: string;
  char: string;
  cost: number;
  apply: (player: Player) => string;
}

// ── Raw JSON shapes (local — not exposed) ─────────────────────────────────────

interface RawMonster {
  id: string; displayName: string; visualAsset: string; cellTypeId: string;
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

interface RawEquipment {
  id: string; displayName: string; visualAsset: string;
  slot: string; atkBonus: number; defBonus: number; tier: number;
}

interface RawPerk {
  id: string; name: string; desc: string; effectType: string; effectValue: number;
}

interface RawMerchantItem {
  id: string; displayName: string; visualAsset: string;
  cost: number; effectType: string; effectValue: number; effectLabel: string;
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
  ITEM_EQUIPMENT: Cell.ITEM_EQUIPMENT,
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
      char:        vis(raw.visualAsset),
      name:        raw.displayName,
      baseHp:      raw.baseHp,
      hpPerLevel:  raw.hpScaleCoefficient,
      baseAtk:     raw.baseAtk,
      atkPerLevel: raw.atkScaleCoefficient,
      cellState:   CELL_MAP[raw.cellTypeId] ?? Cell.FLOOR,
      spawnMsg:    raw.spawnMsg,
      xpReward:    raw.xpValue,
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

const ITEM_EFFECT_TO_TYPE: Record<string, 'heal' | 'stat'> = {
  heal: 'heal',
  atk:  'stat',
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

// ── Equipment ─────────────────────────────────────────────────────────────────

export const EQUIPMENT: EquipmentDef[] = (equipmentData as RawEquipment[]).map(raw => ({
  char:     vis(raw.visualAsset),
  name:     raw.displayName,
  slot:     raw.slot as EquipSlot,
  atkBonus: raw.atkBonus,
  defBonus: raw.defBonus,
  tier:     raw.tier,
}));

// ── Perk effect resolvers ─────────────────────────────────────────────────────

const PERK_RESOLVERS: Record<string, (player: Player, value: number) => void> = {
  maxHpIncrease:           (p, v) => { p.maxHp += v; p.hp = Math.min(p.hp + v, p.maxHp); },
  atkIncrease:             (p, v) => { p.atk += v; },
  visionIncrease:          (p, v) => { p.visionRadius += v; },
  regenIncrease:           (p, v) => { p.regenPerTick += v; },
  poisonImmune:            (p)    => { p.poisonImmune = true; },
  killHealIncrease:        (p, v) => { p.killHeal += v; },
  damageReductionIncrease: (p, v) => { p.damageReduction += v; },
  tickSlowIncrease:        (p, v) => { p.tickSlowPercent += v; },
};

export const PERKS: PerkDef[] = (perksData as RawPerk[]).map(raw => ({
  id:    raw.id,
  name:  raw.name,
  desc:  raw.desc,
  apply: (player: Player) => {
    PERK_RESOLVERS[raw.effectType]?.(player, raw.effectValue);
  },
}));

// ── Merchant effect resolvers ─────────────────────────────────────────────────

const MERCHANT_RESOLVERS: Record<string, (player: Player, value: number, label: string) => string> = {
  heal:       (p, v, l) => { const h = p.heal(v); return l.replace('{value}', String(h)); },
  atkBoost:   (p, v, l) => { p.atk += v; return l; },
  maxHpBoost: (p, v, l) => { p.maxHp += v; p.hp = Math.min(p.hp + v, p.maxHp); return l; },
  visionBoost:(p, v, l) => { p.visionRadius += v; return l; },
  curePoison: (p, _v, l) => { p.statuses = p.statuses.filter(s => s.type !== 'poison'); return l; },
  regenBoost: (p, v, l)  => { p.regenPerTick += v; return l; },
};

export const MERCHANT_STOCK: MerchantItem[] = (merchantData as RawMerchantItem[]).map(raw => ({
  name: raw.displayName,
  char: vis(raw.visualAsset),
  cost: raw.cost,
  apply: (player: Player) => {
    const resolve = MERCHANT_RESOLVERS[raw.effectType];
    return resolve ? resolve(player, raw.effectValue, raw.effectLabel) : raw.effectLabel;
  },
}));

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
    desc: 'Dodging an attack restores 4 HP  (great with Rogue)',
    onPickup: (p: Player) => { p.dodgeHeal += 4; },
  },
  {
    id: 'rift_shard',
    char: '💎',
    name: 'Rift Shard',
    desc: 'Each row cleared grants +2 Max HP permanently  (great with Mage)',
    onLineClear: (p: Player, count: number) => {
      p.maxHp += 2 * count;
      p.hp = Math.min(p.hp, p.maxHp);
    },
  },
  {
    id: 'divine_seal',
    char: '✨',
    name: 'Divine Seal',
    desc: 'Triples your kill-heal (min 4 HP)  (great with Priest)',
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
    desc: 'Gravity 20% faster, score ×1.5',
    apply: (g) => { g.player.tickSlowPercent -= 20; g.scoreMultiplier = 1.5; },
  },
  {
    id: 'cursed',
    emoji: '💀',
    name: 'Cursed',
    desc: 'Score ×2 — but line clears don\'t heal',
    apply: (g) => { g.scoreMultiplier = 2.0; g.noLineHeal = true; },
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
    id: 'warrior',
    emoji: '⚔️',
    name: 'Warrior',
    tagline: 'Front-line fighter. Tough and straightforward.',
    statPreview: '+20 HP  −2 ATK  +3 DEF',
    apply: (p: Player) => {
      p.maxHp += 20; p.hp += 20;
      p.atk = Math.max(1, p.atk - 2);
      p.damageReduction += 3;
    },
  },
  {
    id: 'rogue',
    emoji: '🗡️',
    name: 'Rogue',
    tagline: 'Strike fast, stay elusive. High risk, high reward.',
    statPreview: '−10 HP  +3 ATK  20% dodge  crit ×2 every 5th',
    apply: (p: Player) => {
      p.maxHp = Math.max(10, p.maxHp - 10); p.hp = Math.min(p.hp, p.maxHp);
      p.atk += 3;
      p.dodgeChance += 0.20;
      p.critEvery = 5;
    },
  },
  {
    id: 'mage',
    emoji: '🔮',
    name: 'Mage',
    tagline: 'Harness rift energy. Line clears deal extra damage.',
    statPreview: '−5 HP  +2 vision  line clears deal 5 dmg',
    apply: (p: Player) => {
      p.maxHp = Math.max(10, p.maxHp - 5); p.hp = Math.min(p.hp, p.maxHp);
      p.visionRadius += 2;
      p.lineClearDamage += 5;
    },
  },
  {
    id: 'priest',
    emoji: '✨',
    name: 'Priest',
    tagline: 'Survive through healing. Regenerate and siphon life.',
    statPreview: '+10 HP  −1 ATK  +1 regen/tick  +4 HP on kill',
    apply: (p: Player) => {
      p.maxHp += 10; p.hp += 10;
      p.atk = Math.max(1, p.atk - 1);
      p.regenPerTick += 1;
      p.killHeal += 4;
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
        desc: 'Sacrifice 20 HP for a random perk.',
        apply: (game) => {
          game.player.hp = Math.max(1, game.player.hp - 20);
          game.damageTaken += 20;
          const perk = PERKS[Math.floor(Math.random() * PERKS.length)]!;
          perk.apply(game.player);
          return `The shrine grants: ${perk.name}! (${perk.desc})`;
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
        label: 'Take their gear',
        desc: 'Equip a random piece of equipment.',
        apply: (game) => {
          const tier = Math.min(3, 1 + Math.floor(game.dungeonLevel / 3));
          const eligible = EQUIPMENT.filter(e => e.tier <= tier);
          const def = eligible[Math.floor(Math.random() * eligible.length)]!;
          const prev = game.player.equip(new Equipment(def));
          return prev
            ? `Equipped ${def.name}, replacing ${prev.name}.`
            : `Equipped ${def.name}!`;
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
            game.paused = true;
            game.cb.onLevelUp(game.player.playerLevel);
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
        desc: 'Gain 800 score.',
        apply: (game) => {
          game.score += 800;
          return 'You find 800 pts worth of loot!';
        },
      },
      {
        label: 'Grab quickly',
        desc: '50/50: gain 2000 score OR trigger a trap (−30 HP).',
        apply: (game) => {
          if (Math.random() < 0.5) {
            game.score += 2000;
            return '🎉 Jackpot! +2000 score!';
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

export function getRandomFloorEvent(): FloorEventDef {
  return FLOOR_EVENTS[Math.floor(Math.random() * FLOOR_EVENTS.length)]!;
}
