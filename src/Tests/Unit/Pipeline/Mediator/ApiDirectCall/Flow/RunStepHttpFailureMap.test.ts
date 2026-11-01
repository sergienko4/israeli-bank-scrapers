/**
 * A step's `httpFailureMap` types a failed bank reply by its HTTP status. A
 * mapped status keeps the safe `<step> HTTP <status>` message and swaps only
 * the type. Any other status, a request that got no reply, a body quoting a
 * mapped status and a WAF block keep the transport's type.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import type { IWafErrorDetails } from '../../../../../../Scrapers/Base/Interfaces/WafErrorDetails.js';
import type {
  IApiDirectCallConfig,
  IStepConfig,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { runStep } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.js';
import type { ITemplateScope } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/RefResolver.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { Procedure } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, failWithDetails } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeStubMediator } from './StubMediator.js';

const HINT = CompanyTypes.OneZero;
const BIND_URL = 'https://example.test/api/bind';

const PLAIN_CONFIG: IApiDirectCallConfig = { flow: 'sms-otp', steps: [], envelope: {} };

/** A step with no status map. */
const PLAIN: IStepConfig = {
  name: 'bind',
  urlTag: 'auth.bind',
  body: { shape: {} },
  extractsToCarry: { token: '/access_token' },
};

/** The same step, typing a 401 as a wrong password and a 403 as a lock. */
const MAPPED: IStepConfig = {
  ...PLAIN,
  httpFailureMap: {
    '401': ScraperErrorTypes.InvalidPassword,
    '403': ScraperErrorTypes.AccountBlocked,
  },
};

/** One transport failure and the failure the step must report. */
interface IMapCase {
  readonly label: string;
  readonly step: IStepConfig;
  readonly type: ScraperErrorTypes;
  readonly message: string;
  readonly expectedType: ScraperErrorTypes;
  readonly expected: string;
}

const MAP_CASES: readonly IMapCase[] = [
  {
    label: 'a mapped 401',
    step: MAPPED,
    type: ScraperErrorTypes.Generic,
    message: `POST ${BIND_URL} 401: {"error":"invalid_user"}`,
    expectedType: ScraperErrorTypes.InvalidPassword,
    expected: 'bind HTTP 401',
  },
  {
    label: 'a mapped 403',
    step: MAPPED,
    type: ScraperErrorTypes.Generic,
    message: `POST ${BIND_URL} 403: denied`,
    expectedType: ScraperErrorTypes.AccountBlocked,
    expected: 'bind HTTP 403',
  },
  {
    label: 'an unmapped status',
    step: MAPPED,
    type: ScraperErrorTypes.Generic,
    message: `POST ${BIND_URL} 500: oops`,
    expectedType: ScraperErrorTypes.Generic,
    expected: 'bind HTTP 500',
  },
  {
    label: 'a body quoting a mapped status',
    step: MAPPED,
    type: ScraperErrorTypes.Generic,
    message: `POST ${BIND_URL} 500: upstream said 401: no`,
    expectedType: ScraperErrorTypes.Generic,
    expected: 'bind HTTP 500',
  },
  {
    label: 'a request with no reply',
    step: MAPPED,
    type: ScraperErrorTypes.Timeout,
    message: `POST ${BIND_URL} network error: timeout`,
    expectedType: ScraperErrorTypes.Timeout,
    expected: 'bind TIMEOUT',
  },
  {
    label: 'a no-reply reason quoting a mapped status',
    step: MAPPED,
    type: ScraperErrorTypes.Timeout,
    message: `POST ${BIND_URL} network error: proxy reported 401: denied`,
    expectedType: ScraperErrorTypes.Timeout,
    expected: 'bind TIMEOUT',
  },
  {
    label: 'a 401 on a step with no map',
    step: PLAIN,
    type: ScraperErrorTypes.Generic,
    message: `POST ${BIND_URL} 401: {"error":"invalid_user"}`,
    expectedType: ScraperErrorTypes.Generic,
    expected: 'bind HTTP 401',
  },
];

const WAF_DETAILS: IWafErrorDetails = {
  provider: 'cloudflare',
  httpStatus: 403,
  pageTitle: 'Attention Required',
  pageUrl: BIND_URL,
  suggestions: [],
};

beforeAll((): void => {
  registerWkUrl('auth.bind', HINT, BIND_URL);
});

/**
 * Run one step whose call answers with the given failure.
 * @param step - The step to run.
 * @param answer - The transport's failure.
 * @returns The step result.
 */
function runFailing(step: IStepConfig, answer: Procedure<never>): Promise<unknown> {
  const bus = makeStubMediator({ responses: [answer], captures: [] });
  const scope: ITemplateScope = { carry: {}, creds: {}, config: PLAIN_CONFIG, keypair: undefined };
  return runStep({ step, bus, scope, companyId: HINT });
}

describe('httpFailureMap', () => {
  it.each(MAP_CASES)('types $label', async (row): Promise<void> => {
    const answer = fail(row.type, row.message);
    const result = await runFailing(row.step, answer);
    expect(result).toMatchObject({
      success: false,
      errorType: row.expectedType,
      errorMessage: row.expected,
    });
  });

  it('leaves a WAF block on a mapped status as it is', async (): Promise<void> => {
    const message = `POST ${BIND_URL} 403: blocked by Cloudflare edge (WAF) before reaching the API`;
    const refused = failWithDetails(ScraperErrorTypes.WafBlocked, message, WAF_DETAILS);
    const result = await runFailing(MAPPED, refused);
    expect(result).toEqual(refused);
  });
});
