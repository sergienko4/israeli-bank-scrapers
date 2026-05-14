// Canary: direct `page.on(...)` outside `NetworkDiscovery` is banned.
// Triggers the `no-restricted-syntax` selector in Section 10b of
// `eslint.config.mjs`. Closes the CDP/BiDi fingerprint leak that
// surfaced on PR #228 CI run 25844771660 (Hapoalim Cloudflare
// hCaptcha wall) — every listener must route through the central
// registry on `INetworkDiscovery`.
import type { Page } from 'playwright-core';

export function leak(page: Page): void {
  page.on('requestfailed', (): void => {
    /* canary body — debug listener attached outside registry */
  });
}
