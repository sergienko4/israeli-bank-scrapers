/**
 * Discriminated union for structured pipeline log events.
 * Rule #19: Every logger call must satisfy this union.
 * Enables the Data Mapper to ingest logs and detect bank UI changes.
 *
 * BaseEvent enforces phase + stage on EVERY event.
 * Event-specific fields are intersected via EventPayloads map.
 */

import type { Brand } from './Brand.js';
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
/** Phase stage label — exactly one of the 4-stage protocol values. */
type StageLabel = 'PRE' | 'ACTION' | 'POST' | 'FINAL';
/** Trace status for a completed operation. */
type TraceStatus = 'ok' | 'empty' | 'error';

/**
 * Visible text masked for log safety — caller must run `maskVisibleText`
 * before assigning a raw string to a payload field. The brand is a
 * compile-time guard; runtime is plain string.
 */
type MaskedText = Brand<string, 'MaskedText'>;

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
  'element-resolve': { field: string; result: ElementResult };
  navigation: { url: string; didNavigate: boolean };
  'navigation-fallback': { url: string };
  'page-validate': { url: string; title: MaskedText };
  'popup-dismiss': { text: MaskedText; attempt: number; max: number };
  'popup-delta': { delta: number };
  'login-fill': { field: string; result: ElementResult };
  'login-submit': { method: string; url: string };
  'login-validate': { hasTraffic: boolean; url: string };
  'login-signal': { strategy: ApiStrategy; authToken: boolean; cookies: number };
  'pre-login-guard': { hasPwd: boolean; hasSubmit: boolean };
  'pre-login-reveal': { text: MaskedText; formGate: boolean };
  'pre-login-form': { hasPwd: boolean; iframes: number };
  'proxy-activate': { step: string; result: Outcome };
  'proxy-fire': { url: string };
  'proxy-response': { captured: boolean };
  'dashboard-post': { primed: boolean; url: string };
  'dashboard-auth': { authFound: boolean };
  'scrape-card': {
    card: string;
    month: string;
    txnCount: number;
    durationMs?: number;
    status?: TraceStatus;
  };
  'scrape-result': { accounts: number; txns: number };
  'scrape-audit': { message: MaskedText };
  'scrape-pre': { template: string; cards: readonly string[] };
  'net-capture': { method: string; url: string; card?: string; month?: string };
  'net-skip': { method: string; url: string; status: number };
  'auth-frame': { url: string; keys: readonly string[] };
  'home-validate': { didNavigate: boolean; frames: number; loginForm: boolean };
  'home-nav-sequence': { trigger: MaskedText; target: MaskedText };
  'cleanup-error': { message: MaskedText };
  'mirror-detection': { message: MaskedText };
  'wk-match': {
    wkKey: string;
    strategy: MaskedText;
    matchValue: MaskedText;
    via: MaskedText;
  };
  'element-identity': {
    tag: MaskedText;
    id: MaskedText;
    classes: MaskedText;
    attrs: Readonly<Record<string, MaskedText>>;
    visibility: MaskedText;
  };
  'field-resolution-complete': {
    field: string;
    wkConcept: string;
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
 * Honours `PII_REDACTION=off` for local-dev debugging: when the env
 * flag explicitly disables redaction, the length cap is bypassed too,
 * so logs show full URLs / values verbatim. Production / CI run
 * without the flag and keep the 30-char cap intact.
 * @param text - Raw text to mask.
 * @returns Truncated (or full) text branded as MaskedText.
 */
function maskVisibleText(text: string): MaskedText {
  const trimmed = text.trim();
  if (process.env.PII_REDACTION === 'off') return trimmed as MaskedText;
  if (trimmed.length <= MAX_VISIBLE_TEXT_LENGTH) return trimmed as MaskedText;
  return (trimmed.slice(0, MAX_VISIBLE_TEXT_LENGTH) + '...') as MaskedText;
}

export type { EventName, IBaseEvent, IEventPayloads, MaskedText, PipelineLogEvent, StageLabel };
export { maskVisibleText };
