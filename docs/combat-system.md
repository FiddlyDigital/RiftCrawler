# The Combat System

*A complete specification of the combat resolution used in **Causeway to Ériu**, written so it
can be lifted out of the codebase and run at a table.*

This document describes the system twice. Sections 1–10 are the **specification** — exactly what
the code does, with the real constants. Section 11 is the **tabletop port**: a one-page procedure,
the arithmetic trimmed to what a human can hold, and honest notes on which parts survive the move
to a table and which don't.

Everything numeric here lives in `src/data/combat.json`, `src/data/monsters.json`,
`src/data/monster-ai.json` and `src/data/balance.json`. The logic lives in
`src/systems/combat.ts`. Where this document and the JSON disagree, the JSON is right.

---

## 1. The core: an opposed roll of unequal dice

Every attack in the game — hero swinging at a monster, monster swinging at the hero — resolves the
same way:

> **The attacker and the defender each roll one die. The size of your die is your combat skill.
> The attacker must beat the defender's roll; by how much decides how hard the blow lands.**

There is no to-hit number, no armour class, no attack bonus. Skill is expressed *entirely* as the
size of the die you roll. A novice rolls a d4. A god rolls a d20. Both roll exactly one die, once.

That single design choice is what makes the system portable: there is no bonus arithmetic to
balance, no modifier stacking, and a character sheet needs one word to describe a combatant's
skill — the die they hold.

### The ladder

| Combat level | Die | Who typically holds it |
|---|---|---|
| 1 | **d4** | Vermin. The weakest thing that can hurt you. |
| 2 | **d6** | Starting heroes; common soldiery, skirmishers, oozes. |
| 3 | **d8** | Veterans; heavy infantry, brutes. |
| 4 | **d10** | Champions. |
| 5 | **d12** | Bosses, warlords. |
| 6 | **d20** | The final enemy. One per campaign. |

*(`combat.json` → `diceSidesByLevel`: `[0, 4, 6, 8, 10, 12, 20]`, index 0 unused.)*

Note the jump from d12 to d20 — the ladder is deliberately not uniform. The top rung is meant to
feel like a different order of being, not one more step.

---

## 2. The five outcomes

Roll attacker die (**A**) against defender die (**D**), then read the result in this order. **Order
matters** — the natural-maximum check happens before anything else, so a natural max is a critical
even if the defender rolled higher.

| # | Check | Outcome | Damage |
|---|---|---|---|
| 1 | **A is a natural maximum** (4 on a d4, 20 on a d20…) | **Critical** | ×2.0 + the target is **stunned 1 turn** |
| 2 | **A ≤ D** | **Miss** | ×0 — but see the graze floor (§4) |
| 3 | margin **1–2** | **Glancing blow** | ×0.5 |
| 4 | margin **3–5** | **Hit** | ×1.0 |
| 5 | margin **6+** | **Power strike** | ×1.5 |

where **margin = A − D**.

*(`combat.json` → `outcomeMultipliers`, `marginThresholds: { weakMax: 2, normalMax: 5 }`.)*

Ties go to the defender. That is the only tie-breaking rule in the system.

### The die size changes *what kind* of fighter you are, not just how good

This is the most important non-obvious property of the system, and the thing most worth stealing.

Because a critical is a natural maximum, **crit chance is exactly 1/(die size)** — so *smaller dice
crit more often*:

| Die | Crit chance | Max possible margin | Outcomes reachable |
|---|---|---|---|
| d4 | **25%** | 2 | glancing, critical *only* |
| d6 | **16.7%** | 4 | glancing, hit, critical |
| d8 | **12.5%** | 6 | all five |
| d10 | **10%** | 8 | all five |
| d12 | **8.3%** | 10 | all five |
| d20 | **5%** | 18 | all five |

A d4 fighter cannot land an ordinary hit at all — every blow they land is either a scratch or a
devastating one. A d20 fighter almost never crits but lands power strikes constantly. Low-skill
combat is *swingy and lucky*; high-skill combat is *consistent and crushing*. Nobody had to write a
rule for that; it falls out of the geometry.

Power strikes require a margin of 6, which is impossible below a d8 — so **the d6→d8 step doesn't
just improve your odds, it unlocks a tier of outcome you previously could not roll.** Advancing the
ladder feels like learning something new rather than getting a bigger bonus.

---

## 3. Probability tables

Computed exhaustively over every (A, D) pair. Use these to statline encounters.

### Chance to land any non-miss result

