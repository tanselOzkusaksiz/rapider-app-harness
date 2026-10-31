/**
 * Universal Playwright QA Auditor for Rapider Microapplications
 * Usage:
 *   node simulate-qa-audit-app.js --app=<folderName> --round=1|2 [--out=<outputPath>]
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { ensureAuthenticated } = require('./harness-auth-helper');

const args = process.argv.slice(2);
const appArg = args.find(a => a.startsWith('--app='));
const roundArg = args.find(a => a.startsWith('--round='));
const outArg = args.find(a => a.startsWith('--out='));

if (!appArg) {
  console.error('Usage: node simulate-qa-audit-app.js --app=<folderName> [--round=1|2]');
  process.exit(1);
}

const APP_FOLDER = appArg.split('=')[1];
const ROUND = roundArg ? roundArg.split('=')[1] : '1';
const BASE_URL = 'http://localhost:3300';
const APP_DIR = path.resolve(__dirname, '../rapider-apps/APPS', APP_FOLDER);
const MANIFEST_PATH = path.join(APP_DIR, 'app.manifest.json');

if (!fs.existsSync(MANIFEST_PATH)) {
  console.error(`Manifest not found at ${MANIFEST_PATH}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

function extractPagesFromManifest(m) {
  const pages = [];
  const seenRoutes = new Set();

  const rawPages = [];
  if (Array.isArray(m.webPages)) rawPages.push(...m.webPages);
  if (Array.isArray(m.pages)) rawPages.push(...m.pages);

  for (const p of rawPages) {
    const route = p.route || p.slug || p.id || (p.file ? path.basename(p.file, '.html') : null);
    if (!route || seenRoutes.has(route)) continue;
    seenRoutes.add(route);

    const file = p.file || `pages/${route}.html`;
    pages.push({
      id: p.id || route,
      title: p.title || p.name || route,
      route: route.replace(/^\//, ''),
      file: file.startsWith('pages/') ? file : `pages/${file}`
    });
  }

  // Also check pages/ folder on disk for any unlisted HTML files
  const pagesDir = path.join(APP_DIR, 'pages');
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

async function runAudit() {
  const PAGES = extractPagesFromManifest(manifest);
  console.log(`\n🔍 Starting QA Simulation Audit (Round ${ROUND}) for ${APP_FOLDER} (${PAGES.length} pages)...`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await ensureAuthenticated(page, APP_FOLDER);

  const results = {
    app: APP_FOLDER,
    appName: manifest.name || APP_FOLDER,
    round: ROUND,
    timestamp: new Date().toISOString(),
    pages: []
  };

  for (const p of PAGES) {
    const pageReport = {
      id: p.id,
      title: p.title,
      route: p.route,
      file: p.file,
      consoleErrors: [],
      pageErrors: [],
      failedRequests: [],
      issues: [],
      metrics: {}
    };

    const onConsole = msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!text.includes('favicon.ico')) {
          pageReport.consoleErrors.push(text);
        }
      }
    };
    const onPageError = err => {
      pageReport.pageErrors.push(err.message);
    };
    const onRequestFailed = req => {
      const url = req.url();
      if (!url.includes('favicon.ico') && !url.includes('fonts.googleapis') && !url.includes('cdn.jsdelivr') && !url.includes('unpkg.com')) {
        pageReport.failedRequests.push(`${req.method()} ${url} (${req.failure()?.errorText || 'failed'})`);
      }
    };

    page.on('console', onConsole);
    page.on('pageerror', onPageError);
    page.on('requestfailed', onRequestFailed);

    const targetUrl = `${BASE_URL}/?app=${APP_FOLDER}#/${p.route}`;
    try {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForTimeout(1800);

      const frameHandle = await page.$('#sandbox-iframe');
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
        await page.waitForTimeout(1000);

        const domAudit = await frame.evaluate(() => {
          const findings = [];
          const metrics = {};

          // 1. Check horizontal overflow
          const docWidth = document.documentElement.scrollWidth;
          const winWidth = window.innerWidth;
          metrics.scrollWidth = docWidth;
          metrics.innerWidth = winWidth;
          if (docWidth > winWidth + 16) {
            findings.push({
              phase: 'Phase 1: Layout & Viewport',
              severity: 'MEDIUM',
              code: 'HORIZONTAL_OVERFLOW',
              description: `Document scrollWidth (${docWidth}px) exceeds viewport width (${winWidth}px).`
            });
          }

          // 2. Check hardcoded mock identity / placeholder leaks in visible text
          const bodyText = document.body ? document.body.innerText : '';
          if (bodyText.includes('undefined') || bodyText.includes('[object Object]') || bodyText.includes('NaN%')) {
            findings.push({
              phase: 'Phase 2: Data Binding & Null Safety',
              severity: 'HIGH',
              code: 'RAW_UNDEFINED_OR_NAN_IN_UI',
              description: 'Visible text contains literal "undefined", "[object Object]", or "NaN%".'
            });
          }

          // 3. Check tables for column sorting support
          const tables = Array.from(document.querySelectorAll('table'));
          metrics.tableCount = tables.length;
          tables.forEach((tbl, idx) => {
            const ths = Array.from(tbl.querySelectorAll('thead th'));
            if (ths.length > 1) {
              const sortableThs = ths.filter(th =>
                th.hasAttribute('data-sort') ||
                th.hasAttribute('onclick') ||
                th.style.cursor === 'pointer' ||
                th.classList.contains('sortable') ||
                th.querySelector('[data-sort], .sort-icon, .fa-sort')
              );
              if (sortableThs.length === 0) {
                findings.push({
                  phase: 'Phase 4: Search, Filters & Table Sorting',
                  severity: 'MEDIUM',
                  code: 'TABLE_NOT_SORTABLE',
                  description: `Table #${idx + 1} (${ths.length} columns) has no sortable column headers.`
                });
              }
            }
          });

          // 4. Check forms & modals for submit button and SWR / save handling
          const forms = Array.from(document.querySelectorAll('form'));
          metrics.formCount = forms.length;
          forms.forEach((f, idx) => {
            const hasSaveAttr = f.hasAttribute('data-save-form');
            const hasSubmitHandler = !!f.getAttribute('onsubmit') || !!f.id;
            if (!hasSaveAttr && !hasSubmitHandler) {
              findings.push({
                phase: 'Phase 3: CRUD & Form Persistence',
                severity: 'MEDIUM',
                code: 'UNBOUND_FORM_ELEMENT',
                description: `Form #${idx + 1} has no id, onsubmit, or data-save-form attribute.`
              });
            }
          });

          // 5. Check Dark Mode readiness
          const styleTags = Array.from(document.querySelectorAll('style')).map(s => s.textContent).join('\n');
          const hasDarkRules = styleTags.includes('data-theme="dark"') || styleTags.includes('.dark') || styleTags.includes('--bg-');
          metrics.hasDarkRules = hasDarkRules;
          if (!hasDarkRules) {
            findings.push({
              phase: 'Phase 6: Theme & Contrast',
              severity: 'MEDIUM',
              code: 'MISSING_DARK_MODE_TOKENS',
              description: 'Page stylesheet lacks [data-theme="dark"] rules or semantic CSS custom properties.'
            });
          }

          return { findings, metrics };
        });

        pageReport.issues.push(...domAudit.findings);
        pageReport.metrics = domAudit.metrics;
      }

      if (pageReport.consoleErrors.length > 0) {
        pageReport.issues.push({
          phase: 'Phase 5: Runtime & Console',
          severity: 'HIGH',
          code: 'CONSOLE_ERROR',
          description: `Console error(s): ${pageReport.consoleErrors.slice(0, 2).join(' | ')}`
        });
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
    page.off('requestfailed', onRequestFailed);

    const statusIcon = pageReport.issues.length === 0 ? '✅' : `❌ (${pageReport.issues.length} issues)`;
    console.log(`  - [${p.route}] ${p.title}: ${statusIcon}`);
    results.pages.push(pageReport);
  }

  await browser.close();

  const outFile = outArg
    ? outArg.split('=')[1]
    : path.join(__dirname, `qa-audit-${APP_FOLDER}-round-${ROUND}.json`);
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2));

  const totalIssues = results.pages.reduce((sum, p) => sum + p.issues.length, 0);
  console.log(`\n📊 Round ${ROUND} Summary for ${APP_FOLDER}: ${totalIssues} runtime/UI issue(s) across ${PAGES.length} pages.`);
  console.log(`📄 Saved report to: ${outFile}\n`);
}

runAudit().catch(err => {
  console.error('Fatal error in QA audit script:', err);
  process.exit(1);
});
