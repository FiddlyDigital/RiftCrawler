import { describe, it, expect } from 'vitest';
import { buildNextGoal, type NextGoalInput } from '../views/nextGoal';

/** A player with nothing outstanding — every branch below opts back in explicitly. */
const base: NextGoalInput = {
  floor: 5, deepestFloor: 5,
  totalXpEarned: 100, highXp: 1000,
  codexDiscovered: 21, codexTotal: 21,
  smithsMet: 3, smithsTotal: 3, spearForged: true,
  rescuedCount: 5, rescuesTotal: 5,
  dailyStreak: 0, won: false,
};

describe('buildNextGoal', () => {
  it('rejects a null input', () => {
    expect(() => buildNextGoal(null as unknown as NextGoalInput)).toThrow(TypeError);
  });

  it('celebrates a new depth record and points one floor further', () => {
    const line = buildNextGoal({ ...base, floor: 9, deepestFloor: 7 })!;
    expect(line).toContain('9');
    expect(line).toContain('10');
  });

  it('names how many floors short of the record, singular and plural', () => {
    expect(buildNextGoal({ ...base, floor: 8, deepestFloor: 9 })).toContain('One floor short');
    expect(buildNextGoal({ ...base, floor: 7, deepestFloor: 9 })).toContain('2 floors short');
  });

  it('ignores the depth record when it is far away, and falls through', () => {
    // 6 floors short is beyond the "close" window, so a nearer goal wins.
    const line = buildNextGoal({ ...base, floor: 3, deepestFloor: 9, codexDiscovered: 19 })!;
    expect(line).toContain('codex');
  });

  it('surfaces a nearly-complete codex', () => {
    const line = buildNextGoal({ ...base, codexDiscovered: 20 })!;
    expect(line).toContain('1 codex entry');
    expect(line).toContain('20/21');
  });

  it('surfaces an unfinished Spear questline', () => {
    const line = buildNextGoal({ ...base, spearForged: false, smithsMet: 2 })!;
    expect(line).toContain('2 of 3 smiths');
  });

  it('does not mention smiths when none have been met', () => {
    const line = buildNextGoal({ ...base, spearForged: false, smithsMet: 0, rescuedCount: 2 });
    expect(line).not.toContain('smith');
  });

  it('surfaces a near-miss on the XP record', () => {
    const line = buildNextGoal({ ...base, totalXpEarned: 900, highXp: 1000 })!;
    expect(line).toContain('900');
    expect(line).toContain('1,000');
  });

  it('surfaces captives still unrescued', () => {
    const line = buildNextGoal({ ...base, rescuedCount: 2 })!;
    expect(line).toContain('3 of the 5 captives');
  });

  it('reminds about a live daily streak when nothing else is outstanding', () => {
    const line = buildNextGoal({ ...base, dailyStreak: 4 })!;
    expect(line).toContain('4');
    expect(line).toContain('tomorrow');
  });

  it('reframes around the codex and heat ladder on a victory', () => {
    expect(buildNextGoal({ ...base, won: true, codexDiscovered: 18 })).toContain('3 codex entries');
    expect(buildNextGoal({ ...base, won: true })).toContain('heat ladder');
  });

  it('returns null for a first run with nothing to chase', () => {
    expect(buildNextGoal({
      ...base, floor: 1, deepestFloor: 1, totalXpEarned: 0, highXp: 0,
      codexDiscovered: 21, codexTotal: 21, dailyStreak: 0,
    })).toBeNull();
  });

  it('falls back to naming the depth record', () => {
    const line = buildNextGoal({ ...base, floor: 2, deepestFloor: 12 })!;
    expect(line).toContain('12');
  });
});