| Attacker \ Defender | d4 | d6 | d8 | d10 | d12 | d20 |
|---|---|---|---|---|---|---|
| **d4** | 44% | 38% | 34% | 32% | 31% | 29% |
| **d6** | 58% | 44% | 38% | 33% | 31% | 25% |
| **d8** | 69% | 56% | 45% | 39% | 34% | 26% |
| **d10** | 75% | 65% | 55% | 46% | 40% | 28% |
| **d12** | 79% | 71% | 62% | 54% | 47% | 31% |
| **d20** | 88% | 82% | 78% | 72% | 68% | 48% |

**Read the diagonal.** An even matchup lands a blow only 44–48% of the time, *at every rung of the
ladder*. Two equals always trade at roughly the same rate whether they're rats or gods. Progression
never inflates away; a fight between peers feels the same at level 1 and level 9. Only *mismatches*
move the needle — and they move it hard: a d20 against a d4 lands 88% of the time.

### Full outcome distribution, even matchups

| Matchup | Miss | Glancing | Hit | Power | Critical |
|---|---|---|---|---|---|
| d4 vs d4 | 56.2% | 18.8% | — | — | **25.0%** |
| d6 vs d6 | 55.6% | 19.4% | 8.3% | — | 16.7% |
| d8 vs d8 | 54.7% | 17.2% | 14.1% | 1.6% | 12.5% |
| d10 vs d10 | 54.0% | 15.0% | 15.0% | 6.0% | 10.0% |
| d12 vs d12 | 53.5% | 13.2% | 14.6% | 10.4% | 8.3% |
| d20 vs d20 | 52.2% | 8.8% | 11.2% | **22.8%** | 5.0% |

The distribution rotates from crit-heavy to power-heavy as both sides climb. Same hit rate,
completely different texture.

### Selected mismatches

| Matchup | Miss | Glancing | Hit | Power | Critical |
|---|---|---|---|---|---|
| d6 vs d4 (one rung up) | 41.7% | 29.2% | 12.5% | — | 16.7% |
| d6 vs d8 (one rung down) | 62.5% | 14.6% | 6.2% | — | 16.7% |
| d20 vs d8 | 22.5% | 10.0% | 15.0% | **47.5%** | 5.0% |
| d8 vs d20 | 74.4% | 6.9% | 5.6% | 0.6% | 12.5% |

Note the bottom row: the outmatched d8 fighter still crits **12.5%** of the time against a d20,
because crit chance depends only on their own die. *The underdog always keeps their lightning.* A
hopeless fight is never quite hopeless, and the design never had to bolt on a "lucky hit" rule.

### Expected damage multiplier per swing

Including the graze floor from §4, so this is true expected output per attack action.

| Attacker \ Defender | d4 | d6 | d8 | d10 | d12 | d20 |
|---|---|---|---|---|---|---|
| **d4** | 0.73 | 0.72 | 0.71 | 0.71 | 0.70 | 0.70 |
| **d6** | 0.71 | 0.65 | 0.62 | 0.61 | 0.60 | 0.57 |
| **d8** | 0.78 | 0.69 | 0.64 | 0.60 | 0.58 | 0.54 |
| **d10** | 0.89 | 0.79 | 0.71 | 0.65 | 0.61 | 0.54 |
| **d12** | 0.99 | 0.89 | 0.80 | 0.72 | 0.67 | 0.56 |
| **d20** | 1.19 | 1.13 | 1.07 | 1.01 | 0.94 | 0.73 |

Two things fall out of this table that are worth knowing before you tune anything:

- **The d4 row is almost flat (0.70–0.73).** A d4 attacker deals about the same expected damage to
  a god as to a rat, because their output is carried by criticals and criticals don't care who
  they're facing. Skill defends you against *reliability*, not against fortune.
- **Nothing ever exceeds ~1.2×.** Even a d20 pounding a d4 averages 1.19× its attack stat. The
  spread of expected outcomes across the entire skill matrix is roughly 0.54× to 1.19× — barely
  more than a factor of two. **Combat power comes overwhelmingly from the attack stat and hit
  points, not from the dice.** The dice supply texture and drama; the numbers on the sheet supply
  the actual power curve. Keep that in mind before you "fix" the dice.

---

## 4. Damage, and the two safety valves

```
damage = max(1, round(ATK × outcomeMultiplier × situationalMultiplier))
```

`ATK` is a flat stat on the sheet. There is no damage die — **all randomness lives in the
attack roll.** One roll decides both whether you hit and how hard, which is a large part of why
turns resolve fast.

Two rules exist purely to stop bad luck from being unfun. Both are worth stealing wholesale.

