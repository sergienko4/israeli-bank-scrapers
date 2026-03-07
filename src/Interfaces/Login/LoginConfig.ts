import type { Frame, Page } from 'playwright';

import type { WaitUntilState } from '../../Common/Navigation';
import type { FoundResult } from '../../Interfaces/Common/FoundResult';
import type { IDoneResult } from '../../Interfaces/Common/StepResult';
import type { OtpConfig, SelectorCandidate } from '../../Scrapers/Base/LoginConfigTypes';
import type { IFieldConfig } from './FieldConfig';
import type { ILoginPossibleResults } from './LoginPossibleResults';

/**
 * Declarative login configuration — the "input" format.
 * Converted to ILoginOptions at runtime after selectors are resolved.
 * Does NOT replace ILoginOptions; both coexist.
 */
export interface ILoginConfig {
  loginUrl: string;
  fields: IFieldConfig[];
  submit: SelectorCandidate | SelectorCandidate[];
  possibleResults: ILoginPossibleResults;
  otp?: OtpConfig;
  checkReadiness?: (page: Page) => Promise<IDoneResult>;
  preAction?: (page: Page) => Promise<FoundResult<Frame>>;
  postAction?: (page: Page) => Promise<IDoneResult>;
  waitUntil?: WaitUntilState;
}
