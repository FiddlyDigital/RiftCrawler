HANDOVER.md: Tetris-Roguelike Hybrid Engine ("Causeway to Ériu")

1. Project Overview
1.1 Genre & Core Concept
"Causeway to Ériu" is a mobile-first, portrait-oriented, turn-based roguelike/Tetris hybrid. The gameplay space is a classic vertical Tetris grid, but empty space represents an impassable abyss rather than open floor.
Players construct the physical map in real-time by rotating, shifting, and dropping tetrominoes. These falling pieces act as landing platforms, carrying procedural terrain, hostile monsters, and helpful items that solidify into the permanent dungeon map upon locking.

1.2 Key Mechanics
Dual-Input Paradigm: Touch controls feature a split-DPAD system. The left panel manipulates the active tetromino (rotation, translation, soft/hard drop); the right panel navigates the hero and executes standard roguelike wait actions.

Action-Linked Gravity Ticks: Gravity is linked to player-initiated actions rather than a real-time wall-clock timer. Taking a turn (either moving the block or moving the hero) increments a turn-counter that periodically triggers gravity-descent steps for the active piece.

Dungeon Solidification: Locked blocks write walkable floors (TILE.FLOOR or TILE.STAIRS) directly to the static 2D grid matrix. Entities riding on the falling piece are instantiated as active actors on the map upon locking.

Line Clears as Progress: Completing a horizontal row of floor tiles clears the line, shifting the dungeon layers down. If the player is standing on or above a cleared line, they descend with it. Shifting past the bottom of the map initiates a progression loop into the next, more difficult floor.

Procedural Escalation: Staircases (🪜) spawn procedurally on tetrominoes. Stepping onto a staircase manually descends a level, which scales up enemy health and attack multipliers, while decreasing gravity action-tick intervals.

2. Conceptual Architecture (Prototype)
The proof-of-concept single-file implementation uses a standard object-oriented architecture in vanilla JavaScript inside a single HTML file.
code
Code
[ Browser Window Event Loops ]
                     │ (Touch / Keyboard Inputs)
                     ▼
             [ Game Coordinator ]
                     │
         ┌───────────┴───────────┐
         ▼                       ▼
   [ Player State ]     [ Active Tetromino ]
   (Coordinates, HP)    (Shifting, Matrix, Riders)
         │                       │
         └───────────┬───────────┘
                     ▼
         [ Static Map Grid Matrix ]
         (Walkable Floor vs Void Abyss)
                     │
                     ├───────────────┐
                     ▼               ▼
             [ Active Monsters ]  [ Floor Items ]
             
Prototype Limitations to Address in Production:

Main-Thread Coupling: Game states, entity updates, render pipelines, and particle animations are highly coupled to a single requestAnimationFrame loop.

Object Allocation Overhead: Temporary UI particle objects are allocated on-the-fly, which causes performance issues on low-end mobile hardware due to Garbage Collection (GC) pauses.

Primitive Collision Checking: Movement safety is validated through direct checks on a single 2D grid array, which limits the addition of complex terrain elements like walls, sight-blocking elements, or fluid hazards.