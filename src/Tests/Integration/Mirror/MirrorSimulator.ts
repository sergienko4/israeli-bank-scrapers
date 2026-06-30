/**
 * Mode B mirror SIMULATOR — Playwright `page.route` handler that walks
 * the production scraper through every PHASE_CHAIN phase against a
 * deterministic per-bank manifest.
 *
 * Lifecycle:
 *
 *   1. `installSimulator(args)` reads the manifest, installs the route,
 *      and returns a handle exposing `snapshot()` + `dispose()`.
 *   2. For each request, the simulator:
 *      a. builds an {@link IMatchRequest},
 *      b. asks {@link matchTransition} for the canonical match,
 *      c. fulfils with the response fixture (status + headers + body),
 *      d. advances `currentPhase` when `transition.advanceTo` is set,
 *      e. mints/asserts the OTP challenge nonce when crossing OTP_TRIGGER /
 *         OTP_FILL.
 *   3. Unmatched requests pass through {@link classifyEscape}; fatal
 *      escapes are recorded and aborted; benign / noise are aborted silently.
 *
 * Coexists with the pre-existing single-step {@link ../Helpers/MirrorInterceptor.ts}
 * which PR #310 shipped; both share the page.route('**\/*') entry-point but
 * use entirely disjoint state. Tests choose one or the other per bank.
 *
 * @see ./MirrorManifest.ts
 * @see ./MirrorTransitionMatcher.ts
 * @see ./MirrorEscapeClassifier.ts
 * @see ./MirrorOtpChallenge.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Page, Request, Route } from 'playwright-core';

import ScraperError from '../../../Scrapers/Base/ScraperError.js';
import { isSome, none, type Option, some } from '../../../Scrapers/Pipeline/Types/Option.js';
import { type IntegrationPhase, isForwardTransition } from '../Phases/IntegrationPhase.js';
import { classifyEscape, type EscapeKind } from './MirrorEscapeClassifier.js';
import type {
  IMirrorManifest,
  IMirrorResponse,
  IMirrorTransition,
  MirrorResourceType,
} from './MirrorManifest.js';
import { loadMirrorManifest } from './MirrorManifestLoader.js';
import {
  assertOtpSubmission,
  CHALLENGE_COOKIE,
  CHALLENGE_HEADER,
  createOtpChallengeState,
  DEFAULT_TEST_OTP_CODE,
  type IOtpChallengeState,
  issueChallenge,
} from './MirrorOtpChallenge.js';
import {
  type IMatchOutcome,
  type IMatchRequest,
  matchTransition,
} from './MirrorTransitionMatcher.js';

/** Sentinel-style status returned by void-replacing functions. */
type SimulatorStepStatus = 'noop' | 'advanced' | 'recorded';

/** One recorded unmatched request — exposed via snapshot for assertions. */
interface IFatalEscape {
  readonly method: string;
  readonly url: string;
  readonly resourceType: MirrorResourceType;
}

/** Public snapshot for test assertions. */
interface ISimulatorSnapshot {
  readonly currentPhase: IntegrationPhase;
  readonly transitionsFired: number;
  readonly fatalEscapes: readonly IFatalEscape[];
  readonly benignAbortCount: number;
  readonly noiseAbortCount: number;
}

/** Handle returned by {@link installSimulator}. */
interface ISimulatorHandle {
  /**
   * Snapshot the current simulator state.
   *
   * @returns Frozen snapshot.
   */
  snapshot: () => ISimulatorSnapshot;
  /**
   * Remove the route binding and release simulator resources.
   *
   * @returns Resolves once the unroute completes.
   */
  dispose: () => Promise<true>;
}

/** Mutable simulator state. */
interface ISimulatorState {
  currentPhase: IntegrationPhase;
  transitionsFired: number;
  fatalEscapes: IFatalEscape[];
  benignAbortCount: number;
  noiseAbortCount: number;
  otpChallenge: IOtpChallengeState;
}

/** Bundle for {@link installSimulator}. */
interface IInstallSimulatorArgs {
  readonly page: Page;
  readonly bankId: string;
  readonly fixturesRoot: string;
  readonly expectedOtpCode?: string;
}

