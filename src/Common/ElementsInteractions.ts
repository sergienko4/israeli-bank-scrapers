/**
 * Re-export shim for the canonical Pipeline ElementsInteractions module.
 *
 * @deprecated The canonical implementation lives at
 * `src/Scrapers/Pipeline/Mediator/Elements/ElementsInteractions.ts` and
 * its sibling sub-modules (`ElementsInputActions`, `ElementWaitAction`,
 * `PageEvalAction`). Phase 3 Commit 2 (Common ↔ Pipeline unification)
 * collapsed this file from a duplicate ~400 LoC implementation into a
 * thin re-export. All 17 public symbols (14 values + 3 types) remain
 * available from this path so existing legacy callers keep compiling
 * unchanged — 8 production and 18 test importers as of this writing.
 * New code should import directly from the Pipeline path.
 *
 * This shim is retained deliberately rather than scheduled for
 * deletion: migration work is scoped to banks on the Pipeline flow,
 * and every remaining caller here is legacy. Re-derive the counts
 * before quoting them — `git grep -l "ElementsInteractions.js" -- src`
 * also matches the string fixtures in `LintAndValidate.test.ts`, which
 * are not importers.
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
