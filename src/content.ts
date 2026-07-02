// Data-driven re-exports — all values come from JSON via dataLoader
export type { MonsterDef, BossDef, ItemDef, BoonDef, ClassDef, BiomeDef, FloorEventDef } from './types';
export type { MerchantItem }                                from './dataLoader';
export { MONSTERS, BOSSES, ITEMS, BOONS, BOONS_BY_TIER, getBoonTierForFloor, getThreeRandomBoons, MERCHANT_STOCK, getMerchantStock, MONSTER_DEFS, RELICS, MODIFIERS, CLASSES, BIOMES, FLOOR_EVENTS, getBiomeForFloor, getRandomFloorEvent } from './dataLoader';
