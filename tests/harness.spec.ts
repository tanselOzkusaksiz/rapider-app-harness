import { test, expect } from '@playwright/test';

test('app harness loads and renders layout correctly', async ({ page }) => {
  await page.goto('/');

  // Expect the header or layout container to be visible
  // The harness wraps everything inside #harness-container or provides some standard frame.
  await expect(page).toHaveTitle(/Rappider App Harness \| Local Test Runner/i);

  // You can refine this by expecting specific elements related to the injected micro-frontend
  // For instance, expect an iframe or a specific layout element if rendered directly.
  const appContainer = page.locator('#app-shell');
  await expect(appContainer).toBeVisible();
});
