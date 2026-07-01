// Data-driven re-exports — all values come from JSON via dataLoader
export type { MonsterDef, BossDef, ItemDef, EquipmentDef, ClassDef, BiomeDef, FloorEventDef } from './types';
export type { PerkDef, MerchantItem }                       from './dataLoader';
export { MONSTERS, BOSSES, ITEMS, EQUIPMENT, PERKS, MERCHANT_STOCK, MONSTER_DEFS, RELICS, MODIFIERS, CLASSES, BIOMES, FLOOR_EVENTS, getBiomeForFloor, getRandomFloorEvent } from './dataLoader';
