# Causeway Duel — a boss-floor play state

## The pitch

The game's premise is that **Bres builds a causeway to invade Ériu**, and its
endgame is already "he finishes the bridge and descends to you." The Causeway
Duel turns that metaphor into the **boss-floor verb**: the boss builds a
causeway *down* toward you; you build one *up* to meet it. When the two
causeways touch, you climb yours and fight. Beat the boss and the stairs
appear; let the boss's causeway reach your home row and the bridge is
complete — Bres crosses, and you lose.

It's a tactical, no-gravity spin on the block-laying (removing the reflex
barrier that turns some players off) that doubles as boss-fight variety and
guarantees a real combat climax every boss floor.

## Core loop (the spike)

Turn-based, no gravity, on the shared 10×25 grid:

1. **Setup** — board cleared. Player owns a start tile on the home row
   (bottom); the boss owns a start tile at the top and stands on it.
2. **Player turn** — you're dealt a random tetromino. Steer/rotate it freely;
   place it where **at least one of its cells is orthogonally adjacent to a
   tile you already own** (grow a connected blob — no overlaps, in-bounds).
   Placed cells become your causeway (walkable floor).
3. **Between placements** you may walk your hero along your own causeway
   (normal orthogonal movement + combat).
4. **Boss turn** — the boss AI places a random piece adjacent to *its*
   territory, biased to grow toward your home row, and advances one step
   along its causeway toward you.
5. **Meet** — once your territory and the boss's touch, the path is open. Walk
   up and attack the boss with the normal combat system.
6. **Resolve** — boss HP → 0: spawn stairs (descend / back to the mound).
   Boss advance reaches your home row: you lose (Bres crosses).

## Reused vs. new

| Reused (no change) | New |
|---|---|
| Grid, tiles, colors | A duel board-state flag (a new value of the `tetrisSuspended` family) |
| Hero movement + combat + boss `Monster`s | Connected-placement validity check (adjacency, not gravity) |
| Stairs, descend / waystation flow | Boss placement AI (grow-toward-player heuristic) |
| Piece shapes + rotation math | Meet-in-the-middle detection |
| The Gorgoth "descends to you" loss shape | Boss advance / auto-win-on-home-row counter |

## Design calls (spike defaults, changeable)

- **Strict alternating turns** (you place, boss places).
- **Connect to any owned tile** (forgiving blob growth), not a single frontier.
- **Hero walks the causeway to fight** (uses real combat depth) rather than
  auto-resolving on contact.

## The trimmings (all shipped)

- **Center wall + switch-islands** — a sealed full-width barrier splits the two
  halves. Two switch-islands sit below it; route your causeway to abut each one
  to light it, and lighting both dissolves the wall so you can climb to the
  bridge.
- **Boon-islands** off the main line — two islands above the wall carry rewards
  (a tier-scaled Geis, a heal, or gold). Detour your causeway to touch one and
  it's granted, at a tempo cost that lets the boss gain ground.
- **Characterful boss AI** — the boss no longer marches a straight column. Each
  turn it picks the *lane* that minimises `player-blockers×3 + distance-to-home`
  (`duelBossLaneColumn()`), so it routes around walls you build and probes for
  the shortest open path to your shore.
- **Save / resume** — mid-duel state survives a snapshot round trip. `duelBoss`
  is skipped in the raw scalar sweep and re-linked to the live restored
  `Monster` on load; owner grid, switches, wall, and boons all persist.
- **Polish** — a distinct gold pulsing cursor during the build phase; a
  one-time "the bridge nears your shore" warning when the boss closes in; sound
  cues on boss advance, boon pickup, and wall-open; and richer particle / ring /
  glow flourishes on both the win (stairs rise) and the loss (the bridge lands).

## Boss floors

Every boss floor (5, 10, 15…) enters a Causeway Duel in place of the normal
boss encounter — `duelBossFloorsEnabled()` returns `true`, and both descent
paths (`descendFloor()` / `transitionToNextFloor()`) route into
`startCausewayDuel()` after resetting the dungeon state.

## Status

Shipped. Core loop plus all trimmings are live, proven end-to-end in a headless
browser (enter → both causeways grow → meet → walk-and-fight → win-stairs or
loss-at-shore, switches open the wall, boons grant, save/resume), and covered by
11 unit tests in `src/__tests__/causewayDuel.test.ts`.
