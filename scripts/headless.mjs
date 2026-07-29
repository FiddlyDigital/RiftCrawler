/**
 * Headless simulation harness.
 *
 * Boots a real `Game` in plain Node — no DOM, no canvas, no localStorage — and
 * plays it for a fixed number of turns with stub callbacks and injected ports.
 * This is the runtime half of the sim/host boundary guard: the lint rule in
 * .oxlintrc.json stops the simulation *importing* the host layer, and this
 * proves the simulation actually *runs* without one.
 *
 * If this script starts failing, the simulation has grown a browser dependency.
 *
 *   npm run headless            # 1500 turns, quiet
 *   npm run headless -- 2000 -v # more turns, print the log
 */

const turns = Number(process.argv[2]) || 1500;
const verbose = process.argv.includes('-v');

// Bundle the simulation with Vite's SSR build (no browser env involved) and
// import it straight from memory — the sim is TypeScript with extensionless
// specifiers and JSON imports, so it needs a bundler pass either way.
const { build } = await import('vite');
const result = await build({
  configFile: false,
  logLevel: 'silent',
  build: {
    write: false,
    minify: false,
    ssr: true,
    rollupOptions: { input: 'src/game.ts', output: { format: 'es' } },
  },
});
const chunk = [result].flat()[0].output.find(o => o.type === 'chunk');

// Only NOW arm the browser-global traps: the bundler itself legitimately reads
// `navigator`. Everything past this point is the simulation.
for (const name of ['document', 'window', 'localStorage', 'navigator', 'requestAnimationFrame']) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get() { throw new Error(`headless: simulation touched browser global "${name}"`); },
  });
}
const mod = await import(`data:text/javascript;base64,${Buffer.from(chunk.code).toString('base64')}`);
const { Game } = mod;

// ── Stub host ────────────────────────────────────────────────────────────────
const log = [];
const noop = () => {};
const callbacks = {
  log: (text) => { log.push(text); if (verbose) console.log('  ', text); },
  updateUI: noop,
  onAction: noop,
  onParticle: noop,
  onParticleBurst: noop,
  onImpactGlow: noop,
  onRowClear: noop,
  onHardDrop: noop,
  onMonsterDeath: noop,
  onHitStop: noop,
  onRingPulse: noop,
  onBeam: noop,
  onToast: noop,
  onAudio: noop,
  onBlockLand: noop,
  onCombo: noop,
  onCodexDiscover: noop,
  onCrash: noop,
  onCodexOpen: noop,
  onDeath: (title, reason) => { log.push(`DEATH: ${title} — ${reason}`); },
  onVictory: () => { log.push('VICTORY'); },
  onLevelUp: (_choices, onChoice) => onChoice(0),
  onBossWarning: (_b, done) => done(),
  // Any modal the run opens is answered with the first option so play continues.
  onFloorEvent: (_event, onChoice) => onChoice(0),
  onOpenAltar: (_tier, _choices, commit) => commit(0),
  onOpenTattooArtist: (_choices, commit) => commit(0),
  onOpenShop: (_stock, _gold, _buy, close) => close(),
};

// In-memory clock and stash: the two injected ports.
let clock = 10_000;
let game;
try {
  game = new Game(callbacks, { now: () => (clock += 16) });
} catch (err) {
  // Keep the trap message readable — the bundled module's data: URL makes for
  // an unreadable stack trace.
  console.error(`\n✗ ${err.message}`);
  console.error('  The simulation must not depend on browser globals. Reach the');
  console.error('  host through GameCallbacks or an injected port (see StashPort).');
  process.exit(1);
}

// ── Play ─────────────────────────────────────────────────────────────────────
// Weighted toward laying stone, so a run actually builds floors and clears
// lines rather than wandering the hero into the first monster it meets.
const MOVES = [
  ...Array(3).fill(() => game.handleBlockLeft()),
  ...Array(3).fill(() => game.handleBlockRight()),
  ...Array(2).fill(() => game.handleBlockRotate()),
  ...Array(6).fill(() => game.handleBlockDrop()),
  () => game.handleBlockSoftDrop(),
  () => game.handleHeroMove(1, 0),
  () => game.handleHeroMove(-1, 0),
  () => game.handleHeroMove(0, 1),
  () => game.handleHeroMove(0, -1),
  () => game.handleHeroWait(),
];

// Deterministic PRNG so a failure is reproducible.
let seed = 1234567;
const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

let acted = 0;
for (let i = 0; i < turns && game.active; i++) {
  const move = MOVES[Math.floor(rand() * MOVES.length)];
  try {
    move();
    acted++;
  } catch (err) {
    console.error(`\n✗ turn ${i} threw:`, err);
    process.exit(1);
  }
}

// ── Save/restore round-trip ──────────────────────────────────────────────────
// Exercises SaveGame end to end (including that the injected ports are skipped
// rather than serialized) with no storage API in sight.
const snapshot = game.serialize();
const json = JSON.stringify(snapshot);
const restored = new Game(callbacks, { forRestore: true, now: () => clock });
restored.applySave(JSON.parse(json));
const mismatches = [];
for (const [k, v] of Object.entries({
  dungeonLevel: game.dungeonLevel,
  gold: game.gold,
  linesCleared: game.linesCleared,
  monstersKilled: game.monstersKilled,
  currentType: game.currentType,
})) {
  if (restored[k] !== v) mismatches.push(`${k}: ${restored[k]} !== ${v}`);
}
if (typeof restored.stash?.load !== 'function') mismatches.push('stash port was clobbered by restore');
if (typeof restored.now !== 'function' && restored.now !== undefined) mismatches.push('clock port was clobbered by restore');
if (mismatches.length > 0) {
  console.error('✗ save/restore round-trip mismatched:\n  ' + mismatches.join('\n  '));
  process.exit(1);
}

// ── Report ───────────────────────────────────────────────────────────────────
const roundTripped = json.length;

console.log('HEADLESS SIM OK');
console.log(`  turns played .... ${acted}`);
console.log(`  floor ........... ${game.dungeonLevel}`);
console.log(`  hero ............ lv${game.player.playerLevel}  hp ${Math.round(game.player.hp)}/${Math.round(game.player.maxHp)}`);
console.log(`  gold ............ ${game.gold}`);
console.log(`  monsters slain .. ${game.monstersKilled}`);
console.log(`  lines cleared ... ${game.linesCleared}`);
console.log(`  log lines ....... ${log.length}`);
console.log(`  save snapshot ... ${roundTripped} bytes, restored clean`);

if (acted === 0) { console.error('✗ no turns were played'); process.exit(1); }
if (log.length === 0) { console.error('✗ the run produced no log output'); process.exit(1); }
