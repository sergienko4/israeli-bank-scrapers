export interface PageEvalOpts<TResult> {
  selector: string;
  defaultResult: TResult;
  callback: (element: Element, ...args: unknown[]) => TResult;
}
