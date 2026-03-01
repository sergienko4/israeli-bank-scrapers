import { type Page, type Request, type Route } from 'playwright';
import fs from 'fs';
import path from 'path';

interface MockRoute {
  match: string | RegExp;
  method?: 'GET' | 'POST';
  abort?: boolean;
  contentType?: string;
  body?: string | ((request: Request) => string);
  status?: number;
}

export function loadFixture(fixturePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '..', 'fixtures', fixturePath), 'utf-8');
}

export async function setupRequestInterception(page: Page, routes: MockRoute[]): Promise<void> {
  await page.route('**/*', async (route: Route, request: Request) => {
    const url = request.url();
    const method = request.method();

    for (const mockRoute of routes) {
      const urlMatch =
        mockRoute.match instanceof RegExp
          ? mockRoute.match.test(url)
          : url.includes(mockRoute.match);
      const methodMatch = !mockRoute.method || mockRoute.method === method;

      if (urlMatch && methodMatch) {
        if (mockRoute.abort) {
          await route.abort('failed');
          return;
        }
        const body =
          typeof mockRoute.body === 'function' ? mockRoute.body(request) : mockRoute.body;
        await route.fulfill({
          status: mockRoute.status ?? 200,
          contentType: mockRoute.contentType!,
          body,
        });
        return;
      }
    }

    await route.continue();
  });
}
