/**
 * Re-export shim — the logger cluster moved to
 * {@link ../Logging/Debug.ts} in Phase 12c. New code should import
 * directly from `'../Logging/Debug.js'`. This shim preserves the
 * existing `'../Types/Debug.js'` import path for one release window
 * so the 110-fan-in migration can land in follow-up commits without
 * a giant import-sweep PR.
 *
 * @deprecated Import from `'../Logging/Debug.js'` instead. The shim
 *   will be removed once all callers migrate.
 */

export {
  capTimeout,
  getActiveLogContext,
  getDebug,
  getDebugByName,
  isMockTimingActive,
  MOCK_TIMEOUT_MS,
  runWithBankContext,
  type ScraperLogger,
} from '../Logging/Debug.js';
