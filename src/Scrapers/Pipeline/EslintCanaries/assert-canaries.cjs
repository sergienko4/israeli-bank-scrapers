#!/usr/bin/env node
/**
 * Canary assertion harness.
 *
 * Extracted from the `node -e` body that used to live inline in `verify.sh`;
 * it had outgrown a shell string, and the checks below need real code.
 *
 * A canary is a file that deliberately breaks one rule, so that CI fails the
 * day that rule stops being enforced. That only works if the harness checks
 * the rule the canary NAMES. Four progressively stronger assertions:
 *
 *   1. errorCount > 0                     — the file still errors at all.
 *   2. some message has a real ruleId      — not just a Parsing error.
 *   3. the DECLARED target actually fired  — the point of the exercise.
 *   4. the declared target is its SUBJECT  — not a bystander it also trips.
 *
 * (3) is what this file exists to make non-optional. Every canary must carry
 * a `canary-expects-rule:` annotation, and — when that rule is
 * `no-restricted-syntax` — a `canary-expects-message:` substring too, because
 * `no-restricted-syntax` is a ~58-selector bundle and a bare rule-ID match
 * proves only that SOME selector fired, not the one being certified. That
 * exact hole let `rule10-phase-violation` sit green while certifying nothing.
 *
 * Annotations (in a comment anywhere in the canary):
 *   canary-expects-rule:    <rule-id>      required
 *   canary-expects-message: <substring>    required iff rule is no-restricted-syntax
 */
const fs = require('fs');

const EXPECTS_RULE = /canary-expects-rule:\s*(\S+)/;
const EXPECTS_MESSAGE = /canary-expects-message:\s*(.+)/;
const BUNDLED_RULE = 'no-restricted-syntax';

const readAnnotations = filePath => {
  const wants = [];
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const rule = EXPECTS_RULE.exec(line);
    if (rule) wants.push({ rule: rule[1], message: null });
    else if (EXPECTS_MESSAGE.test(line) && wants.length > 0)
      wants[wants.length - 1].message = EXPECTS_MESSAGE.exec(line)[1].trim();
  }
  return wants;
};

const baseName = filePath => filePath.replace(/.*[\\/]/, '');

/** Assertions 1 + 2: the file errors, and on a real rule rather than a parse failure. */
const checkErrors = (file, name, out) => {
  if (file.errorCount === 0) {
    out.dead.push(name);
    return false;
  }
  if (!(file.messages ?? []).some(m => m.ruleId !== null)) {
    out.parsingOnly.push(name);
    return false;
  }
  return true;
};

/** Assertion 3: the declared target fired, precisely enough to mean something. */
const checkTarget = (file, name, want, out) => {
  const messages = file.messages ?? [];
  const onTarget = messages.filter(m => m.ruleId === want.rule);
  if (onTarget.length === 0) {
    out.wrongRule.push(`${name} (declared ${want.rule}, never fired)`);
    return;
  }
  if (want.rule !== BUNDLED_RULE) return;
  if (want.message === null) {
    out.needMessage.push(name);
    return;
  }
  if (!onTarget.some(m => m.message.includes(want.message))) {
    out.wrongMessage.push(`${name} (no ${want.rule} message contains "${want.message}")`);
  }
};

/**
 * Whether a canary's declared pairs name the rule it was actually given.
 * @param wants - Declared rule/message pairs.
 * @param subject - Rules and selector messages granted to this canary.
 * @returns True when at least one declared pair names a granted subject.
 */
const subjectDeclared = (wants, subject) =>
  wants.some(want => subject.rules.includes(want.rule)) ||
  wants.some(want => want.message !== null && subject.messages.some(m => m.includes(want.message)));

/**
 * Assertion 4: a canary handed a file-specific rule declares THAT rule.
 *
 * A fixture almost always trips bystander selectors as well as its subject —
 * a forbidden `await` also has a return type, a name, a signature. Declaring a
 * bystander passes every check above while certifying a guardrail the canary
 * was never written for, so the real one can be deleted with CI still green.
 *
 * Ground truth is every config block naming this canary by exact path:
 * `CANARY_EXTRA_RULES` for bundled selectors, *plus* any standalone rule
 * granted file-specifically. Reading only the former is how the
 * negated-condition canary got away with declaring a bystander — its subject
 * was a `no-negated-condition` grant this check could not see.
 * @param name - Canary basename, for reporting.
 * @param wants - Declared rule/message pairs.
 * @param subject - Rules and selector messages granted to this canary.
 * @param out - Failure accumulator.
 */
const checkSubject = (name, wants, subject, out) => {
  if (subject.rules.length === 0 && subject.messages.length === 0) return;
  if (subjectDeclared(wants, subject)) return;
  const declared = wants.map(want => want.message ?? want.rule).join(', ');
  const expected = [...subject.rules, ...subject.messages].join(' / ');
  out.wrongSubject.push(`${name} (declares "${declared}", was given ${expected})`);
};

/** Repo root, derived from this file's location rather than by string surgery. */
const REPO_ROOT = require('path').resolve(__dirname, '../../../..');

