import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Game } from '../game';
import { RESCUES } from '../content';
import { Balance } from '../balance';
import type { GameCallbacks, LogClass, FloorEventDef, ShopItem, BoonDef } from '../types';

type Reroll = { run: () => { choices: BoonDef[]; gold: number; cost: number } | null };
type Shop = { stock: ShopItem[]; buy: (id: string) => { gold: number; ok: boolean } } | null;
type Altar = { tier: number; choices: BoonDef[]; commit: (i: number) => void; ctx: Reroll } | null;
type Tattoo = { choices: BoonDef[]; commit: (i: number) => void; ctx: Reroll } | null;
type Ev = { event: FloorEventDef; onChoice: (i: number) => void } | null;

function makeCallbacks(): GameCallbacks & { logs: string[]; shop: () => Shop; altar: () => Altar; tattoo: () => Tattoo; ev: () => Ev } {
  const logs: string[] = [];
  let shop: Shop = null, altar: Altar = null, tattoo: Tattoo = null, ev: Ev = null;
  return {
    logs, shop: () => shop, altar: () => altar, tattoo: () => tattoo, ev: () => ev,
    log: (t: string, _c: LogClass) => { logs.push(t); },
    onOpenShop: (stock: ShopItem[], _gold: number, buy: (id: string) => { gold: number; ok: boolean }) => { shop = { stock, buy }; },
    onOpenAltar: (tier: number, choices: BoonDef[], commit: (i: number) => void, ctx: Reroll) => { altar = { tier, choices, commit, ctx }; },
    onOpenTattooArtist: (choices: BoonDef[], commit: (i: number) => void, ctx: Reroll) => { tattoo = { choices, commit, ctx }; },
    onFloorEvent: (event: FloorEventDef, onChoice: (i: number) => void) => { ev = { event, onChoice }; },
    updateUI: vi.fn(), onDeath: vi.fn(), onParticle: vi.fn(), onParticleBurst: vi.fn(),
    onLevelUp: vi.fn(), onVictory: vi.fn(),
    onBossWarning: (_b: unknown, done: () => void) => done(), onAction: vi.fn(), onBeam: vi.fn(),
    onToast: vi.fn(), onBlockLand: vi.fn(), onRingPulse: vi.fn(), onImpactGlow: vi.fn(), onAudio: vi.fn(),
    onCodexDiscover: vi.fn(),
  } as unknown as GameCallbacks & { logs: string[]; shop: () => Shop; altar: () => Altar; tattoo: () => Tattoo; ev: () => Ev };
}

const rescue = (id: string): import('../types').RescueDef => RESCUES.find(r => r.id === id)!;

