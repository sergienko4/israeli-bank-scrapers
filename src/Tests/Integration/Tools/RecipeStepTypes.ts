/**
 * Discriminated union of harvester step kinds.
 *
 * <p>Backward-compatible extension of the original `IRecipeStep` in
 * {@link HarvestBankHtml}. The legacy pre-login steps are mapped onto
 * `'goto'` and `'reveal'` so existing `BANK_RECIPES` entries flow
 * through unchanged when consumed by the extended executor.
 *
 * <p>New kinds added for full per-phase capture:
 * <ul>
 *   <li>`'login'` — drives the bank's pipeline `ILoginConfig` to
 *       submit credentials and waits for the LOGIN ACTION result.</li>
 *   <li>`'waitFor'` — waits for a URL match or visible text before
 *       snapshotting (covers DASHBOARD navigation tail).</li>
 *   <li>`'recordResponse'` — registers a `page.on('response')`
 *       listener that writes the matched response JSON to the
 *       fixture directory (PII-redacted).</li>
 *   <li>`'snapshot'` — explicit "snapshot now" with no preceding
 *       action (covers SPA banks where we want to capture POST-JS
 *       hydrated DOM after `networkidle`).</li>
 * </ul>
 *
 * <p>Every kind carries a `stepName` so the fixture file naming stays
 * stable across the union.
 */

/** Wait state passed to `page.goto` / `page.waitForLoadState`. */
type WaitLifecycleState = 'domcontentloaded' | 'load' | 'networkidle';

/** Step: navigate to a URL, optionally wait for a richer lifecycle. */
interface IGotoStep {
  readonly kind: 'goto';
  readonly stepName: string;
  readonly url: string;
  readonly waitFor?: WaitLifecycleState;
}

/** Step: click an element matched by visible text (reveal action). */
interface IRevealStep {
  readonly kind: 'reveal';
  readonly stepName: string;
  readonly revealText: string;
}

/** Step: fill credentials + submit the LOGIN form. */
interface ILoginStep {
  readonly kind: 'login';
  readonly stepName: string;
  /** Optional override: log into a different bank's pipeline config. */
  readonly bankIdOverride?: string;
  /** When false, drive the login action WITHOUT overwriting an existing
   *  snapshot at `stepName` (used when the credential form was already
   *  captured pre-login). Defaults to true (snapshot written). */
  readonly snapshot?: boolean;
}

/** Step: wait for URL substring match or visible text before snapshot.
 *  Exactly one of `urlIncludes` / `textVisible` MUST be set — enforced
 *  at the type level via the discriminated intersection below. */
type IWaitForStep = {
  readonly kind: 'waitFor';
  readonly stepName: string;
  readonly timeoutMs?: number;
} & (
  | { readonly urlIncludes: string; readonly textVisible?: string }
  | { readonly textVisible: string; readonly urlIncludes?: string }
);

/** Step: snapshot DOM only (no action). */
interface ISnapshotStep {
  readonly kind: 'snapshot';
  readonly stepName: string;
  readonly waitForLifecycle?: WaitLifecycleState;
}

/** Step: register a response listener for a URL pattern + filename. */
interface IRecordResponseStep {
  readonly kind: 'recordResponse';
  readonly stepName: string;
  /** Substring or full URL — matched against `response.url()`. */
  readonly urlPattern: string;
  /** Filename WITHOUT extension — `.response.json` is appended. */
  readonly captureAs: string;
  readonly methods?: readonly ('GET' | 'POST')[];
}

/** Sum type of all harvester step kinds. */
type IHarvestStep =
  | IGotoStep
  | IRevealStep
  | ILoginStep
  | IWaitForStep
  | ISnapshotStep
  | IRecordResponseStep;

/** Bank recipe in the extended union format. */
interface IExtendedRecipe {
  readonly bankId: string;
  readonly steps: readonly IHarvestStep[];
}

/**
 * Test whether the given step is a `'login'` step.
 *
 * @param step - Harvest step to inspect.
 * @returns True when the discriminant equals `'login'`.
 */
function isLoginStep(step: IHarvestStep): step is ILoginStep {
  return step.kind === 'login';
}

/**
 * Test whether the given step is a `'recordResponse'` step.
 *
 * @param step - Harvest step to inspect.
 * @returns True when the discriminant equals `'recordResponse'`.
 */
function isRecordResponseStep(step: IHarvestStep): step is IRecordResponseStep {
  return step.kind === 'recordResponse';
}

export type {
  IExtendedRecipe,
  IGotoStep,
  IHarvestStep,
  ILoginStep,
  IRecordResponseStep,
  IRevealStep,
  ISnapshotStep,
  IWaitForStep,
  WaitLifecycleState,
};
export { isLoginStep, isRecordResponseStep };
