/**
 * IApiDirectScrapeShape — per-bank config for the ApiDirectScrape
 * phase. Pure data: WK query labels, variable builders, response
 * unwrappers, pagination cursor shape. Zero bank-name coupling.
 *
 * Commit A: STUB interface (empty fields). Commit D moves the
 * full body in from Banks/_Shared/HeadlessScrapeShape.ts with
 * renamed types.
 */

/**
 * Scaffold marker — holds the generic parameters so the type
 * parameters do not collapse to `unknown` in Commit A.
 */
export interface IApiDirectScrapeShapeScaffoldMarker<TAcct, TCursor> {
  readonly tAcct?: TAcct;
  readonly tCursor?: TCursor;
}

/**
 * Bank-specific config consumed by the ApiDirectScrape phase.
 * The interface body lands in Commit D — this stub keeps the
 * type-only file present so its tests + import path exist from
 * Commit A onward.
 */
export interface IApiDirectScrapeShape<TAcct, TCursor> {
  readonly stepName: string;
  readonly __scaffold: IApiDirectScrapeShapeScaffoldMarker<TAcct, TCursor>;
}
