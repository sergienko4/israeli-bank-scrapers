/**
 * #307 anchor-threading invariant test — `LoginFieldDiscovery`
 * dataflow guarantee.
 *
 * <p>Pins the bug Isracard's 2-form lobby exposed in 2026-06-05: PRE-
 * LOGIN flips the OTP form to a password form (`#otpLobbyFormPassword`),
 * but LOGIN PRE was scanning the WHOLE page for `password`/`id`/
 * `card6Digits`. The OTP form's `otpLoginPwd` won DOM order and was
 * filled instead of the real password input, so submit always
 * INVALID_PASSWORD'd.
 *
 * <p>The fix: once `discoverForm` resolves the anchor, every
 * subsequent `mediator.resolveField` call gets the anchor's selector
 * as the 4th arg (`formSelector`), and `SelectorResolverPipeline`
 * applies form-scope to every candidate. This test verifies the
 * dataflow contract:
 * <ul>
 *   <li>First field call sees `formSelector === ''` (no anchor yet).</li>
 *   <li>discoverForm fires AFTER first successful resolution.</li>
 *   <li>Every subsequent field call sees the anchor's selector.</li>
 * </ul>
 */

import pino from 'pino';
import type { Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/Errors.js';
import type { ILoginConfig } from '../../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import type { IElementMediator } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { IFormAnchor } from '../../../../../Scrapers/Pipeline/Mediator/Form/FormAnchor.js';
import { executeDiscoverFields } from '../../../../../Scrapers/Pipeline/Mediator/Login/LoginFieldDiscovery.js';
import type { IFieldContext } from '../../../../../Scrapers/Pipeline/Mediator/Selector/SelectorResolverPipeline.js';
import { none, type Option, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import { fail, type Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

/** Recorded shape of one `resolveField` call. */
interface IResolveFieldCall {
  readonly fieldKey: string;
  readonly formSelector: string;
}

/**
 * Build a minimal fake page that satisfies the bits of `Page` that
 * `executeDiscoverFields` actually touches: `mainFrame()` returning
 * self (so `computeContextId` short-circuits to the main-context id
 * without invoking `Frame.url()`).
 * @returns Page-shaped stub whose mainFrame is itself.
 */
function makeFakePage(): Page {
  const page: { mainFrame: () => Page; isClosed: () => boolean } = {
    /**
     * Closed-state probe — always reports open.
     * @returns Always false.
     */
    isClosed: (): boolean => false,
    /**
     * Main-frame accessor — self-reference avoids real Frame.url() calls.
     * @returns Self cast as Page (alias for main-frame).
     */
    mainFrame: (): Page => page as unknown as Page,
  };
  return page as unknown as Page;
}

/** Bundled args for {@link makeRecordingMediator}. */
interface IMediatorArgs {
  readonly calls: IResolveFieldCall[];
  readonly anchor: IFormAnchor;
  readonly page: Page;
}

/**
 * Build a Procedure-shaped success result for any resolveField stub.
 * @param page - Page bound into the resulting IFieldContext.
 * @returns Success-shaped Procedure with a static `#otpLoginPwd` selector.
 */
function buildFieldCtx(page: Page): Procedure<IFieldContext> {
  return {
    success: true,
    value: {
      selector: '#otpLoginPwd',
      context: page,
      isResolved: true,
      resolvedVia: 'wellKnown',
      round: 'mainPage',
    },
  };
}

/** resolveField args alias to dodge max-params on the 4-arg signature. */
type ResolveFieldArgs = Parameters<IElementMediator['resolveField']>;

/**
 * Build a resolveField stub that records each call's formSelector arg
 * and resolves with a static success.
 * @param args - Calls accumulator + anchor + shared page.
 * @returns A 4-arg resolveField function bound to the recording array.
 */
function buildRecordingResolveField(args: IMediatorArgs): IElementMediator['resolveField'] {
  return (...callArgs: ResolveFieldArgs): Promise<Procedure<IFieldContext>> => {
    const [fieldKey, , , formSelector] = callArgs;
    args.calls.push({ fieldKey, formSelector: formSelector ?? '<undefined>' });
    const ctx = buildFieldCtx(args.page);
    return Promise.resolve(ctx);
  };
}

/**
 * Build a mediator that records every `resolveField`'s formSelector arg
 * and returns a success-shaped `IFieldContext` for each field; the
 * first call's `discoverForm` returns the supplied anchor.
 * @param args - Calls accumulator + anchor stub + shared page.
 * @returns Recording mediator.
 */
function makeRecordingMediator(args: IMediatorArgs): IElementMediator {
  const ctx = buildFieldCtx(args.page);
  const submitFail = fail(ScraperErrorTypes.Generic, 'stub: no submit');
  return {
    resolveField: buildRecordingResolveField(args),
    /**
     * Form-anchor discovery stub — always returns the configured anchor.
     * @returns Option-wrapped IFormAnchor.
     */
    discoverForm: (): Promise<Option<IFormAnchor>> => {
      const opt = some(args.anchor);
      return Promise.resolve(opt);
    },
    /**
     * Clickable resolver stub — same shape as fields.
     * @returns Static success Procedure.
     */
    resolveClickable: (): Promise<Procedure<IFieldContext>> => Promise.resolve(ctx),
    /**
     * Visibility resolver stub — fails because submit isn't being tested.
     * @returns Generic failure Procedure.
     */
    resolveVisible: (): Promise<Procedure<IFieldContext>> => Promise.resolve(submitFail),
    /**
     * Cached form-selector accessor — returns the anchor's selector.
     * @returns The configured anchor's CSS selector.
     */
    getCachedFormSelector: (): string => args.anchor.selector,
  } as unknown as IElementMediator;
}

/**
 * Build a fixed `ILoginConfig` matching Isracard's 3-field shape:
 * password / id / card6Digits.
 * @returns Login config.
 */
function makeLoginConfig(): ILoginConfig {
  return {
    loginUrl: 'about:blank',
    fields: [
      { credentialKey: 'password', selectors: [] },
      { credentialKey: 'id', selectors: [] },
      { credentialKey: 'card6Digits', selectors: [] },
    ],
    submit: [],
    possibleResults: { success: [] },
  };
}

/**
 * Drive `executeDiscoverFields` once and return the recorded calls +
 * the post-discovery anchor option for assertions.
 * @returns Recorded calls + final anchor option.
 */
async function runOnce(): Promise<{
  readonly calls: readonly IResolveFieldCall[];
  readonly finalAnchor: Option<IFormAnchor>;
}> {
  const fakePage = makeFakePage();
  const anchor: IFormAnchor = { selector: '#otpLobbyFormPassword', context: fakePage };
  const calls: IResolveFieldCall[] = [];
  const mediator = makeRecordingMediator({ calls, anchor, page: fakePage });
  const result = await executeDiscoverFields({
    mediator,
    config: makeLoginConfig(),
    activeFrame: fakePage,
    page: fakePage,
    logger: pino({ enabled: false }),
  });
  return { calls, finalAnchor: result.formAnchor };
}

describe('LoginFieldDiscovery — #307 anchor-threading dataflow', () => {
  it('passes empty formSelector to the FIRST resolveField call', async () => {
    const out = await runOnce();
    expect(out.calls.length).toBeGreaterThan(0);
    expect(out.calls[0].fieldKey).toBe('password');
    expect(out.calls[0].formSelector).toBe('');
  });

  it('passes the discovered form selector to subsequent resolveField calls', async () => {
    const out = await runOnce();
    expect(out.calls.length).toBeGreaterThanOrEqual(3);
    const subsequent = out.calls.slice(1).filter((c): boolean => c.fieldKey !== 'password');
    for (const call of subsequent) {
      expect(call.formSelector).toBe('#otpLobbyFormPassword');
    }
  });

  it('captures the form anchor in the discovery result Option', async () => {
    const out = await runOnce();
    const emptyOpt = none();
    expect(out.finalAnchor).not.toEqual(emptyOpt);
    if (out.finalAnchor.has) {
      expect(out.finalAnchor.value.selector).toBe('#otpLobbyFormPassword');
    }
  });
});
