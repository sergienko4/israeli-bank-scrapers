// Jest ESM shim for @hieutran094/camoufox-js (ESM-only, uses import.meta).
// Default: launches the real Camoufox binary via playwright-core firefox.launch().
// Fake-page-eval mode: returns a fake Browser whose page.evaluate(fn, args)
// invokes fn(args) directly in Node — used by E2eMocked tests that mock
// globalThis.fetch and need the strategy's page.evaluate callback to run
// against that mock instead of a real browser network stack.
// Production code uses the ESM module directly via dynamic import().
import fs from 'fs';
import os from 'os';
import path from 'path';
import { firefox } from 'playwright-core';

let FAKE_PAGE_EVAL_MODE = false;

/**
 * Toggle fake-page-eval mode. Default off so existing E2eMocked tests
 * (non-headless banks) keep using real Firefox launches.
 * @param {boolean} enabled - True to enable fake mode; false to restore default.
 * @returns {boolean} The new mode.
 */
export function setFakePageEvalMode(enabled) {
  FAKE_PAGE_EVAL_MODE = !!enabled;
  return FAKE_PAGE_EVAL_MODE;
}

/**
 * Build a fake Browser tree whose page.evaluate(fn, args) runs fn(args) in
 * Node. The strategy is exercised end-to-end — only the network stack is
 * simulated by the test's globalThis.fetch.
 * @returns {object} Fake Browser exposing newContext + close.
 */
function buildFakeBrowser() {
  const goto = () => Promise.resolve(null);
  const evaluateFn = async (fn, args) => {
    if (typeof fn !== 'function') return null;
    return fn(args);
  };
  const page = { goto, evaluate: evaluateFn };
  const newPage = () => Promise.resolve(page);
  const newContext = () => Promise.resolve({ newPage });
  const close = () => Promise.resolve();
  return { newContext, close };
}

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

export async function Camoufox(opts = {}) {
  if (FAKE_PAGE_EVAL_MODE) return buildFakeBrowser();
  const executablePath = findCamoufoxBinary();
  if (!executablePath) {
    throw new Error('Camoufox binary not found — run: npx camoufox fetch');
  }
  return firefox.launch({
    executablePath,
    headless: opts.headless ?? true,
  });
}

export default { Camoufox, setFakePageEvalMode };
