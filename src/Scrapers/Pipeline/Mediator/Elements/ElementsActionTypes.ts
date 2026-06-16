/**
 * Shared element-action option contracts. Extracted from
 * ElementsInteractions.ts so ElementWaitAction and PageEvalAction can
 * import them without a back-edge to the hub, breaking the Elements
 * import cycle. Pure types — zero runtime imports.
 */

/** Options for waiting on element visibility or attachment. */
export interface IWaitOptions {
  visible?: boolean;
  timeout?: number;
}

/** Options for evaluating a single element. */
export interface IPageEvalOpts<TResult> {
  selector: string;
  defaultResult: TResult;
  callback: (element: Element, ...args: unknown[]) => TResult;
}

/** Options for evaluating multiple elements. */
export interface IPageEvalAllOpts<TResult> {
  selector: string;
  defaultResult: TResult;
  callback: (elements: Element[], ...args: unknown[]) => TResult;
}