/** Absolute OS path → the repo-relative, forward-slash key the config uses. */
const configKey = filePath =>
  require('path').relative(REPO_ROOT, filePath).split(/[\\/]/).join('/');

/** A canary no config block singles out; nothing to hold its annotation to. */
const NO_SUBJECT = { rules: [], messages: [] };

const checkOne = (file, out, subjectsByFile) => {
  const name = baseName(file.filePath);
  const wants = readAnnotations(file.filePath);
  if (wants.length === 0) {
    out.unannotated.push(name);
    return;
  }
  if (!checkErrors(file, name, out)) return;
  wants.forEach(want => checkTarget(file, name, want, out));
  checkSubject(name, wants, subjectsByFile[configKey(file.filePath)] ?? NO_SUBJECT, out);
};

const FAILURES = [
  [
    'dead',
    '❌ ARCHITECTURAL FAILURE — guardrails are inactive for',
    'These canaries produced no errors at all: the rule they certify is gone.',
  ],
  [
    'parsingOnly',
    '❌ SILENT-PASS FAILURE — only Parsing errors (ruleId=null) for',
    'Check tsconfig coverage + scope overrides for the targeted rule.',
  ],
  [
    'unannotated',
    '❌ UNANNOTATED CANARY — no `canary-expects-rule:` in',
    'Every canary must name the rule it certifies, or it proves nothing.',
  ],
  [
    'needMessage',
    `❌ IMPRECISE CANARY — \`${BUNDLED_RULE}\` needs \`canary-expects-message:\` in`,
    `${BUNDLED_RULE} bundles ~58 selectors; a bare rule-ID match proves only that SOME selector fired.`,
  ],
  [
    'wrongRule',
    '❌ WRONG-RULE FAILURE — declared target rule did not fire for',
    'The canary errored, but on some OTHER rule than the one it certifies.',
  ],
  [
    'wrongMessage',
    '❌ WRONG-SELECTOR FAILURE — declared message never appeared for',
    'The rule fired, but on a different selector than the one being certified.',
  ],
  [
    'wrongSubject',
    '❌ WRONG-SUBJECT FAILURE — declared a bystander rule, not its own, for',
    'The config grants this canary a specific rule/selector; it must declare THAT one.',
  ],
];

/** @param value - A flat-config rule value. @returns Its severity token. */
const severityOf = value => (Array.isArray(value) ? value[0] : value);

/** @param value - A flat-config rule value. @returns True when it enables the rule. */
const isGrant = value => severityOf(value) !== 'off' && severityOf(value) !== 0;

/** @param block - A flat-config block. @returns Standalone rule ids it enables. */
const grantedRules = block =>
  Object.entries(block.rules ?? {})
    .filter(([id, value]) => id !== BUNDLED_RULE && isGrant(value))
    .map(([id]) => id);

/** @param block - A flat-config block. @returns Canary paths it names exactly. */
const canaryFiles = block =>
  (Array.isArray(block.files) ? block.files : []).filter(
    file => typeof file === 'string' && file.endsWith('.canary.ts') && !file.includes('*'),
  );

/** @param blocks - The flat-config array. @returns Canary path → rules granted to it. */
const collectGrants = blocks => {
  const grants = {};
  for (const block of blocks ?? []) {
    const ids = grantedRules(block);
    if (ids.length === 0) continue;
    canaryFiles(block).forEach(file => (grants[file] = [...(grants[file] ?? []), ...ids]));
  }
  return grants;
};

/**
 * What each canary was actually given, keyed by canary path.
 *
 * Two sources, because a canary's subject can arrive either way: bundled
 * selectors via `CANARY_EXTRA_RULES`, and standalone rules granted by any
 * config block that names the file. Reading only the first is how the
 * negated-condition canary declared a bystander and still passed.
 * @returns Path → `{ messages, rules }`.
 */
const loadSubjects = async () => {
  const { pathToFileURL } = require('url');
  const configPath = require('path').resolve(REPO_ROOT, 'eslint.config.mjs');
  const config = await import(pathToFileURL(configPath).href);
  const messages = config.CANARY_EXTRA_MESSAGES ?? {};
  const rules = collectGrants(config.default);
  const keys = new Set([...Object.keys(messages), ...Object.keys(rules)]);
  return Object.fromEntries(
    [...keys].map(key => [key, { messages: messages[key] ?? [], rules: rules[key] ?? [] }]),
  );
};

const main = async () => {
  const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const subjectsByFile = await loadSubjects();
  const out = {
    dead: [],
    parsingOnly: [],
    unannotated: [],
    needMessage: [],
    wrongRule: [],
    wrongMessage: [],
    wrongSubject: [],
  };
  data.forEach(file => checkOne(file, out, subjectsByFile));

  const failed = FAILURES.filter(([key]) => out[key].length > 0);
  failed.forEach(([key, headline, hint]) => {
    console.error(`\n${headline}: ${out[key].join(', ')}`);
    console.error(`   ${hint}`);
  });
  if (failed.length > 0) process.exit(1);

  console.log(`\n✅ All ${data.length} TS canaries fired the exact rule they declare`);
};

main();
