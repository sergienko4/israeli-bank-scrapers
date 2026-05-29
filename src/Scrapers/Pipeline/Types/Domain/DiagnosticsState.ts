import type { Option } from '../Option.js';
import type { ApiStrategyKind } from './ApiStrategy.js';
import type { IResolvedTarget } from './PreLoginTypes.js';

/** Diagnostics state — tracks timing and breadcrumbs. */
interface IDiagnosticsState {
  readonly loginUrl: string;
  readonly finalUrl: Option<string>;
  readonly loginStartMs: number;
  readonly fetchStartMs: Option<number>;
  readonly lastAction: string;
  readonly pageTitle: Option<string>;
  readonly warnings: readonly string[];
  /** Target URL extracted in DASHBOARD.PRE for navigation. */
  readonly dashboardTargetUrl?: string;
  /** Pre-resolved single click target from DASHBOARD.PRE (IDENTITY-based
   *  race winner of `resolveVisible` against `WK_DASHBOARD.TRANSACTIONS`).
   *  ACTION clicks this FIRST (HEAD behaviour — proven winner). Only when
   *  this fails to trigger a txn signal does ACTION fall back to iterating
   *  `dashboardFallbackSelector`'s `.nth(0..count-1)`. */
  readonly dashboardTarget?: IResolvedTarget;
  /** Generic-selector fallback string (e.g. `[aria-label="..."]` or
   *  `text=...`) used by ACTION ONLY when the identity click yields no
   *  success signal — covers Beinleumi pm.mataf vs pm.q077 (same
   *  aria-label, different elements). */
  readonly dashboardFallbackSelector?: string;
  /** Number of DOM matches for `dashboardFallbackSelector` in the winning
   *  frame. ≥1 when `dashboardTarget` set; 0 otherwise. ACTION iterates
   *  `.nth(0..count-1)` after identity click failed. */
  readonly dashboardCandidateCount?: number;
  /** Pre-resolved menu toggle target for SEQUENTIAL dashboard nav. */
  readonly dashboardMenuTarget?: IResolvedTarget;
  /** Whether txn traffic already exists from login redirect — skip click if true. */
  readonly dashboardTrafficExists?: boolean;
  /** Auth token discovered from iframe sessionStorage in DASHBOARD.FINAL. */
  readonly discoveredAuth?: string | false;
  /** How the login form was submitted — used by POST to decide validation. */
  readonly submitMethod?: 'enter' | 'click' | 'both';
  /** API strategy discovered in LOGIN.FINAL — single value (DIRECT) post .ashx removal. */
  readonly apiStrategy?: ApiStrategyKind;
  /**
   * URL captured at OTP-TRIGGER.PRE entry — Mission M4.F1 baton.
   * OTP-TRIGGER.FINAL reads this to build its own slim emit's
   * `urlBeforeSubmit` field. Empty / absent ⇒ OTP-TRIGGER did not
   * run (test paths or non-OTP banks).
   */
  readonly otpTriggerPreUrl?: string;
  /**
   * ACTION timestamp (epoch-ms) used by OTP-TRIGGER.POST to scope
   * network ACKs to the post-click window. Absent ⇒ POST treats every
   * capture as a candidate (permissive default for test paths that
   * don't run the full ACTION → POST sequence).
   */
  readonly triggerClickedAt?: number;
  /**
   * POST validation outcome for the OTP trigger's scope-bound effect.
   * `true` when either the trigger target disappeared or a 2xx auth-
   * domain ACK landed since `triggerClickedAt`. Absent ⇒ POST did not
   * run or the validation was skipped (test paths).
   */
  readonly triggerScopeValidated?: boolean;
}

export type { IDiagnosticsState };
