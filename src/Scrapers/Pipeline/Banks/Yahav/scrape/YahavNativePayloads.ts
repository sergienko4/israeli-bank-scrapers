/**
 * Yahav native BaNCS inquiry payloads — the customer and portfolio reads
 * (spec §10.2). A payload asks for data by sending an archetype of the entity
 * it wants back; key order is part of the digested bytes.
 */

import type { VarsMap } from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';

/** A BaNCS object reference: its id and its IOR id. */
interface IYahavNativeRef {
  readonly id: string;
  readonly iorId: string;
}

/** The category the customer and portfolio reads ask for. */
const MIN_CATEGORY = Object.freeze(['min']);

/**
 * An archetype block: the entity version, flagged as a template to fill.
 * @param version - Full entity version, e.g. `Currency_1.0.0`.
 * @returns Archetype block.
 */
function yahavArchetype(version: string): VarsMap {
  return { Ver: version, isArchetype: true };
}

/**
 * An inquiry payload for one entity.
 * @param entity - The entity archetype asked for.
 * @param rest - Keys that follow `DataEntity`, in wire order.
 * @returns Inquiry payload.
 */
function yahavInquiry(entity: VarsMap, rest: VarsMap): VarsMap {
  return { Ver: 'MessagePayload_1.0.0', Operation: 'INQ', DataEntity: [entity], ...rest };
}

/**
 * The reference list naming a portfolio by its IOR id.
 * @param portfolio - The portfolio.
 * @returns Reference-data list.
 */
function yahavPortfolioRefs(portfolio: IYahavNativeRef): readonly VarsMap[] {
  const type = { CDE: 'PORTFOLIOIDENTIFIERIORID', DISP: 'PortfolioIdentifierIORID' };
  return [{ Ver: 'ReferenceData_1.0.0', Id: portfolio.iorId, Type: type }];
}

/** The ILS currency archetype. */
const ILS_CURRENCY = Object.freeze({ ...yahavArchetype('Currency_1.0.0'), Code: { CDE: 'ILS' } });

/** Account-list filters: current (DDA) accounts in ILS. */
const ACCOUNT_FILTERS = Object.freeze([
  {
    Ver: 'ANDFilter_1.0.0',
    Filters: [
      { Ver: 'AccountListFilter_1.0.0', Type: { CDE: 'DDA' }, Operator: 'EQUAL' },
      { Ver: 'AccountListFilter_1.0.0', Operator: 'EQUAL', Currency: ILS_CURRENCY },
    ],
  },
]);

/**
 * The customer read: the logged-in user and its customer record.
 * @returns Profile payload.
 */
function yahavProfilePayload(): VarsMap {
  const entity = {
    ...yahavArchetype('CustomerUser_1.0.0'),
    CustHostMap: { '1': yahavArchetype('PersonCustomer_1.0.0') },
    UserId: yahavArchetype('Identifier_1.0.0'),
    VerifictnId: yahavArchetype('StringVerificationIdentifier_1.0.0'),
  };
  return yahavInquiry(entity, { Category: MIN_CATEGORY });
}

/**
 * The portfolio read: every portfolio the customer holds.
 * @returns Portfolios payload.
 */
function yahavPortfoliosPayload(): VarsMap {
  const portfolio = {
    ...yahavArchetype('Portfolio_1.0.0'),
    Id: yahavArchetype('PortfolioIdentifier_1.0.0'),
  };
  const relation = yahavArchetype('CustomerPortfolioRelationship_1.0.0.BY.1.0');
  return yahavInquiry({ ...relation, Prtflio: portfolio }, { Category: MIN_CATEGORY });
}

/**
 * The account-list read for one portfolio.
 * @param portfolio - The portfolio.
 * @returns Accounts payload.
 */
function yahavAccountsPayload(portfolio: IYahavNativeRef): VarsMap {
  const ids = { PortFoId: { INTERNALIDENTIFIER: '' }, iorId: portfolio.iorId, Id: portfolio.id };
  const id = { Ver: 'PortfolioIdentifier_1.0.0', ...ids };
  const relation = yahavArchetype('PortfolioAccountRelationship_1.0.0');
  const owner = { ...yahavArchetype('Portfolio_1.0.0'), Id: id };
  const entity = { ...relation, Id: yahavArchetype('Identifier_1.0.0'), Prtflio: owner };
  const refs = yahavPortfolioRefs(portfolio);
  return yahavInquiry(entity, { RefDataList: refs, Filters: ACCOUNT_FILTERS });
}

export type { IYahavNativeRef };
export {
  ILS_CURRENCY,
  yahavAccountsPayload,
  yahavArchetype,
  yahavInquiry,
  yahavPortfolioRefs,
  yahavPortfoliosPayload,
  yahavProfilePayload,
};