describe('VendorOffers', () => {
  let cb: ReturnType<typeof makeCallbacks>;
  let game: Game;
  beforeEach(() => { cb = makeCallbacks(); game = new Game(cb); game.dungeonLevel = 5; });

  describe('the Fear Dearg peddler', () => {
    it('sells a full heal, and the same item cannot be bought twice', () => {
      game.gold = 100000;
      game.player.hp = 1;
      game.openPeddler();
      const shop = cb.shop()!;
      const first = shop.buy('heal');
      expect(first.ok).toBe(true);
      expect(game.player.hp).toBe(game.player.maxHp);
      expect(shop.buy('heal').ok).toBe(false);   // already purchased this visit
    });

    it('a buy the hero cannot afford is refused and costs nothing', () => {
      game.gold = 0;
      game.openPeddler();
      const before = game.player.atk;
      const res = cb.shop()!.buy('atk');
      expect(res.ok).toBe(false);
      expect(game.player.atk).toBe(before);
      expect(game.gold).toBe(0);
    });

    it('the Deathward Sigil grants a survive-one-hit charge', () => {
      game.gold = 100000;
      const before = game.player.deathwardCharges;
      game.openPeddler();
      cb.shop()!.buy('ward');
      expect(game.player.deathwardCharges).toBe(before + 1);
    });
  });

  describe('the altar', () => {
    it('committing a choice adds that boon', () => {
      game.vendorOffers.altar(3);
      const altar = cb.altar()!;
      expect(altar.tier).toBe(3);
      const chosen = altar.choices[0]!;
      altar.commit(0);
      expect(game.player.boons.some(b => b.def.id === chosen.id)).toBe(true);
      expect(game.paused).toBe(false);   // dialog closed
    });

    it('rerolling spends gold and returns a fresh set; a broke hero cannot reroll', () => {
      game.gold = 100000;
      game.vendorOffers.altar(2);
      const goldBefore = game.gold;
      const res = cb.altar()!.ctx.run();
      expect(res).not.toBeNull();
      expect(game.gold).toBeLessThan(goldBefore);

      game.gold = 0;
      game.vendorOffers.altar(2);
      expect(cb.altar()!.ctx.run()).toBeNull();   // no gold → no reroll
    });
  });

  describe('the tattoo artist', () => {
    it('committing a mark adds an Ogham brand', () => {
      const before = game.player.brands.length;
      game.vendorOffers.tattooArtist();
      cb.tattoo()!.commit(0);
      expect(game.player.brands.length).toBe(before + 1);
    });

    it('rerolling the marks costs gold when affordable', () => {
      game.gold = 100000;
      game.vendorOffers.tattooArtist();
      const goldBefore = game.gold;
      const res = cb.tattoo()!.ctx.run();
      expect(res).not.toBeNull();
      expect(game.gold).toBeLessThan(goldBefore);
    });
  });

  describe('rescue services', () => {
    it('the Gobán Saor (wright) sets your next falling stone to the chosen shape', () => {
      game.vendorOffers.rescueService(rescue('goban'));
      const ev = cb.ev()!;
      // options are the 7 shapes then "No need"; pick the first (the I-stone)
      ev.onChoice(0);
      expect(game.nextType).toBe('I');
    });

    it("Bé Chuille (seer) only reads the floors ahead — a single dismissable line", () => {
      game.vendorOffers.rescueService(rescue('bechuille'));
      const ev = cb.ev()!;
      expect(ev.event.options).toHaveLength(1);
      ev.onChoice(0);
      expect(game.paused).toBe(false);
    });

    it('Airmed (healer) turns carried herbs into permanent Max HP and empties the satchel', () => {
      game.herbsCarried = 1;
      const before = game.player.maxHp;
      game.vendorOffers.rescueService(rescue('airmed'));
      cb.ev()!.onChoice(0);   // give her the herbs
      expect(game.player.maxHp).toBeGreaterThan(before);
      expect(game.herbsCarried).toBe(0);
    });

    it('Airmed with no herbs offers only a dismissable line and leaves Max HP unchanged', () => {
      game.herbsCarried = 0;
      const before = game.player.maxHp;
      game.vendorOffers.rescueService(rescue('airmed'));
      const ev = cb.ev()!;
      expect(ev.event.options).toHaveLength(1);
      ev.onChoice(0);
      expect(game.player.maxHp).toBe(before);
    });

    it('Abcán (harper) queues the suantraí for the next floor', () => {
      game.vendorOffers.rescueService(rescue('abcan'));
      cb.ev()!.onChoice(0);   // ask for the suantraí
      expect(game.harperLullFloor).toBe(game.dungeonLevel + 1);
    });

    it("Nuada (cook) pours the king's draught — +ATK until next descent", () => {
      const before = game.player.atk;
      game.vendorOffers.rescueService(rescue('nuada'));
      cb.ev()!.onChoice(0);   // drink the draught
      expect(game.portionAtkBonus).toBeGreaterThan(0);
      expect(game.player.atk).toBe(before + game.portionAtkBonus);
    });

    it("Nuada offers nothing a second time (the cup answers once per descent)", () => {
      game.vendorOffers.rescueService(rescue('nuada'));
      cb.ev()!.onChoice(0);
      const atkAfterFirst = game.player.atk;
      game.vendorOffers.rescueService(rescue('nuada'));
      const ev = cb.ev()!;
      expect(ev.event.flavor).toMatch(/answers once|only ale/i);
      ev.onChoice(0);
      expect(game.player.atk).toBe(atkAfterFirst);   // no second cup
    });

    it('Eithne (fate) trades the active Rift Curse for another, lifting the old one first', () => {
      game.applyModifier('glass_cannon');           // +8 ATK, −15 Max HP
      const atkUnderCurse = game.player.atk;
      game.vendorOffers.rescueService(rescue('eithne'));
      const ev = cb.ev()!;
      expect(ev.event.options.length).toBeGreaterThan(1);   // 2 swaps + "keep what I carry"
      ev.onChoice(0);
      expect(game.activeModifierId).not.toBe('glass_cannon');
      expect(game.player.atk).not.toBe(atkUnderCurse);      // Glass Cannon's +8 was lifted
      expect(game.player.hp).toBeLessThanOrEqual(game.player.maxHp);
    });

    it('Eithne has nothing to turn when no Rift Curse rides the hero', () => {
      game.activeModifierId = null;
      game.vendorOffers.rescueService(rescue('eithne'));
      const ev = cb.ev()!;
      expect(ev.event.options).toHaveLength(1);
      ev.onChoice(0);
      expect(game.activeModifierId).toBeNull();
    });

    it('Dian Cécht (physician) heals in full and grants a deathward — but only one at a time', () => {
      game.player.hp = 1;
      game.player.deathwardCharges = 0;
      game.vendorOffers.rescueService(rescue('diancecht'));
      cb.ev()!.onChoice(0);   // kneel for the incantation
      expect(game.player.hp).toBe(game.player.maxHp);
      expect(game.player.deathwardCharges).toBe(1);
      // Warded already: the offer collapses to a single dismissable line.
      game.vendorOffers.rescueService(rescue('diancecht'));
      const second = cb.ev()!;
      expect(second.event.options).toHaveLength(1);
      second.onChoice(0);
      expect(game.player.deathwardCharges).toBe(1);
    });

    it('Midir (gambler) takes the stake up front and opens a fidchell match', () => {
      const stake = Balance.CONFIG.rescues.wagerStake;
      game.gold = stake + 25;
      game.vendorOffers.rescueService(rescue('midir'));
      cb.ev()!.onChoice(0);   // play him
      expect(game.gold).toBe(25);
      expect(game.inFidchell).toBe(true);
    });

    it('Midir will not play a hero who cannot cover the stake', () => {
      game.gold = Balance.CONFIG.rescues.wagerStake - 1;
      game.vendorOffers.rescueService(rescue('midir'));
      const ev = cb.ev()!;
      expect(ev.event.options).toHaveLength(1);
      ev.onChoice(0);
      expect(game.inFidchell).toBe(false);
    });
  });
});
