// Boots the REAL production build in headless Chromium and plays the first
// seconds of an actual run: start screen → class pick → curse pick → block and
// hero inputs. Fails (exit 1) on any uncaught page error, a crash modal, or
// the game visibly not responding — the last gate before a deploy goes live.
//
// Usage: npm run smoke   (expects `dist/` to exist — run `npm run build` first)

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const PORT = 4173;
const url = `http://localhost:${PORT}/`;

if (!existsSync('dist/index.html')) {
  console.error('smoke: dist/ not found — run `npm run build` first.');
  process.exit(1);
}

// Serve the built app (vite preview serves dist/ statically).
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
  detached: false,
});
const stopServer = () => { try { server.kill(); } catch { /* already gone */ } };
process.on('exit', stopServer);

// Wait for the server to accept connections.
async function waitForServer(tries = 50) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`smoke: preview server never came up on :${PORT}`);
}

function fail(msg) {
  console.error(`✗ SMOKE FAILED: ${msg}`);
  stopServer();
  process.exit(1);
}

const step = (msg) => console.log(`✓ ${msg}`);

try {
  await waitForServer();
  step('preview server up');

  // The sandbox pre-installs Chromium at a fixed path; CI installs it via
  // `npx playwright install chromium` and needs no explicit path.
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH
    ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const page = await browser.newPage({ viewport: { width: 900, height: 800 } });

  const pageErrors = [];
  page.on('pageerror', err => {
    // The app itself whitelists this benign Chrome resize noise.
    if (!String(err.message).includes('ResizeObserver loop')) pageErrors.push(err.message);
  });
  // Failed asset loads (e.g. a dist built for a different base path served at
  // root) leave a blank page with no pageerror — collect them for diagnosis.
  const badResponses = [];
  page.on('response', res => {
    if (res.status() >= 400) badResponses.push(`${res.status()} ${res.url()}`);
  });

  await page.goto(url);
  try {
    await page.waitForSelector('#start-btn', { timeout: 10000 });
  } catch {
    const hints = [
      badResponses.length ? `failed requests: ${badResponses.slice(0, 5).join(', ')}` : null,
      pageErrors.length ? `page errors: ${pageErrors.slice(0, 3).join(' | ')}` : null,
      'if the dist was built with a --base path, it cannot be served at localhost root — smoke-test a plain-base build',
    ].filter(Boolean);
    fail(`start screen never rendered. ${hints.join('. ')}`);
  }
  step('start screen rendered');

  await page.click('#start-btn');
  // Class pick, then curse pick (both modals style their options .modifier-btn,
  // so scope each click to its host component).
  await page.locator('class-modal .modifier-btn').first().click({ timeout: 5000 });
  await page.waitForTimeout(300);
  await page.locator('modifier-modal .modifier-btn').first().click({ timeout: 5000 });
  await page.waitForTimeout(500);
  step('run started (class + curse chosen)');

  // The canvas is live and sized.
  const canvasBox = await page.locator('#gameCanvas').boundingBox();
  if (!canvasBox || canvasBox.height < 100) fail('game canvas missing or unsized');
  step(`canvas live (${Math.round(canvasBox.width)}x${Math.round(canvasBox.height)})`);

  // A fresh browser profile always gets the first-run tutorial, and its steps
  // advance only when the engine actually processes each input — a true
  // input -> game -> UI assertion chain.
  const tutTitle = () => page.locator('#tutorial-callout .tut-title').textContent({ timeout: 3000 });
  const expectStep = async (want, afterWhat) => {
    const title = (await tutTitle())?.trim();
    if (title !== want) fail(`after ${afterWhat}: expected tutorial step "${want}", got "${title}"`);
  };
  await expectStep('This is you', 'run start');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(250);
  await expectStep('The stone is yours too', 'hero move');
  await page.keyboard.press('j');
  await page.waitForTimeout(250);
  await expectStep('Stone becomes floor', 'block steer');
  await page.keyboard.press('k');
  await page.waitForTimeout(400);
  await expectStep('Clear rows (when you can)', 'hard drop');
  step('engine processes hero + block inputs (tutorial advanced 3 steps)');
  await page.locator('#tut-skip').click();
  await page.waitForTimeout(300);
  const calloutGone = await page.locator('#tutorial-callout').count() === 0;
  if (!calloutGone) fail('tutorial skip did not dismiss the callout');
  step('tutorial skip works');

  // No crash modal, no uncaught errors.
  const crashed = await page.evaluate(() =>
    document.querySelector('crash-modal')?.style.display === 'flex');
  if (crashed) fail('crash modal is showing');
  if (pageErrors.length > 0) fail(`uncaught page errors: ${pageErrors.join(' | ')}`);
  step('no crashes, no uncaught errors');

  await browser.close();
  stopServer();
  console.log('SMOKE PASSED');
  process.exit(0);
} catch (err) {
  fail(err?.message ?? String(err));
}
