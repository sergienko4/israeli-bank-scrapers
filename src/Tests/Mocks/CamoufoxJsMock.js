// Jest CJS shim for @hieutran094/camoufox-js (ESM-only, uses import.meta).
// Launches the real Camoufox binary via playwright-core firefox.launch().
// Production code uses the ESM module directly via dynamic import().
const { firefox } = require('playwright-core');
const path = require('path');
const os = require('os');
const fs = require('fs');

function findCamoufoxBinary() {
  const cacheDir = path.join(os.homedir(), 'AppData', 'Local', 'camoufox');
  const exe = path.join(cacheDir, 'camoufox', 'Cache', 'camoufox.exe');
  if (fs.existsSync(exe)) return exe;
  // Linux/Mac fallback
  const linBin = path.join(cacheDir, 'camoufox-bin');
  if (fs.existsSync(linBin)) return linBin;
  return null;
}

module.exports = {
  async Camoufox(opts = {}) {
    const executablePath = findCamoufoxBinary();
    if (!executablePath) {
      throw new Error('Camoufox binary not found — run: npx camoufox fetch');
    }
    return firefox.launch({
      executablePath,
      headless: opts.headless ?? true,
    });
  },
};
