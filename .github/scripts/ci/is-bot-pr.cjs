/**
 * Accounts and branch prefixes that identify repository automation.
 *
 * Bot PRs are exempt from the PR-body gates: Dependabot, Renovate's weekly
 * lockfile maintenance and release-please generate their bodies, so they
 * cannot produce the §10 guideline-compliance table, and their changelogs
 * cite paths from across the whole history — including files that have since
 * moved.
 *
 * The same predicate exempts bot PRs from the docs-staleness check: Dependabot
 * action-SHA bumps and release-please version bumps routinely touch files bound
 * to a docs page, and a bot cannot update that page. See
 * docs/workflow/code-scanning.md for the controls that cover the gap.
 *
 * `renovate/` is deliberately NOT a trusted branch prefix: Renovate opens its
 * PRs as `renovate[bot]`, so the author check is enough, and a prefix would
 * let any collaborator exempt a hand-written PR just by naming the branch.
 *
 * `.cjs` because the package is `"type": "module"` and `actions/github-script`
 * loads this with `require`.
 */
const BOT_AUTHORS = new Set([
  'dependabot[bot]',
  'renovate[bot]',
  'release-please[bot]',
  'github-actions[bot]',
]);

const BOT_BRANCH_PREFIXES = ['dependabot/', 'release-please--'];

/**
 * Whether a pull request carries a bot author or a trusted bot branch name.
 *
 * The branch-name path cannot tell who pushed the branch: a person with write
 * access who names a same-repo branch `dependabot/…` or `release-please--…`
 * is treated as a bot too.
 *
 * @param {{user?: {login?: string}, head?: {ref?: string, repo?: {full_name?: string}}, base?: {repo?: {full_name?: string}}}} pr
 *   The `pull_request` payload.
 * @returns {boolean} True when the author is a known bot account, or the PR
 *   comes from a same-repo branch with a bot prefix; such a PR skips the body
 *   and docs-staleness gates.
 */
module.exports = function isBotPr(pr) {
  const author = (pr.user && pr.user.login) || '';
  if (BOT_AUTHORS.has(author)) return true;

  // release-please pushes with a human PAT, so `user.login` alone misses it
  // and the branch name is the only reliable signal. A branch name is
  // author-chosen, though, so on a fork anyone could name a branch
  // `dependabot/x` and skip the gate. Trust the prefix only same-repo, where
  // pushing the branch already requires write access.
  const head = pr.head || {};
  const base = pr.base || {};
  const sameRepo = Boolean(head.repo && base.repo && head.repo.full_name === base.repo.full_name);
  if (!sameRepo) return false;

  const ref = head.ref || '';
  return BOT_BRANCH_PREFIXES.some((prefix) => ref.startsWith(prefix));
};
