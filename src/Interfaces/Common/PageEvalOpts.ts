export interface IPageEvalOpts<TResult> {
  selector: string;
  defaultResult: TResult;
  callback: (element: Element) => TResult;
}
