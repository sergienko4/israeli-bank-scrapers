/**
 * Lifecycle tests for `warmAttemptFailureType` — the tag that lets the
 * cold-fallback warning name the warm attempt's own failure instead of
 * blaming the stored token (issue #576 follow-up).
 *
 * The tag has to survive the cold retry that `TokenResolverBuilder` fires
 * immediately after a failed warm attempt, because that retry is exactly when
 * the warning reads it. That longevity is what makes a reset on the NEXT prime
 * cycle mandatory: without it a later, healthy prime still reports a tag from
 * a prime that has already been superseded.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import type { ScraperCredentials } from '../../../../../../Scrapers/Base/Interface.js';
import ScraperError from '../../../../../../Scrapers/Base/ScraperError.js';
import type { IConfigTokenStrategy } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/TokenStrategyFromConfig.js';
import { createTokenStrategyFromConfig } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/TokenStrategyFromConfig.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { ITokenContext } from '../../../../../../Scrapers/Pipeline/Types/Domain/TokenContext.js';
import type { Procedure } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, isOk, succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { type IApiPostCapture, makeStubMediator } from './StubMediator.js';
import { makeJwt, WARM_STEP_TAG, warmTwoStepConfig } from './WarmStartFixtures.js';

const HINT = CompanyTypes.OneZero;
const CTX = { companyId: HINT } as unknown as ITokenContext;

beforeAll((): void => {
  registerWkUrl(WARM_STEP_TAG, HINT, 'https://example.test/api/warm-tag');
});

/** Bundle returned by the harness so each test can drive its own sequence. */
interface IHarness {
  readonly strategy: IConfigTokenStrategy;
  readonly creds: ScraperCredentials;
}

/**
 * Build the strategy under test from the two-step warm config.
 * @returns The constructed strategy.
 */
function buildStrategy(): IConfigTokenStrategy {
  const proc = createTokenStrategyFromConfig({ config: warmTwoStepConfig() });
  if (!isOk(proc)) throw new ScraperError(proc.errorMessage);
  return proc.value;
}

/**
 * Assemble a strategy plus credentials carrying a locally fresh seed.
 * @returns Strategy and credentials ready to prime.
 */
function makeHarness(): IHarness {
  const strategy = buildStrategy();
  const creds = { otpLongTermToken: makeJwt(36000) } as unknown as ScraperCredentials;
  return { strategy, creds };
}

/**
 * Run one `primeInitial` against a mediator that answers every step with
 * `response`. A warm resume consumes one; a cold fallback walks both steps of
 * `warmTwoStepConfig`, so the script has to cover the longer path too.
 * @param harness - Strategy plus credentials under test.
 * @param response - The scripted apiPost outcome, repeated per step.
 * @returns Header-value procedure from the prime.
 */
async function primeOnce(
  harness: IHarness,
  response: Procedure<unknown>,
): Promise<Procedure<string>> {
  const captures: IApiPostCapture[] = [];
  const responses = [response, response];
  const bus = makeStubMediator({ responses, captures });
  return harness.strategy.primeInitial(bus, CTX, harness.creds);
}

/** A warm attempt the bank answers with a bearer. */
const WARM_OK: Procedure<unknown> = succeed({ access_token: makeJwt(36000) });
/** A warm attempt that dies in transit, not at the bank's discretion. */
const WARM_TIMEOUT: Procedure<unknown> = fail(ScraperErrorTypes.Timeout, 'socket hang up');

describe('warmAttemptFailureType lifecycle', (): void => {
  it('reports nothing when no prime has run yet', (): void => {
    const harness = makeHarness();
    const tag = harness.strategy.warmAttemptFailureType();
    expect(tag).toBe('');
  });

  it('names the warm attempt failure that just happened', async (): Promise<void> => {
    const harness = makeHarness();
    await primeOnce(harness, WARM_TIMEOUT);
    const tag = harness.strategy.warmAttemptFailureType();
    expect(tag).toBe(ScraperErrorTypes.Timeout);
  });

  it('clears the tag once a later warm attempt succeeds', async (): Promise<void> => {
    const harness = makeHarness();
    await primeOnce(harness, WARM_TIMEOUT);
    await primeOnce(harness, WARM_OK);
    const tag = harness.strategy.warmAttemptFailureType();
    expect(tag).toBe('');
  });

  it('clears the tag when a later seed is refused before any request', async (): Promise<void> => {
    const harness = makeHarness();
    await primeOnce(harness, WARM_TIMEOUT);
    const stale = { otpLongTermToken: makeJwt(-600) } as unknown as ScraperCredentials;
    const staleHarness: IHarness = { strategy: harness.strategy, creds: stale };
    await primeOnce(staleHarness, WARM_OK);
    const tag = staleHarness.strategy.warmAttemptFailureType();
    expect(tag).toBe('');
  });
});
