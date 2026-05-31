/**
 * Phase H.T4 — barrel re-export of every production phase action
 * function exercised by the full-flow factory. Exists so
 * {@link FullFlowFactory.test.ts} can stay under the project's
 * `import-x/max-dependencies` ceiling (15 modules) while still
 * chaining all 10 phase factories per row.
 *
 * <p>Test-only convenience. Production code never imports through
 * this barrel — phases own their action modules directly.
 */

export {
  executeAccountResolveFinal,
  executeAccountResolvePost,
} from '../../../../../../Scrapers/Pipeline/Mediator/AccountResolve/AccountResolveActions.js';
export { executeAuthDiscoveryPost } from '../../../../../../Scrapers/Pipeline/Mediator/AuthDiscovery/AuthDiscoveryActions.js';
export { executeValidateLoginArea } from '../../../../../../Scrapers/Pipeline/Mediator/Home/HomeActions.js';
export { executeValidatePage } from '../../../../../../Scrapers/Pipeline/Mediator/Init/InitActions.js';
export { executeLoginSignal } from '../../../../../../Scrapers/Pipeline/Mediator/Login/LoginPhaseActions.js';
export {
  executeFillFinal,
  executeFillPost,
} from '../../../../../../Scrapers/Pipeline/Mediator/OtpFill/OtpFillPhaseActions.js';
export {
  executeTriggerFinal,
  executeTriggerPost,
} from '../../../../../../Scrapers/Pipeline/Mediator/OtpTrigger/OtpTriggerPhaseActions.js';
export {
  executeSignalToLogin,
  executeValidateForm,
} from '../../../../../../Scrapers/Pipeline/Mediator/PreLogin/PreLoginPhaseActions.js';
export {
  executeStampAccounts,
  executeValidateResults,
} from '../../../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapePhaseActions.js';
export {
  executeLogResults,
  executeSignalDone,
  executeStartCleanup,
} from '../../../../../../Scrapers/Pipeline/Mediator/Terminate/TerminateActions.js';
