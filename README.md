# Causeway to Ériu

**[▶ Play it live](https://fiddlydigital.github.io/RiftCrawler/)** · ![CI](https://github.com/FiddlyDigital/RiftCrawler/actions/workflows/ci.yml/badge.svg) ![Deploy](https://github.com/FiddlyDigital/RiftCrawler/actions/workflows/deploy-pages.yml/badge.svg)

A mobile-first **Tetris-meets-roguelike** hybrid. You play both halves of the board at once: steer falling tetrominoes to **build** the dungeon floor, then move a hero across the tiles you just laid down to **fight, grow stronger, and descend**. Bres the Beautiful has returned from the depths with his army of mutant Fomorians, weaving ancient magic to raise a bridge back to Ériu, the Emerald Isle. Grow strong enough, then deliberately top out the stack to summon him — **Bres the Beautiful** — and escape the Rift.

Built with TypeScript + Vite as an installable PWA. Rendering is a single `<canvas>`; every modal (start screen, class/modifier pick, shop, altar, character sheet, codex, game-over, …) is a native Web Component with no framework and no Shadow DOM — see [Tech stack](#tech-stack).

---

## Table of contents

- [Causeway to Ériu](#causeway-to-ériu)
  - [Table of contents](#table-of-contents)
  - [The game](#the-game)
  - [Core systems](#core-systems)
  - [Tech stack](#tech-stack)
  - [Getting started](#getting-started)
  - [Project structure](#project-structure)
  - [Data files](#data-files)
    - [`monsters.json`](#monstersjson)
    - [`bosses.json`](#bossesjson)
    - [`classes.json`, `biomes.json`, `patrons.json`](#classesjson-biomesjson-patronsjson)
    - [`boons.json`, `brands.json`, `modifiers.json` — the effect system](#boonsjson-brandsjson-modifiersjson--the-effect-system)
    - [`npcs.json`, `floor-events.json`, `smiths.json`, `omens.json`](#npcsjson-floor-eventsjson-smithsjson-omensjson)
    - [Support files](#support-files)
    - [Data validation](#data-validation)
  - [Adding \& tuning content](#adding--tuning-content)
  - [Testing](#testing)
  - [Notes \& gotchas](#notes--gotchas)

---

## The game

**The loop.** Blocks fall on a gravity timer (and every hero/block action also advances a turn). When a block locks, its cells become dungeon floor — and some cells carry *riders*: monsters, altars, the tattoo artist, stairs, and traps. Your hero can only walk on floor you've built. So you're constantly deciding where to drop pieces to shape a path, reach altars, and corner enemies.

**Combat** is dice-based and turn-based (see below). **Progression** is XP → player level → bigger combat dice, layered with **boons** (Geasa), **brands** (Ogham Marks), **curses**, a starting **class**, and — for the Draoi class — a **patron pact** with one of three deities.

**Winning.** There is one true win condition: let the tetromino stack reach the ceiling. Instead of dying, the Rift stops producing blocks and summons **Bres the Beautiful**, a colossal fixed-stat boss who descends slowly from the top of the board as he nears completing his bridge to Ériu. Defeat him and you win. This is a deliberate choice — you gather strength across floors, then commit when ready. Once he's summoned there's no retreat: the causeway is finished, so every remaining stairs tile on the board vanishes (beaming away like any other departing NPC/altar) — you either finish the fight or you don't.

**Losing.** Your HP hits zero.

**Between runs**, a lore codex (accessible from the sidebar) tracks every boss, NPC, biome, and patron you've discovered across all past runs, persisted in `localStorage` — undiscovered entries show as "???" until you meet them. Death/victory screens also carry a short generated recap of the run's notable beats (close calls, bosses summoned, pacts sworn) alongside the stats grid, share text, and full run log.

---

## Core systems

| System | Where | Summary |
|---|---|---|
| **Dice combat** | `src/systems/combat.ts` | Attacker & defender each roll a die sized by combat level (L1→D4 … L6→D20). Outcome by margin: miss / weak (0.5×) / normal (1×) / power (1.5×) / crit (2×, natural-max roll). **Miss-pity**: the 3rd consecutive whiff is upgraded to a hit. **Graze floor**: a miss still chips ~25% ATK, so no swing is wasted. |
| **Turns & gravity** | `src/game.ts` | `tickMsForLevel = max(400, 3000 − (floor−1)·100) × (1 + slow%/100)`. Floor 1 ≈ 3s/tick; deepens toward the 400ms floor. Every hero move / block action also advances monster turns — except rotation, which is free (it cycles in place; charging a turn for it just punished lining up a drop). |
| **Boons** (*Geasa* in-game) | altars & level-ups | Stackable passives (ATK, HP, dodge, regen, line-clear damage, …), grouped into tiers I–III. |
| **Brands** (*Ogham Marks* in-game) | Occult Tattoo Artist tiles | Permanent, body-slotted marks; collecting a **set** of the same mark grants a powerful set bonus (e.g. War ×3 → +10 ATK, Life ×3 → free revive). |
| **Curses (modifiers)** | chosen at run start | Run-long trade-offs (Glass Cannon, Overclock, Cursed, Berserker, …). |
| **Classes** | chosen at run start | Chronomancer (time/tempo control), The Architect (Tetris-layer synergy, tankier), An Draoi (blood-priced magic, gains a patron pact). Fully data-driven from `classes.json` — see [Data files](#classesjson-biomesjson-patronsjson). |
| **Patron pacts** | An Draoi only, `src/data/patrons.json` | A deity emissary waits in the sídhe-mound waystation from floor 2 until An Draoi swears a pact with one of 2 offered deities (of the Morrígan, Manannán mac Lir, Tethra), each granting its own 3-spell kit as the run's ranged ability — at a permanent ATK toll. |
| **Offers** | `src/dataLoader.ts` | Every 3-choice offer (boons/brands) guarantees ≥2 distinct roles and nudges toward what you already own; gold can reroll. |
| **Biomes & terrain** | `src/dataLoader.ts`, `src/game.ts` | Depth-scaled monster HP and gravity, biome-specific bosses, and a **terrain type** (swamp/sacred/ice) that certain piece shapes lay down on lock — the terrain kind is a trait of the current biome, not the piece shape. |
| **Boss floors** | `src/game.ts` | Every 5th floor is boss-eligible — entering one toasts "You sense dark forces lie in ambush!" — but the boss doesn't spawn until the built floor covers **at least half the field** overall (not just one tall column), so reaching the stairs early just carries the fight into the next floor instead of skipping it. |
| **Floor events** | `src/data/floor-events.json` | A narrative choice every few descents (skip boss floors) — standing stones, Fomorian plunder, etc., each with data-driven option handlers. Rolled on the descent but embodied as a **sheltering stranger in the waystation**, held (across floors if need be) until you visit and meet them. |
| **Lore codex** | `src/storage.ts`, `<codex-modal>` | Cross-run discovery log for bosses/NPCs/biomes/patrons, persisted in `localStorage`. |
| **Lugh's Spear questline** | `src/data/smiths.json`, `src/game.ts` | Every 3rd floor (skipping boss floors) toasts "You hear the clang of an anvil..." on entry, "The sound of anvils is getting stronger!" at 10 tetrominoes placed, and embeds one of three legendary smiths (Luchta, Credne, Goibniu) as a guaranteed encounter on the 20th tetromino dropped that floor (`balance.json`'s `smiths` block). Each grants one spear part; Goibniu's third meeting reforges it, replacing the player's ranged ability with a bolt that pierces every monster straight up their own Tetris column. |
| **Tetris reward** | `src/game.ts` | Clearing all 4 lines at once (once per run) draws the eye of **An Dagda** himself: no dialog interrupts the clear — the Good God takes a seat in the sídhe mound's corner with his cauldron, and greeting him gifts one random tier-3 Geis. |
| **Floor progress dial** | `src/ui.ts`, `#hud-strip` | The HUD shows one compact segment per pending milestone — smith piece count, boss fill %, stairs pity countdown (hidden while a stairs tile is on the board) — so "keep stacking or descend?" is an informed choice. |
| **Floor omens** | `src/data/omens.json`, `src/game.ts` | ~60% of non-boss floors past floor 1 roll a per-floor modifier, announced by toast and shown as a sidebar badge: the Rising Bog (low rows turn swamp), Féth Fíada (vision −2), Cluricaun's Hoard (2× line-clear gold), the Unquiet Cairn (more monsters, skeleton-heavy), Fomorian Weight (gravity +20%), Wild Rift-Surge (2.5× cursed/blessed pieces), and the Night of Bealtaine ritual below. All param-driven — adding an omen is a JSON edit. |
| **Night of Bealtaine** | `src/game.ts` | A ritual omen: every 5th piece carries a brazier; walk into an unlit one to light it. Line clears destroy braziers (protect their rows!) but lit progress banks and replacements keep coming. Light all three → a free tier-III Geis choice. |
| **Waystations** | `src/game.ts` | Every staircase opens a choice — delve deeper, or rest in a safe sídhe mound first. The mound sits *between* floors (visiting never consumes a floor number, so bosses/smiths can't be dodged): no falling stone, no monsters, no fog. Every between-floor choice lives here as a person or fixture: the seanchaí (mound lore, plus "ask for your own tale" — the run recap mid-run), the hearth-fire (one full heal), the Fear Dearg's stall (shop), An Draoi's deity emissary (the pact ceremony), any pending floor event as a sheltering stranger, Aoife with a vengeance bounty when none is sworn, an ogham standing stone that opens the lore codex, the Well of Segais (gold for XP, priced by depth), the Sídhe coffer (bank gold across runs — your next character inherits half), and the Ogham-mark tattooist on some visits. The ambient drone retunes warmer inside. The stairs-choice dialog names whoever is currently waiting. |
| **Tutorial** | `src/tutorial.ts` | A skippable guided tutorial on the first run ever (re-runnable via "New here?" on the start screen): a non-blocking callout card whose 7 steps advance when the player actually performs each action — move, steer, drop, clear, fight, descend — observed from the game's normal event stream. Luck-dependent steps auto-advance after a few landings so it can never stall. Input-mode-aware copy (keyboard vs touch). |
| **Rescues** | `src/data/rescues.json` | Souls-style: captives occasionally ride down inside a tetromino under Fomorian elite guard (captive + two captors on one piece). Kill every guard, then talk to free them — they beam away and join the mound for the rest of the run: the Gobán Saor shapes your next piece to order, Fedelm the Seeress names the boss ahead, Bricriu of the Feast serves the Champion's Portion (+ATK until the next descent), Airmed the Herb-Wise sells permanent Max HP from the herbs of Miach's grave, and Abcán the Harper plays the suantraí so the next floor's monsters arrive drowsy. A line clear that swallows the captive loses them — they may ride again on a later floor. |
| **Combat legibility** | `renderer.ts`, `game.ts` | Tap any tile to inspect it (incl. your hit-chance vs a monster). Monsters that can strike next turn are telegraphed. |
| **Gorgoth endgame** | `src/game.ts`, `monsterAI.ts` | Fixed stats (1450 HP, ATK 54, D20 — see `balance.json`'s `gorgoth` block). Descends one tile every ~2 turns, phasing through terrain. No retreat once summoned — stairs vanish from the board the moment he appears. |
| **Difficulty** | `src/data/balance.json` (`difficulty`), `src/game.ts` | Chosen at run start (before class/curse): *Slí an Scéalaí* (Storyteller — slower stone, +30% HP, softer foes), *Slí an Laoich* (Hero — the default tuning), *Slí na bhFomhórach* (Fomorian — faster stone, harder foes, leaner gold, +15% XP). Pure `balance.json` multipliers applied at the spawn/gold/gravity choke points; the last pick is remembered and a non-default choice shows a sidebar badge. |
| **Mid-run save/resume** | `src/game.ts` (`serialize`/`applySave`), `src/storage.ts` | A complete, versioned run snapshot autosaves on every turn (throttled) and on backgrounding/pagehide, so closing the tab or the OS reaping the PWA never loses the run. The start screen grows a **Continue — Floor N** card; death, victory, or starting a fresh run clears it. Content references (boons/brands/omens/boss mechanics) are stored by id and re-resolved on load, degrading gracefully across content updates. |
| **New Game+ (heat)** | `src/data/balance.json` (`ngplus`), `src/game.ts` | Winning unlocks the heat ladder: each heat level stacks one more permanent geis (the Crow's +ATK, the Horde's +spawns, the Falling Sky's faster gravity, the Empty Purse's leaner gold, Champions' more elites) in exchange for +5%/level XP. Higher heat carries every lower geis; clearing heat N unlocks heat N+1. Chosen at run start when unlocked; shows a **Heat N** badge and rides the save file. |
| **Accessibility & input** | `src/keybinds.ts`, `src/renderer.ts`, pause menu | Fully **remappable keyboard** (pause → Controls; one key, one action; `Esc`/`P`/`M` reserved; persisted). **Colorblind Marks** give cursed pieces a dashed blue outline instead of red. **Shake & Flash** toggles impact shake and the damage flash independently of the broader Reduced Motion mode. Gamepad and touch share the keyboard's action vocabulary. |

**Controls.** Two virtual D-pads (Block / Hero) plus keyboard and gamepad. Keyboard defaults: `WASD`/arrows move the hero, `Space` waits/heals, `Q` uses a ranged ability, `E` cycles spells, `J`/`L`/`I`/`K`/`X` drive the block, `H` holds, `M` mutes, `Esc`/`P` pause — all game keys **remappable** from the pause menu's Controls screen. Movement and attacks are strictly **orthogonal** for hero and monsters alike.

---

## Tech stack

- **TypeScript 7** (strict) — no framework; a hand-rolled `Game` model + canvas renderer + DOM UI.
- **Native Web Components** for every modal (`src/components/`) — plain `HTMLElement` subclasses, `customElements.define`, no Shadow DOM. They render into the **Light DOM** so the existing global `style.css` styles them with zero per-component CSS — verified none of its selectors are element-type-qualified (e.g. no `div.modal-overlay`), so an outer `<div>` becoming a custom-element tag changes nothing visually. `UIManager` (`src/ui.ts`) is a thin typed delegator to each one; only the always-visible HUD (stats, log, sidebar, tooltip) lives in `ui.ts` directly.
- **Vite 8** — dev server & bundler, with **vite-plugin-pwa** for offline/installable builds (manifest, service worker, icon set, install screenshots).
- **Vitest** — unit tests (pure game logic; no DOM harness — see [Testing](#testing)).
- Rendering is one `<canvas>`; audio is the Web Audio API (`src/audio.ts`).
- Zero runtime dependencies — everything in `package.json` is a `devDependency`.

---

## Getting started

Prerequisites: **Node 18+** (the repo pins `@types/node` 20).

```bash
npm install        # install deps
npm run dev        # Vite dev server → http://localhost:5173
npm run build      # production build → dist/  (validates data, then Vite + PWA)
npm run preview    # serve the built dist/
npm test           # run the Vitest suite once
npm run test:watch # watch mode
npm run lint       # tsc --noEmit  (type-check only)
npm run validate-data # validate src/data/*.json against schema/*.schema.json standalone
```

> **Always run `npm run lint`.** `npm run build` uses esbuild, which **does not type-check** — several past bugs were dangling references that compiled fine but threw at runtime. `tsc --noEmit` is the real safety net.

---

## Project structure

```
src/
  main.ts          Boot, wiring, the tick loop, pause/settings, PWA install,
                   drawer/fullscreen handling
  game.ts          The Game class — board state, rules, spawning, locking,
                   gravity, combat orchestration, Gorgoth, win/lose
  entities.ts      Player, Monster, ParticlePool
  renderer.ts      Canvas drawing (tiles, block, hero, particles, telegraphs)
  ui.ts            HUD (stats/log/sidebar/tooltip) + a thin delegator to
                   every modal component (see components/ below)
  components/      One native custom element per modal (Light DOM, no
                   framework) — base-modal.ts (shared show/hide/render),
                   crash-modal, pause-modal, boss-warning-modal,
                   modifier-modal, class-modal, floor-event-modal,
                   offer-modal (shared altar/tattoo picker), shop-modal,
                   char-sheet-modal, codex-modal, game-over-modal,
                   start-modal, and an index.ts barrel of side-effect
                   imports that registers them all
  input.ts         Keyboard, on-screen buttons, gamepad
  config.ts        CONFIG (10×25 grid, 17px tiles) + shape re-exports
  types.ts         Shared types: Cell/Tile enums, EffectSpec, *Def interfaces,
                   GameCallbacks, UIState, …
  dataLoader.ts    Loads /data JSON → runtime tables (MONSTERS, BOSSES,
                   BOONS, BRANDS, CLASSES, BIOMES, PATRONS, …) + the effect
                   resolver
  content.ts       Re-export barrel for the data tables
  balance.ts       Typed loader for the "tuning knob" JSON (combat.json,
                   hazards.json, monster-ai.json, balance.json) — flat
                   numbers consumed by systems/*.ts, game.ts, entities.ts
  colors.ts        Tier color lookups (altar/reward glow + fill colors)
                   from colors.json
  sprites.ts       SpriteService (sprite-atlas → <canvas>/HTML icon
                   rendering) + HtmlUtils (shared HTML-escaping)
  storage.ts       localStorage (high XP, run history, mute, reduced-motion,
                   ghosts, lore codex)
  audio.ts         Web Audio SFX
  errorReporting.ts Fatal-error normalization (DOM-free) wired into the
                   crash-recovery modal
  haptics.ts       Vibration API wrapper, reduced-motion gated
  systems/
    combat.ts        Dice engine, player/monster attacks, kill & victory
    monsterAI.ts     Per-behaviour monster turns (melee/ranged/berserker/…, gorgoth)
    statusEffects.ts Poison/stun/regen ticks
    hazards.ts       Spike/smoke/teleport tiles
  data/            All game content as JSON (see below)
  __tests__/       Vitest specs
schema/            JSON Schema (2020-12) for every file in src/data/,
                   validated by scripts/validate-data.mjs
scripts/
  validate-data.mjs  Validates every src/data/*.json against its schema;
                     runs standalone (`npm run validate-data`) and as the
                     "prebuild" step before every `npm run build`
public/
  icons/           PWA icon set (48–512px, maskable variants, favicon,
                   apple-touch-icon)
  screenshots/     Desktop + mobile install-prompt screenshots (manifest
                   `screenshots`)
  sprites/         The 32rogues tile/monster/item/rogues spritesheets
```

---

## Data files

Everything under `src/data/` is imported at build time (`resolveJsonModule`) and turned into runtime objects by `dataLoader.ts`. Adding or tuning most content is a **JSON edit, no code**. Every file has a matching schema in `schema/` — see [Data validation](#data-validation).

### `monsters.json`
Keyed by monster id. `dataLoader` scales HP/ATK by floor and biome at spawn.

| field | type | notes |
|---|---|---|
| `id`, `displayName` | string | |
| `visualAsset` | string | sprite-map key rendered by `SpriteService`; keys with no `sprite-map.json` entry render nothing |
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
The generic boss pool (one appears every 5th floor, gated on stack fill — see [Core systems](#core-systems)). Fields: `id`, `displayName`, `visualAsset`, `hpMult`, `atkMult`, `xpValue`, `flavorText`. Base HP/ATK are computed from floor and multiplied.
*Note:* biome-specific bosses (Cailleach's Stoneward, Balor's Herald) and **Bres the Beautiful** are defined in code because they carry behaviour callbacks (`onHalfHp`, `onDeath`) that data can't express.

### `classes.json`, `biomes.json`, `patrons.json`

**`classes.json`** — the three starting classes. Fields: `id`, `emoji`, `name`, `tagline`, `statChips` (display-only), `tPieceCdReduction`, `effects: EffectSpec[]`, and a declarative `ability` (`name`, `abilityType`, `range`, `damageMult`, `cooldownMax`, `params`) dispatched by `abilityType` in `game.ts`'s ranged-attack handler.

**`biomes.json`** — ordered deepest-first, matched by `Biome.forFloor(floor)` (first entry whose `minFloor` the floor meets). Fields: `id`, `name`, `minFloor`, `tileRgb`, `moteColor`, `monsterHpMult`, `gravityPctBonus`, `desc`, and `terrainType` (`swamp` | `sacred` | `ice`) — the special-tile effect that biome's terrain-shape pieces (S/L/J) lay down on lock. Crossing into a new one (including the starting floor-1 biome) logs its flavor line and toasts "Entering `<name>`...".

**`patrons.json`** — the three deities An Draoi can pact with. Fields: `id`, `char`, `name`, `deity`, `tagline`, `tollDesc`, `effects: EffectSpec[]` (the permanent toll), and `spells[]` — each a full ranged-ability spec (same shape as a class's `ability`) plus `unlockLevel`, unlocked progressively as the pact deepens.

### `boons.json`, `brands.json`, `modifiers.json` — the effect system

These three (and `classes.json`'s `effects`/`patrons.json`'s toll `effects`) describe their effects **declaratively** using a shared `EffectSpec` (defined in `types.ts`). A small resolver in `dataLoader.ts` applies them:

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
Fields: `id`, `char` (sprite-map key), `name`, `tier` (1–3), `role` (`offense`/`defense`/`utility`), `desc`, `effects: EffectSpec[]`, optional `special`.

**`brands.json`** — permanent tattoos with set bonuses.
Fields: `id`, `char`, `name`, `setSize` (2–3), `role`, `desc`, `setDesc`, `onEquip: EffectSpec[]` (per brand), `onSet: EffectSpec[]` (when a set completes).

**`modifiers.json`** — run-start curses.
Fields: `id`, `emoji`, `name`, `desc`, `effects: EffectSpec[]` (may target `player` or `game`), optional `special`.

**Escape hatch — `special`.** The few effects that can't be pure data reference a named handler in `dataLoader.ts`:
- `void_loop` (boon) — crit-every-N cadence that depends on stack count.
- `full_heal` (curse) — sets `hp = maxHp` after a Max-HP change (Glass Cannon, Berserker).
- `void_prism` is intentionally a no-op in JSON (recomputed in `Player.addBoon`).
To add a new special: put a one-liner in `BOON_SPECIALS` / `MODIFIER_SPECIALS` and reference its key from JSON.

### `npcs.json`, `floor-events.json`, `smiths.json`, `omens.json`

**`npcs.json`** — wandering NPC encounters. `kind: 'flavor'` NPCs cycle through `lines[]` with a `returnLine` on repeat meetings; other kinds intro via `introLine` and may grant something. Discovered NPCs are tracked in the lore codex by `id`. `waystationOnly: true` marks residents of the sídhe-mound waystation (the seanchaí), excluded from random wandering rolls.

**`floor-events.json`** — the narrative floor-event modal, offered every few descents (skip boss floors). Each event has `id`, `emoji`, `title`, `flavor`, and `options[]` (`label`, `desc`, `handler` — a named function in `game.ts`'s handler table — plus optional `params`).

**`smiths.json`** — the three legendary smiths of Lugh's Spear questline, in encounter order (Luchta → Credne → Goibniu). Fields: `id`, `char` (sprite-map key), `name`, `partKey` (`shaft` | `bolts` | `head`), `partName`, `tagline`, `flavor`. Encountered via `game.ts`'s `triggerSmithEncounter`, reusing the floor-event modal rather than a dedicated component; Goibniu's third meeting is a `special`-style reforge handled directly in `game.ts` rather than in JSON, since it swaps `player.rangedAbility` at runtime.

**`omens.json`** — per-floor modifiers rolled on floor entry (chance in `balance.json`'s `omens.rollChance`). Fields: `id`, `icon`, `name`, `toastText`, `logText`, `weight` (relative roll weight), `params` (numeric tunables read by that omen's effect hook in `game.ts`, e.g. `goldMult`, `visionPenalty`, `gravityPct`), and optional `special` — the escape hatch for scripted ritual omens (`"bealtaine"` drives the brazier ritual). Pure stat omens need no code: their hooks read whatever params are present, so a new one is usually just a JSON entry.

### Support files
- **`shapes.json` (each shape carries a `weight` — classics ~10, rare custom shapes ~1, `0` removes it from the natural rotation)** — the 9 piece shapes in the random draw pool: the 7 standard tetrominoes plus two extra non-standard shapes (`Q`, `H`), each `{ matrix, color }` keyed by letter.
- **`sprite-map.json`** — sprite-atlas coordinates (`sheet`, `sx`, `sy`, `sw`, `sh`) into the `public/sprites/*.png` 32rogues sheets, read by `SpriteService`. A key with no entry renders nothing (`SpriteService.iconHTML` returns `''`) — there is no emoji fallback.
- **`balance.json`, `combat.json`, `hazards.json`, `monster-ai.json`, `colors.json`** — flat tuning numbers (dice/combat math, hazard timers, monster-AI thresholds, altar-tier colors), loaded by `balance.ts`/`colors.ts`. Edit these to retune the game; no code changes needed.

### Data validation

Every file in `src/data/` has a matching JSON Schema (2020-12) in `schema/`, checked by `scripts/validate-data.mjs` — run standalone via `npm run validate-data`, or automatically as the `prebuild` step before every `npm run build`. Shared fragments (like `EffectSpec`) live in `schema/_effect-spec.schema.json` and are referenced via `$ref`. Add a new data file → add its schema alongside it and list it in `FILES` in `validate-data.mjs`.

---

## Adding & tuning content

- **New boon / brand / curse:** edit the relevant JSON with `EffectSpec` entries. No code unless you need a `special` handler.
- **New monster:** add an entry to `monsters.json`, make sure its `cellTypeId` is in `CELL_MAP`, give it a `visualAsset` with a matching entry in `sprite-map.json` (no entry renders nothing), and (if it should spawn from blocks) wire its cell into the spawn table in `game.ts`.
- **New biome:** add an entry to `biomes.json` with a `minFloor` and a `terrainType`; biome-specific bosses still need a code entry (see `bosses.json` note above).
- **Classes and patron spells** are fully data-driven (`classes.json`, `patrons.json`) except for the `abilityType` dispatch switch itself in `game.ts` — adding a new *kind* of ranged ability (not just a new class using an existing kind) needs a new case there.

After any content change: `npm run lint && npm test && npm run build` (the build's `prebuild` step re-runs data validation too).

---

## Testing

**One command runs every quality gate** — the same set CI enforces:

```bash
npm run verify        # typecheck + lint + schema validation + tests w/ coverage thresholds + build
```

Individually: `npm run typecheck` (tsc), `npm run lint` (oxlint, warnings are errors), `npm run validate-data` (AJV against `schema/*.json`), `npm run test:coverage` (vitest + v8 coverage with ratchet thresholds in `vitest.config.ts` — raise them as coverage grows, CI fails if a change drops below).

**Versioning**: every Pages deploy is stamped `1.0.<run number>` (shown on the start screen and pause menu, `dev` locally), so bug reports can name the exact build.

### Test suite


Unit tests live in `src/__tests__/` and run on **Vitest** (`npm test`). They cover the pure game logic — combat math, spawning, line clears, boons/brands/curses (including the JSON effect resolver), the Gorgoth endgame, and monster AI. There's no jsdom/happy-dom configured, so **the UI/component/renderer layers have no unit harness** — verify those changes live in the browser (`npm run dev`), driving the actual DOM rather than poking internals.

---

## Notes & gotchas

- **`npm run build` does not type-check** (esbuild). Run `npm run lint` (`tsc --noEmit`) before trusting a build.
- **Movement is orthogonal only** for everyone — a diagonally-adjacent enemy must step to a cardinal tile before it can attack.
- **The Gorgoth fight has no line clears** (blocks stop), so line-clear-oriented builds don't contribute during it — combat/dodge/crit/sustain/ranged builds carry the finale.
- **Modals are Light DOM custom elements, not Shadow DOM.** Every existing `id`/`class` on a modal's markup is preserved verbatim when it moved from a static `<div>` in `index.html` into a component's `template()` string — `style.css` needs no per-component changes. Keep it that way: don't introduce element-type-qualified CSS selectors (`div.modal-overlay`), or a future component could stop matching them.
- **Normal boss floors** gate on *overall* board fill (≥50% of all field cells built), not the tallest single column — a narrow one-column spike from careless hard-dropping doesn't trigger it early.