/** Internal route context — passed into the route handler. */
interface IRouteCtx {
  readonly state: ISimulatorState;
  readonly manifest: IMirrorManifest;
  readonly fixturesRoot: string;
  readonly expectedOtpCode: string;
}

/** Bundle passed to {@link fulfilTransition}. */
interface IFulfilArgs {
  readonly route: Route;
  readonly transition: IMirrorTransition;
  readonly request: IMatchRequest;
  readonly ctx: IRouteCtx;
}

/** Bundle passed to {@link enforceOtpSubmission}. */
interface IOtpEnforcementArgs {
  readonly transition: IMirrorTransition;
  readonly request: IMatchRequest;
  readonly ctx: IRouteCtx;
}

/** Bundle for the outcome dispatcher. */
interface IDispatchArgs {
  readonly outcome: IMatchOutcome;
  readonly route: Route;
  readonly request: IMatchRequest;
  readonly ctx: IRouteCtx;
}

/** Resolved fulfil payload (status + headers + body). */
interface IFulfilPayload {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: Buffer;
}

/** Bundle passed to {@link verifyOtpSubmission}. */
interface IVerifyOtpArgs {
  readonly state: IOtpChallengeState;
  readonly submittedCode: string;
  readonly submittedNonce: string;
  readonly expectedCode: string;
}

/**
 * Install the simulator on the page.
 *
 * @param args - Page + bank id + fixtures root + optional OTP override.
 * @returns Handle exposing snapshot + dispose.
 */
async function installSimulator(args: IInstallSimulatorArgs): Promise<ISimulatorHandle> {
  const manifest = loadMirrorManifest({ bankId: args.bankId, fixturesRoot: args.fixturesRoot });
  const state: ISimulatorState = buildInitialState(manifest);
  const ctx: IRouteCtx = buildRouteCtx({ manifest, state, args });
  await args.page.route('**/*', (route, req): Promise<SimulatorStepStatus> =>
    handleRoute(route, req, ctx),
  );
  return buildHandle(args.page, state);
}

/** Bundle passed to {@link buildRouteCtx}. */
interface IRouteCtxSpec {
  readonly manifest: IMirrorManifest;
  readonly state: ISimulatorState;
  readonly args: IInstallSimulatorArgs;
}

/**
 * Build the route context bundle that travels with every route event.
 *
 * @param spec - Manifest + state + install args.
 * @returns Frozen route context.
 */
function buildRouteCtx(spec: IRouteCtxSpec): IRouteCtx {
  return {
    state: spec.state,
    manifest: spec.manifest,
    fixturesRoot: spec.args.fixturesRoot,
    expectedOtpCode: spec.args.expectedOtpCode ?? DEFAULT_TEST_OTP_CODE,
  };
}

/**
 * Build the initial mutable state from a manifest.
 *
 * @param manifest - Loaded manifest.
 * @returns Mutable simulator state initialised at the start phase.
 */
function buildInitialState(manifest: IMirrorManifest): ISimulatorState {
  return {
    currentPhase: manifest.startPhase,
    transitionsFired: 0,
    fatalEscapes: [],
    benignAbortCount: 0,
    noiseAbortCount: 0,
    otpChallenge: createOtpChallengeState(),
  };
}

/**
 * Build the public handle bound to the page and state.
 *
 * @param page - The page the route was installed on.
 * @param state - Mutable state to snapshot.
 * @returns Handle exposing snapshot + dispose.
 */
function buildHandle(page: Page, state: ISimulatorState): ISimulatorHandle {
  return {
    snapshot: createSnapshotFn(state),
    dispose: createDisposeFn(page),
  };
}

/**
 * Create the snapshot closure bound to mutable state.
 *
 * @param state - Mutable simulator state.
 * @returns Zero-arg snapshot function.
 */
function createSnapshotFn(state: ISimulatorState): () => ISimulatorSnapshot {
  return (): ISimulatorSnapshot => buildSnapshot(state);
}

/**
 * Create the dispose closure bound to the page.
 *
 * @param page - The page the route was installed on.
 * @returns Async dispose function returning `true` on completion.
 */
function createDisposeFn(page: Page): () => Promise<true> {
  return async function dispose(): Promise<true> {
    await page.unroute('**/*');
    return true;
  };
}

