/** Pipeline builder — fluent builder for IPipelineDescriptor. */

import type { ScraperOptions } from '../../../Base/Interface.js';
import type { IApiDirectCallConfig } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import {
  type CredentialEnricher,
  deviceIdentityEnricherOf,
} from '../../Mediator/ApiDirectCall/DeviceIdentity/DeviceIdentityProvider.js';
import type { IApiDirectScrapeShape } from '../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { Procedure } from '../../Types/Procedure.js';
import type { IPipelineDescriptor } from '../PipelineDescriptor.js';
import buildDescriptor from './PipelineBuilderHelpers.js';
import {
  bindBankTextRule,
  createEmptyState,
  type IBuilderState,
  setApiDirectConfig,
  setApiDirectScrape,
  snapshotFields,
} from './PipelineBuilderSetters.js';

/** Fluent builder for pipeline descriptors. */
class PipelineBuilder {
  private readonly _s: IBuilderState = createEmptyState();

  /**
   * Set scraper options.
   * @param options - Scraper options.
   * @returns This builder.
   */
  public withOptions(options: ScraperOptions): this {
    this._s.options = options;
    return this;
  }

  /**
   * Wire the full API-direct bank flow in one call — replaces
   * LOGIN+OTP with a config-driven API-DIRECT-CALL phase AND binds
   * the post-login SHAPE to the API-DIRECT-SCRAPE phase. The two
   * are coupled (one cannot run without the other for an API-direct
   * bank), so they share a single builder entry — one source of
   * truth, no risk of forgetting to wire the scrape after wiring
   * the login.
   *
   * Generic in `<TAcct, TCursor>` so bank-specific shape literals
   * (e.g. `IApiDirectScrapeShape<IPepperAcct, number>`) flow
   * through without contravariance errors at the builder boundary.
   * The login config's `omitBankText` is carried onto the shape.
   *
   * @param config - Bank IApiDirectCallConfig literal (login path).
   * @param shape - Bank IApiDirectScrapeShape literal (scrape path).
   * @returns This builder.
   */
  public withApiDirect<TAcct, TCursor>(
    config: IApiDirectCallConfig,
    shape: IApiDirectScrapeShape<TAcct, TCursor>,
  ): this {
    setApiDirectConfig(this._s, config);
    const scrape = shape as unknown as IApiDirectScrapeShape<unknown, unknown>;
    const bound = bindBankTextRule(scrape, config);
    setApiDirectScrape(this._s, bound);
    return this.withDeviceIdentity(config);
  }

  /**
   * Attach the generic pre-login credential enricher (device identity, etc.).
   * @param enricher - Hook that fills credentials before the first phase.
   * @returns This builder.
   */
  public withCredentialEnricher(enricher: CredentialEnricher): this {
    this._s.enrichCredentials = enricher;
    return this;
  }

  /**
   * Build the pipeline descriptor.
   * @returns The assembled descriptor.
   */
  public build(): Procedure<IPipelineDescriptor> {
    const fields = snapshotFields(this._s);
    const opts = this._s.options as ScraperOptions;
    return buildDescriptor(fields, opts);
  }

  /**
   * Attach the generic device-identity enricher when the bank declares one.
   * @param config - Bank api-direct config.
   * @returns This builder.
   */
  private withDeviceIdentity(config: IApiDirectCallConfig): this {
    const enricher = deviceIdentityEnricherOf(config.deviceIdentity, config.warmStart);
    if (!enricher.has) return this;
    return this.withCredentialEnricher(enricher.value);
  }
}

export default PipelineBuilder;
