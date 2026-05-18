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
  const display = `:${Math.floor(Math.random() * 100) + 99}`;
  const args = [display, '-screen', '0', '1920x1080x24', '-ac', '-nolisten', 'tcp'];
  const proc = spawn(xvfb, args, { stdio: 'ignore', detached: true });
  return { display, proc };
}

function resolveLaunchArgs(headlessOpt) {
  if (headlessOpt !== 'virtual') return { headless: headlessOpt ?? true, env: undefined };
  if (process.platform !== 'linux') return { headless: true, env: undefined };
  const vd = spawnVirtualDisplay();
  if (!vd) return { headless: true, env: undefined };
  return { headless: false, env: { ...process.env, DISPLAY: vd.display } };
}

export async function Camoufox(opts = {}) {
  const executablePath = findCamoufoxBinary();
  if (!executablePath) {
    throw new Error('Camoufox binary not found — run: npx camoufox fetch');
  }
  const { headless, env } = resolveLaunchArgs(opts.headless);
  return firefox.launch({ executablePath, headless, env });
}

export default { Camoufox };
