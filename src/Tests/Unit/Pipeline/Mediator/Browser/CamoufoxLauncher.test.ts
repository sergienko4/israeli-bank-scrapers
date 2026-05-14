/**
 * Unit tests for CamoufoxLauncher — verify static re-exports + callable shape.
 *
 * <p>The full launch path requires a real Firefox/Camoufox binary and
 * is validated in `src/Tests/E2eMocked/CamoufoxLaunch.e2e-mocked.test.ts`.
 * This file stays pure-unit: no OS process, no host-state dependency,
 * deterministic and instantaneous.
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
});
