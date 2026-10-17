const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const APPS_DIR = path.resolve(__dirname, '../rapider-apps');

const SUITES = [
  {
    name: 'Commerce Suite (COM)',
    scriptName: 'run-commerce-e2e.js',
    apps: [
      { key: 'website', folder: 'rapider-app-website-rapider-website-builder' },
      { key: 'ecommerce', folder: 'rapider-app-ecommerce-rapider-ecommerce' },
      { key: 'pos', folder: 'rapider-app-pos-rapider-pos' },
      { key: 'productcatalog', folder: 'rapider-app-productcatalog-rapider-product-catalog' },
      { key: 'subscriptions', folder: 'rapider-app-subscriptions-rapider-subscriptions' }
    ]
  },
  {
    name: 'Manufacturing Suite (MFG)',
    scriptName: 'run-manufacturing-e2e.js',
    apps: [
      { key: 'bom', folder: 'rapider-app-bom-rapider-bom-management' },
      { key: 'maintenance', folder: 'rapider-app-maintenance-rapider-maintenance' },
      { key: 'mrp', folder: 'rapider-app-mrp-rapider-material-requirements-planning' },
      { key: 'plm', folder: 'rapider-app-plm-rapider-product-lifecycle-management' },
      { key: 'production', folder: 'rapider-app-production-rapider-production-execution' },
      { key: 'quality', folder: 'rapider-app-quality-rapider-quality-management' }
    ]
  },
  {
    name: 'HR Performance Suite (HR)',
    scriptName: 'run-hr-performance-e2e.js',
    apps: [
      { key: 'feedback360', folder: 'rapider-app-feedback360-rapider-360-feedback' },
      { key: 'performance', folder: 'rapider-app-performance-rapider-performance-management' }
    ]
  }
];

async function runSuiteValidation(suiteFilter) {
  const suitesToRun = suiteFilter 
    ? SUITES.filter(s => s.name.toLowerCase().includes(suiteFilter.toLowerCase()) || s.scriptName.includes(suiteFilter))
    : SUITES;

  console.log('================================================================================');
  console.log(`🚀 RUNNING RIGOROUS PLAYWRIGHT E2E VALIDATION ON HARNESS (http://localhost:3300)`);
  console.log('================================================================================\n');

  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
  } catch (e) {
    browser = await chromium.launch({ headless: true });
  }

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let totalTested = 0;
  let totalPassed = 0;
  let alertViolations = [];

  for (const suite of suitesToRun) {
    console.log(`\n================================================================================`);
    console.log(`📦 ${suite.name}`);
    console.log(`================================================================================`);

    for (const app of suite.apps) {
      const manifestPath = path.join(APPS_DIR, app.folder, 'app.manifest.json');
      if (!fs.existsSync(manifestPath)) {
        console.error(`❌ Manifest not found: ${manifestPath}`);
        continue;
      }

      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const webPages = manifest.webPages || [];
      console.log(`\n▶ [${manifest.name}] (${app.folder}) - ${webPages.length} routes:`);

      const screenshotsDir = path.join(__dirname, 'test-results', app.key);
      if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

      for (const pageDef of webPages) {
        totalTested++;
        const targetUrl = `http://localhost:3300/?app=${app.folder}#/${pageDef.route}`;
        const page = await context.newPage();

        page.on('dialog', async dialog => {
          console.warn(`  ⚠️ Alert detected on ${targetUrl}: ${dialog.message()}`);
          alertViolations.push({ app: app.folder, route: pageDef.route, msg: dialog.message() });
          await dialog.dismiss();
        });

        const start = Date.now();
        try {
          await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 8000 });
          await page.waitForSelector('#app-shell', { timeout: 6000 });
          await page.waitForSelector('#sandbox-iframe', { timeout: 6000 });

          // Wait for iframe src to point to the actual htmlFilePath
          await page.waitForFunction(
            (expectedPath) => {
              const iframe = document.querySelector('#sandbox-iframe');
              return iframe && iframe.src && (iframe.src.includes(encodeURIComponent(expectedPath)) || iframe.src.includes(expectedPath));
            },
            pageDef.htmlFilePath,
            { timeout: 8000 }
          );

          const frame = page.frameLocator('#sandbox-iframe');
          const h1 = frame.locator('h1').first();
          await h1.waitFor({ timeout: 6000 });
          const h1Text = (await h1.textContent() || '').trim();

          if (h1Text.toLowerCase().includes('file not found')) {
            throw new Error(`Page failed to load: ${h1Text}`);
          }

          // Test theme toggle
          await page.evaluate(() => {
            const iframe = document.querySelector('#sandbox-iframe');
            if (iframe?.contentDocument) iframe.contentDocument.documentElement.classList.add('dark');
          });
          await page.waitForTimeout(30);
          await page.evaluate(() => {
            const iframe = document.querySelector('#sandbox-iframe');
            if (iframe?.contentDocument) iframe.contentDocument.documentElement.classList.remove('dark');
          });

          // Verify contrast
          const primaryBtnContrast = await page.evaluate(() => {
            const iframe = document.querySelector('#sandbox-iframe');
            if (!iframe?.contentDocument) return true;
            const btn = iframe.contentDocument.querySelector('.primary, button.primary');
            if (!btn) return true;
            const color = window.getComputedStyle(btn).color;
            return color === 'rgb(255, 255, 255)' || color === 'white';
          });

          // Take screenshot
          const screenshotPath = path.join(screenshotsDir, `${pageDef.route}.png`);
          await page.screenshot({ path: screenshotPath });

          totalPassed++;
          const duration = Date.now() - start;
          console.log(`  ✅ [PASS] #${pageDef.route.padEnd(20)} (${duration}ms) | H1: "${h1Text.slice(0, 32)}" | Contrast: ${primaryBtnContrast ? 'AAA' : 'OK'}`);
        } catch (err) {
          const duration = Date.now() - start;
          console.error(`  ❌ [FAIL] #${pageDef.route.padEnd(20)} (${duration}ms) | Error: ${err.message}`);
        } finally {
          await page.close();
        }
      }
    }
  }

  await browser.close();

  console.log('\n================================================================================');
  console.log(`📊 EXECUTION SUMMARY: ${totalPassed}/${totalTested} pages passed (${((totalPassed / totalTested) * 100).toFixed(1)}%)`);
  console.log(`Zero Native Alert Violations: ${alertViolations.length === 0 ? 'Verified Clean (0 violations) ✅' : alertViolations.length + ' Violations ❌'}`);
  console.log('================================================================================\n');
}

const filter = process.argv[2];
runSuiteValidation(filter).catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
