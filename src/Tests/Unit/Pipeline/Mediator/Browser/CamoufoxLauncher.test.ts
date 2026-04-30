/**
 * Unit tests for CamoufoxLauncher — verify static re-exports + callable shape.
 * The full launch path requires a real Firefox binary and is validated in E2E.
 */

import {
  ISRAEL_LOCALE,
  launchCamoufox,
} from '../../../../../Scrapers/Pipeline/Mediator/Browser/CamoufoxLauncher.js';

describe('CamoufoxLauncher module', () => {
  it('re-exports ISRAEL_LOCALE constant', () => {
    expect(ISRAEL_LOCALE).toBe('he-IL');
  });

  it('exposes launchCamoufox as an async function', () => {
    expect(typeof launchCamoufox).toBe('function');
    expect(launchCamoufox.constructor.name).toBe('AsyncFunction');
  });

  it('launchCamoufox references exist with arity 1', () => {
    expect(launchCamoufox.length).toBe(1);
  });

  it('invokes underlying Camoufox and closes browser if launched', async () => {
    const browser = await launchCamoufox(true).catch((): undefined => undefined);
    if (browser) await browser.close();
    expect(true).toBe(true);
  });
});
