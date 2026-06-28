/**
 * Tracks the OTP challenge nonce the simulator issues during the
 * `OTP_TRIGGER` fixture and asserts the matching `OTP_FILL`
 * POST carries the same nonce AND the deterministic test code.
 *
 * Design rationale (Phase 11 rubber-duck cycle 2 finding #4):
 * accepting any 6-digit string proves almost nothing — a wrong retriever,
 * wrong field, stale OTP, or wrong bank transition could all still pass.
 * Binding the OTP-FILL POST to a per-session nonce surfaces those bugs.
 *
 * Lifecycle:
 *
 *   1. {@link issueChallenge} called when an OTP_TRIGGER transition fires —
 *      returns a fresh nonce the response fixture embeds (e.g. in a cookie
 *      `Set-Cookie: integ_otp_challenge=<nonce>`).
 *   2. {@link assertOtpSubmission} called when an OTP_FILL transition fires —
 *      extracts the nonce from the request headers/body and asserts the
 *      challenge code matches the deterministic {@link DEFAULT_TEST_OTP_CODE}.
 *
 * The nonce is regenerated per simulator install so back-to-back tests
 * cannot bleed state. Nonces are NOT cryptographically secure — they are
 * test-only identifiers.
 *
 * @see ./MirrorSimulator.ts
 */

/** Deterministic OTP code integration tests submit via the production retriever. */
const DEFAULT_TEST_OTP_CODE = '123456';

/** Header name the simulator uses to round-trip the challenge nonce. */
const CHALLENGE_HEADER = 'x-integ-otp-challenge';

/** Cookie name the simulator uses to round-trip the challenge nonce. */
const CHALLENGE_COOKIE = 'integ_otp_challenge';

/** Mutable nonce store — exactly one nonce active at any moment per install. */
interface IOtpChallengeState {
  nonce: string;
}

/**
 * Generate a per-install nonce. Format: `otp-<random9>` so it is
 * easy to read in trace output yet unique per call.
 *
 * @returns Fresh nonce string.
 */
function generateNonce(): string {
  const seed = Math.random().toString(36).slice(2).padEnd(9, '0').slice(0, 9);
  return `otp-${seed}`;
}

/**
 * Create a fresh OTP-challenge state slot. Called once per
 * `installSimulator` invocation.
 *
 * @returns Fresh state object.
 */
function createOtpChallengeState(): IOtpChallengeState {
  return { nonce: '' };
}

/**
 * Result of an OTP_FILL submission assertion.
 *
 *   - `accepted` — code AND nonce both matched; simulator may advance.
 *   - `wrongCode` — nonce matched but the code differs from the
 *     deterministic test code; simulator returns a fixture-modeled error.
 *   - `wrongNonce` — challenge id was missing or stale (e.g. test
 *     skipped OTP_TRIGGER); fatal escape, simulator aborts.
 */
type OtpAssertionResult = 'accepted' | 'wrongCode' | 'wrongNonce';

/** Bundle for {@link assertOtpSubmission}. */
interface IAssertOtpArgs {
  readonly state: IOtpChallengeState;
  readonly submittedCode: string;
  readonly submittedNonce: string;
  readonly expectedCode: string;
}

/**
 * Mint a fresh nonce, persist it in the state, and return it. Callers
 * embed the nonce in the OTP_TRIGGER response (e.g. via a Set-Cookie
 * header) so the production scraper carries it on the next request.
 *
 * @param state - Mutable challenge state created by {@link createOtpChallengeState}.
 * @returns The newly minted nonce.
 */
function issueChallenge(state: IOtpChallengeState): string {
  const nonce = generateNonce();
  state.nonce = nonce;
  return nonce;
}

/**
 * Decide whether the OTP_FILL submission should be accepted.
 *
 * @param args - State + submitted code/nonce + expected code.
 * @returns The categorized assertion result.
 */
function assertOtpSubmission(args: IAssertOtpArgs): OtpAssertionResult {
  if (args.state.nonce === '' || args.submittedNonce !== args.state.nonce) return 'wrongNonce';
  if (args.submittedCode !== args.expectedCode) return 'wrongCode';
  return 'accepted';
}

export type { IAssertOtpArgs, IOtpChallengeState, OtpAssertionResult };
export {
  assertOtpSubmission,
  CHALLENGE_COOKIE,
  CHALLENGE_HEADER,
  createOtpChallengeState,
  DEFAULT_TEST_OTP_CODE,
  issueChallenge,
};
