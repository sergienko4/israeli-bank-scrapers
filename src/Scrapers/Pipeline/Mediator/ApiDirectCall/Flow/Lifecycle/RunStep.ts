/**
 * RunStep barrel — re-exports the dispatcher and shared step contracts:
 *   - `.dispatch` — `runStep` (default + named).
 *   - `Strategy/Fetch/CookieJar` — `createSimpleCookieJar` (the shared jar).
 *   - `../Steps/RunStep.types` — aliases (`IStepCookieJar`, `IRunStepArgs`, `CarryMap`).
 *
 * Internal helpers (url/headers/prepare) live under `../Steps/`; runtime
 * consumers import the entrypoint through this barrel.
 */

export { createSimpleCookieJar } from '../../../../Strategy/Fetch/CookieJar.js';
export type { CarryMap, IRunStepArgs, IStepCookieJar } from '../Steps/RunStep.types.js';
export { runStep as default, runStep } from './RunStep.dispatch.js';
