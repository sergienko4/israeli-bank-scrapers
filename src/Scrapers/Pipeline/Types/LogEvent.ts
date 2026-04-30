/**
 * Discriminated union for structured pipeline log events.
 * Rule #19: Every logger call must satisfy this union.
 * Enables the Data Mapper to ingest logs and detect bank UI changes.
 *
 * BaseEvent enforces phase + stage on EVERY event.
 * Event-specific fields are intersected via EventPayloads map.
 */

import type { PhaseName } from './Phase.js';
import type { ApiStrategyKind } from './PipelineContext.js';

// ── Scalar type aliases (Rule #15: no bare primitives) ───────────────

/** Stage or phase outcome. */
type Outcome = 'OK' | 'FAIL';
/** Phase lifecycle action. */
type LifecycleAction = 'START' | 'OK' | 'FAIL';
/** Element resolution result. */
type ElementResult = 'FOUND' | 'NOT_FOUND';
/** API strategy identifier — single source: PipelineContext.ts. */
type ApiStrategy = ApiStrategyKind;
/** HTTP method string. */
type HttpMethod = string;
/** Visible text truncated for safety. */
type MaskedText = string;
/** URL string for navigation/network events. */
type EventUrl = string;
/** Proxy activation step name. */
type ProxyStep = string;
/** Phase stage label — exactly one of the 4-stage protocol values. */
type StageLabel = 'PRE' | 'ACTION' | 'POST' | 'FINAL';
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

// ── Base Event — mandatory coordinates on EVERY log event ────────────

/** Every pipeline log event MUST carry these coordinates. */
interface IBaseEvent {
  readonly event: EventName;
  readonly phase: PhaseName;
  readonly stage: StageLabel;
}

// ── Event payloads — each event's specific fields ────────────────────

/** All event names in the pipeline. */
type EventName = keyof IEventPayloads;

/** Map of event name → event-specific fields (excludes base coordinates). */
interface IEventPayloads {
  'phase-stage': { result: Outcome };
  'phase-lifecycle': { action: LifecycleAction; index: MaskedText };
  'element-found': { text: MaskedText };
  'element-resolve': { field: FieldKey; result: ElementResult };
  navigation: { url: EventUrl; didNavigate: DidNavigate };
  'navigation-fallback': { url: EventUrl };
  'page-validate': { url: EventUrl; title: MaskedText };
  'popup-dismiss': { text: MaskedText; attempt: AttemptNum; max: MaxAttempts };
  'popup-delta': { delta: EndpointCount };
  'login-fill': { field: FieldKey; result: ElementResult };
  'login-submit': { method: SubmitMethod; url: EventUrl };
  'login-validate': { hasTraffic: HasTraffic; url: EventUrl };
  'login-signal': { strategy: ApiStrategy; authToken: HasAuthToken; cookies: CookieCount };
  'pre-login-guard': { hasPwd: HasPassword; hasSubmit: HasSubmit };
  'pre-login-reveal': { text: MaskedText; formGate: FormGateVisible };
  'pre-login-form': { hasPwd: HasPassword; iframes: FrameCount };
  'proxy-activate': { step: ProxyStep; result: Outcome };
  'proxy-fire': { url: EventUrl };
  'proxy-response': { captured: WasCaptured };
  'dashboard-post': { primed: IsPrimed; url: EventUrl };
  'dashboard-auth': { authFound: AuthFound };
  'scrape-card': {
    card: CardIndex;
    month: BillingMonth;
    txnCount: TxnCount;
    durationMs?: DurationMs;
    status?: TraceStatus;
  };
  'scrape-result': { accounts: AccountCount; txns: TxnCount };
  'scrape-audit': { message: MaskedText };
  'scrape-pre': { template: EventUrl; cards: readonly CardIndex[] };
  'net-capture': { method: HttpMethod; url: EventUrl; card?: CardIndex; month?: BillingMonth };
  'net-skip': { method: HttpMethod; url: EventUrl; status: AccountCount };
  'auth-frame': { url: EventUrl; keys: readonly FieldKey[] };
  'home-validate': { didNavigate: DidNavigate; frames: FrameCount; loginForm: HasLoginForm };
  'home-nav-sequence': { trigger: MaskedText; target: MaskedText };
  'cleanup-error': { message: MaskedText };
  'mirror-detection': { message: MaskedText };
  'wk-match': {
    wkKey: FieldKey;
    strategy: MaskedText;
    matchValue: MaskedText;
    via: MaskedText;
  };
  'element-identity': {
    tag: MaskedText;
    id: MaskedText;
    classes: MaskedText;
    attrs: Readonly<Record<MaskedText, MaskedText>>;
    visibility: MaskedText;
  };
  'field-resolution-complete': {
    field: FieldKey;
    wkConcept: FieldKey;
    strategy: MaskedText;
    elementId: MaskedText;
    elementTag: MaskedText;
    elementClasses: MaskedText;
  };
  'generic-trace': { message: MaskedText };
}

// ── Mapped type — generates union from IEventPayloads ────────────────

/** Build one union member: BaseEvent coordinates + event-specific payload. */
type EventEntry<TKey extends EventName> = {
  event: TKey;
  phase: PhaseName;
  stage: StageLabel;
} & IEventPayloads[TKey];

/** The full discriminated union — compiler-enforced phase+stage on every event. */
type PipelineLogEvent = {
  [TKey in EventName]: EventEntry<TKey>;
}[EventName];

// ── Utilities ────────────────────────────────────────────────────────

/** Maximum visible text length before truncation in log events. */
const MAX_VISIBLE_TEXT_LENGTH = 30;

/**
 * Mask visible text for log safety — truncate to MAX_VISIBLE_TEXT_LENGTH.
 * @param text - Raw text to mask.
 * @returns Truncated text.
 */
function maskVisibleText(text: MaskedText): MaskedText {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_VISIBLE_TEXT_LENGTH) return trimmed;
  return trimmed.slice(0, MAX_VISIBLE_TEXT_LENGTH) + '...';
}

export type { EventName, IBaseEvent, IEventPayloads, MaskedText, PipelineLogEvent, StageLabel };
export { maskVisibleText };
