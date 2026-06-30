/**
 * Slot-key string-literal unions for IResultSlots.
 *
 * Extracted from PipelineContextFactory.ts so prettier's natural
 * one-key-per-line wrap of the full ResultSlotKey union does not
 * push the factory file past its max-lines budget, AND so each
 * group (phase-state, discovery, phase-emit, balance) has a named
 * type that can be re-used by Pick<IResultSlots, ...> aliases
 * instead of duplicating the literal lists.
 */

/** Phase-state slot keys (top-level phase outcomes). */
export type PhaseStateSlotKey = 'login' | 'dashboard' | 'scrape' | 'api';

/** Discovery slot keys (intermediate findings consumed by later phases). */
export type DiscoverySlotKey =
  | 'preLoginDiscovery'
  | 'loginFieldDiscovery'
  | 'scrapeDiscovery'
  | 'accountDiscovery'
  | 'txnEndpoint'
  | 'dashboardTxnHarvest';

/** Phase-emit slot keys (M1/M4 sealed phases — auth-discovery / otp-trigger / otp-fill). */
export type PhaseEmitSlotKey = 'authDiscovery' | 'otpTrigger' | 'otpFill';

/** Balance-pipeline slot keys (multi-stage balance resolution). */
export type BalanceSlotKey =
  | 'balanceAccountIdentities'
  | 'balanceFetchPlan'
  | 'balanceResponsesByBankAccount'
  | 'balanceExtracted'
  | 'balanceValidation'
  | 'balanceResolution';

/** Union of every result-slot key — single source of truth for IResultSlots. */
export type ResultSlotKey =
  PhaseStateSlotKey | DiscoverySlotKey | PhaseEmitSlotKey | BalanceSlotKey;
