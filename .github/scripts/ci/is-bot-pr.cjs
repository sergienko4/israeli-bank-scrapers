/**
 * Accounts and branch prefixes that identify repository automation.
 *
 * Bot PRs are exempt from the PR-body gates: Dependabot and release-please
 * generate their bodies, so they cannot produce the §10 guideline-compliance
 * table, and their changelogs cite paths from across the whole history —
 * including files that have since moved.
 *
 * `.cjs` because the package is `"type": "module"` and `actions/github-script`
 * loads this with `require`.
 */
const BOT_AUTHORS = new Set(['dependabot[bot]', 'release-please[bot]', 'github-actions[bot]']);

const BOT_BRANCH_PREFIXES = ['dependabot/', 'release-please--'];

/**
 * Whether a pull request was raised by repository automation rather than a
 * person.
 *
 * @param {{user?: {login?: string}, head?: {ref?: string, repo?: {full_name?: string}}, base?: {repo?: {full_name?: string}}}} pr
 *   The `pull_request` payload.
 * @returns {boolean} True when the PR should skip the body gates.
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
