// Jest ESM shim for @hieutran094/camoufox-js (ESM-only, uses import.meta).
// Launches the real Camoufox binary via playwright-core firefox.launch().
// Production code uses the ESM module directly via dynamic import().
//
// `headless: 'virtual'` mode mirrors what camoufox-js does at runtime
// — spawn Xvfb, set $DISPLAY, then launch with headless: false. Falls
// back to `headless: true` if Xvfb isn't installed (e.g. Docker image
// without xvfb apt package). Production CI gets the real virtual-display
// anti-detect benefit; non-Linux test hosts silently use raw boolean.
import { execFileSync, spawn } from 'node:child_process';
import { randomInt } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { firefox } from 'playwright-core';

function findCamoufoxBinary() {
  const home = os.homedir();
  const candidates = [
    // Windows
    path.join(home, 'AppData', 'Local', 'camoufox', 'camoufox', 'Cache', 'camoufox.exe'),
    // Linux (pip/appdirs style)
    path.join(home, '.cache', 'camoufox', 'camoufox', 'camoufox-bin'),
    // Linux (flat)
    path.join(home, '.cache', 'camoufox', 'camoufox-bin'),
    // Mac
    path.join(home, 'Library', 'Caches', 'camoufox', 'camoufox', 'Contents', 'MacOS', 'camoufox'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function findXvfbBinary() {
  try {
    const out = execFileSync('which', ['Xvfb'], { stdio: ['ignore', 'pipe', 'ignore'] });
    const trimmed = out.toString().trim();
    return trimmed && fs.existsSync(trimmed) ? trimmed : null;
  } catch {
    return null;
  }
}

function spawnVirtualDisplay() {
  const xvfb = findXvfbBinary();
  if (!xvfb) return null;
  // `randomInt(min, max)` is [min, max); 99..199 inclusive matches the
  // prior `Math.floor(Math.random() * 100) + 99` range and satisfies
  // the project's no-Math.random architecture rule.
  const display = `:${randomInt(99, 199)}`;
  const args = [display, '-screen', '0', '1920x1080x24', '-ac', '-nolisten', 'tcp'];
  const proc = spawn(xvfb, args, { stdio: 'ignore', detached: true });
  // Detach the parent's reference to the child's event loop handle so
  // the Jest test process can exit even if Xvfb is still running.
  // Without `.unref()` the parent waits for the child to exit and
  // Jest hangs at the end of the run — `--forceExit` would hide this
  // but the right fix is to release the handle (CodeRabbit F9).
  proc.unref();
  return { display, proc };
}

function resolveLaunchArgs(headlessOpt) {
  if (headlessOpt !== 'virtual') return { headless: headlessOpt ?? true, env: undefined };
  if (process.platform !== 'linux') return { headless: true, env: undefined };
  const vd = spawnVirtualDisplay();
  if (!vd) return { headless: true, env: undefined };
  return { headless: false, env: { ...process.env, DISPLAY: vd.display } };
}

/**
 * Whitelist of Camoufox launch-option keys that map cleanly to
 * Playwright's launch / launchPersistentContext options. Camoufox-
 * specific knobs (`humanize`, `disable_coop`, `os`, `screen`, `window`,
 * `user_data_dir`, etc.) are intentionally NOT forwarded — the mock
 * is a lightweight shim, not a stealth replica.
 */
const FORWARDED_LAUNCH_KEYS = new Set(['timezoneId', 'locale', 'viewport', 'javaScriptEnabled']);

function pickForwardedOptions(opts) {
  const out = {};
  for (const key of Object.keys(opts)) {
    if (FORWARDED_LAUNCH_KEYS.has(key)) out[key] = opts[key];
  }
  return out;
}

export async function Camoufox(opts = {}) {
  const executablePath = findCamoufoxBinary();
  if (!executablePath) {
    throw new Error('Camoufox binary not found — run: npx camoufox fetch');
  }
  const { headless, env } = resolveLaunchArgs(opts.headless);
  const launchBase = { executablePath, headless, env };
  if (typeof opts.user_data_dir === 'string') {
    const contextOpts = { ...launchBase, ...pickForwardedOptions(opts) };
    return firefox.launchPersistentContext(opts.user_data_dir, contextOpts);
  }
  return firefox.launch(launchBase);
}

export default { Camoufox };
