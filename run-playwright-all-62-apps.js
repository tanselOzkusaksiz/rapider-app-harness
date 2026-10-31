#!/usr/bin/env node

/**
 * Full-Catalog Live Playwright Harness Auditor & 1200x800 Pure-Page Screenshot Capturer
 * (All 62 Apps / 1,050 Routes)
 *
 * - Sets viewport to exact 1200x800 px
 * - Collapses/hides all Harness UI panels (#header-bar, #sidebar, #devtools-drawer,
 *   #e2e-side-drawer, #iframe-loader, etc.) so #sandbox-iframe occupies the pure 1200x800 viewport
 * - Audits the live DOM, console, and runtime errors
 * - Captures a pure 1200x800 PNG screenshot of every single page of every app
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { ensureAuthenticated } = require('./harness-auth-helper');

const BASE_URL = 'http://localhost:3300';
const APPS_DIR = path.resolve(__dirname, '../rapider-apps/APPS');
const CENTRAL_SCREENSHOTS_DIR = path.resolve(__dirname, 'test-results/pure-pages-1200x800');
const CONCURRENCY = 8;

const PURE_PAGE_HARNESS_CSS = `
  #header-bar,
  #sidebar,
  #devtools-drawer,
  #e2e-side-drawer,
  #e2e-drawer,
  #toast-container,
  #modal-overlay,
  #workspace-search-modal,
  #json-viewer-modal,
  #auth-modal,
  #e2e-report-modal,
  #store-images-modal,
  #iframe-loader,
  #e2e-fake-cursor {
    display: none !important;
    width: 0 !important;
    height: 0 !important;
    opacity: 0 !important;
    pointer-events: none !important;
  }
  html, body, #app-shell {
    display: block !important;
    width: 1200px !important;
    height: 800px !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
    grid-template-columns: 1fr !important;
    grid-template-rows: 1fr !important;
  }
  #main-viewport, #viewport-container {
    width: 1200px !important;
    height: 800px !important;
    max-width: 1200px !important;
    max-height: 800px !important;
    margin: 0 !important;
    padding: 0 !important;
    border: none !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    overflow: hidden !important;
  }
  #sandbox-iframe {
    width: 1200px !important;
    height: 800px !important;
    border: none !important;
    display: block !important;
    margin: 0 !important;
    padding: 0 !important;
  }
`;

function extractPagesFromManifest(appDir, m) {
  const pages = [];
  const seenRoutes = new Set();

  const rawPages = [];
  if (Array.isArray(m.webPages)) rawPages.push(...m.webPages);
  if (Array.isArray(m.pages)) rawPages.push(...m.pages);

  for (const p of rawPages) {
    const route = p.route || p.slug || p.id || (p.file ? path.basename(p.file, '.html') : null);
    if (!route || seenRoutes.has(route)) continue;
    seenRoutes.add(route);

    const file = p.htmlFilePath || p.file || `pages/${route}.html`;
    pages.push({
      id: p.id || route,
      title: p.title || p.name || route,
      route: route.replace(/^\//, ''),
      file: file.startsWith('pages/') ? file : `pages/${file}`
    });
  }

  const pagesDir = path.join(appDir, 'pages');
  if (fs.existsSync(pagesDir)) {
    const htmlFiles = fs.readdirSync(pagesDir).filter(f => f.endsWith('.html'));
    for (const f of htmlFiles) {
      const slug = path.basename(f, '.html');
      const alreadyIncluded = pages.some(p => path.basename(p.file, '.html') === slug || p.route === slug);
      if (!alreadyIncluded) {
        pages.push({
          id: slug,
          title: slug,
          route: slug,
          file: `pages/${f}`
        });
      }
    }
  }

  return pages;
}

async function auditAndCaptureSinglePage(page, appFolder, appDir, p, isFirstPage) {
  const safeRoute = p.route.replace(/[^a-zA-Z0-9_-]/g, '_');
  const appScreenshotsDir = path.join(appDir, 'screenshots');
  const centralAppScreenshotsDir = path.join(CENTRAL_SCREENSHOTS_DIR, appFolder);
  fs.mkdirSync(appScreenshotsDir, { recursive: true });
  fs.mkdirSync(centralAppScreenshotsDir, { recursive: true });

  const screenshotPath = path.join(appScreenshotsDir, `${safeRoute}.png`);
  const centralScreenshotPath = path.join(centralAppScreenshotsDir, `${safeRoute}.png`);

  const pageReport = {
    id: p.id,
    title: p.title,
    route: p.route,
    file: p.file,
    screenshot: screenshotPath,
    dimensions: '1200x800',
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    issues: [],
    metrics: {}
  };

  const onConsole = msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (
        !text.includes('favicon.ico') &&
        !text.includes('ERR_NETWORK_CHANGED') &&
        !text.includes('cdn.tailwindcss.com') &&
        !text.includes('status of 404 (Not Found)')
      ) {
        pageReport.consoleErrors.push(text);
      }
    }
  };
  const onPageError = err => {
    pageReport.pageErrors.push(err.message);
  };

  page.on('console', onConsole);
  page.on('pageerror', onPageError);

  const targetUrl = `${BASE_URL}/?app=${appFolder}#/${p.route}`;
  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });

    // Collapse all Harness panels and force pure 1200x800 page layout
    await page.addStyleTag({ content: PURE_PAGE_HARNESS_CSS });
    await page.evaluate(() => {
      const shell = document.getElementById('app-shell');
      if (shell) {
        shell.classList.remove('e2e-drawer-open');
        shell.classList.remove('sidebar-open');
        shell.classList.add('sidebar-collapsed');
      }
      const drawer = document.getElementById('e2e-side-drawer');
      if (drawer) {
        drawer.classList.remove('open');
        drawer.style.display = 'none';
      }
      const devtools = document.getElementById('devtools-drawer');
      if (devtools) {
        devtools.classList.remove('open', 'expanded');
        devtools.style.display = 'none';
      }
    });

    const frameHandle = await page.waitForSelector('#sandbox-iframe', { timeout: 10000 });
    await page.waitForTimeout(650);
    const frame = frameHandle ? await frameHandle.contentFrame() : null;

    if (!frame) {
      pageReport.issues.push({
        phase: 'Phase 1: Layout & Viewport',
        severity: 'CRITICAL',
        code: 'IFRAME_LOAD_FAILED',
        description: 'Sandbox iframe did not initialize or load content.'
      });
    } else {
      await frame.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(450);

      const domAudit = await frame.evaluate(() => {
        // Hide transient SWR toast before pure screenshot capture
        const swrToast = document.getElementById('swr-toast');
        if (swrToast) swrToast.style.display = 'none';

        const findings = [];
        const metrics = {};

        const docWidth = document.documentElement ? document.documentElement.scrollWidth : 1200;
        const winWidth = window.innerWidth || 1200;
        const winHeight = window.innerHeight || 800;
        metrics.scrollWidth = docWidth;
        metrics.innerWidth = winWidth;
        metrics.innerHeight = winHeight;

        const bodyText = document.body ? document.body.innerText : '';
        if (bodyText.includes('[object Object]') || bodyText.includes('NaN%')) {
          findings.push({
            phase: 'Phase 2: Data Binding & Null Safety',
            severity: 'HIGH',
            code: 'RAW_UNDEFINED_OR_NAN_IN_UI',
            description: 'Visible text contains literal "[object Object]" or "NaN%".'
          });
        }

        const tables = Array.from(document.querySelectorAll('table'));
        metrics.tableCount = tables.length;

        const forms = Array.from(document.querySelectorAll('form'));
        metrics.formCount = forms.length;

        const styleTags = Array.from(document.querySelectorAll('style')).map(s => s.textContent).join('\n');
        const hasDarkRules =
          styleTags.includes('data-theme="dark"') ||
          styleTags.includes('.dark') ||
          styleTags.includes('--bg-') ||
          (document.documentElement && document.documentElement.innerHTML.includes('dark:bg-'));
        metrics.hasDarkRules = hasDarkRules;

        // Live <dialog> viewport centering / right-drawer docking verification
        const dialogs = Array.from(document.querySelectorAll('dialog'));
        metrics.dialogCount = dialogs.length;
        for (const dlg of dialogs) {
          const wasOpen = dlg.open;
          try {
            if (!wasOpen && typeof dlg.showModal === 'function') dlg.showModal();
            const r = dlg.getBoundingClientRect();
            if (r.width > 0) {
              const isDrawer = dlg.classList.contains('drawer') || dlg.classList.contains('sheet');
              if (isDrawer) {
                const rightOffset = Math.abs(r.right - window.innerWidth);
                if (rightOffset > 8) {
                  findings.push({
                    phase: 'Phase 1: Layout & Viewport',
                    severity: 'HIGH',
                    code: 'DRAWER_DIALOG_NOT_DOCKED_RIGHT',
                    description: `<dialog id="${dlg.id || ''}" class="drawer"> is not docked to right edge (rightOffset=${Math.round(rightOffset)}px).`
                  });
                }
              } else {
                const centerOffset = Math.abs((r.left + r.width / 2) - (window.innerWidth / 2));
                if (centerOffset > 8) {
                  findings.push({
                    phase: 'Phase 1: Layout & Viewport',
                    severity: 'HIGH',
                    code: 'DIALOG_NOT_CENTERED_IN_VIEWPORT',
                    description: `<dialog id="${dlg.id || ''}"> is not centered horizontally (offset=${Math.round(centerOffset)}px).`
                  });
                }
              }
            }
          } catch (_e) {} finally {
            if (!wasOpen && dlg.open && typeof dlg.close === 'function') dlg.close();
          }
        }

        // Live checkbox sizing inside .field verification
        const checkboxes = Array.from(document.querySelectorAll('.field input[type="checkbox"], .field input[type="radio"]'));
        for (const cb of checkboxes) {
          const cs = window.getComputedStyle(cb);
          const w = parseFloat(cs.width) || 0;
          if (w > 32) {
            findings.push({
              phase: 'Phase 1: Layout & Viewport',
              severity: 'HIGH',
              code: 'OVERSIZED_CHECKBOX_IN_FIELD',
              description: `Checkbox/radio inside .field has computed width ${Math.round(w)}px instead of ~16px.`
            });
          }
        }

        return { findings, metrics };
      });

      pageReport.issues.push(...domAudit.findings);
      pageReport.metrics = domAudit.metrics;

      // Capture pure 1200x800 PNG screenshot directly from the full-bleed #sandbox-iframe
      const pngBuffer = await frameHandle.screenshot({ type: 'png' });
      fs.writeFileSync(screenshotPath, pngBuffer);
      fs.writeFileSync(centralScreenshotPath, pngBuffer);
      if (isFirstPage || ['overview', 'dashboard', 'home', 'index'].includes(p.route.toLowerCase())) {
        fs.writeFileSync(path.join(appScreenshotsDir, 'cover.png'), pngBuffer);
        fs.writeFileSync(path.join(centralAppScreenshotsDir, 'cover.png'), pngBuffer);
      }
    }

    if (pageReport.pageErrors.length > 0) {
      pageReport.issues.push({
        phase: 'Phase 5: Runtime & Console',
        severity: 'CRITICAL',
        code: 'UNCAUGHT_PAGE_ERROR',
        description: `Uncaught page error(s): ${pageReport.pageErrors.slice(0, 2).join(' | ')}`
      });
    }
  } catch (err) {
    pageReport.issues.push({
      phase: 'Phase 5: Runtime & Console',
      severity: 'CRITICAL',
      code: 'NAVIGATION_ERROR',
      description: err.message
    });
  }

  page.off('console', onConsole);
  page.off('pageerror', onPageError);

  return pageReport;
}

async function main() {
  const filterArg = process.argv.find(a => a.startsWith('--app='));
  const targetApp = filterArg ? filterArg.split('=')[1] : null;

  const allApps = fs
    .readdirSync(APPS_DIR)
    .filter(d => d.startsWith('rapider-app-') && fs.statSync(path.join(APPS_DIR, d)).isDirectory())
    .filter(d => !targetApp || d.includes(targetApp))
    .sort();

  console.log(`🚀 Starting Live Playwright 1200x800 Pure-Page Capture & Audit across ${allApps.length} apps (${CONCURRENCY} concurrent tabs)...`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1200, height: 800 },
    deviceScaleFactor: 1
  });

  // Authenticate once on context
  const authPage = await context.newPage();
  await ensureAuthenticated(authPage, allApps[0]);
  await authPage.close();

  // Create worker tab pool
  const pagesPool = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    pagesPool.push(await context.newPage());
  }

  const summary = {
    timestamp: new Date().toISOString(),
    viewport: '1200x800 (pure page, all harness panels collapsed)',
    appsTotal: allApps.length,
    appsPassed: 0,
    appsFailed: 0,
    pagesTotal: 0,
    pagesPassed: 0,
    pagesFailed: 0,
    screenshotsCaptured: 0,
    totalIssues: 0,
    failedPagesDetail: []
  };

  for (let idx = 0; idx < allApps.length; idx++) {
    const appFolder = allApps[idx];
    const appDir = path.join(APPS_DIR, appFolder);
    const manifestPath = path.join(appDir, 'app.manifest.json');
    if (!fs.existsSync(manifestPath)) continue;

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const pages = extractPagesFromManifest(appDir, manifest);
    summary.pagesTotal += pages.length;

    const appResults = {
      app: appFolder,
      appName: manifest.name || appFolder,
      round: '2',
      viewport: '1200x800',
      timestamp: new Date().toISOString(),
      pages: new Array(pages.length)
    };

    let queueIdx = 0;
    const workers = pagesPool.map(async workerPage => {
      while (queueIdx < pages.length) {
        const myIdx = queueIdx++;
        const p = pages[myIdx];
        const rep = await auditAndCaptureSinglePage(workerPage, appFolder, appDir, p, myIdx === 0);
        appResults.pages[myIdx] = rep;
      }
    });

    await Promise.all(workers);

    const outFile = path.join(__dirname, `qa-audit-${appFolder}-round-2.json`);
    fs.writeFileSync(outFile, JSON.stringify(appResults, null, 2));

    let appIssues = 0;
    let appShots = 0;
    for (const pr of appResults.pages) {
      if (pr.screenshot && fs.existsSync(pr.screenshot)) {
        summary.screenshotsCaptured++;
        appShots++;
      }
      if (pr.issues.length === 0) {
        summary.pagesPassed++;
      } else {
        summary.pagesFailed++;
        appIssues += pr.issues.length;
        summary.totalIssues += pr.issues.length;
        summary.failedPagesDetail.push({
          app: appFolder,
          route: pr.route,
          file: pr.file,
          issues: pr.issues
        });
      }
    }

    if (appIssues === 0) {
      summary.appsPassed++;
      console.log(`✅ [${idx + 1}/${allApps.length}] ${appFolder} (${appShots}/${pages.length} pure 1200x800 screenshots) — 0 issues`);
    } else {
      summary.appsFailed++;
      console.log(`❌ [${idx + 1}/${allApps.length}] ${appFolder} (${appShots}/${pages.length} screenshots) — ${appIssues} issue(s)`);
    }
  }

  await browser.close();

  const summaryPath = path.join(__dirname, 'playwright-all-62-apps-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  console.log('\n====================================================================');
  console.log(`🏁 LIVE PLAYWRIGHT 1200x800 PURE-PAGE CAPTURE & AUDIT SUMMARY:`);
  console.log(`   Apps Passed:          ${summary.appsPassed} / ${summary.appsTotal}`);
  console.log(`   Pages Passed:         ${summary.pagesPassed} / ${summary.pagesTotal}`);
  console.log(`   Screenshots Captured: ${summary.screenshotsCaptured} / ${summary.pagesTotal} (1200x800 px)`);
  console.log(`   Total Issues:         ${summary.totalIssues}`);
  console.log('====================================================================\n');
}

main().catch(err => {
  console.error('Fatal error in run-playwright-all-62-apps.js:', err);
  process.exit(1);
});