/**
 * Build the public snapshot from mutable state.
 *
 * @param state - Mutable simulator state.
 * @returns Readonly snapshot.
 */
function buildSnapshot(state: ISimulatorState): ISimulatorSnapshot {
  return {
    currentPhase: state.currentPhase,
    transitionsFired: state.transitionsFired,
    fatalEscapes: state.fatalEscapes.slice(),
    benignAbortCount: state.benignAbortCount,
    noiseAbortCount: state.noiseAbortCount,
  };
}

/**
 * One route event — dispatch to match or escape.
 *
 * @param route - Playwright route.
 * @param req - Playwright request.
 * @param ctx - Route context.
 * @returns Sentinel step status (advanced / recorded / noop).
 */
async function handleRoute(
  route: Route,
  req: Request,
  ctx: IRouteCtx,
): Promise<SimulatorStepStatus> {
  const request = buildMatchRequest(req);
  const outcome = computeMatchOutcome(request, ctx);
  return dispatchOutcome({ outcome, route, request, ctx });
}

/**
 * Run the pure matcher against the current phase + transitions.
 *
 * @param request - Matcher input.
 * @param ctx - Route context (for phase + transitions).
 * @returns The matcher outcome.
 */
function computeMatchOutcome(request: IMatchRequest, ctx: IRouteCtx): IMatchOutcome {
  return matchTransition({
    request,
    currentPhase: ctx.state.currentPhase,
    transitions: ctx.manifest.transitions,
  });
}

/**
 * Dispatch the matcher outcome to the appropriate side-effect path.
 *
 * @param args - Outcome + route + request + context bundle.
 * @returns Sentinel step status.
 */
async function dispatchOutcome(args: IDispatchArgs): Promise<SimulatorStepStatus> {
  if (args.outcome.kind === 'ambiguous') throwAmbiguous(args.request, args.ctx);
  if (args.outcome.kind === 'none') return handleEscape(args.route, args.request, args.ctx);
  if (!isSome(args.outcome.transition)) return 'noop';
  const transition = args.outcome.transition.value;
  await fulfilTransition({ route: args.route, transition, request: args.request, ctx: args.ctx });
  return 'advanced';
}

/**
 * Throw a ScraperError describing an ambiguous manifest match.
 *
 * @param request - Request that triggered ambiguity.
 * @param ctx - Route context (for current phase).
 * @returns Never returns — always throws.
 */
function throwAmbiguous(request: IMatchRequest, ctx: IRouteCtx): never {
  throw new ScraperError(
    `MirrorSimulator: ambiguous manifest match for ${request.method} ${request.url} in phase ${ctx.state.currentPhase}`,
  );
}

/**
 * Convert a Playwright request to a matcher input.
 *
 * @param req - Playwright request.
 * @returns Pure matcher input.
 */
function buildMatchRequest(req: Request): IMatchRequest {
  const rawHeaders = req.headers();
  const headers = normalizeHeaders(rawHeaders);
  return makeRequestRecord(req, headers);
}

/**
 * Build the IMatchRequest record from a Playwright request + pre-normalized headers.
 *
 * @param req - Playwright request (for method/url/resourceType/postData).
 * @param headers - Already-lowercased headers map.
 * @returns Pure matcher input.
 */
function makeRequestRecord(req: Request, headers: Map<string, string>): IMatchRequest {
  return {
    method: req.method().toUpperCase(),
    url: req.url(),
    resourceType: req.resourceType() as MirrorResourceType,
    postBody: req.postData() ?? '',
    headers,
  };
}

/**
 * Lowercase header keys into a fresh map for the matcher.
 *
 * @param raw - Playwright's header record (mixed-case keys).
 * @returns Lower-cased header map.
 */
function normalizeHeaders(raw: Record<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const key of Object.keys(raw)) {
    const lowerKey = key.toLowerCase();
    out.set(lowerKey, raw[key]);
  }
  return out;
}

/**
 * Handle an unmatched request — classify, count, abort.
 *
 * @param route - Playwright route.
 * @param request - Matcher input.
 * @param ctx - Route context.
 * @returns Sentinel 'recorded'.
 */
