/**
 * ITokenContext — the narrow context port consumed by the token
 * lifecycle (primeInitial / primeFresh). Token strategies need ONLY
 * the resolved bank identity, never the whole IPipelineContext
 * god-object. Defining this minimal port in the Types/Domain leaf lets
 * the ApiMediator token surface depend on it instead of the concrete
 * PipelineContext, breaking the Mediator ⟷ PipelineContext cycle (DIP).
 * IPipelineContext structurally satisfies this port (it carries
 * `companyId`), so existing call sites pass through unchanged.
 */

import type { CompanyTypes } from '../../../../Definitions.js';

/** Minimal context surface required to prime a bank token. */
interface ITokenContext {
  readonly companyId: CompanyTypes;
}

export type { ITokenContext };
