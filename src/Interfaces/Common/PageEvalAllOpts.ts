export interface PageEvalAllOpts<TResult> {
  selector: string;
  defaultResult: TResult;
  callback: (elements: Element[], ...args: unknown[]) => TResult;
}
