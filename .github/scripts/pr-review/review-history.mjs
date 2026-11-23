/**
 * Shared, fail-closed reader for a pull request's review history.
 *
 * The decision and posting paths must agree on what counts as a complete
 * history. Keeping the pagination and its failure modes here prevents one
 * caller from silently accepting a truncated list.
 */
import { githubRequest, readResponseJson } from './shared.mjs';

/** Maximum review-history pages; exceeding it fails closed. */
const MAX_REVIEW_PAGES = 20;

/**
 * Whether a review-history entry is a JSON object.
 * @param {unknown} value - Entry.
 * @returns {boolean} True for a non-null, non-array object.
 */
function isReviewEntry(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * List every review on a pull request.
 * @param {object} args - Request arguments.
 * @param {string} args.repo - `owner/name`.
 * @param {number} args.pr - Pull request number.
 * @param {string} args.token - GitHub token.
 * @param {typeof fetch} [args.fetchImpl] - Test double.
 * @param {boolean} [args.failClosed] - Throw on a failed or incomplete read.
 * @returns {Promise<Array<Record<string, unknown>>>} Reviews.
 * @throws Error when fail-closed is set and GitHub refuses the read or the
 *   history is incomplete.
 */
export async function listReviews({ repo, pr, token, fetchImpl = fetch, failClosed = true }) {
  const reviews = [];
  for (let page = 1; page <= MAX_REVIEW_PAGES; page += 1) {
    let response;
    try {
      response = await githubRequest({
        token,
        path: `/repos/${repo}/pulls/${pr}/reviews?per_page=100&page=${page}`,
        fetchImpl,
      });
    } catch (error) {
      if (!failClosed) return reviews;
      throw error;
    }
    if (!response.ok) {
      if (!failClosed) return reviews;
      throw new Error(`GitHub reviews answered ${response.status}`);
    }
    let batch;
    try {
      const body = await readResponseJson(response);
      if (!Array.isArray(body) || !body.every(isReviewEntry)) {
        throw new Error('GitHub reviews response is not a review list');
      }
      batch = /** @type {Array<Record<string, unknown>>} */ (body);
    } catch (error) {
      if (!failClosed) return reviews;
      throw error;
    }
    reviews.push(...batch);
    if (batch.length < 100) break;
    if (page === MAX_REVIEW_PAGES) {
      if (!failClosed) return reviews;
      throw new Error('review history is incomplete');
    }
  }
  return reviews;
}
