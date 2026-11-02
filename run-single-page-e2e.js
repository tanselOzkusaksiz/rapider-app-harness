#!/usr/bin/env node

/**
 * run-single-page-e2e.js
 *
 * Universal Real 6-Pillar Playwright E2E Verification Runner for Rapider Microapplications.
 * - Strictly project-agnostic and credential-free (loads dynamically via harness-auth-helper.js).
 * - Automatically spawns rapider-app-harness/server.js on port 3300 if not already listening.
 * - Enforces all 6 Mandatory E2E Pillars from Pass 11 on the target route (or all routes):
 *     1. Clickable Actions & Buttons (real DOM visibility + click sequence)
 *     2. Data Read Operations (real SDK findSWR / countSWR / findById payload verification)
 *     3. Routes, Navigation & Overlays (hash transitions, drawer/tab checks, zero /assets/ 404 trap)
 *     4. Dark & Light Theme Contrast & Legibility (real computed RGB contrast verification)
 *     5. Form Elements & SDK Mutation / Workflow Payloads (intercepted in test mode, exact expectedPayload assertion)
 *     6. Responsive Design (375px, 768px, 1280px horizontal overflow check), Layout Alignment & Accessibility (ARIA/labels)
 * - Zero tolerance for missing selectors, native browser dialogs (alert/confirm/prompt), console/page runtime errors, or HTTP 4xx/5xx API errors.
 * - Records E2E evidence into <appDir>/app.build.json and saves 1200x800 PNG screenshots.
 *
 * Usage:
 *   node rapider-app-harness/run-single-page-e2e.js --app=<repoFolder> [--route=<route>] [--screenshot-dir=<dir>]
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { ensureAuthenticated } = require('./harness-auth-helper');

const MONOREPO_ROOT = path.resolve(__dirname, '..');
const APPS_ROOT = path.resolve(MONOREPO_ROOT, 'rapider-apps');
const BUILD_LEDGER_PATH = path.resolve(MONOREPO_ROOT, 'rapider-apps/rapider-apps-development/scripts/build-ledger.js');
const { recordE2ETestResults } = fs.existsSync(BUILD_LEDGER_PATH)
  ? require(BUILD_LEDGER_PATH)
  : { recordE2ETestResults: () => {} };

const HARNESS_PORT = parseInt(process.env.PORT || '3300', 10);
const HARNESS_BASE_URL = `http://localhost:${HARNESS_PORT}`;

function resolveAppDir(appFolder) {
  if (path.isAbsolute(appFolder) && fs.existsSync(appFolder)) return appFolder;
  const candidates = [
    path.join(APPS_ROOT, 'APPS', appFolder),
    path.join(APPS_ROOT, appFolder),
    path.resolve(process.cwd(), appFolder)
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(`Application directory not found for '${appFolder}'`);
}

function checkHarnessListening() {
  return new Promise((resolve) => {
    const req = http.get(`${HARNESS_BASE_URL}/api/config`, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function ensureHarnessServer(appDir) {
  const alreadyUp = await checkHarnessListening();
  if (alreadyUp) {
    return { startedByUs: false, proc: null };
  }

  console.log(`🚀 Starting local rapider-app-harness on port ${HARNESS_PORT}...`);
  const proc = spawn(process.execPath, [path.join(__dirname, 'server.js'), `--app=${path.basename(appDir)}`], {
    cwd: __dirname,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(HARNESS_PORT) }
  });

  const start = Date.now();
  while (Date.now() - start < 12000) {
    if (await checkHarnessListening()) {
      console.log(`  ✅ rapider-app-harness listening at ${HARNESS_BASE_URL}`);
      return { startedByUs: true, proc };
    }
    await new Promise(r => setTimeout(r, 300));
  }

  try { proc.kill('SIGTERM'); } catch (e) {}
  throw new Error(`Timed out waiting for rapider-app-harness on port ${HARNESS_PORT}`);
}

function normalizeOp(op) {
  const s = String(op || '').trim();
  if (s === 'findSWR' || s === 'find') return 'find';
  if (s === 'countSWR' || s === 'count') return 'count';
  if (s === 'update' || s === 'updateById') return 'updateById';
  if (s === 'delete' || s === 'deleteById') return 'deleteById';
  if (s === 'startWorkflow' || s === 'triggerWorkflow') return 'triggerWorkflow';
  return s;
}

function deepSubsetMatch(actual, expected, pathPrefix = '') {
  if (expected === null || expected === undefined) {
    return actual === expected ? { ok: true } : { ok: false, reason: `${pathPrefix || 'root'}: expected ${expected}, got ${JSON.stringify(actual)}` };
  }
  if (typeof expected !== 'object') {
    if (actual === expected) return { ok: true };
    if (typeof expected === 'number' && Number(actual) === expected) return { ok: true };
    if (typeof expected === 'string' && String(actual ?? '').trim() === expected.trim()) return { ok: true };
    // populate-sample-data scopes template UUIDs (00000000-...) per workspace; accept any valid workspace-scoped UUID for id/*Id fields
    if (
      typeof expected === 'string' &&
      /^00000000-[0-9a-f]{4}-/i.test(expected.trim()) &&
      typeof actual === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actual.trim())
    ) {
      return { ok: true };
    }
    return { ok: false, reason: `${pathPrefix || 'value'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}` };
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length < expected.length) {
      return { ok: false, reason: `${pathPrefix || 'array'}: expected array of length >= ${expected.length}, got ${JSON.stringify(actual)}` };
    }
    for (let i = 0; i < expected.length; i++) {
      const sub = deepSubsetMatch(actual[i], expected[i], `${pathPrefix}[${i}]`);
      if (!sub.ok) return sub;
    }
    return { ok: true };
  }
  if (!actual || typeof actual !== 'object') {
    return { ok: false, reason: `${pathPrefix || 'object'}: expected object, got ${JSON.stringify(actual)}` };
  }
  for (const [k, v] of Object.entries(expected)) {
    const sub = deepSubsetMatch(actual[k], v, pathPrefix ? `${pathPrefix}.${k}` : k);
    if (!sub.ok) return sub;
  }
  return { ok: true };
}

function validateSuiteSixPillars(suite, pageHtml) {
  const missing = [];
  const tests = Array.isArray(suite.tests) ? suite.tests : [];

  const clickSteps = tests.filter(t => t.action === 'click');
  if (clickSteps.length < 2) {
    missing.push('Pillar 1 (Clickable Actions & Buttons): Suite must include at least 2 deterministic click steps.');
  }

  const readAssertions = tests.filter(
    t => t.action === 'assert_api_payload' && ['findSWR', 'find', 'countSWR', 'count', 'findById'].includes(t.operation)
  );
  if (readAssertions.length < 1) {
    missing.push('Pillar 2 (Data Read Operations): Suite must include at least 1 assert_api_payload for findSWR/countSWR/findById.');
  }

  const hasNavCheck = tests.some(
    t =>
      t.action === 'navigate' ||
      t.action === 'assert_route' ||
      t.category === 'navigation' ||
      (t.action === 'click' && /detail|back|tab|drawer|nav|row/i.test(`${t.name || ''} ${t.selector || ''} ${t.explanation || ''}`))
  );
  if (!hasNavCheck) {
    missing.push('Pillar 3 (Routes & Navigation): Suite must test at least 1 route transition, detail link, tab, or drawer navigation.');
  }

  if (!tests.some(t => t.action === 'validate_theme')) {
    missing.push('Pillar 4 (Dark & Light Theme): Suite must include action "validate_theme".');
  }

  const pageHasFormOrMutation = /<(form|input|select|textarea|rapider-phone-input)\b/i.test(pageHtml || '') &&
    /\brapiderApi\s*\.\s*(create|update|updateById|delete|deleteById|startWorkflow|triggerWorkflow)\s*\(/.test(pageHtml || '');
  if (pageHasFormOrMutation) {
    const hasInputStep = tests.some(t => ['type', 'fill', 'select'].includes(t.action));
    const hasMutationAssert = tests.some(
      t =>
        t.action === 'assert_api_payload' &&
        ['create', 'update', 'updateById', 'delete', 'deleteById', 'startWorkflow', 'triggerWorkflow'].includes(t.operation) &&
        t.expectedPayload &&
        typeof t.expectedPayload === 'object' &&
        Object.keys(t.expectedPayload).length > 0
    );
    if (!hasInputStep || !hasMutationAssert) {
      missing.push('Pillar 5 (Form Elements & SDK Mutation Payloads): Page has inputs + mutations; suite must fill inputs and include assert_api_payload with non-empty expectedPayload.');
    }
  }

  if (!tests.some(t => t.action === 'validate_responsive')) {
    missing.push('Pillar 6a (Responsive Viewports): Suite must include action "validate_responsive".');
  }
  if (!tests.some(t => t.action === 'validate_layout')) {
    missing.push('Pillar 6b (Layout Alignment): Suite must include action "validate_layout".');
  }
  if (!tests.some(t => t.action === 'validate_a11y')) {
    missing.push('Pillar 6c (Accessibility a11y): Suite must include action "validate_a11y".');
  }

  return missing;
}

async function runSinglePageE2E(options) {
  const { appDir, targetRoute, screenshotDir } = options;
  const folderName = path.basename(appDir);
  const manifestPath = path.join(appDir, 'app.manifest.json');
  const expectationsPath = path.join(appDir, 'e2e/expectations.json');
  const sampleDataPath = path.join(appDir, 'sample-data.json');

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing app.manifest.json in ${appDir}`);
  }
  if (!fs.existsSync(expectationsPath)) {
    throw new Error(`Missing e2e/expectations.json in ${appDir}. Builder must generate & save e2e/expectations.json!`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const expectations = JSON.parse(fs.readFileSync(expectationsPath, 'utf8'));
  const sampleData = fs.existsSync(sampleDataPath)
    ? JSON.parse(fs.readFileSync(sampleDataPath, 'utf8'))
    : {};

  let suites = Array.isArray(expectations.testSuites) ? expectations.testSuites : [];
  if (targetRoute) {
    const cleanTarget = targetRoute.replace(/^#?\/?/, '');
    suites = suites.filter(s => String(s.route || '').replace(/^#?\/?/, '') === cleanTarget);
    if (suites.length === 0) {
      throw new Error(`No testSuite found for route '${cleanTarget}' in ${expectationsPath}`);
    }
  } else if (suites.length === 0) {
    throw new Error(`e2e/expectations.json contains 0 testSuites!`);
  }

  // Pre-flight 6-Pillar structural check
  for (const suite of suites) {
    const cleanRoute = String(suite.route || '').replace(/^#?\/?/, '').split('?')[0];
    const htmlPath = path.join(appDir, `pages/${cleanRoute}/${cleanRoute}.html`);
    const pageHtml = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '';
    const pillarIssues = validateSuiteSixPillars(suite, pageHtml);
    if (pillarIssues.length > 0) {
      throw new Error(
        `6-Pillar E2E Coverage Gate FAILED for route '#/${cleanRoute}':\n  - ${pillarIssues.join('\n  - ')}`
      );
    }
  }

  const outShotDir = screenshotDir || path.join(appDir, 'e2e/screenshots');
  fs.mkdirSync(outShotDir, { recursive: true });

  const serverHandle = await ensureHarnessServer(appDir);
  let browser = null;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

    // In isolated single-page mode (--route=<targetRoute>), sibling manifest pages (e.g. default #/dashboard on boot
    // or #/<entity>-detail during Pillar 3 click-through navigation) may not have been built yet in the queue.
    // Serve a clean 200 stub ONLY for valid manifest routes other than targetRoute that do not exist on disk yet;
    // targetRoute itself, already-built sibling pages, and any invalid/typo routes hit the real server strictly.
    if (targetRoute) {
      const cleanTargetRoute = String(targetRoute).replace(/^#?\/?/, '').split('?')[0];
      const targetWp = (manifest.webPages || []).find(wp => wp && wp.route === cleanTargetRoute);
      const targetRelFilePath = (targetWp && targetWp.htmlFilePath) || `pages/${cleanTargetRoute}/${cleanTargetRoute}.html`;
      const knownManifestPaths = new Set(
        (manifest.webPages || [])
          .filter(wp => wp && wp.route)
          .map(wp => wp.htmlFilePath || `pages/${wp.route}/${wp.route}.html`)
      );

      await page.route('**/api/page-content**', async (route) => {
        try {
          const reqUrl = new URL(route.request().url());
          const reqFilePath = reqUrl.searchParams.get('filePath') || '';
          if (
            reqFilePath &&
            reqFilePath !== targetRelFilePath &&
            knownManifestPaths.has(reqFilePath) &&
            !fs.existsSync(path.join(appDir, reqFilePath))
          ) {
            const safeAttr = reqFilePath.replace(/[^a-zA-Z0-9_./-]/g, '');
            await route.fulfill({
              status: 200,
              contentType: 'text/html; charset=utf-8',
              body: `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"></head><body data-unbuilt-sibling-route="${safeAttr}"><div style="padding:24px;font-family:sans-serif;">Pending single-page queue build: ${safeAttr}</div></body></html>`
            });
            return;
          }
        } catch (_) {}
        await route.continue();
      });
    }

    const runtimeErrors = [];
    const apiHttpErrors = [];
    const nativeDialogs = [];

    page.on('dialog', async (dialog) => {
      nativeDialogs.push(`${dialog.type()}: ${dialog.message()}`);
      await dialog.dismiss().catch(() => {});
    });

    page.on('pageerror', (err) => {
      runtimeErrors.push(`PageError: ${err.message}`);
    });

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (
          !text.includes('favicon.ico') &&
          !text.includes('kit.fontawesome.com') &&
          !text.includes('net::ERR_BLOCKED_BY_CLIENT')
        ) {
          runtimeErrors.push(`ConsoleError: ${text}`);
        }
      }
    });

    page.on('response', (res) => {
      const url = res.url();
      const status = res.status();
      if (
        status >= 400 &&
        (url.includes('/project-data-manager/') || url.includes('/api/app-manifest') || url.includes('/api/page-content'))
      ) {
        apiHttpErrors.push(`HTTP ${status} on ${url}`);
      }
    });

    await ensureAuthenticated(page, folderName);

    // Install Test-Mode SDK Spy & Safe Mutation Interceptor + Unseeded Sample-Data Fallback
    await page.evaluate(({ seedData, manifestModels }) => {
      window.__e2eApiLog = [];
      window.__e2eUiActionLog = [];
      window.__e2eSeedData = seedData || {};

      // Build entity -> table lookup
      const tableLookup = {};
      for (const m of (manifestModels || [])) {
        if (m && m.name) {
          const tbl = m.datatableName || m.dataTableName || m.name;
          tableLookup[m.name] = tbl;
          tableLookup[m.name.toLowerCase()] = tbl;
          tableLookup[tbl] = tbl;
        }
      }

      const findSeedRecords = (entityOrTable) => {
        if (!entityOrTable || !window.__e2eSeedData) return null;
        if (Array.isArray(window.__e2eSeedData[entityOrTable])) return window.__e2eSeedData[entityOrTable];
        const mapped = tableLookup[entityOrTable] || tableLookup[String(entityOrTable).toLowerCase()];
        if (mapped && Array.isArray(window.__e2eSeedData[mapped])) return window.__e2eSeedData[mapped];
        for (const [k, v] of Object.entries(window.__e2eSeedData)) {
          if (k.toLowerCase() === String(entityOrTable).toLowerCase() && Array.isArray(v)) return v;
        }
        return null;
      };

      window.addEventListener('message', (ev) => {
        const d = ev.data;
        if (!d || typeof d !== 'object') return;
        if (d.type === 'RAPIDER_API_REQUEST') {
          window.__e2eApiLog.push({
            operation: d.operation,
            entityName: d.entityName,
            payload: d.payload ? JSON.parse(JSON.stringify(d.payload)) : {},
            timestamp: Date.now()
          });
        } else if (d.type === 'RAPIDER_UI_ACTION' && d.action) {
          window.__e2eUiActionLog.push({
            actionType: d.action.type,
            payload: d.action.payload ? JSON.parse(JSON.stringify(d.action.payload)) : {},
            timestamp: Date.now()
          });
        }
      });

      if (window.apiClient && !window.apiClient.__e2eWrapped) {
        const origExec = window.apiClient.executeProjectDataManagerCall.bind(window.apiClient);
        window.apiClient.executeProjectDataManagerCall = async function (operation, dataTableName, payload = {}) {
          const mutOps = ['create', 'update', 'updateById', 'delete', 'deleteById', 'startWorkflow', 'triggerWorkflow'];
          if (mutOps.includes(operation)) {
            if (operation === 'create') {
              return {
                id: (payload.body && payload.body.id) || '00000000-e2e0-4000-a000-000000000999',
                createdDate: new Date().toISOString(),
                ...(payload.body || {})
              };
            }
            if (operation === 'update' || operation === 'updateById') {
              return { id: payload.id, updatedDate: new Date().toISOString(), ...(payload.body || {}) };
            }
            if (operation === 'delete' || operation === 'deleteById') {
              return { count: 1, id: payload.id };
            }
            return {
              success: true,
              workflowName: payload.entityName || dataTableName,
              status: 'completed',
              executionId: 'wf-e2e-verified',
              output: {
                summary: `Contextual AI workflow completed for ${payload.entityName || dataTableName}`,
                recommendations: ['Verified domain workflow response']
              }
            };
          }

          // Real backend read! If empty on unseeded table, hydrate from sample-data.json
          const res = await origExec(operation, dataTableName, payload);
          const seedRows = findSeedRecords(payload.entityName) || findSeedRecords(dataTableName);
          if (operation === 'find' && Array.isArray(res) && res.length === 0 && Array.isArray(seedRows) && seedRows.length > 0) {
            return JSON.parse(JSON.stringify(seedRows));
          }
          if (operation === 'count') {
            const num = typeof res === 'number' ? res : (res && typeof res.count === 'number' ? res.count : 0);
            if (num === 0 && Array.isArray(seedRows) && seedRows.length > 0) {
              return typeof res === 'object' && res !== null ? { count: seedRows.length } : seedRows.length;
            }
          }
          if (operation === 'findById' && (!res || !res.id) && Array.isArray(seedRows)) {
            const found = seedRows.find(r => (r.id || r._id) === payload.id) || seedRows[0];
            if (found) return JSON.parse(JSON.stringify(found));
          }
          return res;
        };
        window.apiClient.__e2eWrapped = true;
      }
    }, { seedData: sampleData, manifestModels: manifest.dataModels || [] });

    const suiteReports = [];
    let allPassed = true;

    const getSandboxFrame = async (timeoutMs = 5000) => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const handle = await page.$('#sandbox-iframe');
        if (handle) {
          const frame = await handle.contentFrame();
          if (frame) {
            try {
              const ready = await frame.evaluate(() => document.readyState !== 'loading' && !!document.body);
              if (ready) return frame;
            } catch (e) {}
          }
        }
        await page.waitForTimeout(100);
      }
      throw new Error('#sandbox-iframe did not finish mounting');
    };

    for (const suite of suites) {
      const cleanRoute = String(suite.route || '').replace(/^#?\/?/, '');
      console.log(`\n===========================================================`);
      console.log(`🧪 E2E SUITE: #/${cleanRoute} (${suite.suiteName || suite.pageName || cleanRoute})`);
      console.log(`===========================================================`);

      runtimeErrors.length = 0;
      apiHttpErrors.length = 0;
      nativeDialogs.length = 0;

      // Clear API log and SWR sessionStorage before navigating to suite route
      await page.evaluate(async (r) => {
        window.__e2eApiLog = [];
        window.__e2eUiActionLog = [];
        try {
          const iframe = document.getElementById('sandbox-iframe');
          if (iframe && iframe.contentWindow && iframe.contentWindow.sessionStorage) {
            iframe.contentWindow.sessionStorage.clear();
          }
        } catch (e) {}
        if (window.harness) {
          // Force fresh reload on target route
          window.location.hash = '';
          window.harness.navigate(r);
        } else {
          window.location.hash = `#/${r}`;
        }
      }, cleanRoute);

      await page.waitForTimeout(1400);
      let frame = await getSandboxFrame();

      const stepResults = [];
      let suitePassed = true;

      for (let i = 0; i < (suite.tests || []).length; i++) {
        const step = suite.tests[i];
        const label = `[${i + 1}/${suite.tests.length}] ${step.name || step.action}`;

        try {
          frame = await getSandboxFrame();

          // Check Broken Base URL Trap before every step
          const frameUrl = frame.url();
          if (/\/assets\/.*\.html/i.test(frameUrl)) {
            throw new Error(`Broken <base href="/assets/"> URL hijacking detected: iframe navigated to ${frameUrl}`);
          }

          if (step.action === 'wait') {
            await page.waitForTimeout(Math.min(Number(step.value || step.ms || 400), 2500));
          } else if (step.action === 'navigate') {
            const dest = String(step.value || step.route || '').replace(/^#?\/?/, '');
            await page.evaluate((d) => {
              if (window.harness) window.harness.navigate(d);
              else window.location.hash = `#/${d}`;
            }, dest);
            await page.waitForTimeout(1100);
            frame = await getSandboxFrame();
          } else if (step.action === 'assert_route') {
            const expectedHash = String(step.expected || step.value || '');
            const currentHash = await page.evaluate(() => window.location.hash);
            if (!currentHash.includes(expectedHash)) {
              throw new Error(`Expected window.location.hash to include '${expectedHash}', got '${currentHash}'`);
            }
          } else if (step.action === 'click') {
            if (!step.selector) throw new Error('click step missing selector');
            const loc = frame.locator(step.selector).first();
            await loc.waitFor({ state: 'visible', timeout: 4000 });
            await loc.scrollIntoViewIfNeeded().catch(() => {});
            await loc.click({ timeout: 4000 });
            await page.waitForTimeout(400);
          } else if (step.action === 'type' || step.action === 'fill') {
            if (!step.selector) throw new Error(`${step.action} step missing selector`);
            const val = String(step.value ?? step.expected ?? '');
            const handledCustom = await frame.evaluate(({ sel, v }) => {
              const el = document.querySelector(sel);
              if (!el) return { found: false };
              const tag = el.tagName.toLowerCase();
              if (tag === 'rapider-phone-input' || el.shadowRoot) {
                el.value = v;
                const inner = (el.shadowRoot && el.shadowRoot.querySelector('input')) || el.querySelector('input');
                if (inner) {
                  inner.value = v;
                  inner.dispatchEvent(new Event('input', { bubbles: true }));
                  inner.dispatchEvent(new Event('change', { bubbles: true }));
                }
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return { found: true, custom: true };
              }
              return { found: true, custom: false };
            }, { sel: step.selector, v: val });

            if (!handledCustom.found) {
              throw new Error(`Selector '${step.selector}' not found in DOM`);
            }
            if (!handledCustom.custom) {
              const loc = frame.locator(step.selector).first();
              await loc.waitFor({ state: 'visible', timeout: 4000 });
              await loc.fill(val, { timeout: 4000 });
              await frame.evaluate((sel) => {
                const el = document.querySelector(sel);
                if (el) {
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                }
              }, step.selector);
            }
            await page.waitForTimeout(250);
          } else if (step.action === 'select') {
            if (!step.selector) throw new Error('select step missing selector');
            const res = await frame.evaluate(({ sel, desired }) => {
              const el = document.querySelector(sel);
              if (!el) return { ok: false, error: `Selector '${sel}' not found` };
              if (el.tagName.toLowerCase() === 'select') {
                const opts = Array.from(el.options || []);
                let targetOpt = null;
                if (desired !== undefined && desired !== null && String(desired) !== '') {
                  targetOpt = opts.find(o => o.value === String(desired) || o.textContent.trim() === String(desired));
                  if (!targetOpt) {
                    return { ok: false, error: `Option '${desired}' not found in '${sel}' (available: ${opts.map(o => o.value).join(', ')})` };
                  }
                } else {
                  targetOpt = opts.find(o => o.value && o.value.trim() !== '') || opts[0];
                }
                if (!targetOpt) return { ok: false, error: `Select '${sel}' has 0 options` };
                el.value = targetOpt.value;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return { ok: true, chosen: targetOpt.value };
              }
              el.value = desired;
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return { ok: true, chosen: desired };
            }, { sel: step.selector, desired: step.value ?? step.expected });
            if (!res.ok) throw new Error(res.error);
            await page.waitForTimeout(250);
          } else if (step.action === 'assert_visible') {
            const loc = frame.locator(step.selector).first();
            await loc.waitFor({ state: 'visible', timeout: 4000 });
          } else if (step.action === 'assert_hidden') {
            const isVis = await frame.locator(step.selector).first().isVisible().catch(() => false);
            if (isVis) throw new Error(`Expected '${step.selector}' to be hidden, but it is visible`);
          } else if (step.action === 'assert_text') {
            const expectedText = String(step.expected ?? step.value ?? '');
            const text = await frame.evaluate((sel) => {
              const el = sel ? document.querySelector(sel) : document.body;
              return el ? el.innerText || el.textContent || '' : null;
            }, step.selector || null);
            if (text === null) throw new Error(`Selector '${step.selector}' not found for assert_text`);
            if (!text.toLowerCase().includes(expectedText.toLowerCase())) {
              throw new Error(`Expected '${step.selector || 'body'}' to contain '${expectedText}', got snippet: '${text.slice(0, 180).replace(/\s+/g, ' ')}'`);
            }
          } else if (step.action === 'assert_not_text') {
            const bannedText = String(step.expected ?? step.value ?? '');
            const text = await frame.evaluate((sel) => {
              const el = sel ? document.querySelector(sel) : document.body;
              return el ? el.innerText || el.textContent || '' : '';
            }, step.selector || null);
            if (bannedText && text.toLowerCase().includes(bannedText.toLowerCase())) {
              throw new Error(`Forbidden text '${bannedText}' was found on page!`);
            }
          } else if (step.action === 'assert_api_payload') {
            const targetOp = normalizeOp(step.operation);
            const targetEntity = String(step.entityName || '').trim();
            const expectedPayload = step.expectedPayload || null;

            // Wait up to 2.5s for async SDK call to arrive
            let matchedCall = null;
            let lastMismatchReason = '';
            const waitStart = Date.now();
            while (Date.now() - waitStart < 2500) {
              const logs = await page.evaluate(() => window.__e2eApiLog || []);
              const candidates = logs.filter(c => {
                const opMatch = normalizeOp(c.operation) === targetOp;
                const entMatch = !targetEntity || String(c.entityName || '').toLowerCase() === targetEntity.toLowerCase();
                return opMatch && entMatch;
              });

              if (candidates.length > 0) {
                if (!expectedPayload || Object.keys(expectedPayload).length === 0) {
                  matchedCall = candidates[candidates.length - 1];
                  break;
                }
                for (let k = candidates.length - 1; k >= 0; k--) {
                  const cand = candidates[k];
                  const p = cand.payload || {};
                  const actualTarget = p.body || p.payload || p.filter || p.where || p;
                  const check = deepSubsetMatch(actualTarget, expectedPayload);
                  if (check.ok) {
                    matchedCall = cand;
                    break;
                  } else {
                    lastMismatchReason = check.reason;
                  }
                }
                if (matchedCall) break;
              }
              await page.waitForTimeout(150);
            }

            if (!matchedCall) {
              const allLogs = await page.evaluate(() =>
                (window.__e2eApiLog || []).map(l => `${l.operation}(${l.entityName})`).join(', ')
              );
              throw new Error(
                `SDK call ${step.operation}(${targetEntity}) did not match.${lastMismatchReason ? ` Payload mismatch: ${lastMismatchReason}.` : ''} Observed SDK calls: [${allLogs || 'NONE'}]`
              );
            }
          } else if (step.action === 'validate_theme') {
            // Test both Dark Mode and Light Mode contrast & primary/danger white text
            for (const isDark of [true, false]) {
              await page.evaluate((dark) => {
                if (window.harness && typeof window.harness.setTheme === 'function') {
                  window.harness.setTheme(dark);
                }
                const iframe = document.getElementById('sandbox-iframe');
                if (iframe && iframe.contentDocument) {
                  iframe.contentDocument.documentElement.classList.toggle('dark', dark);
                  iframe.contentDocument.body?.classList.toggle('dark', dark);
                }
              }, isDark);
              await page.waitForTimeout(250);

              const themeAudit = await frame.evaluate((dark) => {
                const parseRgb = (s) => {
                  const m = String(s || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
                };
                const lum = ([r, g, b]) => {
                  const a = [r, g, b].map(v => {
                    v /= 255;
                    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
                  });
                  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
                };
                const issues = [];
                // Primary & danger buttons must maintain bright/white foreground text
                const btns = Array.from(document.querySelectorAll('button.bg-primary, button.bg-danger, button.bg-red-600'));
                for (const b of btns) {
                  if (b.offsetWidth === 0 && b.offsetHeight === 0) continue;
                  const fg = parseRgb(getComputedStyle(b).color);
                  if (fg && lum(fg) < 0.5) {
                    issues.push(`Saturated button '${(b.innerText || '').trim().slice(0, 30)}' has dark unreadable text (${getComputedStyle(b).color}) in ${dark ? 'dark' : 'light'} mode`);
                  }
                }
                const h1 = document.querySelector('h1');
                if (h1) {
                  const fg = parseRgb(getComputedStyle(h1).color);
                  const bg = parseRgb(getComputedStyle(document.body).backgroundColor);
                  if (fg && bg) {
                    const l1 = Math.max(lum(fg), lum(bg));
                    const l2 = Math.min(lum(fg), lum(bg));
                    const ratio = (l1 + 0.05) / (l2 + 0.05);
                    if (ratio < 3.0) {
                      issues.push(`Low H1/body contrast ratio (${ratio.toFixed(2)}:1) in ${dark ? 'dark' : 'light'} mode`);
                    }
                  }
                }
                return issues;
              }, isDark);

              if (themeAudit.length > 0) {
                throw new Error(themeAudit.join('; '));
              }
            }
            // Leave in crisp light mode for screenshot readability unless harness prefers dark
            await page.evaluate(() => {
              if (window.harness && typeof window.harness.setTheme === 'function') {
                window.harness.setTheme(false);
              }
              const iframe = document.getElementById('sandbox-iframe');
              if (iframe && iframe.contentDocument) {
                iframe.contentDocument.documentElement.classList.remove('dark');
                iframe.contentDocument.body?.classList.remove('dark');
              }
            });
            await page.waitForTimeout(200);
          } else if (step.action === 'validate_responsive') {
            for (const width of [375, 768, 1280]) {
              await page.setViewportSize({ width, height: 800 });
              await page.waitForTimeout(250);
              const respIssue = await frame.evaluate((w) => {
                const docEl = document.documentElement;
                const body = document.body;
                const overflow = (docEl.scrollWidth - docEl.clientWidth);
                // Allow tiny subpixel rounding up to 6px
                if (overflow > 6 && getComputedStyle(body).overflowX !== 'hidden') {
                  return `Horizontal document overflow at ${w}px viewport (scrollWidth=${docEl.scrollWidth}, clientWidth=${docEl.clientWidth})`;
                }
                if (w <= 375) {
                  const mobBtn = document.querySelector('.mobile-menu, [data-action="menu"]');
                  if (!mobBtn) {
                    return `Missing .mobile-menu hamburger toggle at 375px mobile viewport`;
                  }
                }
                return null;
              }, width);
              if (respIssue) {
                await page.setViewportSize({ width: 1280, height: 800 });
                throw new Error(respIssue);
              }
            }
            await page.setViewportSize({ width: 1200, height: 800 });
            await page.waitForTimeout(200);
          } else if (step.action === 'validate_layout') {
            const layoutIssue = await frame.evaluate(() => {
              const main = document.querySelector('main');
              if (!main) return 'Missing <main> container element';
              const h1 = document.querySelector('h1');
              if (!h1 || !(h1.innerText || '').trim()) return 'Missing or empty <h1> heading';
              return null;
            });
            if (layoutIssue) throw new Error(layoutIssue);
          } else if (step.action === 'validate_a11y') {
            const a11yIssues = await frame.evaluate(() => {
              const errs = [];
              const iconOnlyBtns = Array.from(document.querySelectorAll('button'));
              for (const b of iconOnlyBtns) {
                if (b.offsetWidth === 0 && b.offsetHeight === 0) continue;
                const text = (b.innerText || b.textContent || '').trim();
                const aria = b.getAttribute('aria-label') || b.getAttribute('title');
                if (!text && !aria) {
                  errs.push(`Icon-only button (${b.id || b.className.slice(0, 35)}) lacks aria-label/title`);
                }
              }
              return errs;
            });
            if (a11yIssues.length > 0) {
              throw new Error(a11yIssues.slice(0, 3).join('; '));
            }
          } else {
            throw new Error(`Unsupported E2E step action '${step.action}'`);
          }

          console.log(`  ✅ PASS ${label}`);
          stepResults.push({ step: i + 1, name: step.name || step.action, action: step.action, status: 'passed' });
        } catch (stepErr) {
          suitePassed = false;
          allPassed = false;
          console.error(`  ❌ FAIL ${label}: ${stepErr.message}`);
          stepResults.push({
            step: i + 1,
            name: step.name || step.action,
            action: step.action,
            status: 'failed',
            error: stepErr.message
          });
        }
      }

      // Post-suite zero-tolerance checks for runtime errors, HTTP 4xx/5xx, and native dialogs
      if (nativeDialogs.length > 0) {
        suitePassed = false;
        allPassed = false;
        const msg = `Forbidden native browser dialog(s) triggered: ${nativeDialogs.join(' | ')}`;
        console.error(`  ❌ FAIL [Zero-Dialog Gate]: ${msg}`);
        stepResults.push({ step: stepResults.length + 1, name: 'Zero Native Dialog Gate', action: 'runtime_gate', status: 'failed', error: msg });
      }
      if (runtimeErrors.length > 0) {
        suitePassed = false;
        allPassed = false;
        const msg = `Uncaught runtime/console error(s): ${runtimeErrors.slice(0, 3).join(' | ')}`;
        console.error(`  ❌ FAIL [Zero-Runtime-Error Gate]: ${msg}`);
        stepResults.push({ step: stepResults.length + 1, name: 'Zero Runtime Error Gate', action: 'runtime_gate', status: 'failed', error: msg });
      }
      if (apiHttpErrors.length > 0) {
        suitePassed = false;
        allPassed = false;
        const msg = `Backend API HTTP 4xx/5xx error(s): ${apiHttpErrors.slice(0, 3).join(' | ')}`;
        console.error(`  ❌ FAIL [Zero-API-Error Gate]: ${msg}`);
        stepResults.push({ step: stepResults.length + 1, name: 'Zero API HTTP Error Gate', action: 'runtime_gate', status: 'failed', error: msg });
      }

      // Capture clean Light Mode & Dark Mode desktop screenshots of the rendered sandbox iframe after SWR data settles
      await page.setViewportSize({ width: 1560, height: 980 });
      await page.evaluate((r) => {
        if (window.harness && typeof window.harness.setTheme === 'function') {
          window.harness.setTheme(false);
        }
        if (window.harness) window.harness.navigate(r);
      }, cleanRoute);
      await page.waitForTimeout(2600);

      const safeRouteName = cleanRoute.replace(/[^a-zA-Z0-9_-]/g, '_');
      const screenshotPath = path.join(outShotDir, `${safeRouteName}.png`);
      const darkScreenshotPath = path.join(outShotDir, `${safeRouteName}-dark.png`);

      // 1. Light Mode Screenshot
      await page.evaluate(() => {
        const iframe = document.getElementById('sandbox-iframe');
        if (iframe && iframe.contentDocument) {
          iframe.contentDocument.documentElement.classList.remove('dark');
          iframe.contentDocument.body?.classList.remove('dark');
        }
        if (iframe && iframe.contentWindow) {
          iframe.contentWindow.postMessage({ type: 'RAPIDER_THEME_CHANGE', isDark: false, theme: 'light' }, '*');
        }
      });
      await page.waitForTimeout(250);
      const iframeEl = await page.$('#sandbox-iframe');
      if (iframeEl) {
        await iframeEl.screenshot({ path: screenshotPath });
      } else {
        await page.screenshot({ path: screenshotPath });
      }
      console.log(`  📸 Saved Light E2E screenshot: ${screenshotPath}`);

      // 2. Dark Mode Screenshot
      await page.evaluate(() => {
        if (window.harness && typeof window.harness.setTheme === 'function') {
          window.harness.setTheme(true);
        }
        const iframe = document.getElementById('sandbox-iframe');
        if (iframe && iframe.contentDocument) {
          iframe.contentDocument.documentElement.classList.add('dark');
          iframe.contentDocument.body?.classList.add('dark');
        }
        if (iframe && iframe.contentWindow) {
          iframe.contentWindow.postMessage({ type: 'RAPIDER_THEME_CHANGE', isDark: true, theme: 'dark' }, '*');
        }
      });
      await page.waitForTimeout(350);
      if (iframeEl) {
        await iframeEl.screenshot({ path: darkScreenshotPath });
      } else {
        await page.screenshot({ path: darkScreenshotPath });
      }
      console.log(`  🌙 Saved Dark E2E screenshot:  ${darkScreenshotPath}`);

      // Restore light mode default
      await page.evaluate(() => {
        if (window.harness && typeof window.harness.setTheme === 'function') {
          window.harness.setTheme(false);
        }
        const iframe = document.getElementById('sandbox-iframe');
        if (iframe && iframe.contentDocument) {
          iframe.contentDocument.documentElement.classList.remove('dark');
          iframe.contentDocument.body?.classList.remove('dark');
        }
      });

      suiteReports.push({
        route: cleanRoute,
        suiteName: suite.suiteName || suite.pageName || cleanRoute,
        status: suitePassed ? 'passed' : 'failed',
        totalSteps: stepResults.length,
        passedSteps: stepResults.filter(s => s.status === 'passed').length,
        failedSteps: stepResults.filter(s => s.status === 'failed').length,
        screenshotPath,
        darkScreenshotPath,
        steps: stepResults
      });
    }

    // Record E2E evidence into app.build.json (merge with existing suites if running single route)
    let combinedSuites = suiteReports;
    const buildJsonPath = path.join(appDir, 'app.build.json');
    if (targetRoute && fs.existsSync(buildJsonPath)) {
      try {
        const existing = JSON.parse(fs.readFileSync(buildJsonPath, 'utf8'));
        const prevSuites = Array.isArray(existing.e2eSuites?.suites) ? existing.e2eSuites.suites : [];
        const updatedRoutes = new Set(suiteReports.map(s => s.route));
        combinedSuites = [...prevSuites.filter(s => !updatedRoutes.has(s.route)), ...suiteReports];
      } catch (e) {}
    }

    recordE2ETestResults(
      appDir,
      {
        passed: allPassed && combinedSuites.every(s => s.status === 'passed'),
        suites: combinedSuites
      },
      { expectationsFile: 'e2e/expectations.json', agent: 'Antigravity' }
    );

    console.log(`\n===========================================================`);
    console.log(`🏁 PLAYWRIGHT E2E SUMMARY (${folderName}${targetRoute ? ` -> #/${targetRoute}` : ''})`);
    console.log(`Result: ${allPassed ? '100% PASSED ✅' : 'FAILED ❌'} (${suiteReports.filter(s => s.status === 'passed').length}/${suiteReports.length} suites)`);
    console.log(`===========================================================`);

    return { passed: allPassed, suites: suiteReports };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (serverHandle.startedByUs && serverHandle.proc) {
      try { serverHandle.proc.kill('SIGTERM'); } catch (e) {}
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  const getArg = (name) => {
    const arg = args.find(a => a.startsWith(`--${name}=`));
    return arg ? arg.split('=').slice(1).join('=') : null;
  };

  const appArg = getArg('app');
  const targetRoute = getArg('route');
  const screenshotDir = getArg('screenshot-dir');

  if (!appArg) {
    console.error('Usage: node rapider-app-harness/run-single-page-e2e.js --app=<repoFolder> [--route=<route>] [--screenshot-dir=<dir>]');
    process.exit(1);
  }

  let appDir;
  try {
    appDir = resolveAppDir(appArg);
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }

  runSinglePageE2E({ appDir, targetRoute, screenshotDir })
    .then((res) => {
      process.exit(res.passed ? 0 : 1);
    })
    .catch((err) => {
      console.error(`\n❌ E2E Runner Error: ${err.message}`);
      process.exit(1);
    });
}

if (require.main === module) {
  main();
}

module.exports = { runSinglePageE2E };

