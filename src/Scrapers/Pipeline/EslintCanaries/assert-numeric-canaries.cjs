#!/usr/bin/env node
/**
 * Assert every numeric canary dies the moment its OWN cap is loosened by one.
 *
 * A size canary proves a cap exists, not that the cap is the one it claims.
 * `mediator-auth-fn-over-cap.canary.ts` carried a 28-line function to certify a
 * cap of 10 — but 28 also breaks 11, 12 … 27, so the cap could be raised to 27
 * and the canary would stay just as red. It certified "some cap below 28", and
 * the tightening it was written to defend could have been relaxed silently.
 *
 * The discriminating question is: would this fixture still fail if its own cap
 * were raised by exactly one? If yes, its red survives a real weakening and the
 * canary is not a tripwire. So each canary is re-linted against its OWN scoped
 * cap plus one — resolved per file, never a global maximum — and must come back
 * CLEAN. Combined with `assert-canaries.cjs` (which requires the declared rule
 * to fire at the real cap), this pins each fixture to exactly `cap + 1` lines,
 * the only size at which every possible raise is caught.
 *
 * Failures are reported with the exact target size, never auto-sized — how a
 * fixture reaches that size is a judgement about what it is for.
 */
const { ESLint } = require('eslint');
const { readdirSync, readFileSync } = require('fs');
const path = require('path');
const { capOf, verdict } = require('./numeric-canary-verdict.cjs');

const CANARY_DIR = __dirname;
const NUMERIC_RULES = [
  'max-lines',
  'max-lines-per-function',
  'phase9-local/fn-declaration-max-lines',
];
const EXPECTS_RULE = /canary-expects-rule:\s*(\S+)/g;

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
 * The cap this specific canary actually resolves to.
 *
 * Read through `calculateConfigForFile` so the answer is the cap ESLint really
 * applies to this path — the block that wins after every `files:` override —
 * rather than any cap declared elsewhere in the config.
 * @param resolver - A plain ESLint instance.
 * @param file - Canary path.
 * @param rule - Rule id.
 * @returns `{ max, options }` for that file, or null when the rule is off.
 */
const scopedCapFor = async (resolver, file, rule) => {
  const config = await resolver.calculateConfigForFile(file);
  return capOf(config.rules?.[rule]);
};

/**
 * Whether a canary still reports its rule once that rule is loosened by one.
 * @param file - Canary path.
 * @param rule - Rule id under test.
 * @param cap - The canary's own scoped cap.
 * @returns True when the fixture survives the raise, i.e. proves nothing.
 */
const survivesRaise = async (file, rule, cap) => {
  const eslint = new ESLint({
    ignore: false,
    overrideConfig: { rules: { [rule]: ['error', { ...cap.options, max: cap.max + 1 }] } },
  });
  const [result] = await eslint.lintFiles([file]);
  return result.messages.some(message => message.ruleId === rule);
};

/**
 * Collect every canary that fails to pin its own cap.
 * @param resolver - A plain ESLint instance.
 * @param rule - Rule id under test.
 * @returns `{ checked, failures }` — count measured and human-readable lines.
 */
const survivorsOf = async (resolver, rule) => {
  const failures = [];
  const files = canariesFor(rule);
  for (const file of files) {
    const cap = await scopedCapFor(resolver, file, rule);
    const stillRed = cap.found && (await survivesRaise(file, rule, cap));
    const outcome = verdict(cap, stillRed);
    if (outcome === 'unarmed') {
      failures.push(`${path.basename(file)} — declares ${rule}, which resolves to no cap here`);
    }
    if (outcome === 'unanchored') {
      failures.push(
        `${path.basename(file)} — still red at ${rule} max ${cap.max + 1}; ` +
          `shrink it to exactly ${cap.max + 1} effective line(s)`,
      );
    }
  }
  return { checked: files.length, failures };
};

const main = async () => {
  const resolver = new ESLint({ ignore: false });
  const failures = [];
  let checked = 0;
  for (const rule of NUMERIC_RULES) {
    const outcome = await survivorsOf(resolver, rule);
    checked += outcome.checked;
    failures.push(...outcome.failures);
    if (outcome.checked === 0) {
      failures.push(`${rule} — declared numeric rule with no canary; nothing defends its cap`);
    }
  }

  if (failures.length > 0) {
    console.error(`\n❌ UNANCHORED SIZE CANARY — ${failures.length} fixture(s):`);
    console.error(`   - ${failures.join('\n   - ')}`);
    console.error('\n   Each stays red even after its own cap is loosened by one, so it');
    console.error('   certifies "a cap below its size", not the exact cap it defends.');
    console.error('   A fixture sized to cap + 1 is the only one no raise can survive.');
    process.exit(1);
  }
  if (checked === 0) {
    console.error('\n❌ NO NUMERIC CANARY MEASURED — the harness proved nothing.');
    process.exit(1);
  }
  console.log(`✅ All ${checked} numeric canaries die on a one-step raise of their own cap`);
};

module.exports = { capOf, verdict };

if (require.main === module) main();