### The graze floor

**A miss is never nothing.** A missed attack still deals `25%` of ATK (minimum 1).

*(`combat.json` → `grazeDamagePct: 0.25`.)*

This is what keeps the expected-damage table above from collapsing at the bad end. Its real job is
emotional: in a game where the clock is always running, a wasted turn is a punishment, and the
system punishes you enough already. You always accomplish *something*.

### Miss pity

**You can never miss three times in a row.** Two consecutive misses arm the pity; the third miss is
upgraded to a guaranteed glancing blow. Any landed blow disarms it.

*(`combat.json` → `missPityStreak: 2`. Tracked as `player.missStreak`.)*

Note this is **asymmetric — the hero has it, monsters do not.** It exists to protect the player from
a death spiral, not to model anything. A cold streak should sting; it should never be the reason
you lost the run. Three whiffs in a row at a 55% miss rate happens roughly one turn in six, which is
often enough to matter.

Both valves are invisible when things are going well and only show up when the dice are cruel —
the right shape for a mercy rule.

---

## 5. Resolving an incoming attack: the full order of operations

The defensive layer is a chain of checks, each of which can end the attack early. This ordering is
load-bearing; changing it changes the value of every defensive ability in the game.

```
1.  Guaranteed dodge?     ── spend a charge → attack ends, no roll made
2.  Dodge chance %?       ── roll; on success → attack ends (and may heal you)
3.  THE OPPOSED ROLL      ── §1–2. A miss here is a "block", and deals nothing
                             (the graze floor applies to the hero attacking, not to the hero
                              being attacked — monsters get no free chip damage)
4.  raw = ATK × outcome multiplier
5.  Flat damage reduction ── actual = max(0, raw − DR).  DR is a percentage of MAX HP,
                             not a flat number, so armour scales with the character
6.  Apply damage
7.  Reflect (thorns)      ── attacker takes a % of your ATK; may kill them outright
8.  Status infliction     ── a critical ALWAYS inflicts the attacker's status;
                             otherwise roll the attacker's listed chance
9.  Death check           ── → §7
```

Two details worth lifting:

- **Damage reduction is a fraction of Max HP, not a flat number.** A character with 10% DR and
  200 Max HP reduces every hit by 20. Armour that scales with the wearer never becomes worthless
  in the late game and is never overwhelming early — a persistent problem with flat DR.
- **Criticals bypass the status roll entirely.** Every critical inflicts whatever the attacker
  carries. This makes crits meaningfully scary from a poisonous enemy in a way a damage multiplier
  alone would not, at zero extra complexity.

---

## 6. Status effects

Only two statuses exist. Both tick at the *end* of each round, before anything else moves.

| Status | Effect |
|---|---|
| **Stun** | The victim loses their next turn. Does not stack — a stunned target can't be re-stunned. |
| **Poison** | Deals `power` damage per round for `duration` rounds. |

Poison on the hero is reduced by damage reduction (`max(0, power − DR)`), so armour blunts venom.
Poison on a monster is not — monsters have no DR. Poison can kill, and a poison kill awards full
rewards.

A critical hit applies a 1-round stun. That is the only universally available control effect in the
game, and it comes free with the best outcome on the table — so criticals compound: you hit for
double *and* they lose a turn.

---

## 7. Death, and the two ways out of it

When hit points reach zero the run ends — **unless** something intercepts, checked in this order:

1. **Deathward charge** — consume one charge; restore to **30% of Max HP**. Repeatable while
   charges remain.
2. **Life Brand** — a one-shot revive that **destroys every brand (equipment set bonus) you own**.
   Also restores to 30%.

Both leave you alive at 30%, i.e. alive but in immediate danger, which is the point: a revive
should buy you a chance, not reset the fight.

The Life Brand's cost is the interesting one — it's paid in *build*, not in hit points or gold.
You survive, but the character you'd assembled over the run is gone and you fight on as something
lesser. That's a far more memorable price than a resource number going down, and it costs nothing
to implement.

---

## 8. Who holds which die

### The hero

Combat level is the greater of the character's class die and a floor set by experience level:

| Character level | Combat level | Die |
|---|---|---|
| 1–2 | class default | class default |
| 3–4 | at least 3 | at least d8 |
| 5–6 | 4 | d10 |
| 7–8 | 5 | d12 |
| 9+ | **6** | **d20** |

*(`balance.json` → `player.combatLevelBands`.)*

Class defaults: d8 for the armoured Architect, d6 for the two casters. The bands *override* rather
than add from level 5 up, so all classes converge — the martial class's edge is an early-game one
that the casters catch up to, which is exactly the right shape for a class whose advantage is
supposed to be its opening.

