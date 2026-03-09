import fs from 'fs';
import path from 'path';
import { type Page, type Request, type Route } from 'playwright';
import { fileURLToPath } from 'url';

const CURRENT_FILE = fileURLToPath(import.meta.url);
const CURRENT_DIR = path.dirname(CURRENT_FILE);

interface IMockRoute {
  match: string | RegExp;
  method?: 'GET' | 'POST';
  abort?: boolean;
  contentType?: string;
  body?: string | ((request: Request) => string);
  status?: number;
}

/**
 * Loads a fixture file from the fixtures directory.
 * @param fixturePath - relative path within the fixtures directory
 * @returns the file contents as a string
 */
export function loadFixture(fixturePath: string): string {
  const fullPath = path.resolve(CURRENT_DIR, '..', 'fixtures', fixturePath);
  return fs.readFileSync(fullPath, 'utf-8');
}

/**
 * Sets up request interception on a Playwright page using mock route definitions.
 * @param page - the Playwright page to intercept requests on
 * @param routes - array of mock route definitions
 * @returns promise that resolves when interception is set up
 */
export async function setupRequestInterception(page: Page, routes: IMockRoute[]): Promise<boolean> {
  await page.route('**/*', async (route: Route, request: Request) => {
    const url = request.url();
    const method = request.method();

    const matchingRoute = routes.find(mockRoute => {
      const isUrlMatch =
        mockRoute.match instanceof RegExp
          ? mockRoute.match.test(url)
          : url.includes(mockRoute.match);
      const isMethodMatch = !mockRoute.method || mockRoute.method === method;
      return isUrlMatch && isMethodMatch;
    });

    if (matchingRoute) {
      if (matchingRoute.abort) {
        await route.abort('failed');
        return;
      }
      const body =
        typeof matchingRoute.body === 'function' ? matchingRoute.body(request) : matchingRoute.body;
      const contentType = matchingRoute.contentType ?? 'text/html';
      await route.fulfill({
        status: matchingRoute.status ?? 200,
        contentType,
        body,
      });
      return;
    }

    await route.continue();
  });
  return true;
}