async function handleEscape(
  route: Route,
  request: IMatchRequest,
  ctx: IRouteCtx,
): Promise<SimulatorStepStatus> {
  const kind = getEscapeKind(request);
  recordEscape(ctx.state, request, kind);
  await route.abort();
  return 'recorded';
}

/**
 * Compute the escape kind for one request via {@link classifyEscape}.
 *
 * @param request - Matcher input.
 * @returns Classified escape kind.
 */
function getEscapeKind(request: IMatchRequest): EscapeKind {
  return classifyEscape({
    method: request.method,
    url: request.url,
    resourceType: request.resourceType,
  });
}

/**
 * Update mutable state with one escape outcome.
 *
 * @param state - Mutable state.
 * @param request - Escape request facts.
 * @param kind - Classified kind.
 * @returns Sentinel 'recorded'.
 */
function recordEscape(
  state: ISimulatorState,
  request: IMatchRequest,
  kind: EscapeKind,
): SimulatorStepStatus {
  if (kind === 'fatal') return recordFatalEscape(state, request);
  if (kind === 'benign') return recordBenignEscape(state);
  return recordNoiseEscape(state);
}

/**
 * Record one fatal escape.
 *
 * @param state - Mutable state.
 * @param request - Request that escaped.
 * @returns Sentinel 'recorded'.
 */
function recordFatalEscape(state: ISimulatorState, request: IMatchRequest): SimulatorStepStatus {
  state.fatalEscapes.push({
    method: request.method,
    url: request.url,
    resourceType: request.resourceType,
  });
  return 'recorded';
}

/**
 * Increment the benign abort counter.
 *
 * @param state - Mutable state.
 * @returns Sentinel 'recorded'.
 */
function recordBenignEscape(state: ISimulatorState): SimulatorStepStatus {
  state.benignAbortCount += 1;
  return 'recorded';
}

/**
 * Increment the noise abort counter.
 *
 * @param state - Mutable state.
 * @returns Sentinel 'recorded'.
 */
function recordNoiseEscape(state: ISimulatorState): SimulatorStepStatus {
  state.noiseAbortCount += 1;
  return 'recorded';
}

/**
 * Fulfil a matched transition — load fixture, validate OTP if applicable,
 * advance phase, fire response.
 *
 * @param args - Route + matched transition + request + context.
 * @returns Sentinel 'advanced'.
 */
async function fulfilTransition(args: IFulfilArgs): Promise<SimulatorStepStatus> {
  handleOtpForFulfil(args);
  const payload = getFulfilPayload(args.ctx, args.transition);
  await args.route.fulfill({
    status: payload.status,
    headers: payload.headers,
    body: payload.body,
  });
  return advanceTransitionState(args.transition, args.ctx);
}

/**
 * If the fulfilled transition is the OTP_FILL submission, enforce the
 * submitted code + nonce match the issued challenge.
 *
 * @param args - Fulfil bundle.
 * @returns Sentinel 'advanced' when enforced, 'noop' otherwise.
 */
function handleOtpForFulfil(args: IFulfilArgs): SimulatorStepStatus {
  if (args.transition.phase !== 'OTP_FILL') return 'noop';
  return enforceOtpSubmission({
    transition: args.transition,
    request: args.request,
    ctx: args.ctx,
  });
}

/**
 * Resolve the fulfil payload (status + headers + body) for a transition.
 *
 * @param ctx - Route context (for fixture root + OTP challenge).
 * @param transition - Matched transition.
 * @returns Status + composed headers + body bytes.
 */
function getFulfilPayload(ctx: IRouteCtx, transition: IMirrorTransition): IFulfilPayload {
  const body = readFixtureBody(ctx.fixturesRoot, ctx.manifest.bankId, transition.response);
  const headers = composeResponseHeaders(transition, ctx.state.otpChallenge);
  return { status: transition.response.status, headers, body };
}

/**
 * Increment the transitions counter and advance the phase if applicable.
 *
 * @param transition - Matched transition.
 * @param ctx - Route context (for mutable state).
 * @returns Sentinel 'advanced'.
 */
