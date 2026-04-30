/**
 * Step resolvers — resolve login and scrape execute functions.
 * Extracted from PipelineAssembly.ts to respect max-lines.
 */

import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import type { IApiDirectCallConfig } from '../../Mediator/ApiDirectCall/IApiDirectCallConfig.js';
import { executeMatrixLoop } from '../../Mediator/Scrape/ScrapePhaseActions.js';
import { createApiDirectCallPhase } from '../../Phases/ApiDirectCall/ApiDirectCallPhase.js';
import { createLoginPhaseFromConfig } from '../../Phases/Login/LoginPhase.js';
import { createConfigScrapeStep, createCustomScrapeStep } from '../../Phases/Scrape/ScrapePhase.js';
import type { BasePhase } from '../../Types/BasePhase.js';
import type { IActionContext, IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import type { CustomScrapeFn, IScrapeConfigBase } from '../../Types/ScrapeConfig.js';
import type { ActionExecFn } from '../../Types/SimplePhase.js';
import { SimplePhase } from '../../Types/SimplePhase.js';
import { DECLARATIVE_LOGIN_STEP } from '../LoginSteps/DeclarativeLoginStep.js';
import { DIRECT_POST_LOGIN_STEP } from '../LoginSteps/DirectPostLoginStep.js';
import { NATIVE_LOGIN_STEP } from '../LoginSteps/NativeLoginStep.js';

type StepExecFn = ActionExecFn;
type StepResult = Promise<Procedure<IPipelineContext>>;
type Ctx = IActionContext;
type FullCtx = IPipelineContext;
type LoginFn = (ctx: FullCtx, credentials: Record<string, string>) => StepResult;
/** Whether a browser instance is available. */
type HasBrowser = boolean;
/** Whether OTP configuration is present. */
type HasOtp = boolean;
/** Login mode identifier string. */
type LoginModeId = string;

/** Step shape accepted by wrapStep — legacy steps that return Procedure<IPipelineContext>. */
interface IWrappableStep {
  /** Execute the step against pipeline context. */
  execute: (c: FullCtx, i: FullCtx) => StepResult;
}

/**
 * Wrap a legacy pipeline step into an ActionExecFn.
 * Bridges IPipelineContext and IActionContext — safe because BasePhase merges via spread.
 * @param step - The legacy pipeline step to wrap.
 * @returns Adapted ActionExecFn.
 */
function wrapStep(step: IWrappableStep): ActionExecFn {
  return (_ctx: Ctx, input: Ctx): Promise<Procedure<IActionContext>> => {
    const full = input as unknown as FullCtx;
    return step.execute(full, full) as unknown as Promise<Procedure<IActionContext>>;
  };
}

/**
 * Adapt a 2-param login fn to an ActionExecFn.
 * @param fn - Bank-provided login function.
 * @returns Adapted function.
 */
function adaptLoginFn(fn: LoginFn): ActionExecFn {
  return (ctx: Ctx): Promise<Procedure<IActionContext>> => {
    const full = ctx as unknown as FullCtx;
    const creds = full.credentials as Record<string, string>;
    return fn(full, creds) as unknown as Promise<Procedure<IActionContext>>;
  };
}

/** Login step lookup by mode name. */
const LOGIN_STEPS: Record<string, StepExecFn> = {
  /** @inheritdoc */
  declarative: wrapStep(DECLARATIVE_LOGIN_STEP),
  /** @inheritdoc */
  directPost: wrapStep(DIRECT_POST_LOGIN_STEP),
  /** @inheritdoc */
  native: wrapStep(NATIVE_LOGIN_STEP),
};

/** Bundled builder state for assembly. */
interface IBuilderState {
  readonly hasBrowser: HasBrowser;
  readonly isHeadless: HasBrowser;
  readonly hasOtp: HasOtp;
  readonly hasOtpTrigger: HasOtp;
  readonly loginMode: LoginModeId;
  readonly loginConfig: ILoginConfig | false;
  readonly loginFn: LoginFn | false;
  readonly scrapeFn: ((ctx: Ctx) => StepResult) | false;
  readonly scrapeConfig: IScrapeConfigBase | false;
  readonly proxyAuth: { readonly companyCode: string } | false;
  readonly apiDirectConfig: IApiDirectCallConfig | false;
}

/**
 * Resolve login step execute function.
 * @param state - Builder state.
 * @returns Login StepExecFn.
 */
function resolveLoginExec(state: IBuilderState): StepExecFn {
  if (state.loginFn) return adaptLoginFn(state.loginFn);
  if (state.hasOtp) return wrapStep(DECLARATIVE_LOGIN_STEP);
  return LOGIN_STEPS[state.loginMode];
}

/**
 * Build a custom scrape exec from a custom scrape function.
 * @param scrapeFn - The bank-provided scrape function.
 * @returns StepExecFn wrapping the custom function.
 */
function buildCustomScrapeExec(scrapeFn: (ctx: Ctx) => StepResult): StepExecFn {
  /**
   * Bridge custom scrape fn to pipeline context.
   * @param ctx - Pipeline context to bridge.
   * @returns Scrape result.
   */
  const bridgedFn: CustomScrapeFn = ctx => scrapeFn(ctx as unknown as Ctx);
  const step = createCustomScrapeStep(bridgedFn);
  return wrapStep(step);
}

/**
 * Resolve scrape step execute function.
 * @param state - Builder state.
 * @returns Scrape StepExecFn.
 */
function resolveScrapeExec(state: IBuilderState): StepExecFn {
  if (state.scrapeConfig) {
    const step = createConfigScrapeStep(state.scrapeConfig);
    return wrapStep(step);
  }
  if (state.scrapeFn) return buildCustomScrapeExec(state.scrapeFn);
  return (_ctx: Ctx, input: Ctx): Promise<Procedure<IActionContext>> => executeMatrixLoop(input);
}

/**
 * Build the login phase.
 * @param state - Builder state.
 * @returns Login BasePhase.
 */
function buildLoginPhase(state: IBuilderState): BasePhase {
  if (state.apiDirectConfig) return createApiDirectCallPhase(state.apiDirectConfig);
  if (state.loginConfig) return createLoginPhaseFromConfig(state.loginConfig);
  const exec = resolveLoginExec(state);
  return Reflect.construct(SimplePhase, ['login', exec]);
}

export type { IBuilderState, LoginFn, StepExecFn };
export { buildLoginPhase, resolveScrapeExec };
