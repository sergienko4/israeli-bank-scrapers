export interface IPageEvalAllOpts<TResult> {
  selector: string;
  defaultResult: TResult;
  callback: (elements: Element[]) => TResult;
}
