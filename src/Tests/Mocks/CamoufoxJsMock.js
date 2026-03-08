// Jest ESM shim for @hieutran094/camoufox-js (ESM-only, uses import.meta).
// Launches the real Camoufox binary via playwright-core firefox.launch().
// Production code uses the ESM module directly via dynamic import().
import fs from 'fs';
import os from 'os';
import path from 'path';
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

export async function Camoufox(opts = {}) {
  const executablePath = findCamoufoxBinary();
  if (!executablePath) {
    throw new Error('Camoufox binary not found — run: npx camoufox fetch');
  }
  return firefox.launch({
    executablePath,
    headless: opts.headless ?? true,
  });
}

export default { Camoufox };
