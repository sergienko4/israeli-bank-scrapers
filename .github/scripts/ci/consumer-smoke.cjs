/**
 * The smallest program a consumer can write, run exactly as a consumer runs it.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every other test in this repo runs from the working tree, with
 * devDependencies installed and `CI` set. Issue #552 is a defect of the
 * *published artifact* under a *consumer's* environment, so none of them can
 * see it. This file is deliberately naive: it requires the package by name,
 * starts one scrape, and prints whatever it gets back.
 *
 * Two properties are being proved, and both are invisible from inside the repo:
 *
 *   1. The scrape SETTLES. A pipeline that awaits an unref'd timer lets Node
 *      empty its event loop and exit 0 mid-run, so the consumer gets no result
 *      and no error. That is why this file installs no keepalive timer: the
 *      scrape must hold the loop open by itself, or it has failed.
 *   2. The failure it settles with is the bank's or the environment's, never
 *      the logger's. A library that resolves a devDependency at runtime dies
 *      before reaching the network.
 *
 * A scrape reports failure by RETURNING a result, so an exception reaching
 * this file is itself a defect — `throw` therefore sets a non-zero exit code
 * and fails the gate rather than counting as "it settled".
 *
 * No bank is contacted. The credentials are obvious dummies, and a synthetic
 * fetch response stops the native Leumi flow at its first request.
 */

/** Printed only when the scrape produced an outcome the caller can act on. */
const SETTLED_MARKER = 'SETTLED';
const PRIME_URL = 'https://hb2.bankleumi.co.il/H/Login.html';

/** Obvious dummies — this program must never authenticate against anything. */
const DUMMY_CREDENTIALS = {
  username: 'not-a-real-user',
  password: 'not-a-real-password',
};

function offlineFetch(input) {
  const url = input instanceof Request ? input.url : String(input);
  if (url !== PRIME_URL) throw new Error('Unexpected consumer prime URL');
  console.log('OFFLINE_REQUEST');
  return Promise.resolve(new Response(null, { status: 503 }));
}

/**
 * Print the outcome in a form the shell gate can assert on.
 * @param {string} label - Outcome kind.
 * @param {string} detail - Message or serialised result.
 * @returns {void}
 */
function report(label, detail) {
  console.log(`${SETTLED_MARKER} ${label} ${detail}`);
}

function createConsumerScraper({ createScraper, CompanyTypes }) {
  return createScraper({
    companyId: CompanyTypes.Leumi,
    startDate: new Date('2026-01-01'),
  });
}

async function runScrape(exports) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = offlineFetch;
  try {
    const result = await createConsumerScraper(exports).scrape(DUMMY_CREDENTIALS);
    report('result', JSON.stringify(result));
  } catch (error) {
    report('throw', error && error.message ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

module.exports = { runScrape };
if (require.main === module) runScrape(require('@sergienko4/israeli-bank-scrapers'));
