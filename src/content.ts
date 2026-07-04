// Data-driven re-exports — all values come from JSON via dataLoader
export type { MonsterDef, BossDef, BoonDef, BrandDef, ClassDef, BiomeDef, FloorEventDef } from './types';
export { MONSTERS, BOSSES, BOONS, BOONS_BY_TIER, getBoonTierForFloor, getThreeRandomBoons, BRANDS, getThreeRandomBrands, MONSTER_DEFS, MODIFIERS, CLASSES, BIOMES, FLOOR_EVENTS, getBiomeForFloor, getRandomFloorEvent } from './dataLoader';
