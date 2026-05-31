/**
 * Re-export shim for the canonical Pipeline ElementsInteractions module.
 *
 * @deprecated The canonical implementation lives at
 * `src/Scrapers/Pipeline/Mediator/Elements/ElementsInteractions.ts` and
 * its sibling sub-modules (`ElementsInputActions`, `ElementWaitAction`,
 * `PageEvalAction`). Phase 3 Commit 2 (Common ↔ Pipeline unification)
 * collapsed this file from a duplicate ~400 LoC implementation into a
 * thin re-export. All 16 public symbols remain available from this
 * path so existing Common-tree callers (13 prod + 5 test) keep
 * compiling unchanged. New code should import directly from the
 * Pipeline path. This shim will be removed in a follow-up phase once
 * all Common importers are migrated.
 *
 * Public-API note: the Pipeline implementation adds PII-redacted
 * logging via `maskVisibleText`. All function signatures and return
 * types match the previous Common implementation byte-for-byte.
 */
export type {
  IPageEvalAllOpts,
  IPageEvalOpts,
  IWaitOptions,
} from '../Scrapers/Pipeline/Mediator/Elements/ElementsInteractions.js';
export {
  capturePageText,
  clickButton,
  clickLink,
  deepFillInput,
  dropdownElements,
  dropdownSelect,
  elementPresentOnPage,
  fillInput,
  pageEval,
  pageEvalAll,
  setValue,
  waitUntilElementDisappear,
  waitUntilElementFound,
  waitUntilIframeFound,
} from '../Scrapers/Pipeline/Mediator/Elements/ElementsInteractions.js';
