/**
 * Unit tests for Strategy/Fetch/HttpFailureClassifier — the non-2xx
 * classification shared by NativeFetchStrategy (and its mTLS / GraphQL
 * subclasses) and CamoufoxIdentityFetchStrategy.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import { isAuthRejectionMessage } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.authReject.js';
import {
  classifyHttpFailure,
  CLOUDFLARE_BLOCK_REASON,
  CLOUDFLARE_CHALLENGE_REASON,
} from '../../../../../Scrapers/Pipeline/Strategy/Fetch/HttpFailureClassifier.js';
import {
  BLOCK_PAGE_CLIENT_IP,
  BLOCK_PAGE_RAY_ID,
  CLOUDFLARE_BLOCK_PAGE,
  CLOUDFLARE_CHALLENGE_HEADERS,
  CLOUDFLARE_CHALLENGE_PAGE,
  CLOUDFLARE_ORIGIN_ERROR_PAGE,
  CLOUDFRONT_BLOCK_PAGE,
  ORIGIN_PAGE_WITH_EDGE_SCRIPT,
} from '../../../../Helpers/EdgeBlockPages.js';

/** Request URL used in every case. */
const TARGET_URL = 'https://bank.example/v1/devices/token';

/** Old-IE HTML shell that is not a Cloudflare page. */
const OLD_IE_PAGE = '<!DOCTYPE html>\n<!--[if lt IE 7]> <html class="ie6 oldie"> <![endif]-->';

/** JSON body that merely names the markers — not HTML, so not a block page. */
const JSON_NAMING_MARKERS = '{"error":"cf-error relayed from cloudflare"}';

/** Response headers carrying no edge verdict. */
const NO_HEADERS: Readonly<Record<string, string>> = {};

/** One classification row. */
interface IClassifyCase {
  readonly label: string;
  readonly status: number;
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly expectedType: ScraperErrorTypes;
}

const CLASSIFY_CASES: readonly IClassifyCase[] = [
  {
    label: 'Cloudflare 403 block page',
    status: 403,
    body: CLOUDFLARE_BLOCK_PAGE,
    headers: NO_HEADERS,
    expectedType: ScraperErrorTypes.WafBlocked,
  },
  {
    label: 'Cloudflare 429 block page',
    status: 429,
    body: CLOUDFLARE_BLOCK_PAGE,
    headers: NO_HEADERS,
    expectedType: ScraperErrorTypes.WafBlocked,
  },
  {
    label: 'Cloudflare 522 origin-error page',
    status: 522,
    body: CLOUDFLARE_ORIGIN_ERROR_PAGE,
    headers: NO_HEADERS,
    expectedType: ScraperErrorTypes.Generic,
  },
  {
    label: 'CloudFront 403 block page',
    status: 403,
    body: CLOUDFRONT_BLOCK_PAGE,
    headers: NO_HEADERS,
    expectedType: ScraperErrorTypes.Generic,
  },
  {
    label: 'old-IE HTML without Cloudflare markers',
    status: 403,
    body: OLD_IE_PAGE,
    headers: NO_HEADERS,
    expectedType: ScraperErrorTypes.Generic,
  },
  {
    label: 'JSON body naming the markers',
    status: 403,
    body: JSON_NAMING_MARKERS,
    headers: NO_HEADERS,
    expectedType: ScraperErrorTypes.Generic,
  },
  {
    label: 'HTML naming Cloudflare without an error block',
    status: 403,
    body: '<html><body>Protected by Cloudflare</body></html>',
    headers: NO_HEADERS,
    expectedType: ScraperErrorTypes.Generic,
  },
  {
    label: 'HTML with an error block but no Cloudflare mention',
    status: 403,
    body: '<html class="cf-error"></html>',
    headers: NO_HEADERS,
    expectedType: ScraperErrorTypes.Generic,
  },
  {
    label: 'Cloudflare 403 challenge',
    status: 403,
    body: CLOUDFLARE_CHALLENGE_PAGE,
    headers: CLOUDFLARE_CHALLENGE_HEADERS,
    expectedType: ScraperErrorTypes.WafBlocked,
  },
  {
    label: 'Cloudflare 503 challenge',
    status: 503,
    body: CLOUDFLARE_CHALLENGE_PAGE,
    headers: CLOUDFLARE_CHALLENGE_HEADERS,
    expectedType: ScraperErrorTypes.WafBlocked,
  },
  {
    label: 'challenge page body without the challenge header',
    status: 403,
    body: CLOUDFLARE_CHALLENGE_PAGE,
    headers: NO_HEADERS,
    expectedType: ScraperErrorTypes.Generic,
  },
  {
    label: 'origin 403 page carrying the injected edge script',
    status: 403,
    body: ORIGIN_PAGE_WITH_EDGE_SCRIPT,
    headers: NO_HEADERS,
    expectedType: ScraperErrorTypes.Generic,
  },
];

describe('classifyHttpFailure', () => {
  it.each(CLASSIFY_CASES)('$label → $expectedType', (row: IClassifyCase) => {
    const failure = { verb: 'POST', url: TARGET_URL, ...row };
    const result = classifyHttpFailure(failure);
    expect(result).toMatchObject({ success: false, errorType: row.expectedType });
  });

  it('reports a Cloudflare block with a fixed reason, never the page body', () => {
    const body = CLOUDFLARE_BLOCK_PAGE;
    const failure = { verb: 'POST', url: TARGET_URL, status: 403, body, headers: NO_HEADERS };
    const result = classifyHttpFailure(failure);
    const expectedMessage = `POST ${TARGET_URL} 403: ${CLOUDFLARE_BLOCK_REASON}`;
    expect(result).toMatchObject({ success: false, errorMessage: expectedMessage });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(BLOCK_PAGE_CLIENT_IP);
    expect(serialized).not.toContain(BLOCK_PAGE_RAY_ID);
    const isStillAuthShaped = isAuthRejectionMessage(expectedMessage);
    expect(isStillAuthShaped).toBe(true);
  });

  it('reports a Cloudflare challenge with a fixed reason, never the page body', () => {
    const body = CLOUDFLARE_CHALLENGE_PAGE;
    const headers = CLOUDFLARE_CHALLENGE_HEADERS;
    const failure = { verb: 'POST', url: TARGET_URL, status: 403, body, headers };
    const result = classifyHttpFailure(failure);
    const expectedMessage = `POST ${TARGET_URL} 403: ${CLOUDFLARE_CHALLENGE_REASON}`;
    expect(result).toMatchObject({ success: false, errorMessage: expectedMessage });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(BLOCK_PAGE_RAY_ID);
  });

  it('keeps the status-plus-snippet message for every other failure', () => {
    const body = CLOUDFRONT_BLOCK_PAGE;
    const failure = { verb: 'GET', url: TARGET_URL, status: 403, body, headers: NO_HEADERS };
    const result = classifyHttpFailure(failure);
    const snippet = CLOUDFRONT_BLOCK_PAGE.slice(0, 120);
    const expectedMessage = `GET ${TARGET_URL} 403: ${snippet}`;
    expect(result).toMatchObject({ success: false, errorMessage: expectedMessage });
  });
});
