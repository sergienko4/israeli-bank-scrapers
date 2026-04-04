/**
 * Discriminated union for structured pipeline log events.
 * Rule #19: Every logger call must satisfy this union.
 * Enables the Data Mapper to ingest logs and detect bank UI changes.
 */

import type { PhaseName } from './Phase.js';

/** Phase execution stage identifier. */
type StageName = 'PRE' | 'ACTION' | 'POST' | 'FINAL';
/** Stage or phase outcome. */
type Outcome = 'OK' | 'FAIL';
/** Phase lifecycle action. */
type LifecycleAction = 'START' | 'OK' | 'FAIL';
/** Element resolution result. */
type ElementResult = 'FOUND' | 'NOT_FOUND';
/** API strategy identifier. */
type ApiStrategy = 'DIRECT' | 'PROXY';
/** HTTP method string. */
type HttpMethod = string;
/** Visible text truncated for safety. */
type MaskedText = string;
/** URL string for navigation/network events. */
type EventUrl = string;
/** Proxy activation step name. */
type ProxyStep = string;
/** Login submit method identifier. */
type SubmitMethod = string;
/** Card index for scrape iteration. */
type CardIndex = string;
/** Billing month for scrape iteration. */
type BillingMonth = string;
/** Transaction count from a scrape call. */
type TxnCount = number;
/** Duration in milliseconds for a traced operation. */
type DurationMs = number;
/** Trace status for a completed operation. */
type TraceStatus = 'ok' | 'empty' | 'error';
/** Account count from scrape results. */
type AccountCount = number;
/** Number of endpoints captured. */
type EndpointCount = number;
/** Cookie count from audit. */
type CookieCount = number;
/** Field credential key name. */
type FieldKey = string;
/** Popup dismiss attempt number. */
type AttemptNum = number;
/** Max attempts for popup. */
type MaxAttempts = number;
/** Number of iframe contexts. */
type FrameCount = number;
/** Whether navigation occurred. */
type DidNavigate = boolean;
/** Whether network traffic was observed. */
type HasTraffic = boolean;
/** Whether an auth token was found. */
type HasAuthToken = boolean;
/** Whether a password field is present. */
type HasPassword = boolean;
/** Whether a submit button is present. */
type HasSubmit = boolean;
/** Whether form gate is visible. */
type FormGateVisible = boolean;
/** Whether a response was captured. */
type WasCaptured = boolean;
/** Whether traffic is primed. */
type IsPrimed = boolean;
/** Whether auth was found. */
type AuthFound = boolean;
/** Whether login form is present. */
type HasLoginForm = boolean;

/** Discriminated union for all pipeline log events. */
type PipelineLogEvent =
  | { event: 'phase-stage'; phase: PhaseName; stage: StageName; result: Outcome }
  | { event: 'phase-lifecycle'; phase: PhaseName; action: LifecycleAction; index: string }
  | { event: 'element-found'; phase: PhaseName; text: MaskedText }
  | { event: 'element-resolve'; phase: PhaseName; field: FieldKey; result: ElementResult }
  | { event: 'navigation'; phase: PhaseName; url: EventUrl; didNavigate: DidNavigate }
  | { event: 'navigation-fallback'; phase: PhaseName; url: EventUrl }
  | { event: 'page-validate'; url: EventUrl; title: MaskedText }
  | { event: 'popup-dismiss'; text: MaskedText; attempt: AttemptNum; max: MaxAttempts }
  | { event: 'popup-delta'; delta: EndpointCount }
  | { event: 'login-fill'; field: FieldKey; result: ElementResult }
  | { event: 'login-submit'; method: SubmitMethod; url: EventUrl }
  | { event: 'login-validate'; hasTraffic: HasTraffic; url: EventUrl }
  | { event: 'login-signal'; strategy: ApiStrategy; authToken: HasAuthToken; cookies: CookieCount }
  | { event: 'pre-login-guard'; hasPwd: HasPassword; hasSubmit: HasSubmit }
  | { event: 'pre-login-reveal'; text: MaskedText; formGate: FormGateVisible }
  | { event: 'pre-login-form'; hasPwd: HasPassword; iframes: FrameCount }
  | { event: 'proxy-activate'; step: ProxyStep; result: Outcome }
  | { event: 'proxy-fire'; url: EventUrl }
  | { event: 'proxy-response'; captured: WasCaptured }
  | { event: 'dashboard-post'; strategy: ApiStrategy; primed: IsPrimed; url: EventUrl }
  | { event: 'dashboard-auth'; authFound: AuthFound }
  | {
      event: 'scrape-card';
      card: CardIndex;
      month: BillingMonth;
      txnCount: TxnCount;
      durationMs?: DurationMs;
      status?: TraceStatus;
    }
  | { event: 'scrape-result'; accounts: AccountCount; txns: TxnCount }
  | { event: 'scrape-pre'; template: EventUrl; cards: readonly CardIndex[] }
  | { event: 'net-capture'; method: HttpMethod; url: EventUrl }
  | { event: 'net-skip'; method: HttpMethod; url: EventUrl; status: number }
  | { event: 'auth-frame'; url: EventUrl; keys: readonly string[] }
  | {
      event: 'home-validate';
      didNavigate: DidNavigate;
      frames: FrameCount;
      loginForm: HasLoginForm;
    }
  | { event: 'cleanup-error'; message: MaskedText }
  | { event: 'generic-trace'; phase: PhaseName; message: MaskedText };

/** Maximum visible text length before truncation in log events. */
const MAX_VISIBLE_TEXT_LENGTH = 30;

/**
 * Mask visible text for log safety — truncate to MAX_VISIBLE_TEXT_LENGTH.
 * Prevents accidental PII leakage in element labels, button text, URLs.
 * @param text - Raw visible text from DOM element.
 * @returns Truncated text safe for logging.
 */
function maskVisibleText(text: string): MaskedText {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_VISIBLE_TEXT_LENGTH) return trimmed;
  return trimmed.slice(0, MAX_VISIBLE_TEXT_LENGTH) + '...';
}

export type { PipelineLogEvent };
export { maskVisibleText };
