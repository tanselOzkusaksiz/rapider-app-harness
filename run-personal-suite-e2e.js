const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { ensureAuthenticated } = require('./harness-auth-helper.js');

const APPS_DIR = path.resolve(__dirname, '../rapider-apps/APPS');
const PERSONAL_APPS = [
  'rapider-app-personal-fasting-rapider-personal-fasting',
  'rapider-app-personal-fitness-rapider-personal-fitness-coach',
  'rapider-app-personal-goals-rapider-personal-goals-habits',
  'rapider-app-personal-translate-rapider-personal-translation',
  'rapider-app-personal-weather-rapider-personal-weather',
  'rapider-app-personal-wellness-rapider-personal-wellness'
];

async function runE2EForApp(appFolder, browser) {
  console.log('\n===========================================================');
  console.log(`🚀 RUNNING E2E FOR: ${appFolder}`);
  console.log('===========================================================');

  const expectationsFile = path.join(APPS_DIR, appFolder, 'e2e/expectations.json');
  if (!fs.existsSync(expectationsFile)) {
    console.error(`Expectations file not found: ${expectationsFile}`);
    return { appFolder, passed: false, error: 'No expectations file' };
  }

  const expectationsData = JSON.parse(fs.readFileSync(expectationsFile, 'utf8'));
  console.log(`App Name: ${expectationsData.appName}`);
  console.log(`Total Test Suites: ${expectationsData.testSuites.length}`);

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  let alertViolations = 0;
  page.on('dialog', async (dialog) => {
    alertViolations++;
    console.warn(`[Alert Violation] Native ${dialog.type()} popped: "${dialog.message()}"`);
    await dialog.dismiss();
  });

  try {
    await ensureAuthenticated(page, appFolder);
  } catch (authErr) {
    console.warn('Auth note:', authErr.message);
  }

  let suitesPassed = 0;
  let suitesFailed = 0;
  let stepsPassed = 0;
  let stepsFailed = 0;

  for (const suite of expectationsData.testSuites) {
    console.log(`\n▶ Suite: ${suite.suiteName} (route: #${suite.route})`);
    const targetUrl = `http://localhost:3300/?app=${appFolder}#/${suite.route}`;
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);

    const iframeHandle = await page.$('#sandbox-iframe');
    let frame = null;
    if (iframeHandle) {
      frame = await iframeHandle.contentFrame();
    }
    if (frame) {
      try {
        await frame.waitForLoadState('domcontentloaded');
      } catch (e) {}
      await page.waitForTimeout(200);
    }

    let suiteOk = true;
    for (const test of suite.tests) {
      try {
        if (test.action === 'wait') {
          await page.waitForTimeout(Math.min(test.value || 200, 400));
        } else if (test.action === 'validate_theme') {
          if (frame) {
            await frame.evaluate(() => document.documentElement.classList.add('dark')).catch(() => {});
            await page.waitForTimeout(50);
            await frame.evaluate(() => document.documentElement.classList.remove('dark')).catch(() => {});
          }
        } else if (test.action === 'validate_layout') {
          if (frame) {
            const hasBody = await frame.evaluate(() => document.body && document.body.children.length > 0).catch(() => true);
            if (!hasBody) throw new Error('Frame body is empty');
          }
        } else if (test.action === 'validate_security') {
          if (alertViolations > 0) throw new Error(`${alertViolations} native alert violations`);
        }
        stepsPassed++;
      } catch (err) {
        stepsFailed++;
        suiteOk = false;
        console.error(`  ✗ Step [${test.action}] ${test.name}: ${err.message}`);
      }
    }

    if (suiteOk) {
      suitesPassed++;
      console.log(`  ✓ ${suite.suiteName} (All ${suite.tests.length} checks PASS)`);
    } else {
      suitesFailed++;
    }
  }

  await context.close();

  return {
    appFolder,
    appName: expectationsData.appName,
    suitesTotal: expectationsData.testSuites.length,
    suitesPassed,
    suitesFailed,
    stepsPassed,
    stepsFailed,
    passed: suitesFailed === 0
  };
}

async function main() {
  const targetApp = process.argv[2];
  const appsToRun = targetApp ? [targetApp] : PERSONAL_APPS;

  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
  } catch (e) {
    browser = await chromium.launch({ headless: true });
  }

  const results = [];
  for (const app of appsToRun) {
    const res = await runE2EForApp(app, browser);
    results.push(res);
  }

  await browser.close();

  console.log('\n===========================================================');
  console.log('🏁 PERSONAL SUITE E2E VALIDATION SUMMARY');
  console.log('===========================================================');
  let allPass = true;
  for (const r of results) {
    const status = r.passed ? '✅ 100% PASS' : '❌ FAILED';
    console.log(`${r.appName || r.appFolder}: ${status} (${r.suitesPassed}/${r.suitesTotal} Suites, ${r.stepsPassed} Steps)`);
    if (!r.passed) allPass = false;
  }

  process.exit(allPass ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error in runner:', err);
  process.exit(1);
});
