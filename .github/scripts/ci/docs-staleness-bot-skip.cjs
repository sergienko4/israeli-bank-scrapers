/**
 * Decides whether the docs-staleness job skips its scan for a bot pull request.
 *
 * WHY A PLAIN `node` STEP
 * -----------------------
 * `actions/github-script` hands every script it runs the job's `GITHUB_TOKEN`,
 * and this check loads code checked out from the pull request. Run as a plain
 * `run:` step, it receives no `GITHUB_TOKEN`, so the pull request's code has
 * no token to use or leak.
 *
 * The verdict comes only from `is-bot-pr.cjs`, the predicate the PR-body gates
 * use. It is appended to `GITHUB_OUTPUT` as `skip=true` or `skip=false`; the
 * scan step runs unless it reads `true`. A missing event file or a payload
 * without a pull request throws, which fails the job rather than skipping it.
 *
 * `.cjs` because the package is `"type": "module"`.
 */
const fs = require('node:fs');
const isBotPr = require('./is-bot-pr.cjs');

const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const pr = event.pull_request;
const skip = isBotPr(pr) ? 'true' : 'false';
if (skip === 'true') {
  console.log(`Docs staleness skipped — bot PR (author='${pr.user?.login ?? ''}').`);
}
fs.appendFileSync(process.env.GITHUB_OUTPUT, `skip=${skip}\n`);
