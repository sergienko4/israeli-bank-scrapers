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
 * No bank is contacted. The credentials are obvious dummies, and the harness
 * installs with `--ignore-scripts` so the native better-sqlite3 binding is
 * absent — Camoufox therefore refuses to start long before any navigation.
 */

const { createScraper, CompanyTypes } = require('@sergienko4/israeli-bank-scrapers');

/** Printed only when the scrape produced an outcome the caller can act on. */
const SETTLED_MARKER = 'SETTLED';

/** Obvious dummies — this program must never authenticate against anything. */
const DUMMY_CREDENTIALS = {
  phoneNumber: '972000000000',
  password: 'not-a-real-password',
  email: 'nobody@example.invalid',
};

/**
 * Print the outcome in a form the shell gate can assert on.
 * @param {string} label - Outcome kind.
 * @param {string} detail - Message or serialised result.
 * @returns {void}
 */
function report(label, detail) {
  console.log(`${SETTLED_MARKER} ${label} ${detail}`);
}

const scraper = createScraper({
  companyId: CompanyTypes.Pepper,
  startDate: new Date('2026-01-01'),
});

scraper
  .scrape(DUMMY_CREDENTIALS)
  .then(result => report('result', JSON.stringify(result)))
  .catch(error => {
    report('throw', error && error.message ? error.message : String(error));
    process.exitCode = 1;
  });