Experience to next level starts at 50 and multiplies by 1.4 each level (50, 70, 98, 137, 191, …).

### Monsters

| Enemy | Level | Die | HP (floor 1) | +HP/floor | ATK | +ATK/floor | Behaviour |
|---|---|---|---|---|---|---|---|
| Bog Rat | 1 | d4 | 10 | +2.0 | 3 | +1.0 | melee |
| Cairn Wight | 2 | d6 | 18 | +3.0 | 5 | +1.0 | melee, poison 25% |
| Fomorian Slinger | 2 | d6 | 12 | +2.5 | 4 | +1.2 | ranged (3) |
| Peat Ooze | 2 | d6 | 22 | +3.5 | 2 | +0.5 | healer |
| Sluagh Bat | 2 | d6 | 8 | +2.0 | 3 | +1.0 | swift, poison 50% |
| Fomorian Brute | 3 | d8 | 30 | +4.0 | 7 | +1.5 | berserker |
| Floor boss | **5** | **d12** | 18 | +3 | 5 | +1 | (per boss) |
| The final enemy | **6** | **d20** | 1450 | — | 54 | — | inexorable advance |

**Elite variants** (a ~15% chance on any spawn): **×2 HP, ×1.5 ATK, +1 combat level** (capped at 6).
One line of code, and it produces an enemy that is recognisably the same creature but genuinely
dangerous — including the die bump, which changes how the fight *feels*, not just how long it takes.

---

## 9. Monster behaviour

Six behaviours, each a handful of lines. All distances are **Manhattan** (no diagonals — movement
and attacks are strictly orthogonal for everyone, which removes an entire class of geometry
arguments at the table).

| Behaviour | Rule |
|---|---|
| **Melee** | Attack if adjacent, else close if within 5, else hold position. |
| **Berserker** | As melee, chase 5 — but **below half HP it attacks twice per round**. |
| **Swift** | Chase range 7, and **moves twice per round** while closing (not while attacking). |
| **Ranged** | Attacks at range 3 **if it has line of sight**; if sight is blocked and you're within 2 it backs off a step; otherwise it closes to within range+3. |
| **Healer** | Never attacks in preference to healing: **restores 25% of Max HP to an adjacent wounded ally**, otherwise behaves as melee. |
| **Inexorable** | Advances one tile every round, through walls and terrain. Cannot be escaped, only killed. |

The berserker's below-half double attack is the standout: it turns "nearly dead" into the most
dangerous phase of the fight, so finishing a wounded brute is a real decision rather than mop-up.
The healer, which never attacks at all, converts a fight into a targeting-priority puzzle without
adding a single new mechanic.

One caveat if you're porting the ranged behaviour: as tuned, retreat distance (2) is *inside*
attack range (3), so the kiter only ever backs off when something breaks line of sight — close to
it in the open and it simply shoots you point-blank. The intent behind the numbers is clearly
"skirmisher gives ground when you close", and at a table that's the version worth running: **if the
target is adjacent, step back instead of shooting.** Set retreat distance above attack range if you
want the code to do the same.

---

## 10. Rewards on a kill

| Event | Reward |
|---|---|
| Any kill | 80 gold, **+3 HP healed**, experience per the monster's value |
| Elite kill | +150 gold per floor of depth, on top |
| Boss kill | 500 gold |

The flat **+3 HP on every kill** is quietly one of the most important numbers in the system.
It means aggression is itself a healing strategy — clearing a room leaves you healthier than
avoiding it — which pushes players toward the fights instead of away from them, without any
explicit incentive text.

Optional layered effects, all percentage-of-a-reference-stat so they scale for the whole run: heal
a % of Max HP per kill, gain a % of ATK per kill (resets each floor), reflect a % of ATK to
attackers, heal on dodge.

---

## 11. Running this at a table

The system ports almost intact. It was built around one opposed die roll precisely because that is
what a person can do quickly, and there is no hidden state — everything above fits on an index card.

### The procedure, condensed

> **Attack.** Attacker rolls their die. Defender rolls theirs.
>
> - **Natural max on the attacker's die → CRITICAL.** Double damage, target loses their next turn.
> - **Attacker's roll ≤ defender's → MISS.** Deal a quarter damage anyway.
> - Otherwise take the **margin**:
>   - **1–2 →** half damage
>   - **3–5 →** normal damage
>   - **6+ →** one-and-a-half damage
>
> Damage is your Attack score times that multiplier, minimum 1, minus the target's damage
> reduction.
>
> *Nobody misses three times in a row: after two whiffs, the third automatically lands as a
> glancing blow.*

