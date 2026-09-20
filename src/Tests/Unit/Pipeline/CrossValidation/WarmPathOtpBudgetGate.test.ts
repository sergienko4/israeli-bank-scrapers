/**
 * Warm-path OTP gate — proves every real-E2E suite that can trigger an SMS is
 * wired so one run can only ever send one message.
 *
 * <p>Two of the three properties are now enforced by the type system:
 * `otpBudget` and `loginWitness` are required on `IWarmFallbackArgs`, so a
 * suite cannot simply omit them. What types cannot see is whether those
 * objects are *connected to anything*. A witness built and passed but never
 * bound to `onAuthFlowComplete` observes nothing, reports '', and silently
 * turns every retry into a refusal; a poller left unmetered costs a message
 * nobody counts. Both compile perfectly.
 *
 * <p>Nothing else can catch it either: these suites need real credentials, so
 * in CI they skip, and a unit test cannot observe a suite that never ran. This
 * gate reads the sources instead.
 *
 * <p>The suite list is derived from disk rather than hardcoded, so a fourth
 * OTP bank is covered the moment it is added — the previous allow-list shared
 * its failure mode with the thing it was guarding, and was in fact already
 * hiding two suites (Beinleumi and Hapoalim) that nobody had classified.
 *
 * <p>Two safety models exist, and every OTP suite must fall into exactly one:
 * a suite that can retry needs a budget and a witness spanning both attempts;
 * a suite that scrapes once is safe structurally, because one attempt cannot
 * cost two messages. Adding a retry to the second kind moves it into the
 * first, and this gate makes that move mandatory rather than optional.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE_PATH = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../../../');
const E2E_DIR = join(REPO_ROOT, 'src/Tests/E2eReal');

/** Marker identifying a suite that can cause an SMS. */
const OTP_MARKER = 'createBankOtpPoller(';

/** Marker identifying a suite whose ladder can start a second attempt. */
const WARM_FALLBACK_MARKER = 'scrapeWithWarmFallback(';

/**
 * Read one suite's source.
 * @param file - Suite filename.
 * @returns File contents.
 */
function readSuite(file: string): string {
  const path = join(E2E_DIR, file);
  return readFileSync(path, 'utf8');
}

/**
 * Every real-E2E suite that builds an OTP poller, discovered on disk.
 * @returns Suite filenames, sorted.
 */
function findOtpSuites(): readonly string[] {
  const names = readdirSync(E2E_DIR);
  const entries = names.filter(name => name.endsWith('.e2e-real.test.ts'));
  const otp = entries.filter(name => {
    const source = readSuite(name);
    return source.includes(OTP_MARKER);
  });
  return [...otp].sort();
}

/**
 * Count non-overlapping occurrences of a literal needle.
 * @param haystack - Source text.
 * @param needle - Literal to count.
 * @returns Number of occurrences.
 */
function countOf(haystack: string, needle: string): number {
  const parts = haystack.split(needle);
  return parts.length - 1;
}

const OTP_SUITES = findOtpSuites();

/**
 * Suites whose retry ladder can start a second attempt, and which therefore
 * need a budget and a witness spanning both.
 * @returns Suite filenames.
 */
function findWarmFallbackSuites(): readonly string[] {
  return OTP_SUITES.filter(file => {
    const source = readSuite(file);
    return source.includes(WARM_FALLBACK_MARKER);
  });
}

/**
 * Suites that scrape once and stop. One attempt can cost at most one message,
 * so their safety is structural rather than metered.
 * @returns Suite filenames.
 */
function findSingleAttemptSuites(): readonly string[] {
  return OTP_SUITES.filter(file => {
    const source = readSuite(file);
    return !source.includes(WARM_FALLBACK_MARKER);
  });
}

const WARM_FALLBACK_SUITES = findWarmFallbackSuites();
const SINGLE_ATTEMPT_SUITES = findSingleAttemptSuites();

/**
 * OTP suites known to exist when this gate was written.
 *
 * <p>A *floor*, never a ceiling. Discovery is what enumerates the suites, so a
 * new OTP bank is covered the moment it lands — it is sorted into a safety
 * model below and asserted like every other. This list exists only to catch
 * the opposite failure: a suite that silently stops being discovered because
 * its poller construction was renamed or refactored away, which would shrink
 * the gate to nothing while every test still passed.
 */
const KNOWN_OTP_SUITES = [
  'Beinleumi.e2e-real.test.ts',
  'Hapoalim.e2e-real.test.ts',
  'OneZero.e2e-real.test.ts',
  'PayBox.e2e-real.test.ts',
  'Pepper.e2e-real.test.ts',
] as const;

describe('real-E2E OTP suites — discovery', (): void => {
  it('still finds every suite already known to cause an SMS', (): void => {
    const missing = KNOWN_OTP_SUITES.filter(name => !OTP_SUITES.includes(name));
    expect(missing).toEqual([]);
  });

  it('sorts every OTP suite into exactly one safety model', (): void => {
    const covered = [...WARM_FALLBACK_SUITES, ...SINGLE_ATTEMPT_SUITES].sort();
    expect(covered).toEqual([...OTP_SUITES]);
  });

  it('leaves neither safety model empty, so no assertion runs vacuously', (): void => {
    const warmCount = WARM_FALLBACK_SUITES.length;
    const singleCount = SINGLE_ATTEMPT_SUITES.length;
    expect(warmCount).toBeGreaterThan(0);
    expect(singleCount).toBeGreaterThan(0);
  });
});

describe.each(SINGLE_ATTEMPT_SUITES)('%s — one attempt, one message', (file): void => {
  it('builds exactly one OTP poller, so one run asks for one code', (): void => {
    const source = readSuite(file);
    const pollers = countOf(source, OTP_MARKER);
    expect(pollers).toBe(1);
  });

  it('never retries, which is what makes the single poller sufficient', (): void => {
    const source = readSuite(file);
    expect(source).not.toContain(WARM_FALLBACK_MARKER);
  });
});

describe.each(WARM_FALLBACK_SUITES)('%s — one SMS per run', (file): void => {
  it('builds exactly one budget for the run', (): void => {
    const source = readSuite(file);
    const budgets = countOf(source, 'createOtpBudget()');
    expect(budgets).toBe(1);
  });

  it('meters every OTP poller it builds', (): void => {
    const source = readSuite(file);
    const pollers = countOf(source, OTP_MARKER);
    const metered = countOf(source, 'otpBudget.meter(');
    expect(metered).toBe(pollers);
  });

  it('meters the cold attempt as well as the warm one', (): void => {
    const source = readSuite(file);
    const pollers = countOf(source, OTP_MARKER);
    expect(pollers).toBeGreaterThan(1);
  });

  it('builds exactly one login witness for the run', (): void => {
    const source = readSuite(file);
    const witnesses = countOf(source, 'createLoginWitness(');
    expect(witnesses).toBe(1);
  });

  it('binds the witness to the callback, or it observes nothing', (): void => {
    const source = readSuite(file);
    expect(source).toContain('onAuthFlowComplete: loginWitness.writer');
  });

  it('wraps the cache writer, so the token still reaches disk', (): void => {
    const source = readSuite(file);
    expect(source).toContain('createLoginWitness(cache.writer)');
  });
});
