import pino from 'pino';
import type { Page } from 'playwright-core';

import ScraperError from '../../../Scrapers/Base/ScraperError.js';
import type {
  IElementMediator,
  IRaceResult,
} from '../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { IHomeDiscovery } from '../../../Scrapers/Pipeline/Mediator/Home/HomeResolver.js';
import { resolveHomeStrategy } from '../../../Scrapers/Pipeline/Mediator/Home/HomeResolver.js';
import { isOk, succeed } from '../../../Scrapers/Pipeline/Types/Procedure.js';

const LOGIN_HREF = 'https://digital.example-bank.local/personalarea/Login/';
const LOGIN_LABEL = 'כניסה לחשבון';

/** Per-attribute scripted values for a representative home control. */
interface IAttrResponses {
  readonly target: string;
  readonly href: string;
}

/**
 * Builds a representative visible control result.
 * @returns Visible control result.
 */
function makeVisibleResult(): IRaceResult {
  return { ...NOT_FOUND_RESULT, found: true as const, value: LOGIN_LABEL };
}

/**
 * Reads scripted target and href values.
 * @param responses - Scripted attribute values.
 * @param attr - Attribute name.
 * @returns Scripted attribute value.
 */
function readAttributeValue(responses: IAttrResponses, attr: string): string {
  return attr === 'target' ? responses.target : responses.href;
}

/**
 * Scripted mediator for representative home-control attributes.
 */
class ScriptedHomeMediator {
  private readonly _presence = succeed(true);
  private readonly _visible = makeVisibleResult();

  /**
   * Stores scripted attribute responses.
   * @param _responses - Scripted attribute values.
   */
  constructor(private readonly _responses: IAttrResponses) {}

  /**
   * Resolves the representative visible control.
   * @returns Visible control.
   */
  public resolveVisible(): Promise<IRaceResult> {
    return Promise.resolve(this._visible);
  }

  /**
   * Resolves the representative visible control list.
   * @returns Visible control list.
   */
  public resolveAllVisible(): Promise<readonly IRaceResult[]> {
    return Promise.resolve([this._visible]);
  }

  /**
   * Reports that the representative control carries probed attributes.
   * @returns Attribute-presence result.
   */
  public checkAttribute(): ReturnType<IElementMediator['checkAttribute']> {
    return Promise.resolve(this._presence);
  }

  /**
   * Reads scripted target and href values.
   * @param _race - Ignored resolved control.
   * @param attr - Attribute name.
   * @returns Scripted attribute value.
   */
  public getAttributeValue(_race: IRaceResult, attr: string): Promise<string> {
    const value = readAttributeValue(this._responses, attr);
    return Promise.resolve(value);
  }
}

/**
 * Builds a mediator that resolves one representative visible anchor.
 * @param responses - Scripted attribute values.
 * @returns Mock element mediator.
 */
function makeHomeMediator(responses: IAttrResponses): IElementMediator {
  return new ScriptedHomeMediator(responses) as unknown as IElementMediator;
}

/**
 * Minimal page stub for HOME PRE.
 * @returns Page stub.
 */
function makePageStub(): Page {
  return {
    /**
     * Page URL.
     * @returns Static home URL.
     */
    url: (): string => 'https://www.example-bank.local/',
    /**
     * Page frames.
     * @returns Empty frame list.
     */
    frames: (): Page[] => [],
  } as unknown as Page;
}

/**
 * Builds a silent logger for HOME PRE.
 * @returns Silent pino logger.
 */
function silentLogger(): pino.Logger {
  return pino({ enabled: false });
}

/**
 * Resolves HOME PRE for one representative control.
 * @param responses - Scripted attribute values.
 * @returns Discovery result.
 */
async function runResolve(responses: IAttrResponses): Promise<IHomeDiscovery> {
  const mediator = makeHomeMediator(responses);
  const page = makePageStub();
  const logger = silentLogger();
  const result = await resolveHomeStrategy(mediator, logger, page);
  if (!isOk(result)) throw new ScraperError('HOME PRE expected to succeed in oracle');
  return result.value;
}

describe('Leumi oracle — home nav override readiness', () => {
  it('does not attach a nav override when the representative control lacks target blank', async () => {
    const discovery = await runResolve({ target: '', href: LOGIN_HREF });
    expect(discovery.navHrefOverride).toBeUndefined();
  });

  it('attaches a nav override only when the representative control opens a new tab', async () => {
    const discovery = await runResolve({ target: '_blank', href: LOGIN_HREF });
    expect(discovery.navHrefOverride).toBe(LOGIN_HREF);
  });
});
