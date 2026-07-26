import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Game } from '../game';
import { Tile } from '../types';
import type { GameCallbacks, LogClass, RangedAbility } from '../types';

function makeCallbacks(): GameCallbacks & { logs: string[]; toasts: string[] } {
  const logs: string[] = []; const toasts: string[] = [];
  return {
    logs, toasts,
    log: (t: string, _c: LogClass) => { logs.push(t); },
    onToast: (t: string) => { toasts.push(t); },
    updateUI: vi.fn(), onDeath: vi.fn(), onParticle: vi.fn(), onParticleBurst: vi.fn(),
    onLevelUp: vi.fn(), onOpenShop: vi.fn(), onOpenTattooArtist: vi.fn(), onVictory: vi.fn(),
    onBossWarning: (_b: unknown, done: () => void) => done(), onAction: vi.fn(), onBeam: vi.fn(),
    onBlockLand: vi.fn(), onRingPulse: vi.fn(), onImpactGlow: vi.fn(), onAudio: vi.fn(),
    onCodexDiscover: vi.fn(), onFloorEvent: vi.fn(), onOpenAltar: vi.fn(), onRowClear: vi.fn(),
    onCombo: vi.fn(),
  } as unknown as GameCallbacks & { logs: string[]; toasts: string[] };
}

// Reach the private core-loop helpers without widening the public API.
type Core = {
  checkLineClears(): void;
  transitionToNextFloor(): void;
  tickVeil(): void;
  checkCloseCall(): void;
};
const core = (g: Game): Core => g as unknown as Core;
const fillRow = (g: Game, y: number): void => {
  for (let x = 0; x < 10; x++) { g.map[x]![y] = Tile.FLOOR; g.colors[x]![y] = '#888'; }
};
const revealAll = (g: Game): void => {
  for (let x = 0; x < 10; x++) for (let y = 0; y < 25; y++) g.visibility[x]![y] = true;
};
const spell = (name: string): RangedAbility => ({ name, emoji: 'fx_arcane', range: 0, damageMult: 1, cooldownMax: 3 });

describe('Game core — line clears', () => {
  let cb: ReturnType<typeof makeCallbacks>;
  let game: Game;
  beforeEach(() => { cb = makeCallbacks(); game = new Game(cb); game.dungeonLevel = 3; });

  it('clearing a full row awards gold and XP', () => {
    const gold0 = game.gold;
    fillRow(game, 24);
    core(game).checkLineClears();
    expect(game.linesCleared).toBe(1);
    expect(game.gold).toBeGreaterThan(gold0);
  });

  it('a perfect four-line clear draws An Dagda\'s notice, once', () => {
    for (const y of [21, 22, 23, 24]) fillRow(game, y);
    core(game).checkLineClears();
    expect(game.dagdaGiftEarned).toBe(true);
    expect(cb.toasts.some(t => t.includes('An Dagda'))).toBe(true);
    // a later clear does not re-earn it
    const beats = game.storyBeats.filter(b => b.includes('drew the Good God')).length;
    fillRow(game, 24);
    core(game).checkLineClears();
    expect(game.storyBeats.filter(b => b.includes('drew the Good God')).length).toBe(beats);
  });

  it('the line-clear-damage perk hurts visible monsters', () => {
    game.player.atk = 100;
    game.player.lineClearDamage = 0.5;   // 50% ATK = 50 dmg
    game.spawnMonster('skeleton', 0, 0, false);
    const m = game.monsters[0]!;
    const hp0 = m.hp;
    revealAll(game);
    fillRow(game, 24);
    core(game).checkLineClears();
    expect(m.hp).toBeLessThan(hp0);
  });

  it('the Annihilation-Rune AoE hits every monster, even unseen ones', () => {
    game.player.lineClearAoeDmgMult = 5;
    game.spawnMonster('skeleton', 9, 1, false);
    const m = game.monsters[0]!;
    const hp0 = m.hp;
    // deliberately NOT revealed
    game.visibility[9]![1] = false;
    fillRow(game, 24);
    core(game).checkLineClears();
    expect(m.hp).toBeLessThan(hp0);
  });

  it('a cursed run (noLineHeal) still clears the row but heals nothing', () => {
    game.noLineHeal = true;
    game.player.hp = 1;   // well below maxHp, so a heal *would* do something if allowed
    game.lastLineClearMs = performance.now() - 5000;   // no combo, so the summary line logs
    fillRow(game, 24);
    core(game).checkLineClears();
    expect(game.player.hp).toBe(1);
    expect(cb.logs.some(l => l.includes('no heal'))).toBe(true);
  });

  it('back-to-back clears build a combo', () => {
    game.lastLineClearMs = performance.now() - 5000;   // first clear is out of the combo window
    fillRow(game, 24);
    core(game).checkLineClears();
    expect(game.comboCount).toBe(0);
    fillRow(game, 24);                                  // second clear lands immediately → in-window
    core(game).checkLineClears();
    expect(game.comboCount).toBeGreaterThanOrEqual(1);
    expect(game.biggestCombo).toBeGreaterThanOrEqual(1);
  });

  it('a captive swallowed by a cleared row is lost with a lament, not freed', () => {
    game.npcTiles.push({ x: 3, y: 24, npcId: '__rescue_goban__' });
    fillRow(game, 24);
    core(game).checkLineClears();
    expect(game.rescuedIds.has('goban')).toBe(false);
    expect(game.npcTiles.some(n => n.npcId === '__rescue_goban__')).toBe(false);
    expect(cb.logs.some(l => l.includes('stone closes over'))).toBe(true);
  });
});

