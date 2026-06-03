/**
 * OTP-TRIGGER Mediator orchestrator — slim re-exporter.
 * Each PRE/ACTION/POST/FINAL lives in its own sibling file to satisfy
 * the strict Mediator overlay (max-lines:150, max-lines-per-function:10).
 */

export { default as executeTriggerAction } from './OtpTriggerPhaseActions.Click.js';
export { default as executeTriggerFinal } from './OtpTriggerPhaseActions.Final.js';
export { default as executeTriggerPost } from './OtpTriggerPhaseActions.Post.js';
export { default as executeTriggerPre } from './OtpTriggerPhaseActions.Pre.js';