That's the whole engine. Everything else in this document is content sitting on top of it.

### What to change for a table

Five recommendations, in order of how much they'll improve play:

1. **Round the multipliers into a lookup, don't do the arithmetic.** Print a small card per
   character: `Glancing 3 / Hit 6 / Power 9 / Crit 12` for an ATK of 6. Players read a number
   instead of computing one. This is the single biggest speed win, and it's why the flat-ATK
   design pays off at a table where a damage die would not.

2. **Give the miss-pity to the players only, and say so out loud.** It's a mercy rule, not a
   simulation. Track it with a token in front of the player — two tokens means the next miss lands.
   Making it visible turns it from an invisible kindness into a small tactical fact players can
   plan around.

3. **Consider dropping the graze floor, or flattening it to 1 damage.** In a video game where you
   attack dozens of times a minute, a quarter-damage miss smooths the curve beautifully. At a table
   where a round takes a minute, "you miss — deal 1.75, round to 2" is arithmetic in exchange for
   very little. Flat 1 keeps the intent (no wasted turn) at no cost. If you're running a gritty
   game, cut it entirely and let misses be misses — but then expect fights to run noticeably longer
   and re-read the expected-damage table in §3, because you'll be cutting roughly 0.25 off every
   entry in the bad half of it.

4. **Keep ties going to the defender.** It's the reason even matchups sit at a ~45% hit rate rather
   than a slow, whiffy 40% or a fast 55%, and it means the defender is doing something rather than
   passively holding a number. Players like rolling on defence; it keeps everyone at the table
   holding dice on everyone's turn.

5. **Let the die be the whole character sheet, at least at first.** The most portable thing here is
   that *skill is a die size and nothing else*. If you're building something new rather than
   converting, resist adding a to-hit bonus — the moment you do, you've reintroduced modifier
   stacking and lost the property that makes the system readable at a glance.

### What does *not* survive the port

Two things:

- **Elites as a ×2 HP multiplier.** Doubling hit points is free in a game where the computer tracks
  them; at a table it just doubles the length of the fight, which is the least interesting way to
  make an encounter harder. Port the **+1 die and the ×1.5 attack** — those change the fight — and
  leave the hit points alone, or raise them by half at most.
- **The 1450-HP final enemy.** That number exists to fill a very long endgame sequence with an
  advancing threat. A tabletop version of the same fight wants phases, terrain and a clock, not a
  large number. Take the *inexorable advance* — one tile per round, through walls, cannot be
  escaped — and build the encounter around that instead.

### A worked example

A veteran (d8, ATK 6, DR 4) fights a Fomorian Brute on floor 3 (d8, HP 38, ATK 10).

> **Round 1.** Hero rolls **7**, brute rolls **2**. Margin 5 → *hit*, ×1.0 → **6 damage**.
> Brute at 32.
> Brute rolls **8** — natural max → **critical**. ×2.0 = 20, minus 4 DR → **16 damage**, and
> the hero is **stunned**.
>
> **Round 2.** Hero loses their turn. Brute rolls **3**, hero rolls **6**. *Miss* — the hero
> blocks.
>
> **Round 3.** Hero rolls **8** — natural max → **critical**. ×2.0 → **12 damage**, brute
> stunned. Brute at 20.
> Brute is stunned; no attack.
>
> **Round 4.** Hero rolls **2**, brute rolls **5**. *Miss* — graze for 2 (a quarter of 6, rounded).
> Brute at 18, and now below half its 38 HP: **enraged, two attacks per round from here.**

Four rounds, eight dice rolled, no arithmetic harder than halving. That's the target.

---

## Where the numbers live

| File | Contents |
|---|---|
| `src/data/combat.json` | Dice ladder, outcome multipliers, margin thresholds, miss-pity, graze floor, crit stun, kill rewards |
| `src/data/monsters.json` | Every monster's die, base HP/ATK, per-floor scaling, behaviour, status infliction |
| `src/data/monster-ai.json` | Chase ranges, enrage threshold, retreat distance, heal fraction |
| `src/data/balance.json` | `player.combatLevelBands`, `eliteMonsters`, `boss`, experience curve |
| `src/systems/combat.ts` | The resolver itself — roll, outcome, damage, death, kill rewards |
| `src/systems/monsterAI.ts` | The six behaviours |
| `src/systems/statusEffects.ts` | Poison/stun ticking, regeneration |
