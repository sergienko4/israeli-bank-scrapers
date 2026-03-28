import { Page } from '@playwright/test'; // 🚨 This MUST trigger an ESLint error

export class IllegalPhase {
    public async execute(page: Page) { // 🚨 Direct 'page' usage MUST trigger an error
        await page.click('.bad-selector');
    }
}