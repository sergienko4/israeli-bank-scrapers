import { ScraperWebsiteChangedError } from './Scrapers/Base/ScraperWebsiteChangedError';

export function assertNever(x: never, error = ''): never {
  throw new ScraperWebsiteChangedError('assertNever', error || `Unexpected object: ${String(x)}`);
}

export default assertNever;
