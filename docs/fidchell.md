# Fidchell — "the wooden wisdom"

## The pitch

Fidchell is the board game of the gods in Irish myth — the Dagda and Lugh play
it, and it belongs to the Mythological Cycle alongside Bres and the Fomorians.
Its exact rules are lost, so this is built on its closest surviving relative:
**brandub**, the Irish 7×7 *tafl* game. It's a pure turn-based **strategy**
counterpart to the reflex block-building and the territorial Causeway Duel — a
third, distinct mental muscle.

Every **7th floor** (7, 14, 21…, skipping boss floors) a Fomorian gambler bars
the crossing and sets the board. You're dealt one side **at random**:

- **The King's escape** — you hold the High King + four defenders; slip the King
  to any corner *dún* to win free.
- **The Raiders' hunt** — you command the eight Fomorian raiders; surround and
  take the King before he escapes.

**Win** → a skill-gated shortcut: gold, a boon, and passage straight past the
floor. **Lose** → no shortcut; the floor is rebuilt and the gambler drops onto
it as an elite to fight through. It can never dead-end a run.

## Rules (brandub-based)

- **Board:** a centred 7×7. The King starts on the central throne with four
  defenders in the cross; eight raiders start on the edge arms. Raiders move
  first (tafl tradition).
- **Movement:** every piece slides orthogonally any distance, like a chess rook
  — no diagonals, no jumping.
- **Restricted squares:** only the King may stop on a corner or the throne
  (other pieces may pass over the empty throne but not the corners).
- **Capture (custodial):** move so an enemy is flanked between two of your
  pieces along a line, and it's taken. A corner or the empty throne counts as
  one side of the flank. Moving *into* a gap between two enemies is safe.
- **The weak King:** the King is captured by ordinary custodial flanking, like
  any soldier — two raiders on opposite sides. (This is the balancing lever: it
  offsets the King's rook speed against the raiders' numbers.)
- **Win / lose:** King reaches a corner → King side wins. King is taken → raider
  side wins. A side with no legal move loses; a 120-ply cap resolves a stall
  against the player.

## The AI

Both roles are driven by a depth-3 **negamax with alpha-beta** over a positional
evaluation (King's proximity to a corner, escape mobility, surviving defenders,
raiders pressing the King). This matters because the player is dealt a random
side, so the AI must play *either* role competently — a greedy 1-ply AI made the
side you faced trivial. A move resolves in ~30 ms.

**Balance:** in AI-vs-AI self-play the King side wins ~60% and the raiders ~40%
— both roles genuinely winnable, with the heroic King escape as the slight
default. A human (sharper than the AI) does better than the baseline on whichever
side they draw.

## Controls

Fully turn-based, tap-driven (the natural counterpart to the falling-block
layer): tap one of your pieces to select it, and its legal squares light up; tap
a highlighted square to move. Tap elsewhere to deselect.

## Engine reuse

Like the Causeway Duel, it runs as a self-contained suspended play-state:

| Reused | New |
|---|---|
| The grid + renderer, the `blockBuildingSuspended` suspend pattern | Rook-slide move generation + custodial-capture resolution |
| Tap-to-inspect input plumbing (routed to `handleFidchellTap`) | A depth-limited negamax AI that plays both sides |
| Toast / log / particle / boon / story-beat hooks | The random-side deal + skill-gated win (shortcut) / loss (fight) |
| The generic save/resume scalar sweep — no live refs, so it round-trips for free | A 7×7 board state + HUD panel |

## Status

Shipped. Covered by unit tests (setup, rook legality, custodial capture, King
escape, King capture, floor-7 entry, save/resume) and an AI-vs-AI balance
simulation, and verified live in-browser (board render, ~30 ms AI moves,
tap-to-move, win/loss flows).
