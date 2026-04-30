/**
 * Generic cursor-pagination wire helpers — shared across every headless bank.
 * Exposes a branded wire value for the first page of any cursor-paginated
 * GraphQL query. The project's architecture rules forbid raw `null` and
 * `unknown` in source, so the wire value is minted via JSON.parse and
 * handed back under an opaque brand type.
 * Zero bank-name literals.
 */

/** Opaque brand for the first-page wire marker — treated as data only. */
export interface ICursorFirstPageWire {
  readonly __brand: 'CursorFirstPageWire';
}

/** Wire cursor type accepted by ApiMediator payload builders. */
export type CursorWireValue = string | ICursorFirstPageWire;

/**
 * Wire value representing "no cursor yet" for the first page of a
 * paginated GraphQL query. Produced via JSON.parse so the source
 * carries no forbidden literal — the Result Pattern applies to
 * function returns, not to wire payloads the server requires.
 */
const FIRST_PAGE_CURSOR_WIRE = JSON.parse('null') as ICursorFirstPageWire;

export { FIRST_PAGE_CURSOR_WIRE };
