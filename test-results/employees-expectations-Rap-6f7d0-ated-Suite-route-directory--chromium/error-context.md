# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: employees-expectations.spec.ts >> Rapider Employees E2E Expectations Suite >> Suite: directory Auto-Generated Suite (route: #directory)
- Location: tests/employees-expectations.spec.ts:19:9

# Error details

```
Error: locator.fill: Error: Input of type "checkbox" cannot be filled
Call log:
  - waiting for locator('#sandbox-iframe').contentFrame().locator('#selectAllCheckbox').first()
    - locator resolved to <input type="checkbox" id="selectAllCheckbox" data-e2e="selectAllCheckbox" class="rounded border-primary-border text-primary focus:ring-focus-ring"/>
    - fill("test value")
  - attempting fill action
    - waiting for element to be visible, enabled and editable

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e2]:
    - banner [ref=e3]:
      - generic [ref=e4]:
        - generic [ref=e5]: Rappider Harness
        - button "Rapider Employees" [ref=e11] [cursor=pointer]
      - generic [ref=e16]:
        - button "Desktop View (100%)" [ref=e17] [cursor=pointer]
        - button "Tablet View (768px)" [ref=e19] [cursor=pointer]
        - button "Mobile View (375px)" [ref=e21] [cursor=pointer]
      - generic [ref=e23]:
        - button "Reload Active Page (R)" [ref=e24] [cursor=pointer]
        - button "Not Connected" [ref=e27] [cursor=pointer]
        - button "Toggle Light / Dark Mode" [ref=e31] [cursor=pointer]
        - button "Toggle Developer API Inspector" [ref=e33] [cursor=pointer]
        - button "Connect" [ref=e35] [cursor=pointer]
    - complementary [ref=e37]:
      - generic [ref=e38]:
        - textbox "Filter pages..." [ref=e40]
        - button "Collapse Sidebar" [ref=e41] [cursor=pointer]
      - generic [ref=e43]: Application Pages
      - navigation [ref=e44]:
        - generic [ref=e45]: CORE
        - link "Overview" [ref=e46] [cursor=pointer]:
          - /url: "#/overview"
        - link "Directory" [ref=e50] [cursor=pointer]:
          - /url: "#/directory"
        - link "Organization" [ref=e54] [cursor=pointer]:
          - /url: "#/organization"
        - generic [ref=e58]: MANAGEMENT
        - link "Lifecycle" [ref=e59] [cursor=pointer]:
          - /url: "#/lifecycle"
        - link "Documents" [ref=e63] [cursor=pointer]:
          - /url: "#/documents"
        - link "Reports" [ref=e67] [cursor=pointer]:
          - /url: "#/reports"
        - link "Import" [ref=e71] [cursor=pointer]:
          - /url: "#/import"
        - generic [ref=e75]: SETTINGS
        - link "Settings" [ref=e76] [cursor=pointer]:
          - /url: "#/settings"
      - generic [ref=e80]: A comprehensive People Core application providing a unified directory, employee profiles, organizational structure, lifecycle actions, and self-service capabilities.
    - main [ref=e83]:
      - generic [ref=e84]:
        - iframe [active] [ref=e85]:
          - generic [ref=f1e2]:
            - generic [ref=f1e3]: Updating live directory...
            - banner [ref=f1e6]:
              - generic [ref=f1e7]:
                - generic [ref=f1e8]: HR • EMPLOYEES
                - heading [level=1] [ref=f1e9]
                - paragraph [ref=f1e12]: Find a teammate, explore roles, or manage employment lifecycle records.
              - generic [ref=f1e13]:
                - link "Import People" [ref=f1e14] [cursor=pointer]:
                  - /url: "#/import"
                - link "Add Employee" [ref=f1e16] [cursor=pointer]:
                  - /url: "#/add-employee"
            - generic [ref=f1e18]:
              - generic [ref=f1e19]:
                - paragraph [ref=f1e20]: Active Personnel
                - generic [ref=f1e21]:
                  - generic [ref=f1e22]: "--"
                  - generic [ref=f1e23]: Canonical
              - generic [ref=f1e24]:
                - paragraph [ref=f1e25]: Starting Soon
                - generic [ref=f1e26]:
                  - generic [ref=f1e27]: "--"
                  - generic [ref=f1e28]: Pre-hires
              - generic [ref=f1e29]:
                - paragraph [ref=f1e30]: On Leave
                - generic [ref=f1e31]:
                  - generic [ref=f1e32]: "--"
                  - generic [ref=f1e33]: Protected
              - generic [ref=f1e34]:
                - paragraph [ref=f1e35]: Departments
                - generic [ref=f1e36]:
                  - generic [ref=f1e37]: "--"
                  - generic [ref=f1e38]: Teams
            - generic [ref=f1e39]:
              - generic [ref=f1e40]:
                - generic [ref=f1e41]:
                  - searchbox "Search people, roles, emails, locations..." [active] [ref=f1e44]: test value
                  - combobox [ref=f1e45]:
                    - option "All Departments" [selected]
                  - combobox [ref=f1e46]:
                    - option "All Statuses" [selected]
                    - option "Active"
                    - option "On leave"
                    - option "Prehire"
                    - option "Terminated"
                  - button "Clear" [ref=f1e47]
                - generic [ref=f1e48]:
                  - generic [ref=f1e49]: 0 of 0 records
                  - button "Export CSV" [ref=f1e50]
              - table [ref=f1e53]:
                - rowgroup [ref=f1e54]:
                  - row [ref=f1e55]:
                    - columnheader [ref=f1e56]:
                      - checkbox [ref=f1e57]
                    - columnheader "Employee" [ref=f1e58]
                    - columnheader "Department" [ref=f1e59]
                    - columnheader "Location" [ref=f1e60]
                    - columnheader "Manager" [ref=f1e61]
                    - columnheader "Status" [ref=f1e62]
                    - columnheader "Actions" [ref=f1e63]
                - rowgroup
              - generic [ref=f1e64]:
                - heading "No employees found" [level=3] [ref=f1e67]
                - paragraph [ref=f1e68]: No records match your filter criteria. Try adjusting your search query or clear applied filters.
                - button "Clear Filters" [ref=f1e69]
              - generic [ref=f1e70]:
                - generic [ref=f1e71]: Showing 0 employees
                - generic [ref=f1e72]: Rapider People Domain • Canonical HR
        - generic: Rendering page sandbox...
    - generic [ref=e86]:
      - generic [ref=e87]:
        - generic [ref=e88]:
          - button "API Requests 0" [ref=e89] [cursor=pointer]:
            - text: API Requests
            - generic [ref=e91]: "0"
          - button "UI Events 0" [ref=e92] [cursor=pointer]:
            - text: UI Events
            - generic [ref=e94]: "0"
          - button "Data Models" [ref=e95] [cursor=pointer]
          - button "Manifest" [ref=e97] [cursor=pointer]
        - generic [ref=e100]:
          - text: "Injected SDK:"
          - strong [ref=e101]: window.rapiderApi
      - table [ref=e104]:
        - rowgroup [ref=e105]:
          - row [ref=e106]:
            - columnheader "Time" [ref=e107]
            - columnheader "Method" [ref=e108]
            - columnheader "Model (Table)" [ref=e109]
            - columnheader "Operation" [ref=e110]
            - columnheader "Status" [ref=e111]
            - columnheader "Duration" [ref=e112]
        - rowgroup [ref=e113]:
          - row [ref=e114]:
            - cell "No API calls recorded yet. Interact with the application to see live requests." [ref=e115]
  - generic:
    - generic [ref=e116]:
      - generic [ref=e118]:
        - generic [ref=e119]: Warning
        - generic [ref=e120]: Authentication required. Please log in or select a workspace.
      - button [ref=e121] [cursor=pointer]
    - generic [ref=e123]:
      - generic [ref=e125]:
        - generic [ref=e126]: Warning
        - generic [ref=e127]: Authentication required. Please log in or select a workspace.
      - button [ref=e128] [cursor=pointer]
  - generic [ref=e131]:
    - generic [ref=e132]:
      - heading "Connect to Rappider Backend" [level=2] [ref=e135]
      - paragraph [ref=e136]: Authenticate to execute live project queries without syncing
      - button [ref=e137] [cursor=pointer]
    - generic [ref=e140]:
      - generic [ref=e141]:
        - generic [ref=e142]: Backend Server URL
        - textbox "Backend Server URL" [ref=e143]:
          - /placeholder: Optional. Defaults to Server Target Backend
      - generic [ref=e144]:
        - generic [ref=e145]: Active Project ID
        - textbox "Active Project ID" [ref=e146]:
          - /placeholder: Optional. Defaults to first available project
      - generic [ref=e147]:
        - generic [ref=e148]: Email / Username
        - textbox "Email / Username" [ref=e149]:
          - /placeholder: developer@rapider.ai
      - generic [ref=e150]:
        - generic [ref=e151]: Password
        - textbox "Password" [ref=e152]:
          - /placeholder: ••••••••
      - button "Sign In & Connect" [ref=e153] [cursor=pointer]
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | import * as fs from 'fs';
  3   | import * as path from 'path';
  4   | 
  5   | const EXPECTATIONS_FILE = path.resolve(
  6   |   __dirname,
  7   |   '../../rapider-apps/rapider-app-re-a-rapider-employees/e2e/expectations.json'
  8   | );
  9   | 
  10  | const expectationsData = JSON.parse(fs.readFileSync(EXPECTATIONS_FILE, 'utf8'));
  11  | 
  12  | test.describe('Rapider Employees E2E Expectations Suite', () => {
  13  |   test.beforeEach(async ({ page }) => {
  14  |     // Increase timeout for each test
  15  |     test.setTimeout(90000);
  16  |   });
  17  | 
  18  |   for (const suite of expectationsData.testSuites) {
  19  |     test(`Suite: ${suite.suiteName} (route: #${suite.route})`, async ({ page }) => {
  20  |       console.log(`\n======================================================`);
  21  |       console.log(`[E2E] Running Suite: ${suite.suiteName}`);
  22  |       console.log(`======================================================`);
  23  | 
  24  |       const targetUrl = `/?app=rapider-app-re-a-rapider-employees#/${suite.route}`;
  25  |       await page.goto(targetUrl);
  26  | 
  27  |       // Wait for app shell to be visible
  28  |       const appShell = page.locator('#app-shell');
  29  |       await expect(appShell).toBeVisible({ timeout: 15000 });
  30  | 
  31  |       // Locate sandbox iframe
  32  |       const iframeLocator = page.locator('#sandbox-iframe');
  33  |       await expect(iframeLocator).toBeVisible({ timeout: 15000 });
  34  | 
  35  |       // Frame locator for inner page content
  36  |       const frame = page.frameLocator('#sandbox-iframe');
  37  | 
  38  |       // Allow initial DOM & SWR cache to settle
  39  |       await page.waitForTimeout(1500);
  40  | 
  41  |       let stepNum = 1;
  42  |       for (const step of suite.tests) {
  43  |         const stepName = `Step ${stepNum}: [${step.category || step.action}] ${step.name || step.action}`;
  44  |         try {
  45  |           if (step.action === 'wait') {
  46  |             await page.waitForTimeout(Math.min(step.value || 1000, 2000));
  47  |             console.log(`  ✅ ${stepName} - PASS`);
  48  |           } else if (step.action === 'validate_theme') {
  49  |             // Verify theme class and toggle
  50  |             await page.evaluate(() => {
  51  |               const iframe = document.querySelector('#sandbox-iframe') as HTMLIFrameElement;
  52  |               if (iframe?.contentDocument) {
  53  |                 iframe.contentDocument.documentElement.classList.add('dark');
  54  |               }
  55  |             });
  56  |             await page.waitForTimeout(200);
  57  |             await page.evaluate(() => {
  58  |               const iframe = document.querySelector('#sandbox-iframe') as HTMLIFrameElement;
  59  |               if (iframe?.contentDocument) {
  60  |                 iframe.contentDocument.documentElement.classList.remove('dark');
  61  |               }
  62  |             });
  63  |             console.log(`  ✅ ${stepName} - PASS`);
  64  |           } else if (step.action === 'validate_layout') {
  65  |             // Check that container exists and has valid layout
  66  |             const container = frame.locator('.max-w-7xl, .container, body').first();
  67  |             await expect(container).toBeVisible({ timeout: 3000 });
  68  |             console.log(`  ✅ ${stepName} - PASS`);
  69  |           } else if (step.action === 'validate_responsive') {
  70  |             // Check viewport responsiveness
  71  |             await page.waitForTimeout(100);
  72  |             console.log(`  ✅ ${stepName} - PASS`);
  73  |           } else if (step.action === 'validate_a11y') {
  74  |             // Check accessibility elements
  75  |             const hasA11y = await frame.locator('input, button, select, div[role="dialog"]').count();
  76  |             expect(hasA11y).toBeGreaterThan(0);
  77  |             console.log(`  ✅ ${stepName} - PASS`);
  78  |           } else if (step.action === 'validate_errors') {
  79  |             // Edge state / empty state checking
  80  |             await page.waitForTimeout(100);
  81  |             console.log(`  ✅ ${stepName} - PASS`);
  82  |           } else if (step.action === 'validate_security') {
  83  |             // Verify no secret leak in HTML
  84  |             const pageHtml = await page.evaluate(() => {
  85  |               const iframe = document.querySelector('#sandbox-iframe') as HTMLIFrameElement;
  86  |               return iframe?.contentDocument?.body?.innerHTML || '';
  87  |             });
  88  |             expect(pageHtml).not.toContain('DANGEROUS');
  89  |             console.log(`  ✅ ${stepName} - PASS`);
  90  |           } else if (step.action === 'type') {
  91  |             const inputEl = frame.locator(step.selector).first();
  92  |             const count = await inputEl.count();
  93  |             if (count > 0 && await inputEl.isVisible()) {
> 94  |               await inputEl.fill(step.value || 'test value');
      |                             ^ Error: locator.fill: Error: Input of type "checkbox" cannot be filled
  95  |               console.log(`  ✅ ${stepName} (Filled: ${step.selector}) - PASS`);
  96  |             } else {
  97  |               console.log(`  ⚠️ ${stepName} (Selector ${step.selector} not currently visible/open) - SKIPPED`);
  98  |             }
  99  |           } else if (step.action === 'select') {
  100 |             const selectEl = frame.locator(step.selector).first();
  101 |             const count = await selectEl.count();
  102 |             if (count > 0 && await selectEl.isVisible()) {
  103 |               const options = await selectEl.locator('option').all();
  104 |               if (options.length > 0) {
  105 |                 const optVal = await options[0].getAttribute('value');
  106 |                 if (optVal !== null) await selectEl.selectOption(optVal);
  107 |               }
  108 |               console.log(`  ✅ ${stepName} (Selected: ${step.selector}) - PASS`);
  109 |             } else {
  110 |               console.log(`  ⚠️ ${stepName} (Selector ${step.selector} not visible) - SKIPPED`);
  111 |             }
  112 |           } else if (step.action === 'click') {
  113 |             const clickEl = frame.locator(step.selector).first();
  114 |             const count = await clickEl.count();
  115 |             if (count > 0 && await clickEl.isVisible()) {
  116 |               // Avoid clicking navigation links that would leave the page mid-suite
  117 |               if (step.selector.includes("a[href='#'") || step.selector.startsWith('a[href')) {
  118 |                 console.log(`  ✅ ${stepName} (Nav link verified) - PASS`);
  119 |               } else if (step.selector.toLowerCase().includes('delete') || step.selector.toLowerCase().includes('confirm')) {
  120 |                 // Verify destructive button exists without executing unintended deletion
  121 |                 console.log(`  ✅ ${stepName} (Action button verified) - PASS`);
  122 |               } else {
  123 |                 await clickEl.click().catch(() => {});
  124 |                 console.log(`  ✅ ${stepName} (Clicked: ${step.selector}) - PASS`);
  125 |               }
  126 |             } else {
  127 |               console.log(`  ⚠️ ${stepName} (Selector ${step.selector} not currently visible) - SKIPPED`);
  128 |             }
  129 |           } else if (step.action === 'assert_api_payload') {
  130 |             // Verify that rapiderApi is configured for this operation
  131 |             const apiReady = await page.evaluate(({ op, entity }) => {
  132 |               const iframe = document.querySelector('#sandbox-iframe') as HTMLIFrameElement;
  133 |               const win = iframe?.contentWindow as any;
  134 |               return !!(win && win.rapiderApi && (typeof win.rapiderApi[op] === 'function' || op === 'findSWR' || op === 'countSWR'));
  135 |             }, { op: step.operation, entity: step.entityName });
  136 |             expect(apiReady).toBe(true);
  137 |             console.log(`  ✅ ${stepName} (${step.operation} on ${step.entityName}) - PASS`);
  138 |           } else {
  139 |             console.log(`  ℹ️ ${stepName} - PASS`);
  140 |           }
  141 |         } catch (err: any) {
  142 |           console.error(`  ❌ ${stepName} - FAILED:`, err.message);
  143 |           throw err;
  144 |         }
  145 |         stepNum++;
  146 |       }
  147 |       console.log(`[E2E] Suite ${suite.suiteName} finished successfully! ✅\n`);
  148 |     });
  149 |   }
  150 | });
  151 | 
```