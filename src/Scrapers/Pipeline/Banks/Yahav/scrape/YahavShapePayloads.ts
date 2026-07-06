/**
 * Yahav BaNCS request Payloads — the per-call `Payload` blocks that
 * differentiate the multiplexed `/account` endpoint. This module builds the
 * accounts (DDA/ILS filtered) and balance (`portfolioBalance`) Payloads; both
 * ride the portfolio refs (`iorId` + `Id`) captured at BIND. Grounded verbatim
 * in the captured trace request bodies (calls 0014 + 0023).
 */

import type { VarsMap } from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import { portfolioRefs } from './YahavShapeEnvelope.js';

/** Hebrew shekel display label (unicode-escaped to keep the source ASCII). */
const ILS_DISP = '\u05e9\u05e7\u05dc';

/** Portfolio reference-data type block (shared by every RefDataList entry). */
const PORTFOLIO_REF_TYPE = { CDE: 'PORTFOLIOIDENTIFIERIORID', DISP: 'PortfolioIdentifierIORID' };

/**
 * Portfolio reference-data list (the captured portfolio iorId), shared by
 * the accounts, balance and transactions Payloads.
 * @param ctx - Action context (portfolio-ref source).
 * @returns Single-element RefDataList.
 */
export function refDataList(ctx: IActionContext): VarsMap[] {
  const { iorId } = portfolioRefs(ctx);
  return [{ Ver: 'ReferenceData_1.0.0', Id: iorId, Type: PORTFOLIO_REF_TYPE }];
}

/**
 * Portfolio identifier block — the captured iorId + portfolio Id.
 * @param ctx - Action context.
 * @returns `PortfolioIdentifier` object.
 */
function portfolioIdent(ctx: IActionContext): VarsMap {
  const refs = portfolioRefs(ctx);
  const portFoId = { INTERNALIDENTIFIER: '' };
  return { Ver: 'PortfolioIdentifier_1.0.0', PortFoId: portFoId, iorId: refs.iorId, Id: refs.id };
}

/**
 * Portfolio `DataEntity` shared by the accounts + balance Payloads.
 * @param ctx - Action context.
 * @returns Single-element DataEntity array.
 */
function portfolioEntity(ctx: IActionContext): VarsMap[] {
  const idBlock = { Ver: 'Identifier_1.0.0', isArchetype: true };
  const prtflio = { Ver: 'Portfolio_1.0.0', isArchetype: true, Id: portfolioIdent(ctx) };
  const rel = 'PortfolioAccountRelationship_1.0.0';
  return [{ Ver: rel, isArchetype: true, Id: idBlock, Prtflio: prtflio }];
}

/** Account-list filter: DDA (demand-deposit) account type. */
const DDA_FILTER = {
  Ver: 'AccountListFilter_1.0.0',
  Type: { CDE: 'DDA', DISP: 'DEMANDDEPOSITACCOUNT' },
  Operator: 'EQUAL',
};

/**
 * Account-list filter: ILS currency.
 * @returns Currency filter block.
 */
function ilsFilter(): VarsMap {
  const code = { CDE: 'ILS', DISP: ILS_DISP };
  const currency = { Ver: 'Currency_1.0.0', isArchetype: true, Code: code };
  return { Ver: 'AccountListFilter_1.0.0', Currency: currency, Operator: 'EQUAL' };
}

/**
 * AND-filter pairing the DDA type + ILS currency account filters.
 * @returns Single-element Filters array.
 */
function accountFilters(): VarsMap[] {
  return [{ Ver: 'ANDFilter_1.0.0', Filters: [DDA_FILTER, ilsFilter()] }];
}

/**
 * Accounts request Payload (call 0014) — DDA/ILS-filtered account list.
 * @param ctx - Action context.
 * @returns Accounts `Payload` block.
 */
export function accountsPayload(ctx: IActionContext): VarsMap {
  const head = { Ver: 'MessagePayload_1.0.0', DataEntity: portfolioEntity(ctx), Operation: 'INQ' };
  return { ...head, RefDataList: refDataList(ctx), Filters: accountFilters() };
}

/**
 * Balance request Payload (call 0023) — `portfolioBalance` category.
 * @param ctx - Action context.
 * @returns Balance `Payload` block.
 */
export function balancePayload(ctx: IActionContext): VarsMap {
  const head = { Ver: 'MessagePayload_1.0.0', DataEntity: portfolioEntity(ctx), Operation: 'INQ' };
  return { ...head, Category: ['portfolioBalance'], RefDataList: refDataList(ctx) };
}
