#!/usr/bin/env node
/**
 * Assert every numeric canary is held up by its OWN scoped cap.
 *
 * A size canary proves a cap exists, not that the cap is the one it claims.
 * `form-sub-fn-over-cap.canary.ts` carried a 28-line function to certify a cap
 * of 10 — but 28 also breaks the Pipeline fallback of 15, so deleting the §19.4a
 * override left the canary just as red. It certified "some cap", and the
 * tightening it was written to defend could have been removed silently.
 *
 * The discriminating question is: would this fixture still fail under the
 * LOOSEST cap the config declares anywhere? If yes, its red is explained by any
 * cap at all and proves nothing about the scoped one. So each canary is re-linted
 * with its rule forced to that loosest cap; it must come back CLEAN.
 *
 * Deliberately conservative: the loosest declared cap is an upper bound on every
 * fallback a canary could be resting on, so a pass here is a pass against all of
 * them. Failures are reported, never auto-sized — the fix is a judgement about
 * what the fixture is for.
 */
const { ESLint } = require('eslint');
const { readdirSync, readFileSync } = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const CANARY_DIR = __dirname;
const NUMERIC_RULES = ['max-lines', 'max-lines-per-function'];
const EXPECTS_RULE = /canary-expects-rule:\s*(\S+)/g;

/** @param value - A flat-config rule value. @returns Its severity token. */
const severityOf = value => (Array.isArray(value) ? value[0] : value);

/**
 * Cap and options from a flat-config rule value.
 * @param value - Rule value, `['error', 150]` or `['error', { max: 150 }]`.
 * @returns `{ max, options }`, or null when the rule is off or capless.
 */
const capOf = value => {
  if (!Array.isArray(value) || severityOf(value) === 'off' || severityOf(value) === 0) return null;
  const options = value[1];
  if (typeof options === 'number') return { max: options, options: { max: options } };
  if (options && typeof options.max === 'number') return { max: options.max, options };
  return null;
};

/**
 * The loosest cap the whole config declares for a rule.
 *
 * Read from the config array rather than by resolving all 794 production files:
 * an upper bound is all this needs, and it costs one pass instead of minutes.
 * @param blocks - The flat-config array.
 * @param rule - Rule id to scan for.
 * @returns `{ max, options }` of the loosest declaration, or null.
 */
const loosestCap = (blocks, rule) => {
  let best = null;
  for (const block of blocks) {
    const cap = capOf(block.rules?.[rule]);
    if (cap && (best === null || cap.max > best.max)) best = cap;
  }
  return best;
};

/** @param file - Canary path. @returns Rule ids the canary declares. */
const declaredRules = file =>
  [...readFileSync(file, 'utf8').matchAll(EXPECTS_RULE)].map(match => match[1]);

/**
 * Canaries declaring a given numeric rule.
 * @param rule - Rule id.
 * @returns Absolute canary paths.
 */
const canariesFor = rule =>
  readdirSync(CANARY_DIR)
    .filter(name => name.endsWith('.canary.ts'))
    .map(name => path.join(CANARY_DIR, name))
    .filter(file => declaredRules(file).includes(rule));

/**
 * Canaries that still fail once their rule is loosened to the fallback.
 * @param rule - Rule id under test.
 * @param cap - Loosest declared cap for that rule.
 * @returns Basenames that remain red, i.e. prove nothing about their own cap.
 */
const survivorsOf = async (rule, cap) => {
  const files = canariesFor(rule);
  if (files.length === 0) return [];
  const eslint = new ESLint({
    ignore: false,
    overrideConfig: { rules: { [rule]: ['error', { ...cap.options, max: cap.max }] } },
  });
  const results = await eslint.lintFiles(files);
  return results
    .filter(result => result.messages.some(message => message.ruleId === rule))
    .map(result => path.basename(result.filePath));
};

const main = async () => {
  const { pathToFileURL } = require('url');
  const config = await import(pathToFileURL(path.join(REPO_ROOT, 'eslint.config.mjs')).href);
  const failures = [];
  for (const rule of NUMERIC_RULES) {
    const cap = loosestCap(config.default, rule);
    if (!cap) continue;
    const survivors = await survivorsOf(rule, cap);
    survivors.forEach(name => failures.push(`${name} (still red at ${rule} max ${cap.max})`));
  }

  if (failures.length > 0) {
    console.error(`\n❌ UNANCHORED SIZE CANARY — ${failures.length} fixture(s):`);
    console.error(`   - ${failures.join('\n   - ')}`);
    console.error('\n   These stay red even at the loosest cap the config declares, so they');
    console.error('   certify "a cap exists", not the tightened cap they were written for.');
    console.error('   Shrink each fixture until only its own scoped cap can flag it.');
    process.exit(1);
  }
  console.log('✅ Every numeric canary is anchored to its own scoped cap');
};

main();