function advanceTransitionState(
  transition: IMirrorTransition,
  ctx: IRouteCtx,
): SimulatorStepStatus {
  ctx.state.transitionsFired += 1;
  applyPhaseAdvance(transition, ctx.state);
  return 'advanced';
}

/**
 * Reject the OTP_FILL submission if nonce or code mismatch.
 *
 * @param args - Transition + request + context bundle.
 * @returns Sentinel 'advanced'.
 */
function enforceOtpSubmission(args: IOtpEnforcementArgs): SimulatorStepStatus {
  const submittedCode = extractSubmittedCode(args.request.postBody, args.transition);
  const submittedNonce = extractSubmittedNonce(args.request.headers);
  return verifyOtpSubmission({
    state: args.ctx.state.otpChallenge,
    expectedCode: args.ctx.expectedOtpCode,
    submittedCode,
    submittedNonce,
  });
}

/**
 * Extract the submitted nonce from either the challenge header or the
 * raw `Cookie` header (header takes precedence).
 *
 * @param headers - Lower-cased request headers.
 * @returns Submitted nonce or empty string when missing.
 */
function extractSubmittedNonce(headers: ReadonlyMap<string, string>): string {
  const headerNonce = headers.get(CHALLENGE_HEADER);
  if (headerNonce !== undefined) return headerNonce;
  const cookieHeader = headers.get('cookie') ?? '';
  return extractCookieNonce(cookieHeader);
}

/**
 * Assert the OTP submission against the issued challenge — throw on reject.
 *
 * @param args - OTP verification args.
 * @returns Sentinel 'advanced' on accept.
 */
function verifyOtpSubmission(args: IVerifyOtpArgs): SimulatorStepStatus {
  const result = assertOtpSubmission({
    state: args.state,
    submittedCode: args.submittedCode,
    submittedNonce: args.submittedNonce,
    expectedCode: args.expectedCode,
  });
  if (result !== 'accepted') throwOtpRejected(result, args);
  return 'advanced';
}

/**
 * Throw a ScraperError describing the OTP rejection reason.
 *
 * @param result - Non-accepted assertion result.
 * @param args - Original verification args (for context strings).
 * @returns Never returns — always throws.
 */
function throwOtpRejected(result: string, args: IVerifyOtpArgs): never {
  throw new ScraperError(
    `MirrorSimulator OTP_FILL rejected (${result}): submittedCode='${args.submittedCode}' submittedNonce='${args.submittedNonce}'`,
  );
}

/**
 * Try to pull the submitted OTP code from the POST body using the
 * transition's postData predicate keys as candidates. Falls back to
 * the trimmed body when no predicate is declared.
 *
 * @param body - Raw POST body.
 * @param transition - The matched transition for predicate hints.
 * @returns Best-effort code value (empty string when none found).
 */
function extractSubmittedCode(body: string, transition: IMirrorTransition): string {
  if (transition.postData === undefined) return body.trim();
  const expectations = transition.postData.expectations;
  for (const key of Object.keys(expectations)) {
    const found = findValueInBody(body, key, transition.postData.shape);
    if (isSome(found)) return found.value;
  }
  return '';
}

/**
 * Look up a single key in the body using the predicate shape.
 *
 * @param body - Raw POST body.
 * @param key - Key to look up.
 * @param shape - JSON or form encoding.
 * @returns Some(value) or none.
 */
function findValueInBody(body: string, key: string, shape: 'json' | 'form'): Option<string> {
  if (shape === 'form') return findValueInForm(body, key);
  return findValueInJson(body, key);
}

/**
 * Look up a key in a URL-encoded form body.
 *
 * @param body - Raw form body.
 * @param key - Key to look up.
 * @returns Some(value) or none.
 */
function findValueInForm(body: string, key: string): Option<string> {
  const params = new URLSearchParams(body);
  const value = params.get(key);
  if (value === null) return none();
  return some(value);
}

/**
 * Look up a key in a JSON-encoded body.
 *
 * @param body - Raw JSON body.
 * @param key - Key to look up.
 * @returns Some(value) or none.
 */
function findValueInJson(body: string, key: string): Option<string> {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    return serializeJsonValue(parsed[key]);
  } catch {
    return none();
  }
}

