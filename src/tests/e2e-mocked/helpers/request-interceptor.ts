import { type Page, type HTTPRequest } from 'puppeteer';
import fs from 'fs';
import path from 'path';

interface MockRoute {
  match: string | RegExp;
  method?: 'GET' | 'POST';
  contentType: string;
  body: string | ((request: HTTPRequest) => string);
  status?: number;
}

const INTERCEPTION_PRIORITY = 500;

export function loadFixture(fixturePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '..', 'fixtures', fixturePath), 'utf-8');
}

export async function setupRequestInterception(page: Page, routes: MockRoute[]): Promise<void> {
  await page.setRequestInterception(true);

  page.on('request', (request: HTTPRequest) => {
    const url = request.url();
    const method = request.method();

    for (const route of routes) {
      const urlMatch = route.match instanceof RegExp ? route.match.test(url) : url.includes(route.match);
      const methodMatch = !route.method || route.method === method;

      if (urlMatch && methodMatch) {
        const body = typeof route.body === 'function' ? route.body(request) : route.body;
        void request.respond(
          { status: route.status ?? 200, contentType: route.contentType, body },
          INTERCEPTION_PRIORITY,
        );
        return;
      }
    }

    void request.continue(undefined, 0);
  });
}
