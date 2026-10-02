/**
 * Opt-in real-E2E run of Pepper's durable device auth.
 *
 * <p>A separate suite from `Pepper.e2e-real.test.ts` because the two follow
 * different OTP safety models: the legacy suite retries through
 * WarmPathFallback under one shared budget, while a durable run scrapes once
 * and stops — a durable failure is the result, never a cold retry. The
 * PEPPER_PERSISTENT_AUTH* flags make the two mutually exclusive, so one run
 * executes exactly one of them.
 */

import { jest } from '@jest/globals';
import * as dotenv from 'dotenv';

import { CompanyTypes } from '../../index.js';
import { getDebug } from '../../Scrapers/Pipeline/Logging/Debug.js';
import { assertSuccessfulScrape, logScrapedTransactions, SCRAPE_TIMEOUT } from './Helpers.js';
import { createLoginWitness } from './LoginWitness.js';
import { createOtpBudget } from './OtpBudget.js';
import { createBankOtpPoller } from './OtpPoller.js';
import {
  buildDurableSink,
  createDurableCache,
  type DurableRunKind,
  durableRunKindOf,
  planDurableRun,
} from './PepperDurableHarness.js';
import { createScrapeAttempt } from './ScrapeAttempt.js';

dotenv.config();

const LOG = getDebug(import.meta.url);

const hasCoreCreds = !!(process.env.PEPPER_PHONE_NUMBER && process.env.PEPPER_PASSWORD);

/** Durable run the PEPPER_PERSISTENT_AUTH* flags select; `off` skips this suite. */
const DURABLE_KIND: DurableRunKind = durableRunKindOf(process.env);
const DESCRIBE_IF = hasCoreCreds && DURABLE_KIND !== 'off' ? describe : describe.skip;

/**
 * Legacy auth-flow sink for durable runs: durable mode must never call it,
 * and nothing it reports may reach the legacy token cache.
 * @returns Resolves immediately.
 */
function discardAuthFlow(): Promise<void> {
  return Promise.resolve();
}

/**
 * One durable scrape: resume (or enroll) with the cached state, persist each
 * published state, and assert the run's cost against its allowance. No
 * WarmPathFallback and no cold retry — a durable failure is the result.
 * @param kind - Durable run kind (not `off`).
 * @returns True once asserted.
 */
async function runDurableScrape(kind: Exclude<DurableRunKind, 'off'>): Promise<true> {
  const phoneNumber = process.env.PEPPER_PHONE_NUMBER ?? '';
  const password = process.env.PEPPER_PASSWORD ?? '';
  const cache = createDurableCache(LOG);
  const before = await cache.read();
  const plan = await planDurableRun(kind, cache, phoneNumber);
  const otpBudget = createOtpBudget();
  const loginWitness = createLoginWitness(discardAuthFlow);
  let publications = 0;
  const sink = buildDurableSink(cache, (): number => (publications += 1));
  const runScrape = createScrapeAttempt({
    companyId: CompanyTypes.Pepper,
    onAuthFlowComplete: loginWitness.writer,
    onPersistentAuthStateUpdate: sink,
    ...plan.stateOption,
  });
  const poller = createBankOtpPoller('Pepper', LOG);
  const otpCodeRetriever = otpBudget.meter(poller);
  const result = await runScrape({ phoneNumber, password, otpCodeRetriever });
  const after = await cache.read();
  const { allowance } = plan;
  const otpSpent = otpBudget.spent();
  const legacyToken = loginWitness.lastToken();
  LOG.info(
    {
      kind,
      expectedPublications: allowance.publications,
      success: result.success,
      otpSpent,
      publications,
      hadState: before.length > 0,
      stateChanged: after !== before,
    },
    'Pepper durable run',
  );
  assertSuccessfulScrape(result);
  expect(otpSpent).toBeLessThanOrEqual(allowance.maxOtp);
  expect(publications).toBe(allowance.publications);
  expect(after !== before).toBe(allowance.publications > 0);
  expect(legacyToken).toBe('');
  expect(result.persistentOtpToken).toBeUndefined();
  logScrapedTransactions(result);
  return true;
}

DESCRIBE_IF('E2E: Pepper durable device auth (real credentials, opt-in)', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it(`durable ${DURABLE_KIND}: replays or renews without SMS`, async () => {
    const kind = DURABLE_KIND as Exclude<DurableRunKind, 'off'>;
    const isAsserted = await runDurableScrape(kind);
    expect(isAsserted).toBe(true);
  });
});
