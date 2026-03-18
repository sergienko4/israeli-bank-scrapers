/**
 * Pluggable fetch strategy — abstracts how HTTP calls are made.
 * Returns Procedure<T> (never null/undefined).
 */

import type { Procedure } from '../Types/Procedure.js';

/** Fetch strategy interface — all fetches return strong-typed Procedure. */
interface IFetchStrategy {
  fetchPost<T>(url: string, data: Record<string, string>): Promise<Procedure<T>>;
  fetchGet<T>(url: string): Promise<Procedure<T>>;
}

export default IFetchStrategy;
export type { IFetchStrategy };
