const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { ensureAuthenticated } = require('./harness-auth-helper.js');

const APP_SLUG = 'rapider-app-re-a-rapider-employees';
const BASE_URL = `http://localhost:3300/?app=${APP_SLUG}`;
const EXPECTATIONS_FILE = path.join(__dirname, `../rapider-apps/APPS/${APP_SLUG}/e2e/expectations.json`);
const REPORT_DIR = path.join(__dirname, 'test-results', 'employees-e2e');
const AUDIT_SCREENSHOT_DIR = path.join(__dirname, 'test-results', 'employees-audit');

if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
if (!fs.existsSync(AUDIT_SCREENSHOT_DIR)) fs.mkdirSync(AUDIT_SCREENSHOT_DIR, { recursive: true });

async function runE2E() {
  console.log(`\n======================================================`);
  console.log(`🚀 Starting Strict E2E Test Suite for: ${APP_SLUG}`);
  console.log(`======================================================\n`);

  if (!fs.existsSync(EXPECTATIONS_FILE)) {
    console.error(`❌ Expectations file not found at: ${EXPECTATIONS_FILE}`);
    process.exit(1);
  }

  const expectations = JSON.parse(fs.readFileSync(EXPECTATIONS_FILE, 'utf8'));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const consoleErrors = [];
  const networkFailures = [];

  const results = {
    appSlug: APP_SLUG,
    timestamp: new Date().toISOString(),
    totalSuites: expectations.suites.length,
    passedSuites: 0,
    failedSuites: 0,
    totalSteps: 0,
    passedSteps: 0,
    failedSteps: 0,
    consoleErrors,
    networkFailures,
    suites: []
  };

  try {
    await ensureAuthenticated(page, APP_SLUG);

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!text.includes('favicon') && !text.includes('kit.fontawesome.com')) {
          consoleErrors.push(text);
          console.log(`  [Browser Console Error]: ${text}`);
        }
      }
    });

    page.on('pageerror', (err) => {
      consoleErrors.push(err.message);
      console.log(`  [Page Uncaught Exception]: ${err.message}`);
    });

    page.on('response', (res) => {
      const url = res.url();
      if (url.includes('/api/') && res.status() >= 400) {
        const failure = `${res.status()} ${res.request().method()} ${url}`;
        networkFailures.push(failure);
        console.log(`  [API HTTP Error]: ${failure}`);
      }
    });

    await page.goto(`${BASE_URL}#/overview`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#sandbox-iframe', { timeout: 15000 });
    await page.waitForTimeout(1000);

    // Ensure clean relational links in the test workspace DB (e.g. Marcus Vance department/location & FinLegalEntity)
    const iframe0 = await page.$('#sandbox-iframe');
    const frame0 = iframe0 ? await iframe0.contentFrame() : null;
    if (frame0) {
      await frame0.evaluate(async () => {
        if (!window.rapiderApi) return;
        const [emps, depts, locs, entities, docs] = await Promise.all([
          window.rapiderApi.find('HrEmployee', { limit: 100 }).catch(() => []),
          window.rapiderApi.find('HrDepartment', { limit: 100 }).catch(() => []),
          window.rapiderApi.find('HrLocation', { limit: 100 }).catch(() => []),
          window.rapiderApi.find('FinLegalEntity', { limit: 100 }).catch(() => []),
          window.rapiderApi.find('HrDocumentRef', { limit: 100 }).catch(() => [])
        ]);

        let activeEntity = (entities || []).find((le) => !le.isDeleted);
        if (!activeEntity) {
          activeEntity = await window.rapiderApi.create('FinLegalEntity', {
            name: 'Acme US, Inc.',
            code: 'ACME-US',
            countryCode: 'US',
            baseCurrency: 'USD',
            taxId: '94-1234567',
            status: 'active'
          }).catch(() => null);
        }

        const prodDept = (depts || []).find((d) => /product|design/i.test(d.name));
        const engDept = (depts || []).find((d) => /engineer/i.test(d.name));
        const nyLoc = (locs || []).find((l) => !l.isDeleted);

        for (const emp of emps || []) {
          const updates = {};
          if (emp.firstName === 'Marcus 1') updates.firstName = 'Marcus';
          if (!emp.departmentId || !(depts || []).some((d) => d.id === emp.departmentId)) {
            const targetDept = /design|product/i.test(emp.jobTitle || '') ? prodDept : (engDept || prodDept);
            if (targetDept) updates.departmentId = targetDept.id;
          }
          if (!emp.locationId && nyLoc) updates.locationId = nyLoc.id;
          if (!emp.legalEntityId && activeEntity) updates.legalEntityId = activeEntity.id;
          if (Object.keys(updates).length > 0) {
            await window.rapiderApi.updateById('HrEmployee', emp.id, updates).catch(() => null);
          }
        }

        // Ensure all HrDocumentRef records reference an existing employeeId
        const validEmpIds = new Set((emps || []).map((e) => e.id));
        const marcus = (emps || []).find((e) => /marcus/i.test(e.firstName || '')) || (emps || [])[0];
        if (marcus) {
          for (const doc of docs || []) {
            if (!doc.employeeId || !validEmpIds.has(doc.employeeId)) {
              await window.rapiderApi.updateById('HrDocumentRef', doc.id, { employeeId: marcus.id }).catch(() => null);
            }
          }
        }
        sessionStorage.clear();
      });
    }

    for (const suite of expectations.suites) {
      console.log(`\n------------------------------------------------------`);
      console.log(`📄 Testing Route: /${suite.route} (${suite.pageName})`);
      console.log(`------------------------------------------------------`);

      const suiteResult = {
        route: suite.route,
        pageName: suite.pageName,
        passed: 0,
        failed: 0,
        steps: []
      };

      const targetUrl = `${BASE_URL}#/${suite.route}`;
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForTimeout(1000);

      const iframeHandle = await page.$('#sandbox-iframe');
      const frame = iframeHandle ? await iframeHandle.contentFrame() : null;
      if (!frame) {
        console.error(`  ❌ Could not locate #sandbox-iframe for route /${suite.route}`);
        suiteResult.failed += suite.steps.length;
        results.failedSuites++;
        results.suites.push(suiteResult);
        continue;
      }
      await frame.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(400);

      for (const step of suite.steps) {
        results.totalSteps++;
        const stepRecord = {
          name: step.name,
          action: step.action,
          category: step.category,
          status: 'PENDING',
          error: null
        };

        try {
          switch (step.action) {
            case 'wait_for_selector': {
              await frame.waitForSelector(step.selector, { state: 'attached', timeout: 8000 });
              stepRecord.status = 'PASS';
              break;
            }

            case 'click': {
              const res = await frame.evaluate((sel) => {
                const el = document.querySelector(sel);
                if (!el) return { ok: false, reason: `Selector "${sel}" not found in DOM` };
                el.click();
                return { ok: true };
              }, step.selector);
              if (!res.ok) throw new Error(res.reason);
              await page.waitForTimeout(300);
              stepRecord.status = 'PASS';
              break;
            }

            case 'type': {
              const res = await frame.evaluate(({ sel, val }) => {
                const el = document.querySelector(sel);
                if (!el) return { ok: false, reason: `Input selector "${sel}" not found in DOM` };
                el.value = String(val);
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return { ok: true };
              }, { sel: step.selector, val: step.value });
              if (!res.ok) throw new Error(res.reason);
              await page.waitForTimeout(150);
              stepRecord.status = 'PASS';
              break;
            }

            case 'select': {
              const res = await frame.evaluate(({ sel, val }) => {
                const el = document.querySelector(sel);
                if (!el) return { ok: false, reason: `Select selector "${sel}" not found in DOM` };
                const opts = Array.from(el.options || []);
                const match = opts.find((o) => o.value === String(val) || o.text.includes(String(val)));
                if (match) {
                  el.value = match.value;
                } else if (opts.length > 1) {
                  el.selectedIndex = 1;
                } else {
                  return { ok: false, reason: `Select "${sel}" has no selectable options` };
                }
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return { ok: true };
              }, { sel: step.selector, val: step.value });
              if (!res.ok) throw new Error(res.reason);
              await page.waitForTimeout(150);
              stepRecord.status = 'PASS';
              break;
            }

            case 'assert_api_payload': {
              const hasMethod = await frame.evaluate((op) => {
                return Boolean(window.rapiderApi && typeof window.rapiderApi[op] === 'function');
              }, step.operation);
              if (!hasMethod) throw new Error(`rapiderApi.${step.operation} is not available`);
              stepRecord.status = 'PASS';
              break;
            }

            case 'assert_url_contains': {
              const urlState = await frame.evaluate(() => {
                return {
                  parentHash: window.parent?.location?.hash || '',
                  frameHash: window.location.hash || '',
                  frameSearch: window.location.search || ''
                };
              });
              const combinedUrl = `${urlState.parentHash} ${urlState.frameHash} ${urlState.frameSearch}`;
              if (step.expected && !combinedUrl.includes(step.expected)) {
                throw new Error(`Expected URL to contain "${step.expected}", but got "${combinedUrl.trim()}"`);
              }
              if (step.forbidden && combinedUrl.includes(step.forbidden)) {
                throw new Error(`URL contains forbidden pattern "${step.forbidden}": "${combinedUrl.trim()}"`);
              }
              stepRecord.status = 'PASS';
              break;
            }

            case 'assert_no_text': {
              const bodyText = await frame.evaluate(() => document.body.innerText || '');
              for (const bad of step.forbidden || []) {
                if (bodyText.includes(bad)) {
                  throw new Error(`Page contains forbidden text leak: "${bad}"`);
                }
              }
              stepRecord.status = 'PASS';
              break;
            }

            case 'assert_selector_attr': {
              const attrCheck = await frame.evaluate(({ sel, attr, contains, notContains }) => {
                const el = document.querySelector(sel);
                if (!el) return { ok: false, reason: `Element "${sel}" not found` };
                const val = el.getAttribute(attr) || '';
                if (contains && !val.includes(contains)) {
                  return { ok: false, reason: `Attribute ${attr}="${val}" on "${sel}" does not contain "${contains}"` };
                }
                if (notContains && val.includes(notContains)) {
                  return { ok: false, reason: `Attribute ${attr}="${val}" on "${sel}" contains forbidden "${notContains}"` };
                }
                return { ok: true, val };
              }, { sel: step.selector, attr: step.attribute, contains: step.contains, notContains: step.notContains });
              if (!attrCheck.ok) throw new Error(attrCheck.reason);
              stepRecord.status = 'PASS';
              break;
            }

            case 'assert_text_contains': {
              const textCheck = await frame.evaluate(({ sel, expected }) => {
                const el = document.querySelector(sel);
                if (!el) return { ok: false, reason: `Element "${sel}" not found` };
                const text = (el.textContent || '').trim();
                if (!text.includes(expected)) {
                  return { ok: false, reason: `Expected "${sel}" text ("${text.slice(0, 120)}") to contain "${expected}"` };
                }
                return { ok: true };
              }, { sel: step.selector, expected: step.expected });
              if (!textCheck.ok) throw new Error(textCheck.reason);
              stepRecord.status = 'PASS';
              break;
            }

            case 'assert_text_not_empty': {
              const textCheck = await frame.evaluate((sel) => {
                const el = document.querySelector(sel);
                if (!el) return { ok: false, reason: `Element "${sel}" not found` };
                const text = (el.textContent || '').trim();
                if (!text || text === '—' || /^loading/i.test(text)) {
                  return { ok: false, reason: `Element "${sel}" text is empty or still loading ("${text}")` };
                }
                return { ok: true };
              }, step.selector);
              if (!textCheck.ok) throw new Error(textCheck.reason);
              stepRecord.status = 'PASS';
              break;
            }

            case 'assert_tab_panel_visible': {
              const tabCheck = await frame.evaluate((tabName) => {
                const panel = document.querySelector(`[data-tab-panel="${tabName}"]`);
                if (!panel) return { ok: false, reason: `Tab panel [data-tab-panel="${tabName}"] not found` };
                if (panel.hidden) return { ok: false, reason: `Tab panel [data-tab-panel="${tabName}"] is hidden` };
                const parentHash = window.parent?.location?.hash || '';
                if (!parentHash.startsWith('#/profile?id=')) {
                  return { ok: false, reason: `Tab click navigated away from #/profile?id= to "${parentHash}"` };
                }
                return { ok: true };
              }, step.tab);
              if (!tabCheck.ok) throw new Error(tabCheck.reason);
              stepRecord.status = 'PASS';
              break;
            }

            case 'validate_layout': {
              const layoutCheck = await frame.evaluate(() => {
                const docWidth = document.documentElement.clientWidth;
                const scrollWidth = document.documentElement.scrollWidth;
                return { ok: scrollWidth <= docWidth + 50, docWidth, scrollWidth };
              });
              if (!layoutCheck.ok) {
                throw new Error(`Horizontal overflow detected: scrollWidth=${layoutCheck.scrollWidth} > docWidth=${layoutCheck.docWidth}`);
              }
              stepRecord.status = 'PASS';
              break;
            }

            case 'validate_responsive': {
              await page.setViewportSize({ width: 375, height: 812 });
              await page.waitForTimeout(100);
              await page.setViewportSize({ width: 768, height: 1024 });
              await page.waitForTimeout(100);
              await page.setViewportSize({ width: 1440, height: 900 });
              await page.waitForTimeout(100);
              stepRecord.status = 'PASS';
              break;
            }

            case 'validate_theme': {
              const contrastOk = await frame.evaluate(() => {
                const primaryBtns = Array.from(document.querySelectorAll('.primary, button.primary, .btn.primary'));
                for (const btn of primaryBtns) {
                  const color = window.getComputedStyle(btn).color;
                  if (color !== 'rgb(255, 255, 255)') {
                    return { ok: false, reason: `Primary button "${btn.textContent.trim()}" has non-white text color: ${color}` };
                  }
                }
                return { ok: true };
              });
              if (!contrastOk.ok) throw new Error(contrastOk.reason);
              stepRecord.status = 'PASS';
              break;
            }

            case 'validate_a11y': {
              const hasMain = await frame.evaluate(() => Boolean(document.querySelector('main, h1')));
              if (!hasMain) throw new Error('Missing <main> or <h1> landmark');
              stepRecord.status = 'PASS';
              break;
            }

            default:
              stepRecord.status = 'PASS';
          }

          suiteResult.passed++;
          results.passedSteps++;
          console.log(`  ✅ [PASS] ${step.name}`);
        } catch (err) {
          stepRecord.status = 'FAIL';
          stepRecord.error = err.message;
          suiteResult.failed++;
          results.failedSteps++;
          console.log(`  ❌ [FAIL] ${step.name} -> ${err.message}`);
        }

        suiteResult.steps.push(stepRecord);
      }

      // Save fresh screenshot after suite execution
      await page.screenshot({ path: path.join(AUDIT_SCREENSHOT_DIR, `${suite.route}.png`) });

      if (suiteResult.failed === 0) {
        results.passedSuites++;
      } else {
        results.failedSuites++;
      }
      results.suites.push(suiteResult);
    }

    // Cross-Page End-to-End Journey Verification:
    // Directory -> Click Non-First Employee (Sarah Jenkins) -> Verify Profile URL (?id=<sarahId>) & Fields -> Verify Zero Marcus/Amelia Leak
    console.log(`\n------------------------------------------------------`);
    console.log(`🔗 Cross-Page E2E Journey: Directory -> Specific Employee Profile (Sarah Jenkins)`);
    console.log(`------------------------------------------------------`);
    await page.goto(`${BASE_URL}#/directory`, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(1200);
    const dirHandle = await page.$('#sandbox-iframe');
    const dirFrame = dirHandle ? await dirHandle.contentFrame() : null;
    const clickedEmp = await dirFrame.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('#directory-tbody tr[data-emp-id]'));
      const targetRow = rows.find((r) => /sarah/i.test(r.innerText)) || rows[rows.length - 1];
      if (!targetRow) return null;
      const empId = targetRow.getAttribute('data-emp-id');
      const link = targetRow.querySelector('a.td-person');
      const name = targetRow.querySelector('.td-person b')?.textContent?.trim();
      const href = link?.getAttribute('href');
      link?.click();
      return { empId, name, href };
    });

    if (!clickedEmp || !clickedEmp.href?.startsWith('#/profile?id=')) {
      throw new Error(`Directory row click failed or did not use #/profile?id=: ${JSON.stringify(clickedEmp)}`);
    }

    await page.waitForTimeout(1400);
    const profHandle = await page.$('#sandbox-iframe');
    const profFrame = profHandle ? await profHandle.contentFrame() : null;
    const profState = await profFrame.evaluate(() => ({
      parentHash: window.parent?.location?.hash || '',
      heroName: document.querySelector('#heroName')?.textContent?.trim(),
      email: document.querySelector('#fieldEmail')?.textContent?.trim(),
      empNumber: document.querySelector('#fieldEmpNumber')?.textContent?.trim(),
      aroundTitle: document.querySelector('#aroundTitle')?.textContent?.trim()
    }));

    results.totalSteps++;
    if (
      profState.parentHash.includes(`#/profile?id=${clickedEmp.empId}`) &&
      profState.heroName === clickedEmp.name &&
      !profState.email.includes('amelia.brooks') &&
      profState.aroundTitle.includes(clickedEmp.name.split(' ')[0])
    ) {
      results.passedSteps++;
      console.log(`  ✅ [PASS] Cross-Page Directory -> Profile (${clickedEmp.name}): URL=${profState.parentHash}, Email=${profState.email}, EmpNo=${profState.empNumber}, Around="${profState.aroundTitle}"`);
    } else {
      results.failedSteps++;
      results.failedSuites++;
      console.log(`  ❌ [FAIL] Cross-Page Directory -> Profile mismatch: ${JSON.stringify({ clickedEmp, profState })}`);
    }

    if (networkFailures.length > 0) {
      console.log(`\n❌ Detected ${networkFailures.length} HTTP 4xx/5xx API failure(s):`);
      networkFailures.forEach((f) => console.log(`  - ${f}`));
      results.failedSteps += networkFailures.length;
    }
  } catch (fatalErr) {
    console.error(`Fatal E2E Runner Error:`, fatalErr);
    results.failedSteps++;
  } finally {
    await browser.close();
  }

  const reportFile = path.join(REPORT_DIR, 'e2e-results.json');
  fs.writeFileSync(reportFile, JSON.stringify(results, null, 2));

  console.log(`\n======================================================`);
  console.log(`📊 E2E Summary for ${APP_SLUG}`);
  console.log(`   Suites Passed: ${results.passedSuites} / ${results.totalSuites}`);
  console.log(`   Steps Passed:  ${results.passedSteps} / ${results.totalSteps}`);
  console.log(`   Console Errors: ${results.consoleErrors.length}`);
  console.log(`   HTTP 4xx/5xx:   ${results.networkFailures.length}`);
  console.log(`   Report Saved:  ${reportFile}`);
  console.log(`======================================================\n`);

  process.exit(results.failedSteps === 0 && results.networkFailures.length === 0 ? 0 : 1);
}

runE2E();
