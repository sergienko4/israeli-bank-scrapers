/**
 * Yahav native bootstrap (spec §10.2, AD-Y): the BaNCS login, then the
 * profile read that proves the customer, then the portfolio read whose
 * default portfolio — else the first — every account read names. The
 * response session rotates the session state on each answer; these patches
 * add only the portfolio. Step names stay clear of the `customer` query tag.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { ApiRecord } from '../../../Mediator/Scrape/AutoMapperFacade/AutoMapperTypes.js';
import { getIn } from '../../../Mediator/Scrape/Bancs/BancsShape.js';
import type {
  IApiDirectScrapeBootstrapStep,
  IBootstrapExtractArgs,
  SessionContextPatch,
  VarsMap,
} from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { YAHAV_BANCS_PATHS as PATHS } from '../../../Registry/Config/PipelineBankConfigYahavConstants.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import { fail, type Procedure, succeed } from '../../../Types/Procedure.js';
import { yahavEntities, yahavRefOf } from './YahavAccountExtract.js';
import { yahavLoginBody } from './YahavNativeEnvelope.js';
import { yahavPortfoliosPayload, yahavProfilePayload } from './YahavNativePayloads.js';
import { yahavLoginHeaders, yahavReadHeaders, yahavReadVars } from './YahavShapeCall.js';
import { YAHAV_SESSION_KEYS as KEYS, yahavCallUrl } from './YahavShapeHelpers.js';

/**
 * The login body at this instant.
 * @returns Login body.
 */
function loginVars(): VarsMap {
  const now = new Date();
  return yahavLoginBody(now);
}

/**
 * The login adds nothing beyond what the response session rotates.
 * @returns Empty patch.
 */
function loginPatch(): Procedure<SessionContextPatch> {
  return succeed({});
}

/**
 * The profile read body.
 * @param ctx - Action context.
 * @returns Read body.
 */
function profileVars(ctx: IActionContext): VarsMap {
  const payload = yahavProfilePayload();
  return yahavReadVars(ctx, PATHS.customer, payload);
}

/**
 * Whether an entity is the logged-in customer user.
 * @param entity - Profile entity.
 * @returns True for the customer user.
 */
function isCustomerUser(entity: ApiRecord): boolean {
  return entity.Ver === 'CustomerUser_1.0.0';
}

/**
 * Pass a profile naming the customer user; fail any other.
 * @param args - Profile answer.
 * @returns Empty patch, or the missing-profile failure.
 */
function profilePatch(args: IBootstrapExtractArgs): Procedure<SessionContextPatch> {
  const hasUser = yahavEntities(args.body).some(isCustomerUser);
  if (hasUser) return succeed({});
  return fail(ScraperErrorTypes.Generic, 'profile customer missing');
}

/**
 * The portfolio read body.
 * @param ctx - Action context.
 * @returns Read body.
 */
function portfolioVars(ctx: IActionContext): VarsMap {
  const payload = yahavPortfoliosPayload();
  return yahavReadVars(ctx, PATHS.portfolio, payload);
}

/**
 * The default portfolio relationship, else the first, else none.
 * @param entities - Portfolio entities.
 * @returns The chosen relationship, or empty.
 */
function chosenPortfolio(entities: readonly ApiRecord[]): ApiRecord {
  const preferred = entities.find(entity => entity.DefPortfolioInd === true);
  return preferred ?? entities.at(0) ?? {};
}

/**
 * Store the chosen portfolio's ids; fail when they are unusable.
 * @param args - Portfolio answer.
 * @returns Portfolio patch, or the missing-reference failure.
 */
function portfolioPatch(args: IBootstrapExtractArgs): Procedure<SessionContextPatch> {
  const entities = yahavEntities(args.body);
  const chosen = chosenPortfolio(entities);
  const id = getIn(chosen, ['Prtflio', 'Id', 'Id']);
  const iorId = getIn(chosen, ['Prtflio', 'Id', 'iorId']);
  const ref = yahavRefOf(id, iorId);
  if (ref === false) return fail(ScraperErrorTypes.Generic, 'portfolio reference missing');
  return succeed({ [KEYS.portfolioId]: ref.id, [KEYS.portfolioIorId]: ref.iorId });
}

/** The BaNCS login. */
const LOGIN_STEP: IApiDirectScrapeBootstrapStep = {
  name: 'login',
  urlTag: yahavCallUrl(PATHS.login),
  method: 'POST',
  buildVars: loginVars,
  extraHeaders: yahavLoginHeaders(PATHS.login),
  extractPatch: loginPatch,
};

/** The profile read. */
const PROFILE_STEP: IApiDirectScrapeBootstrapStep = {
  name: 'profile',
  urlTag: yahavCallUrl(PATHS.customer),
  method: 'POST',
  buildVars: profileVars,
  extraHeaders: yahavReadHeaders(PATHS.customer),
  extractPatch: profilePatch,
};

/** The portfolio read. */
const PORTFOLIO_STEP: IApiDirectScrapeBootstrapStep = {
  name: 'portfolio',
  urlTag: yahavCallUrl(PATHS.portfolio),
  method: 'POST',
  buildVars: portfolioVars,
  extraHeaders: yahavReadHeaders(PATHS.portfolio),
  extractPatch: portfolioPatch,
};

/** The bootstrap steps, in dispatch order. */
const YAHAV_BOOTSTRAP: readonly IApiDirectScrapeBootstrapStep[] = [
  LOGIN_STEP,
  PROFILE_STEP,
  PORTFOLIO_STEP,
];

export default YAHAV_BOOTSTRAP;
export { YAHAV_BOOTSTRAP };
