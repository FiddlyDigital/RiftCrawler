// Data-driven re-exports — all values come from JSON via dataLoader
export type { MonsterDef, BossDef, BoonDef, BrandDef, ClassDef, BiomeDef, FloorEventDef, NpcDef, PatronDef } from './types';
export {
  MONSTERS, BOSSES, BOONS, BOONS_BY_TIER, BRANDS, MONSTER_DEFS, MODIFIERS, CLASSES,
  BIOMES, FLOOR_EVENTS, NPCS, PATRONS,
  Boon, Brand, Modifier, PlayerClass, Biome, FloorEvent, Npc, Patron,
  MonsterTemplate, Boss, EffectResolver,
} from './dataLoader';
