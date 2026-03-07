import type { Browser } from 'playwright';

/**
 * Launch a Camoufox browser (Firefox with C++-level anti-detect stealth).
 * Uses dynamic import() because @hieutran094/camoufox-js is ESM-only.
 */
export async function launchCamoufox(headless: boolean): Promise<Browser> {
  const camoufoxModule = await import('@hieutran094/camoufox-js');
  return camoufoxModule.Camoufox({ headless, locale: 'he-IL' }) as unknown as Browser;
}
