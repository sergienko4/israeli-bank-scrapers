/**
 * Builder step resolvers — resolve login and scrape execute functions.
 * Extracted from BuilderAssembly.ts to respect max-lines.
 */

import type { ILoginConfig } from '../../Base/Interfaces/Config/LoginConfig.js';
import {
  createConfigScrapeStep,
  createCustomScrapeStep,
  SCRAPE_STEP,
} from '../Phases/Scrape/ScrapePhase.js';
import type { BasePhase } from '../Types/BasePhase.js';
import type { IPipelineStep } from '../Types/Phase.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import type { IScrapeConfigBase } from '../Types/ScrapeConfig.js';
import { SimplePhase } from '../Types/SimplePhase.js';
import { buildDeclarativePhase } from './BuilderLoginPhase.js';
import { DECLARATIVE_LOGIN_STEP } from './DeclarativeLoginPhase.js';
import { DIRECT_POST_LOGIN_STEP } from './DirectPostLoginPhase.js';
import { NATIVE_LOGIN_STEP } from './NativeLoginPhase.js';

type StepExecFn = IPipelineStep<IPipelineContext, IPipelineContext>['execute'];
type StepResult = Promise<Procedure<IPipelineContext>>;
type Ctx = IPipelineContext;
type LoginFn = (ctx: Ctx, credentials: Record<string, string>) => StepResult;
/** Whether a browser instance is available. */
type HasBrowser = boolean;
/** Whether OTP configuration is present. */
type HasOtp = boolean;
/** Login mode identifier string. */
type LoginModeId = string;

/**
 * Adapt a 2-param login fn to a StepExecFn.
 * @param fn - Bank-provided login function.
 * @returns Adapted function.
 */
function adaptLoginFn(fn: LoginFn): StepExecFn {
  return (ctx: Ctx): StepResult => fn(ctx, ctx.credentials as Record<string, string>);
}

/** Login step lookup by mode name. */
const LOGIN_STEPS: Record<string, StepExecFn> = {
  /**
   * Declarative login delegate.
   * @param ctx - Pipeline context.
   * @param input - Pipeline input.
   * @returns Login result.
   */
  declarative: (ctx: Ctx, input: Ctx): StepResult => DECLARATIVE_LOGIN_STEP.execute(ctx, input),
  /**
   * Direct POST login delegate.
   * @param ctx - Pipeline context.
   * @param input - Pipeline input.
   * @returns Login result.
   */
  directPost: (ctx: Ctx, input: Ctx): StepResult => DIRECT_POST_LOGIN_STEP.execute(ctx, input),
  /**
   * Native login delegate.
   * @param ctx - Pipeline context.
   * @param input - Pipeline input.
   * @returns Login result.
   */
  native: (ctx: Ctx, input: Ctx): StepResult => NATIVE_LOGIN_STEP.execute(ctx, input),
};

/** Bundled builder state for assembly. */
interface IBuilderState {
  readonly hasBrowser: HasBrowser;
  readonly hasOtp: HasOtp;
  readonly loginMode: LoginModeId;
  readonly loginConfig: ILoginConfig | false;
  readonly loginFn: LoginFn | false;
  readonly otpConfig: unknown;
  readonly scrapeFn: ((ctx: Ctx) => StepResult) | false;
  readonly scrapeConfig: IScrapeConfigBase | false;
}

/**
 * Resolve login step execute function.
 * @param state - Builder state.
 * @returns Login StepExecFn.
 */
function resolveLoginExec(state: IBuilderState): StepExecFn {
  if (state.loginFn) return adaptLoginFn(state.loginFn);
  if (state.otpConfig) {
    return (ctx: Ctx, input: Ctx): StepResult => DECLARATIVE_LOGIN_STEP.execute(ctx, input);
  }
  return LOGIN_STEPS[state.loginMode];
}

/**
 * Resolve scrape step execute function.
 * @param state - Builder state.
 * @returns Scrape StepExecFn.
 */
function resolveScrapeExec(state: IBuilderState): StepExecFn {
  if (state.scrapeConfig) {
    const step = createConfigScrapeStep(state.scrapeConfig);
    return (ctx: Ctx, input: Ctx): StepResult => step.execute(ctx, input);
  }
  if (state.scrapeFn) {
    const step = createCustomScrapeStep(state.scrapeFn);
    return (ctx: Ctx, input: Ctx): StepResult => step.execute(ctx, input);
  }
  return (ctx: Ctx, input: Ctx): StepResult => SCRAPE_STEP.execute(ctx, input);
}

/**
 * Build the login phase.
 * @param state - Builder state.
 * @returns Login BasePhase.
 */
function buildLoginPhase(state: IBuilderState): BasePhase {
  if (state.loginConfig) return buildDeclarativePhase(state.loginConfig);
  const exec = resolveLoginExec(state);
  return Reflect.construct(SimplePhase, ['login', exec]) as BasePhase;
}

export type { IBuilderState, LoginFn, StepExecFn };
export { buildLoginPhase, resolveScrapeExec };
