#!/usr/bin/env node
/**
 * Assert the Rule #10 layer boundary from the RESOLVED config.
 *
 * Rule #10 bans raw `page.*` in Pipeline business logic; the Mediator is
 * exempt because it owns the browser handle (P7, general-rules-guidlines.md).
 * No canary can prove the exempt side — a canary proves a rule FIRES, and the
 * Mediator's contract is that it does NOT.
 *
 * The previous attempt linted `CreateElementMediator.ts` and asserted no
 * Rule #10 error. That file contains no `page.*` call expression at all (its
 * only `page.` hits are JSDoc prose), so the assertion passed no matter what
 * the rule's scope was — including if Rule #10 had been deleted outright. It
 * was decoration.
 *
 * This reads the selector list ESLint actually resolves per file, and pairs
 * every negative with a POSITIVE CONTROL. Disarm Rule #10 and the positive
 * control fails; widen it over the Mediator and the negative fails. Neither
 * outcome can be reached by editing one line.
 */
const { ESLint } = require('eslint');
const { readdirSync, statSync } = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../../..');

/** Rule #10's message opens with this; it is the rule's identity in options. */
const NEEDLE = 'Rule #10';

const MEDIATOR = 'src/Scrapers/Pipeline/Mediator/Elements/CreateElementMediator.ts';
const GRANDFATHER = 'src/Scrapers/Pipeline/Phases/BindApiMediator/BindApiMediatorClientVersion.ts';

/**
 * Every sub-scope §21 arms Rule #10 on.
 *
 * Probing only one of them would let a commit drop the other four from the
 * §21 `files` list with this gate still green — the rule would remain "armed"
 * on the one path the probe happens to read.
 */
const ARMED_ROOTS = [
  'src/Scrapers/Pipeline/Phases',
  'src/Scrapers/Pipeline/Core',
  'src/Scrapers/Pipeline/Banks',
  'src/Scrapers/Pipeline/Registry',
  'src/Scrapers/Pipeline/Logging',
];

/**
 * First `.ts` file under a directory, depth-first, excluding one path.
 * @param dir - Absolute directory to search.
 * @param skip - Absolute path to exclude (the grandfathered file).
 * @returns Absolute path of a usable file, or null.
 */
const firstFile = (dir, skip) => {
  for (const entry of readdirSync(dir).sort()) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      const found = firstFile(full, skip);
      if (found) return found;
    } else if (full.endsWith('.ts') && !full.endsWith('.test.ts') && full !== skip) return full;
  }
  return null;
};

/**
 * How Rule #10 resolves for a file: whether it is present, and whether it errors.
 *
 * The two are reported separately on purpose. A positive control needs both —
 * `no-restricted-syntax` demoted to `'warn'` still carries the Rule #10 entry,
 * so a presence-only check would pass while nothing failed CI. A negative
 * control needs `carries === false` alone, because a Rule #10 entry sitting on
 * an exempt path at warning severity is still a leak.
 * @param eslint - Configured ESLint instance.
 * @param file - Repo-relative file path.
 * @returns `{ carries, isError }` for the resolved config.
 */
const ruleTenState = async (eslint, file) => {
  const config = await eslint.calculateConfigForFile(path.join(REPO_ROOT, file));
  const options = config.rules?.['no-restricted-syntax'] ?? [];
  const isError = options[0] === 2 || options[0] === 'error';
  const carries = options
    .slice(1)
    .some(entry => typeof entry === 'object' && String(entry.message).includes(NEEDLE));
  return { carries, isError };
};

/**
 * Whether Rule #10 is armed as an error for a file.
 * @param eslint - Configured ESLint instance.
 * @param file - Repo-relative file path.
 * @returns True when Rule #10 is present AND the rule is set to error.
 */
const isArmedOn = async (eslint, file) => {
  const state = await ruleTenState(eslint, file);
  return state.carries && state.isError;
};

/**
 * Whether Rule #10 is absent for a file, at any severity.
 * @param eslint - Configured ESLint instance.
 * @param file - Repo-relative file path.
 * @returns True when no Rule #10 entry is present.
 */
const isExemptOn = async (eslint, file) => {
  const state = await ruleTenState(eslint, file);
  return !state.carries;
};

/** Report one expectation. @param ok - Whether it held. @param label - Description. @param out - Failures. */
const expect = (ok, label, out) => {
  if (!ok) out.push(label);
};

/**
 * A probe file for one armed root, as a repo-relative path.
 * @param root - Repo-relative directory.
 * @returns Repo-relative file path, or null when the root holds no candidate.
 */
const probeFor = root => {
  const found = firstFile(path.join(REPO_ROOT, root), path.join(REPO_ROOT, GRANDFATHER));
  return found ? path.relative(REPO_ROOT, found).split(path.sep).join('/') : null;
};

const main = async () => {
  const eslint = new ESLint({ ignore: false });
  const out = [];
  const probes = [];
  for (const root of ARMED_ROOTS) {
    const probe = probeFor(root);
    if (!probe) {
      out.push(`no probe file found under ${root}`);
      continue;
    }
    probes.push(probe);
    expect(
      await isArmedOn(eslint, probe),
      `POSITIVE CONTROL: Rule #10 not an error on ${probe}`,
      out,
    );
  }
  expect(await isExemptOn(eslint, MEDIATOR), `Rule #10 leaked onto ${MEDIATOR}`, out);
  expect(await isExemptOn(eslint, GRANDFATHER), `§21a grandfather lost on ${GRANDFATHER}`, out);

  if (out.length > 0) {
    console.error(`\n❌ RULE #10 BOUNDARY FAILURE:\n   - ${out.join('\n   - ')}`);
    console.error('\n   Rule #10 must be armed as an ERROR on every Pipeline business-logic');
    console.error('   root, and absent from the Mediator (which owns the browser handle)');
    console.error('   and from the §21a grandfather.');
    process.exit(1);
  }
  console.log(
    `✅ Rule #10 boundary holds (armed on ${probes.length} roots, exempt on Mediator + §21a)`,
  );
};

main();
