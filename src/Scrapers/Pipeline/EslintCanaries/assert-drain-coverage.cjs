/**
 * Every selector queued for drain must still match something.
 *
 * A selector in `PIPELINE_SYNTAX_PENDING_DRAIN` is not armed on production yet:
 * its remaining sites are being removed first. Until then the canary suite is
 * the only thing proving the selector still works. If it matches no canary, it
 * is inert — the config carries a guard that would find nothing on the day it
 * is finally armed, and nothing would say so.
 *
 * Matching is measured by re-linting each canary with the drain selectors
 * substituted under tagged messages, so a selector is identified by position
 * rather than by the wording of its real message. Rewording a message
 * therefore cannot make this gate quietly stop measuring.
 */
const { ESLint } = require('eslint');
const { readdirSync } = require('fs');
const path = require('path');

const CANARY_DIR = __dirname;
const CONFIG = path.join(CANARY_DIR, '..', '..', '..', '..', 'eslint.config.mjs');
const TAG = 'DRAIN_COVERAGE_PROBE';

/** @returns Absolute paths of every canary fixture. */
const canaryFiles = () =>
  readdirSync(CANARY_DIR)
    .filter(name => name.endsWith('.canary.ts'))
    .map(name => path.join(CANARY_DIR, name));

/**
 * A `no-restricted-syntax` config that reports each drain selector by index.
 * @param selectors - Drain selectors, in order.
 * @returns Flat-config rule value.
 */
const probeRule = selectors => [
  'error',
  ...selectors.map((selector, index) => ({ selector, message: `${TAG} ${index}` })),
];

/**
 * Indices of the drain selectors that matched at least one canary.
 * @param selectors - Drain selectors, in order.
 * @returns Set of matched indices.
 */
const matchedIndices = async selectors => {
  const eslint = new ESLint({
    ignore: false,
    overrideConfig: { rules: { 'no-restricted-syntax': probeRule(selectors) } },
  });
  const results = await eslint.lintFiles(canaryFiles());
  const hit = new Set();
  for (const result of results) {
    for (const message of result.messages) {
      if (!String(message.message).startsWith(TAG)) continue;
      hit.add(Number(String(message.message).slice(TAG.length + 1)));
    }
  }
  return hit;
};

const main = async () => {
  const { PIPELINE_PENDING_DRAIN_SELECTORS: selectors } = await import(`file://${CONFIG}`);
  if (selectors.length === 0) {
    console.log('✅ No selectors queued for drain');
    return;
  }
  const hit = await matchedIndices(selectors);
  const inert = selectors.filter((_, index) => !hit.has(index));

  if (inert.length > 0) {
    console.error(`\n❌ INERT DRAIN SELECTOR — ${inert.length} of ${selectors.length}:`);
    console.error(`   - ${inert.join('\n   - ')}`);
    console.error('\n   Each is queued for drain but matches no canary, so nothing proves it');
    console.error('   still works. Add a fixture with the shape it is meant to catch, or');
    console.error('   drop the selector — a guard that matches nothing is not a guard.');
    process.exit(1);
  }
  console.log(`✅ All ${selectors.length} drain-queued selectors still match a canary`);
};

main().catch(error => {
  console.error(error);
  process.exit(1);
});
