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
const PHASES_ROOT = 'src/Scrapers/Pipeline/Phases';

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
 * Whether Rule #10 is in the resolved `no-restricted-syntax` options.
 * @param eslint - Configured ESLint instance.
 * @param file - Repo-relative file path.
 * @returns True when an option entry carries Rule #10's message.
 */
const hasRuleTen = async (eslint, file) => {
  const config = await eslint.calculateConfigForFile(path.join(REPO_ROOT, file));
  const options = config.rules?.['no-restricted-syntax'] ?? [];
  return options
    .slice(1)
    .some(entry => typeof entry === 'object' && String(entry.message).includes(NEEDLE));
};

/** Report one expectation. @param ok - Whether it held. @param label - Description. @param out - Failures. */
const expect = (ok, label, out) => {
  if (!ok) out.push(label);
};

const main = async () => {
  const eslint = new ESLint({ ignore: false });
  const probe = firstFile(path.join(REPO_ROOT, PHASES_ROOT), path.join(REPO_ROOT, GRANDFATHER));
  if (!probe) {
    console.error(`❌ RULE #10 BOUNDARY — no probe file found under ${PHASES_ROOT}`);
    process.exit(1);
  }
  const phase = path.relative(REPO_ROOT, probe).split(path.sep).join('/');
  const out = [];
  expect(await hasRuleTen(eslint, phase), `POSITIVE CONTROL: Rule #10 absent on ${phase}`, out);
  expect(!(await hasRuleTen(eslint, MEDIATOR)), `Rule #10 leaked onto ${MEDIATOR}`, out);
  expect(!(await hasRuleTen(eslint, GRANDFATHER)), `§21a grandfather lost on ${GRANDFATHER}`, out);

  if (out.length > 0) {
    console.error(`\n❌ RULE #10 BOUNDARY FAILURE:\n   - ${out.join('\n   - ')}`);
    console.error('\n   Rule #10 must be armed on Pipeline business logic and absent from the');
    console.error('   Mediator (which owns the browser handle) and from the §21a grandfather.');
    process.exit(1);
  }
  console.log(`✅ Rule #10 boundary holds (armed on ${phase}, exempt on Mediator + §21a)`);
};

main();