/**
 * Serialize one JSON value to a string Option. `undefined` becomes none,
 * strings pass through, everything else is JSON.stringify'd.
 *
 * @param value - JSON value (any).
 * @returns Some(stringified) or none.
 */
function serializeJsonValue(value: unknown): Option<string> {
  if (typeof value === 'string') return some(value);
  if (value === undefined) return none();
  const serialized = JSON.stringify(value);
  return some(serialized);
}

/**
 * Extract our challenge cookie from a raw `Cookie` header.
 *
 * @param cookieHeader - Raw cookie header value.
 * @returns The nonce or empty string.
 */
function extractCookieNonce(cookieHeader: string): string {
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${CHALLENGE_COOKIE}=`)) {
      return trimmed.slice(CHALLENGE_COOKIE.length + 1);
    }
  }
  return '';
}

/**
 * Combine the manifest's response headers with the OTP challenge
 * Set-Cookie when an OTP_TRIGGER transition fires.
 *
 * @param transition - Matched transition.
 * @param challenge - OTP challenge state.
 * @returns Final response headers.
 */
function composeResponseHeaders(
  transition: IMirrorTransition,
  challenge: IOtpChallengeState,
): Record<string, string> {
  const base = buildBaseResponseHeaders(transition.response);
  return addOtpChallengeIfNeeded(base, transition.phase, challenge);
}

/**
 * Build the base response headers from the manifest's response declaration.
 *
 * @param response - Mirror response declaration.
 * @returns Base headers (content-type + declared headers).
 */
function buildBaseResponseHeaders(response: IMirrorResponse): Record<string, string> {
  return {
    'content-type': response.contentType,
    ...(response.headers ?? {}),
  };
}

/**
 * When the transition is OTP_TRIGGER, append the challenge Set-Cookie; otherwise
 * pass the headers through unchanged. Returns a fresh record (no mutation).
 *
 * @param headers - Base response headers.
 * @param phase - The transition's phase.
 * @param challenge - OTP challenge state (used to issue a fresh nonce).
 * @returns Headers, with `set-cookie` added only for OTP_TRIGGER transitions.
 */
function addOtpChallengeIfNeeded(
  headers: Record<string, string>,
  phase: IntegrationPhase,
  challenge: IOtpChallengeState,
): Record<string, string> {
  if (phase !== 'OTP_TRIGGER') return headers;
  const nonce = issueChallenge(challenge);
  return { ...headers, 'set-cookie': `${CHALLENGE_COOKIE}=${nonce}; Path=/` };
}

/**
 * Read the response body fixture from disk.
 *
 * @param fixturesRoot - Fixtures root.
 * @param bankId - Bank id.
 * @param response - Response declaration.
 * @returns Body bytes.
 */
function readFixtureBody(fixturesRoot: string, bankId: string, response: IMirrorResponse): Buffer {
  const path = join(fixturesRoot, bankId, response.bodyFile);
  return readFileSync(path);
}

/**
 * Update the simulator's current phase from the transition's
 * advanceTo declaration. Backward / same-phase transitions are
 * rejected to keep the state machine forward-only.
 *
 * @param transition - The matched transition.
 * @param state - Mutable state.
 * @returns Sentinel 'noop' or 'advanced'.
 */
function applyPhaseAdvance(
  transition: IMirrorTransition,
  state: ISimulatorState,
): SimulatorStepStatus {
  if (transition.advanceTo === undefined) return 'noop';
  ensureForwardTransition(state.currentPhase, transition.advanceTo);
  state.currentPhase = transition.advanceTo;
  return 'advanced';
}

/**
 * Throw if the proposed phase transition is not strictly forward.
 *
 * @param current - Current phase.
 * @param target - Target phase.
 * @returns `true` after enforcing forward direction.
 */
function ensureForwardTransition(current: IntegrationPhase, target: IntegrationPhase): true {
  if (!isForwardTransition(current, target)) {
    throw new ScraperError(
      `MirrorSimulator: backward transition rejected (${current} -> ${target})`,
    );
  }
  return true;
}

export type {
  IFatalEscape,
  IInstallSimulatorArgs,
  ISimulatorHandle,
  ISimulatorSnapshot,
  SimulatorStepStatus,
};
export { installSimulator };
