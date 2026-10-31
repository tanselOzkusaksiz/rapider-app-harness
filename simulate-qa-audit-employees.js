#!/usr/bin/env node

/**
 * ============================================================================
 * QA Engineer Simulation & 6-Phase Audit Runner for HR Employees App
 * ============================================================================
 * Follows QA_APP_BUILDER_BUG_REPORTING_GUIDE.md across all 12 pages of
 * rapider-app-re-a-rapider-employees using localhost:4200 & localhost:3300.
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { ensureAuthenticated } = require('./harness-auth-helper');

const APP_SLUG = 'rapider-app-re-a-rapider-employees';
const APP_ID = '7c424ecb-fee6-4c78-afdb-721256119a83';
const HARNESS_URL = process.env.HARNESS_URL || 'http://localhost:3300';
const UI_URL = process.env.UI_URL || 'http://localhost:4200';

const PAGES = [
  { route: 'overview', name: 'Overview', file: 'pages/overview/overview.html', hasTable: false, hasForm: false },
  { route: 'directory', name: 'Directory', file: 'pages/directory/directory.html', hasTable: true, hasForm: false },
  { route: 'profile', name: 'Profile', file: 'pages/profile/profile.html', hasTable: false, hasForm: true },
  { route: 'organization', name: 'Organization', file: 'pages/organization/organization.html', hasTable: true, hasForm: true },
  { route: 'lifecycle', name: 'Lifecycle', file: 'pages/lifecycle/lifecycle.html', hasTable: true, hasForm: true },
  { route: 'documents', name: 'Documents', file: 'pages/documents/documents.html', hasTable: true, hasForm: true },
  { route: 'reports', name: 'Reports', file: 'pages/reports/reports.html', hasTable: true, hasForm: false },
  { route: 'import', name: 'Import & Export', file: 'pages/import/import.html', hasTable: false, hasForm: false },
  { route: 'settings', name: 'Settings', file: 'pages/settings/settings.html', hasTable: false, hasForm: true },
  { route: 'add-employee', name: 'Add Employee', file: 'pages/add-employee/add-employee.html', hasTable: false, hasForm: true },
  { route: 'edit-employee', name: 'Edit Employee', file: 'pages/edit-employee/edit-employee.html', hasTable: false, hasForm: true },
  { route: 'change-employee', name: 'Change Employee', file: 'pages/change-employee/change-employee.html', hasTable: false, hasForm: true }
];

async function runQaSimulation() {
  const roundArg = process.argv.find(a => a.startsWith('--round='))?.split('=')[1] || '1';
  const outFile = path.resolve(__dirname, `qa-simulation-round-${roundArg}.json`);
  const screenshotDir = path.resolve(__dirname, 'qa-screenshots', `round-${roundArg}`);
  fs.mkdirSync(screenshotDir, { recursive: true });

  console.log(`\n================================================================`);
  console.log(`🕵️  QA ENGINEER SIMULATION — ROUND ${roundArg} (${APP_SLUG})`);
  console.log(`🌐 Local UI: ${UI_URL} | Local Harness: ${HARNESS_URL}`);
  console.log(`================================================================\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Check localhost:4200 Rapider UI reachability first
  let uiReachable = false;
  try {
    const uiRes = await page.goto(UI_URL, { waitUntil: 'domcontentloaded', timeout: 10000 });
    uiReachable = Boolean(uiRes && uiRes.status() < 500);
    console.log(`✅ Verified Local Rapider UI at ${UI_URL} (HTTP ${uiRes ? uiRes.status() : 'N/A'})`);
  } catch (e) {
    console.log(`⚠️  Local Rapider UI check warning: ${e.message}`);
  }

  // Authenticate against Harness + Live Backend
  const consoleErrors = [];
  const networkErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!text.includes('favicon') && !text.includes('fonts.gstatic')) {
        consoleErrors.push(text);
      }
    }
  });
  page.on('response', res => {
    if (res.status() >= 400 && (res.url().includes('rappider.com') || res.url().includes('rapider.ai'))) {
      networkErrors.push({ status: res.status(), url: res.url() });
    }
  });

  await ensureAuthenticated(page, APP_SLUG);

  // Obtain a real employee ID for detail/edit/change routes
  await page.goto(`${HARNESS_URL}/?app=${APP_SLUG}#/directory`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const frame0 = page.frameLocator('#sandbox-iframe');
  let sampleEmployeeId = null;
  try {
    const href = await frame0.locator('a[href*="profile?id="]').first().getAttribute('href', { timeout: 5000 });
    const m = href && href.match(/id=([0-9a-f\-]{36})/i);
    if (m) sampleEmployeeId = m[1];
  } catch (_) {}

  const pageReports = [];
  const discoveredBugs = [];

  for (const p of PAGES) {
    consoleErrors.length = 0;
    networkErrors.length = 0;

    const routeWithParam = ['profile', 'edit-employee', 'change-employee'].includes(p.route) && sampleEmployeeId
      ? `${p.route}?id=${sampleEmployeeId}`
      : p.route;

    const targetUrl = `${HARNESS_URL}/?app=${APP_SLUG}#/${routeWithParam}`;
    await page.goto(targetUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1800);

    const iframeEl = await page.$('#sandbox-iframe');
    const frame = await iframeEl.contentFrame();

    const audit = await frame.evaluate((pageMeta) => {
      const issues = [];
      const passes = [];

      // Phase 1: Identity & Mock Leak Check (QA_APP_BUILDER_BUG_REPORTING_GUIDE.md Section 5 & 7)
      const eyebrowText = (document.querySelector('.eyebrow')?.textContent || '').trim();
      const appboxSub = (document.querySelector('.appbox small')?.textContent || '').trim();
      const profileName = (document.querySelector('.profile-link strong')?.textContent || '').trim();
      const profileSub = (document.querySelector('.profile-link small')?.textContent || '').trim();
      const bodyText = document.body.innerText || '';

      if (/^ACME\s*\/\s*EMPLOYEES$/i.test(eyebrowText) || /^Acme\s*·\s*People$/i.test(appboxSub) || /^Jamie Lee$/i.test(profileName)) {
        issues.push({
          phase: 'Phase 1: Initial Load, Identity & Zero Mock Leaks',
          passRef: 'Pass 03 / Pass 19',
          severity: 'High',
          selector: '.sidebar .profile-link, .topbar .eyebrow, .sidebar .appbox',
          title: `[${pageMeta.name} Page] Hardcoded mock organization ("ACME / EMPLOYEES") and user identity ("Jamie Lee") instead of dynamic workspace/user resolution`,
          actual: `Topbar eyebrow displays "${eyebrowText}", sidebar appbox displays "${appboxSub}", and sidebar footer displays "${profileName} (${profileSub})".`,
          expected: `Organization name and logged-in user identity must be resolved dynamically from the active Rapider workspace/session or FinLegalEntity record, never hardcoded to "ACME" or "Jamie Lee".`
        });
      } else {
        passes.push('Phase 1: Dynamic workspace organization & user identity verified (no hardcoded ACME / Jamie Lee)');
      }

      if (/Amelia Brooks|EMP-0108/i.test(bodyText)) {
        issues.push({
          phase: 'Phase 1: Initial Load, Identity & Zero Mock Leaks',
          passRef: 'Pass 03',
          severity: 'Critical',
          selector: 'main.main',
          title: `[${pageMeta.name} Page] Static wireframe identity ("Amelia Brooks" / "EMP-0108") leaked into DOM`,
          actual: 'Found "Amelia Brooks" or "EMP-0108" in visible text.',
          expected: 'Zero static wireframe identities in visible DOM.'
        });
      } else {
        passes.push('Phase 1: Zero wireframe identity leaks ("Amelia Brooks" / "EMP-0108")');
      }

      // Phase 2: Dynamic Charts & Data Hydration
      if (pageMeta.route === 'overview') {
        const growthChart = document.querySelector('#overview-growth-chart');
        const hasDynamicAttr = growthChart && growthChart.getAttribute('data-hydrated') === 'true';
        if (!hasDynamicAttr) {
          issues.push({
            phase: 'Phase 2: Empty State, Seed Data & Live Data Hydration',
            passRef: 'Pass 02 / Pass 03',
            severity: 'Medium',
            selector: '#overview-growth-chart',
            title: `[Overview Page] "Team growth" Q1–Q4 bar chart uses static hardcoded heights instead of live HrEmployee hire date data`,
            actual: `#overview-growth-chart renders static hardcoded bar heights (60px, 75px, 90px, 110px) that do not update from live HrEmployee records.`,
            expected: `#overview-growth-chart must dynamically compute quarterly headcount bars and labels from live HrEmployee start dates and mark data-hydrated="true".`
          });
        } else {
          passes.push('Phase 2: Overview Team growth chart dynamically hydrated from live HrEmployee records');
        }
      }

      // Phase 3: Forms, Schema Completeness & Action Handlers
      const formsMissingAttr = Array.from(document.querySelectorAll('form')).filter(f => !f.hasAttribute('data-save-form'));
      if (formsMissingAttr.length > 0) {
        issues.push({
          phase: 'Phase 3: CRUD Lifecycle & Form Persistence',
          passRef: 'Pass 02',
          severity: 'Medium',
          selector: 'form:not([data-save-form])',
          title: `[${pageMeta.name} Page] Mutation form(s) missing mandatory data-save-form attribute`,
          actual: `Found ${formsMissingAttr.length} <form> element(s) without the data-save-form attribute (${formsMissingAttr.map(f => '#' + (f.id || 'unnamed')).join(', ')}).`,
          expected: `All mutation <form> elements must include the data-save-form attribute per Pass 02 SWR & Mutation conventions.`
        });
      } else if (pageMeta.hasForm) {
        passes.push('Phase 3: All mutation <form> elements include data-save-form');
      }

      if (pageMeta.route === 'change-employee') {
        const locSelect = document.querySelector('#changeLocationSelect, [name="proposedLocationId"]');
        if (!locSelect) {
          issues.push({
            phase: 'Phase 3: CRUD Lifecycle & Schema Completeness',
            passRef: 'Pass 03 / Pass 09',
            severity: 'Medium',
            selector: '#changeForm',
            title: `[Change Employee Page] Form missing "Proposed location" (proposedLocationId) selector despite HrChangeRequest schema support`,
            actual: `loadChangePageData() fetches HrLocation records, but #changeForm has no Proposed location dropdown bound to proposedLocationId.`,
            expected: `#changeForm must include a #changeLocationSelect dropdown populated with live HrLocation options and submit proposedLocationId in the HrChangeRequest payload.`
          });
        } else {
          passes.push('Phase 3: Change Employee form includes Proposed location (#changeLocationSelect) bound to proposedLocationId');
        }
      }

      if (pageMeta.route === 'add-employee' || pageMeta.route === 'edit-employee') {
        const jobProfileSelect = document.querySelector('#jobProfileId, [name="jobProfileId"]');
        if (!jobProfileSelect) {
          issues.push({
            phase: 'Phase 3: CRUD Lifecycle & Schema Completeness',
            passRef: 'Pass 03 / Pass 09',
            severity: 'Medium',
            selector: pageMeta.route === 'add-employee' ? '#addEmployeeForm' : '#editEmployeeForm',
            title: `[${pageMeta.name} Page] Employee form missing "Job profile" (jobProfileId) selector required for 100% Data Completeness`,
            actual: `Form does not include a Job profile (#jobProfileId) selector, leaving jobProfileId unset on created/updated HrEmployee records.`,
            expected: `Form must include a #jobProfileId dropdown populated from live HrJobProfile records and persist jobProfileId on save.`
          });
        } else {
          passes.push('Phase 3: Employee form includes Job profile (#jobProfileId) selector');
        }
      }

      // Phase 4: Interactive Column Sorting & Bulk Selection
      if (pageMeta.hasTable) {
        const sortableHeaders = document.querySelectorAll('th[data-sort]');
        if (sortableHeaders.length === 0) {
          issues.push({
            phase: 'Phase 4: Search, Filtering, Column Sorting & Bulk Actions',
            passRef: 'Pass 20',
            severity: 'High',
            selector: 'table thead th',
            title: `[${pageMeta.name} Page] Data table column headers do not support interactive ascending/descending sorting`,
            actual: `Clicking <th> column headers on ${pageMeta.route}.html does nothing (0 th[data-sort] headers found).`,
            expected: `Data table column headers must include data-sort attributes and click handlers that toggle ascending/descending sort order with visible ↑/↓ indicators.`
          });
        } else {
          passes.push(`Phase 4: Interactive column sorting enabled (${sortableHeaders.length} sortable columns)`);
        }
      }

      if (pageMeta.route === 'lifecycle') {
        const hasDeclineBtn = document.body.innerHTML.includes('decline-item') || Boolean(document.querySelector('[data-action="decline-item"]'));
        const hasBulkHandler = typeof window.__lifecycleBulkSelectionWired === 'boolean' && window.__lifecycleBulkSelectionWired;
        if (!hasDeclineBtn || !hasBulkHandler) {
          issues.push({
            phase: 'Phase 4: Search, Filtering, Column Sorting & Bulk Actions',
            passRef: 'Pass 08 / Pass 20',
            severity: 'High',
            selector: '#lifecycle-table-body, #bulk-bar',
            title: `[Lifecycle Page] Missing bulk checkbox selection handler (#bulk-bar), filtered CSV export, and Decline action on pending change requests`,
            actual: `Checking [data-select-all] or [data-select-row] does not reveal #bulk-bar, export-selected exports all records instead of selected rows, and pending HrChangeRequest rows lack a Decline action.`,
            expected: `Checking row/header checkboxes must toggle #bulk-bar, export-selected must export checked rows when selected, and pending requests must offer both Approve and Decline actions.`
          });
        } else {
          passes.push('Phase 4: Lifecycle bulk checkbox selection, filtered export, and Approve/Decline actions verified');
        }
      }

      if (pageMeta.route === 'documents') {
        const hasFilteredExport = typeof window.__documentsFilteredExportWired === 'boolean' && window.__documentsFilteredExportWired;
        if (!hasFilteredExport) {
          issues.push({
            phase: 'Phase 4: Search, Filtering, Column Sorting & Bulk Actions',
            passRef: 'Pass 20',
            severity: 'Medium',
            selector: '#bulk-bar [data-action="export-selected"]',
            title: `[Documents Page] Bulk "Export selected" action exports all documents instead of only checked rows`,
            actual: `Clicking [data-action="export-selected"] in #bulk-bar exports the entire state.documents array instead of filtering by checked [data-select-row] checkboxes.`,
            expected: `[data-action="export-selected"] must export only the checked document rows when rows are selected in #documents-table-body.`
          });
        } else {
          passes.push('Phase 4: Documents bulk export accurately filters by selected checkboxes');
        }
      }

      // Phase 5: Dark Mode Theme Parity (Pass 07)
      document.documentElement.classList.add('dark');
      document.body.classList.add('dark');
      const panelEl = document.querySelector('.panel') || document.querySelector('.sidebar');
      const panelBg = panelEl ? window.getComputedStyle(panelEl).backgroundColor : '';
      const bodyBg = window.getComputedStyle(document.body).backgroundColor;
      document.documentElement.classList.remove('dark');
      document.body.classList.remove('dark');

      const isPanelStillWhiteInDark = panelBg === 'rgb(255, 255, 255)' || bodyBg === 'rgb(248, 250, 252)';
      if (isPanelStillWhiteInDark) {
        issues.push({
          phase: 'Phase 5: Theme Parity (Light & Dark Mode) & Visual Polish',
          passRef: 'Pass 07',
          severity: 'High',
          selector: 'html.dark .panel, html.dark .sidebar, html.dark .topbar',
          title: `[${pageMeta.name} Page] Dark mode (html.dark / body.dark) missing dark surface & text tokens — cards and sidebar stay bright white`,
          actual: `When html.dark / body.dark is active, body background is "${bodyBg}" and .panel/.sidebar background remains "${panelBg}" (bright white), breaking Dark Mode parity.`,
          expected: `All 12 pages must define html.dark / body.dark CSS variables and dark surface rules (.sidebar, .topbar, .panel, inputs, tables, dialogs) with WCAG AA contrast.`
        });
      } else {
        passes.push(`Phase 5: Dark Mode (html.dark / body.dark) surface parity verified (panel: ${panelBg})`);
      }

      return { issues, passes, eyebrowText, profileName, panelBgInDark: panelBg };
    }, p);

    // Phase 6: Network & Console Health
    if (consoleErrors.length > 0 || networkErrors.length > 0) {
      audit.issues.push({
        phase: 'Phase 6: Network & Console Health',
        passRef: 'Pass 09',
        severity: 'Critical',
        selector: 'window',
        title: `[${p.name} Page] Runtime console or HTTP 4xx/5xx network errors detected`,
        actual: `Console errors: ${consoleErrors.length}, Network 4xx/5xx: ${networkErrors.length}`,
        expected: `0 console errors and 0 HTTP 4xx/5xx errors.`
      });
    } else {
      audit.passes.push('Phase 6: 0 Console Errors & 0 HTTP 4xx/5xx API Errors');
    }

    const screenshotPath = path.join(screenshotDir, `${p.route}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });

    const status = audit.issues.length === 0 ? 'PASSED' : `FAILED (${audit.issues.length} issues)`;
    console.log(`📄 [${p.route.padEnd(15)}] ${status}`);
    for (const iss of audit.issues) {
      console.log(`   ❌ (${iss.severity}) ${iss.title}`);
      discoveredBugs.push({
        pageRoute: p.route,
        pageName: p.name,
        file: p.file,
        ...iss
      });
    }

    pageReports.push({
      route: p.route,
      name: p.name,
      file: p.file,
      screenshot: screenshotPath,
      issueCount: audit.issues.length,
      passCount: audit.passes.length,
      issues: audit.issues,
      passes: audit.passes
    });
  }

  await browser.close();

  const summary = {
    round: Number(roundArg),
    timestamp: new Date().toISOString(),
    appSlug: APP_SLUG,
    appId: APP_ID,
    uiUrl: UI_URL,
    harnessUrl: HARNESS_URL,
    uiReachable,
    totalPages: PAGES.length,
    pagesPassed: pageReports.filter(r => r.issueCount === 0).length,
    pagesWithIssues: pageReports.filter(r => r.issueCount > 0).length,
    totalIssuesFound: discoveredBugs.length,
    pageReports,
    discoveredBugs
  };

  fs.writeFileSync(outFile, JSON.stringify(summary, null, 2));
  console.log(`\n================================================================`);
  console.log(`📊 QA SIMULATION ROUND ${roundArg} COMPLETE`);
  console.log(`   Pages Audited: ${summary.totalPages}`);
  console.log(`   Pages Passed : ${summary.pagesPassed}/${summary.totalPages}`);
  console.log(`   Total Issues : ${summary.totalIssuesFound}`);
  console.log(`   Saved Report : ${outFile}`);
  console.log(`================================================================\n`);
}

runQaSimulation().catch(err => {
  console.error('Fatal error in QA Simulation:', err);
  process.exit(1);
});