describe('Game core — spell cycling', () => {
  let game: Game;
  beforeEach(() => { game = new Game(makeCallbacks()); });

  it('cycles to the next spell when the book holds two or more', () => {
    game.player.spellbook = [spell('Alpha'), spell('Beta')];
    game.player.activeSpellIndex = 0;
    game.handleCycleSpell();
    expect(game.player.activeSpellIndex).toBe(1);
    expect(game.player.rangedAbility!.name).toBe('Beta');
    game.handleCycleSpell();
    expect(game.player.activeSpellIndex).toBe(0);   // wraps around
  });

  it('is a no-op with fewer than two spells or when dead', () => {
    game.player.spellbook = [spell('Only')];
    game.handleCycleSpell();
    expect(game.player.activeSpellIndex).toBe(0);
    game.player.spellbook = [spell('A'), spell('B')];
    game.player.hp = 0;
    game.handleCycleSpell();
    expect(game.player.activeSpellIndex).toBe(0);
  });
});

describe('Game core — hero move interactions', () => {
  let cb: ReturnType<typeof makeCallbacks>;
  let game: Game;
  beforeEach(() => { cb = makeCallbacks(); game = new Game(cb); game.dungeonLevel = 3; });

  it('a guaranteed-crit cadence fires on the Nth strike', () => {
    game.player.critEvery = 1;   // every hit is a crit
    game.player.atk = 1;
    game.spawnMonster('rat', game.player.x, game.player.y - 1, false);
    game.handleHeroMove(0, -1);   // attack up (atk 1 won't kill the rat)
    expect(game.player.critCount).toBe(0);   // reset after firing
  });

  it('killing a monster by moving into it removes it and advances the turn', () => {
    game.player.atk = 100000; game.player.baseCombatLevel = 6;
    game.spawnMonster('rat', game.player.x, game.player.y - 1, false);
    expect(game.monsters.length).toBe(1);
    game.handleHeroMove(0, -1);
    expect(game.monsters.length).toBe(0);
  });

  it('a stunned hero burns the move shaking it off', () => {
    game.player.statuses.push({ type: 'stun', duration: 3, power: 0 });
    const x0 = game.player.x, y0 = game.player.y;
    game.handleHeroMove(1, 0);
    expect(game.player.x).toBe(x0);   // didn't move
    expect(game.player.y).toBe(y0);
    expect((game.cb as unknown as { logs: string[] }).logs.some(l => l.includes('stunned'))).toBe(true);
    // the stun weakened this turn (the move-handler decrements, then the turn tick decrements again)
    const stun = game.player.statuses.find(s => s.type === 'stun');
    expect(stun === undefined || stun.duration < 3).toBe(true);
  });

  it('lighting the last Bealtaine need-fire completes the ritual and opens a tier-3 altar', () => {
    game.brazierLitCount = 2;   // one short of the default 3
    game.brazierTiles.push({ x: game.player.x, y: game.player.y - 1, lit: false });
    game.map[game.player.x]![game.player.y - 1] = Tile.FLOOR;
    game.handleHeroMove(0, -1);
    expect(game.ritualComplete).toBe(true);
    expect(cb.onOpenAltar).toHaveBeenCalled();
  });

  it('rejects a non-finite delta', () => {
    expect(() => game.handleHeroMove(NaN, 0)).toThrow(TypeError);
  });
});

describe('Game core — floor collapse & upkeep', () => {
  let game: Game;
  beforeEach(() => { game = new Game(makeCallbacks()); });

  it('a stack collapse advances the floor and rebuilds', () => {
    const floor0 = game.dungeonLevel;
    core(game).transitionToNextFloor();
    expect(game.dungeonLevel).toBe(floor0 + 1);
  });

  it('the veil timer counts down and drops the veil at zero', () => {
    game.player.veiledTurns = 1;
    core(game).tickVeil();
    expect(game.player.veiledTurns).toBe(0);
  });
});
