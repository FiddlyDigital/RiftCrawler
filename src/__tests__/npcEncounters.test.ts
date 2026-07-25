import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Game } from '../game';
import { NPCS, Boon } from '../content';
import type { GameCallbacks, LogClass, FloorEventDef, GhostRecord } from '../types';

type Captured = { event: FloorEventDef; onChoice: (i: number) => void } | null;

function makeCallbacks(): GameCallbacks & { logs: string[]; captured: () => Captured } {
  const logs: string[] = [];
  let last: Captured = null;
  return {
    logs,
    captured: () => last,
    log: (text: string, _cls: LogClass) => { logs.push(text); },
    onFloorEvent: (event: FloorEventDef, onChoice: (i: number) => void) => { last = { event, onChoice }; },
    updateUI: vi.fn(), onDeath: vi.fn(), onParticle: vi.fn(), onParticleBurst: vi.fn(),
    onLevelUp: vi.fn(), onOpenShop: vi.fn(), onOpenTattooArtist: vi.fn(), onVictory: vi.fn(),
    onBossWarning: (_b: unknown, done: () => void) => done(), onAction: vi.fn(), onBeam: vi.fn(),
    onToast: vi.fn(), onBlockLand: vi.fn(), onRingPulse: vi.fn(), onImpactGlow: vi.fn(), onAudio: vi.fn(),
    onCodexDiscover: vi.fn(), onGhostLaidToRest: vi.fn(),
  } as unknown as GameCallbacks & { logs: string[]; captured: () => Captured };
}

const npc = (id: string): import('../types').NpcDef => NPCS.find(n => n.id === id)!;

describe('NpcEncounters', () => {
  let cb: ReturnType<typeof makeCallbacks>;
  let game: Game;

  beforeEach(() => {
    cb = makeCallbacks();
    game = new Game(cb);
    game.dungeonLevel = 5;
  });

  it('a bounty NPC opens a vengeance contract and swearing it records the quest', () => {
    const aoife = npc('aoife');
    expect(aoife.kind).toBe('bounty');
    game.npcEncounters.triggerEncounter(aoife);
    const c = cb.captured()!;
    expect(c.event.title).toBe(aoife.name);
    // option 0 = swear vengeance
    c.onChoice(0);
    expect(game.activeBountyQuest).not.toBeNull();
    expect(game.activeBountyQuest!.floor % 5).toBe(0);   // a boss floor
    expect(game.storyBeats.some(b => b.startsWith('swore vengeance'))).toBe(true);
  });

  it('declining a bounty leaves no quest', () => {
    game.npcEncounters.triggerEncounter(npc('aoife'));
    cb.captured()!.onChoice(1);  // "Not now"
    expect(game.activeBountyQuest).toBeNull();
  });

  it('a trade NPC with no boons still opens a real dialog (nothing to trade)', () => {
    expect(game.player.boons.length).toBe(0);
    game.npcEncounters.triggerEncounter(npc('fomorian_tinker'));
    const c = cb.captured()!;
    expect(c.event.flavor).toMatch(/nothing worth trading|gathered some/i);
    expect(c.event.options.length).toBe(1);
  });

  it('a trade NPC swaps a held boon for a tier-3 one', () => {
    const owned = Boon.BY_TIER[1][0]!;
    game.player.addBoon(owned);
    const before = game.player.boons[0]!.def.id;
    game.npcEncounters.triggerEncounter(npc('fomorian_tinker'));
    const c = cb.captured()!;
    c.onChoice(0);  // give up the first boon
    // the surrendered boon is gone; a replacement was granted
    expect(game.player.boons.some(b => b.def.id === before)).toBe(false);
    expect(game.player.boons.length).toBeGreaterThanOrEqual(1);
    expect(game.storyBeats.some(b => b.includes('Fomorian tinker'))).toBe(true);
  });

  it('a flavor NPC records the meeting so a return line can differ next time', () => {
    const teller = npc('fionnuala');
    game.npcEncounters.triggerEncounter(teller);
    expect(game.metFlavorNpcIds.has('fionnuala')).toBe(true);
    expect(cb.captured()!.event.options.length).toBe(1);  // just "Farewell"
  });

  it('the seanchaí chains into a second "your tale" dialog and never departs', () => {
    game.storyBeats.push('slew a rat', 'lit the fires of Bealtaine');
    game.npcEncounters.triggerSeanchai();
    const first = cb.captured()!;
    expect(first.event.title).toBe(npc('seanchai').name);
    first.onChoice(0);  // "Ask for your own tale"
    const tale = cb.captured()!;
    expect(tale.event.id).toBe('__seanchai_tale__');
    expect(tale.event.flavor).toContain('floor');   // the run recap
    // resident stays on the board
    expect(game.storyBeats).toContain('heard your own tale by the mound-fire');
  });

  it('triggerGhost with no active ghost is a no-op that still calls back', () => {
    const onClosed = vi.fn();
    game.activeGhost = null;
    game.npcEncounters.triggerGhost(onClosed);
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(cb.captured()).toBeNull();
  });

  it('laying a ghost to rest grants a boon and removes it from the ghost file', () => {
    const ghost: GhostRecord = { id: 'g1', playerLevel: 3, floor: 4, classId: 'draoi', cause: 'slain by a rat', date: '2026-01-01' };
    game.activeGhost = ghost;
    game.availableGhosts = [ghost];
    const before = game.player.boons.length;
    game.npcEncounters.triggerGhost();
    const c = cb.captured()!;
    expect(c.event.title).toBe('A Ghost of Yourself');
    c.onChoice(0);  // lay to rest
    expect(game.player.boons.length).toBe(before + 1);
    expect(game.availableGhosts.some(g => g.id === 'g1')).toBe(false);
    expect(cb.onGhostLaidToRest).toHaveBeenCalledWith('g1');
  });

  it('turning a ghost away keeps it in the file for a later meeting', () => {
    const ghost: GhostRecord = { id: 'g2', playerLevel: 2, floor: 3, classId: null, cause: 'fell', date: 'x' };
    game.activeGhost = ghost;
    game.availableGhosts = [ghost];
    game.npcEncounters.triggerGhost();
    cb.captured()!.onChoice(1);  // turn away
    expect(game.availableGhosts.some(g => g.id === 'g2')).toBe(true);
  });
});
