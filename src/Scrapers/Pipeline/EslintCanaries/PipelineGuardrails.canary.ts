// Canary: Pipeline Section 6 guardrails — DI, mediator, result pattern, guard clauses
// Each section must trigger at least 1 Pipeline-specific ESLint error.

// 🚫 DI: Restricted import from Registry/Config
// (commented out — would break TSC, verified by import rule separately)
// import { SCRAPER_CONFIGURATION } from '../../../Registry/Config/ScraperConfig';

class CanaryHelper {}

export class CanaryPipeline {
  // 🚫 DI ENFORCEMENT: Manual instantiation (not in safe-list)
  public _helper = new CanaryHelper();

  // 🚫 RESULT PATTERN: Primitive return (string on MethodDefinition)
  public execute(): string {
    return 'done';
  }

  // 🚫 else blocks disallowed — use guard clauses
  public check(isOk: boolean): string {
    if (isOk) {
      return 'ok';
    } else {
      return 'fail';
    }
  }

  // 🚫 Ternary operators disallowed
  public mode(isDebug: boolean): string {
    return isDebug ? 'verbose' : 'silent';
  }

  // 🚫 PAGINATION: While loop forbidden
  public loop(): boolean {
    while (true) {
      break;
    }
    return true;
  }

  // 🚫 DATA INTEGRITY: '' fallback forbidden
  public fallback(val: string | false): string {
    const text = val || '';
    return text;
  }

  // 🚫 ARCHITECTURE: Status string comparison
  public isReady(status: string): boolean {
    return status === 'success';
  }

  // 🚫 catch clause .message access
  public safe(): string {
    try {
      return 'ok';
    } catch (err) {
      return (err as Error).message;
    }
  }

  // 🚫 as never / as any
  public cast(): string {
    const data = {} as never;
    return String(data);
  }
}
