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
import { type IMatchRequest, matchTransition } from './MirrorTransitionMatcher.js';

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

/**
 * Install the simulator on the page.
 *
 * @param args - Page + bank id + fixtures root + optional OTP override.
 * @returns Handle exposing snapshot + dispose.
 */
async function installSimulator(args: IInstallSimulatorArgs): Promise<ISimulatorHandle> {
  const manifest = loadMirrorManifest({ bankId: args.bankId, fixturesRoot: args.fixturesRoot });
  const state: ISimulatorState = buildInitialState(manifest);
  const ctx: IRouteCtx = {
    state,
    manifest,
    fixturesRoot: args.fixturesRoot,
    expectedOtpCode: args.expectedOtpCode ?? DEFAULT_TEST_OTP_CODE,
  };
  await args.page.route(
    '**/*',
    (route, req): Promise<SimulatorStepStatus> => handleRoute(route, req, ctx),
  );
  return buildHandle(args.page, state);
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
  /**
   * Snapshot the current simulator state.
   *
   * @returns Frozen snapshot.
   */
  const snapshot = (): ISimulatorSnapshot => buildSnapshot(state);
  /**
   * Remove the route binding and release simulator resources.
   *
   * @returns Resolves once the unroute completes.
   */
  async function dispose(): Promise<true> {
    await page.unroute('**/*');
    return true;
  }
  return { snapshot, dispose };
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
  const outcome = matchTransition({
    request,
    currentPhase: ctx.state.currentPhase,
    transitions: ctx.manifest.transitions,
  });
  if (outcome.kind === 'ambiguous') {
    throw new ScraperError(
      `MirrorSimulator: ambiguous manifest match for ${request.method} ${request.url} in phase ${ctx.state.currentPhase}`,
    );
  }
  if (outcome.kind === 'none') return handleEscape(route, request, ctx);
  if (!isSome(outcome.transition)) return 'noop';
  await fulfilTransition({ route, transition: outcome.transition.value, request, ctx });
  return 'advanced';
}

/**
 * Convert a Playwright request to a matcher input.
 *
 * @param req - Playwright request.
 * @returns Pure matcher input.
 */
function buildMatchRequest(req: Request): IMatchRequest {
  const rawHeaders = req.headers();
  const lowered = new Map<string, string>();
  for (const key of Object.keys(rawHeaders)) {
    const lowerKey = key.toLowerCase();
    lowered.set(lowerKey, rawHeaders[key]);
  }
  const postBody = req.postData() ?? '';
  return {
    method: req.method().toUpperCase(),
    url: req.url(),
    resourceType: req.resourceType() as MirrorResourceType,
    postBody,
    headers: lowered,
  };
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
  const kind = classifyEscape({
    method: request.method,
    url: request.url,
    resourceType: request.resourceType,
  });
  recordEscape(ctx.state, request, kind);
  await route.abort();
  return 'recorded';
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
  if (kind === 'fatal') {
    state.fatalEscapes.push({
      method: request.method,
      url: request.url,
      resourceType: request.resourceType,
    });
    return 'recorded';
  }
  if (kind === 'benign') state.benignAbortCount += 1;
  if (kind === 'noise') state.noiseAbortCount += 1;
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
  if (args.transition.phase === 'OTP_FILL') {
    enforceOtpSubmission({ transition: args.transition, request: args.request, ctx: args.ctx });
  }
  const body = readFixtureBody(
    args.ctx.fixturesRoot,
    args.ctx.manifest.bankId,
    args.transition.response,
  );
  const headers = composeResponseHeaders(args.transition, args.ctx.state.otpChallenge);
  await args.route.fulfill({
    status: args.transition.response.status,
    headers,
    body,
  });
  args.ctx.state.transitionsFired += 1;
  applyPhaseAdvance(args.transition, args.ctx.state);
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
  const cookieHeader = args.request.headers.get('cookie') ?? '';
  const headerNonce = args.request.headers.get(CHALLENGE_HEADER);
  const submittedNonce = headerNonce ?? extractCookieNonce(cookieHeader);
  const result = assertOtpSubmission({
    state: args.ctx.state.otpChallenge,
    submittedCode,
    submittedNonce,
    expectedCode: args.ctx.expectedOtpCode,
  });
  if (result !== 'accepted') {
    throw new ScraperError(
      `MirrorSimulator OTP_FILL rejected (${result}): submittedCode='${submittedCode}' submittedNonce='${submittedNonce}'`,
    );
  }
  return 'advanced';
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
    const value = parsed[key];
    if (typeof value === 'string') return some(value);
    if (value === undefined) return none();
    const serialized = JSON.stringify(value);
    return some(serialized);
  } catch {
    return none();
  }
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
  const headers: Record<string, string> = {
    'content-type': transition.response.contentType,
    ...(transition.response.headers ?? {}),
  };
  if (transition.phase === 'OTP_TRIGGER') {
    const nonce = issueChallenge(challenge);
    headers['set-cookie'] = `${CHALLENGE_COOKIE}=${nonce}; Path=/`;
  }
  return headers;
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
  if (!isForwardTransition(state.currentPhase, transition.advanceTo)) {
    throw new ScraperError(
      `MirrorSimulator: backward transition rejected (${state.currentPhase} -> ${transition.advanceTo})`,
    );
  }
  state.currentPhase = transition.advanceTo;
  return 'advanced';
}

export type {
  IFatalEscape,
  IInstallSimulatorArgs,
  ISimulatorHandle,
  ISimulatorSnapshot,
  SimulatorStepStatus,
};
export { installSimulator };
