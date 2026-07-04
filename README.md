# Rift Crawler

A mobile-first **Tetris-meets-roguelike** hybrid. You play both halves of the board at once: steer falling tetrominoes to **build** the dungeon floor, then move a hero across the tiles you just laid down to **fight, grow stronger, and descend**. Grow strong enough, then deliberately top out the stack to summon the final boss — **Gorgoth the Returned** — and escape the Rift.

Built with TypeScript + Vite as an installable PWA. Rendering is a single `<canvas>`; everything else is plain DOM.

---

## Table of contents

- [The game](#the-game)
- [Core systems](#core-systems)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Project structure](#project-structure)
- [Data files](#data-files)
- [Adding & tuning content](#adding--tuning-content)
- [Testing](#testing)
- [Notes & gotchas](#notes--gotchas)

---

## The game

**The loop.** Blocks fall on a gravity timer (and every hero/block action also advances a turn). When a block locks, its cells become dungeon floor — and some cells carry *riders*: monsters, altars, the tattoo artist, stairs, bombs, and traps. Your hero can only walk on floor you've built. So you're constantly deciding where to drop pieces to shape a path, reach altars, and corner enemies.

**Combat** is dice-based and turn-based (see below). **Progression** is XP → player level → bigger combat dice, layered with **boons**, **brands**, **curses**, and a starting **class**.

**Winning.** There is one win condition: let the tetromino stack reach the ceiling. Instead of dying, the Rift stops producing blocks and summons **Gorgoth the Returned**, a colossal fixed-stat boss who descends slowly from the top of the board. Defeat him and you win. This is a deliberate choice — you gather strength across floors, then commit when ready. (Flee down a ladder mid-fight and his remaining HP is banked, so you can chip him down over multiple attempts.)

**Losing.** Your HP hits zero.

---

## Core systems

| System | Where | Summary |
|---|---|---|
| **Dice combat** | `src/systems/combat.ts` | Attacker & defender each roll a die sized by combat level (L1→D4 … L6→D20). Outcome by margin: miss / weak (0.5×) / normal (1×) / power (1.5×) / crit (2×, natural-max roll). **Miss-pity**: the 3rd consecutive whiff is upgraded to a hit. **Graze floor**: a miss still chips ~25% ATK, so no swing is wasted. |
| **Turns & gravity** | `src/game.ts` | `tickMsForLevel = max(400, 3000 − (floor−1)·100) × (1 + slow%/100)`. Floor 1 ≈ 3s/tick; deepens toward the 400ms floor. Every hero move / block action also advances monster turns. |
| **Boons** | altars & level-ups | Stackable passives (ATK, HP, dodge, regen, line-clear damage, …), grouped into tiers I–III. |
| **Sacred Brands** | Occult Tattoo Artist tiles | Permanent, body-slotted marks; collecting a **set** of the same brand grants a powerful set bonus (e.g. War ×3 → +10 ATK, Life ×3 → free revive). |
| **Curses (modifiers)** | chosen at run start | Run-long trade-offs (Glass Cannon, Overclock, Cursed, Berserker, …). |
| **Offers** | `src/dataLoader.ts` | Every 3-choice offer (boons/brands) guarantees ≥2 distinct roles and nudges toward what you already own; gold can reroll. |
| **Biomes** | `src/dataLoader.ts` | Depth-scaled monster HP and gravity, plus biome-specific bosses. |
| **Combat legibility** | `renderer.ts`, `game.ts` | Tap any tile to inspect it (incl. your hit-chance vs a monster). Monsters that can strike next turn are telegraphed. |
| **Gorgoth endgame** | `src/game.ts`, `monsterAI.ts` | Fixed stats (1400 HP, ATK 48, D20). Descends one tile every ~2 turns, phasing through terrain. HP persists across ladder escapes. |

**Controls.** Two virtual D-pads (Block / Hero) plus keyboard and gamepad. Keyboard: `WASD`/arrows move the hero, `Space` waits/heals, `Q` uses a ranged ability, `J`/`L`/`I`/`K`/`X` drive the block, `H` holds, `M` mutes, `Esc`/`P` pause. Movement and attacks are strictly **orthogonal** for hero and monsters alike.

---

## Tech stack

- **TypeScript** (strict) — no framework; a hand-rolled `Game` model + canvas renderer + DOM UI.
- **Vite 5** — dev server & bundler, with **vite-plugin-pwa** for offline/installable builds.
- **Vitest** — unit tests (pure game logic; no DOM harness).
- Rendering is one `<canvas>`; audio is the Web Audio API (`src/audio.ts`).

---

## Getting started

Prerequisites: **Node 18+** (the repo pins `@types/node` 20).

```bash
npm install        # install deps
npm run dev        # Vite dev server → http://localhost:5173
npm run build      # production build → dist/  (Vite + PWA)
npm run preview    # serve the built dist/
npm test           # run the Vitest suite once
npm run test:watch # watch mode
npm run lint       # tsc --noEmit  (type-check only)
```

> **Always run `npm run lint`.** `npm run build` uses esbuild, which **does not type-check** — several past bugs were dangling references that compiled fine but threw at runtime. `tsc --noEmit` is the real safety net.

---

## Project structure

```
src/
  main.ts          Boot, wiring, the tick loop, pause/settings, PWA install
  game.ts          The Game class — board state, rules, spawning, locking,
                   gravity, combat orchestration, Gorgoth, win/lose
  entities.ts      Player, Monster, ParticlePool
  renderer.ts      Canvas drawing (tiles, block, hero, particles, telegraphs)
  ui.ts            DOM UI manager (modals, sidebar, tooltips, pause menu)
  input.ts         Keyboard, on-screen buttons, gamepad
  config.ts        CONFIG (10×25 grid, 17px tiles) + shape re-exports
  types.ts         Shared types: Cell/Tile enums, EffectSpec, *Def interfaces,
                   GameCallbacks, UIState, …
  dataLoader.ts    Loads /data JSON → runtime tables (MONSTERS, BOSSES,
                   BOONS, BRANDS, MODIFIERS, …) + the effect resolver
  content.ts       Re-export barrel for the data tables
  storage.ts       localStorage (high XP, run history, mute, reduced-motion)
  audio.ts         Web Audio SFX
  analytics.ts     Optional Plausible hooks
  systems/
    combat.ts        Dice engine, player/monster attacks, kill & victory
    monsterAI.ts     Per-behaviour monster turns (melee/ranged/berserker/…, gorgoth)
    statusEffects.ts Poison/stun/regen ticks
    hazards.ts       Spike/smoke/teleport tiles
  data/            All game content as JSON (see below)
  __tests__/       Vitest specs
```

---

## Data files

Everything under `src/data/` is imported at build time (`resolveJsonModule`) and turned into runtime objects by `dataLoader.ts`. Adding or tuning most content is a **JSON edit, no code**.

### `monsters.json`
Keyed by monster id. `dataLoader` scales HP/ATK by floor and biome at spawn.

| field | type | notes |
|---|---|---|
| `id`, `displayName` | string | |
| `visualAsset` | string | key into `visual-registry.json` (emoji fallback) |
| `cellTypeId` | string | must exist in `CELL_MAP` in `dataLoader.ts` |
| `combatLevel` | number? | die size for combat (1→D4 … 6→D20); default 2 |
| `baseHp`, `baseAtk` | number | floor-1 stats |
| `hpScaleCoefficient`, `atkScaleCoefficient` | number | added per floor |
| `xpValue` | number | XP on kill |
| `spawnMsg` | string | log line |
| `statusInflict` | object? | `{ type, chance, duration, power }` (e.g. poison on hit) |
| `behaviorType` | string? | `melee` (default) / `ranged` / `healer` / `berserker` / `swift` |
| `attackRange`, `moveSpeed` | number? | ranged reach / movement |

### `bosses.json`
The generic boss pool (one appears every 5th floor). Fields: `id`, `displayName`, `visualAsset`, `hpMult`, `atkMult`, `xpValue`, `flavorText`. Base HP/ATK are computed from floor and multiplied.
*Note:* biome-specific bosses (Crystal Golem, Rift Tyrant) and **Gorgoth** are defined in code because they carry behaviour callbacks (`onHalfHp`, `onDeath`) that data can't express.

### `boons.json`, `brands.json`, `modifiers.json` — the effect system

These three describe their effects **declaratively** using a shared `EffectSpec` (defined in `types.ts`). A small resolver in `dataLoader.ts` applies them:

```ts
interface EffectSpec {
  target?: 'player' | 'game';   // default 'player'; only curses use 'game'
  stat: string;                 // property name on Player or Game
  op?: 'add' | 'mul' | 'set';   // default 'add'
  value: number | boolean;
  min?: number;                 // clamp result ≥ min
  max?: number;                 // clamp result ≤ max
  floor?: boolean;              // floor the result
}
```

Examples: `+2 ATK` → `{ "stat": "atk", "value": 2 }`; a dodge cap → `{ "stat": "dodgeChance", "value": 0.1, "max": 0.75 }`; halve vision → `{ "stat": "visionRadius", "op": "mul", "value": 0.5, "floor": true, "min": 1 }`; a curse touching the game → `{ "target": "game", "stat": "xpMultiplier", "op": "set", "value": 1.5 }`.

**`boons.json`** — stackable altar/level-up passives.
Fields: `id`, `char` (emoji), `name`, `tier` (1–3), `role` (`offense`/`defense`/`utility`), `desc`, `effects: EffectSpec[]`, optional `special`.

**`brands.json`** — permanent tattoos with set bonuses.
Fields: `id`, `char`, `name`, `setSize` (2–3), `role`, `desc`, `setDesc`, `onEquip: EffectSpec[]` (per brand), `onSet: EffectSpec[]` (when a set completes).

**`modifiers.json`** — run-start curses.
Fields: `id`, `emoji`, `name`, `desc`, `effects: EffectSpec[]` (may target `player` or `game`), optional `special`.

**Escape hatch — `special`.** The few effects that can't be pure data reference a named handler in `dataLoader.ts`:
- `void_loop` (boon) — crit-every-N cadence that depends on stack count.
- `full_heal` (curse) — sets `hp = maxHp` after a Max-HP change (Glass Cannon, Berserker).
- `void_prism` is intentionally a no-op in JSON (recomputed in `Player.addBoon`).
To add a new special: put a one-liner in `BOON_SPECIALS` / `MODIFIER_SPECIALS` and reference its key from JSON.

### Support files
- **`shapes.json`** — the 7 tetromino shapes: `{ matrix, color, preview }` keyed by letter (`I O T S Z J L`).
- **`visual-registry.json`** — `visualAsset` → emoji, used as a fallback glyph when a sprite isn't available.
- **`sprite-map.json`** — sprite-atlas coordinates for the optional pixel-art sheets.

---

## Adding & tuning content

- **New boon / brand / curse:** edit the relevant JSON with `EffectSpec` entries. No code unless you need a `special` handler.
- **New monster:** add an entry to `monsters.json`, make sure its `cellTypeId` is in `CELL_MAP`, give it a `visualAsset` in `visual-registry.json`, and (if it should spawn from blocks) wire its cell into the spawn table in `game.ts`.
- **Classes** are still code (`dataLoader.ts`) because they use per-event callbacks (ranged abilities, class passives) that don't fit the add/set/mul model.

After any content change: `npm run lint && npm test && npm run build`.

---

## Testing

Unit tests live in `src/__tests__/` and run on **Vitest** (`npm test`). They cover the pure game logic — combat math, spawning, line clears, boons/brands/curses (including the JSON effect resolver), the Gorgoth endgame, and monster AI. The UI/renderer layers have no unit harness (they need the full DOM); verify those in the browser (`npm run dev`).

---

## Notes & gotchas

- **`npm run build` does not type-check** (esbuild). Run `npm run lint` (`tsc --noEmit`) before trusting a build.
- **Movement is orthogonal only** for everyone — a diagonally-adjacent enemy must step to a cardinal tile before it can attack.
- **The Gorgoth fight has no line clears** (blocks stop), so line-clear-oriented builds don't contribute during it — combat/dodge/crit/sustain/ranged builds carry the finale.
