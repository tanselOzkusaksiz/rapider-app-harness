/**
 * deterministic-page-auditor.js
 * 
 * High-precision deterministic static & structural analyzer for Rapider microapplication HTML pages.
 * Audits pages against Rapider UI page rules and the 20 QA Passes WITHOUT requiring non-deterministic LLM analysis.
 * 
 * Verifies:
 *   1. Dead buttons (buttons without event listeners, onclick, data-action, or form submit)
 *   2. Broken navigation links (href="#", empty hrefs, missing target HTML files or routes)
 *   3. Non-CRUD workflow buttons without handlers or workflow bindings
 *   4. Native alert(), confirm(), prompt() violations
 *   5. Button contrast enforcement (#ffffff !important on primary buttons)
 *   6. SDK entity model matching against app.manifest.json
 *   7. SWR caching method usage (findSWR/countSWR)
 *   8. Modal and drawer wiring
 *   9. Search inputs without filtering handlers
 *  10. Manifest alignment (every webPage exists on disk and vice versa)
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const NON_CRUD_ACTION_VERBS = [
  'submit', 'approve', 'reject', 'process', 'recalculate', 'calculate',
  'generate', 'export', 'import', 'sync', 'assign', 'publish', 'verify',
  'check-in', 'complete', 'download', 'upload', 'archive', 'enroll', 'pay'
];

/**
 * Strips HTML comments and script tag contents for separate analysis.
 * Resolves and loads both inline scripts and local external script files (e.g. <script src="assets/app.js">).
 */
function parseHtmlSections(htmlContent, htmlFilePath, appDir) {
  const scripts = [];
  const styles = [];

  // Extract inline scripts
  const scriptTagRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let scriptMatch;
  while ((scriptMatch = scriptTagRegex.exec(htmlContent)) !== null) {
    const attrs = scriptMatch[1];
    const inlineContent = scriptMatch[2];

    if (inlineContent && inlineContent.trim()) {
      scripts.push(inlineContent);
    }

    const srcMatch = attrs.match(/src=["']([^"']+)["']/i);
    if (srcMatch) {
      const src = srcMatch[1];
      if (!src.startsWith('http') && !src.startsWith('//')) {
        // Resolve local script file
        const candidates = [
          path.resolve(path.dirname(htmlFilePath), src),
          path.resolve(appDir, src),
          path.resolve(appDir, 'assets', path.basename(src)),
          path.resolve(appDir, 'pages/assets', path.basename(src))
        ];
        for (const candidate of candidates) {
          if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            scripts.push(fs.readFileSync(candidate, 'utf8'));
            break;
          }
        }
      }
    }
  }

  // Extract inline styles
  const styleRegex = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let styleMatch;
  while ((styleMatch = styleRegex.exec(htmlContent)) !== null) {
    styles.push(styleMatch[1]);
  }

  // Extract local external stylesheets (<link rel="stylesheet" href="...">)
  const linkCssRegex = /<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi;
  let linkMatch;
  while ((linkMatch = linkCssRegex.exec(htmlContent)) !== null) {
    const rawHref = linkMatch[1].split('?')[0].split('#')[0];
    if (!rawHref.startsWith('http') && !rawHref.startsWith('//')) {
      const candidates = [
        path.resolve(path.dirname(htmlFilePath), rawHref),
        path.resolve(appDir, rawHref.replace(/^\//, '')),
        path.resolve(appDir, 'assets', path.basename(rawHref)),
        path.resolve(appDir, 'pages/assets', path.basename(rawHref)),
        path.resolve(appDir, 'assets/themes', path.basename(rawHref))
      ];
      for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          styles.push(fs.readFileSync(candidate, 'utf8'));
          break;
        }
      }
    }
  }

  // Strip scripts, styles, and HTML comments to get clean DOM-only HTML for parsing elements
  const cleanMarkup = htmlContent
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  return {
    combinedScript: scripts.join('\n'),
    combinedStyle: styles.join('\n'),
    cleanMarkup
  };
}

/**
 * Audits a single HTML page deterministically.
 */
function auditHtmlPage(pagePath, appDir, manifest, pageSpec = null) {
  const issues = [];
  const warnings = [];
  const metrics = {
    buttonsTotal: 0,
    buttonsWithActions: 0,
    linksTotal: 0,
    linksValid: 0,
    sdkCallsTotal: 0,
    modalsTotal: 0
  };

  if (!fs.existsSync(pagePath)) {
    return {
      pagePath,
      passed: false,
      issues: [{ rule: 'Pass 13: Manifest Sync', type: 'FILE_NOT_FOUND', message: `File does not exist: ${pagePath}` }],
      warnings: [],
      metrics
    };
  }

  const rawHtml = fs.readFileSync(pagePath, 'utf8');
  const relativePagePath = path.relative(appDir, pagePath);
  const { combinedScript, combinedStyle, cleanMarkup } = parseHtmlSections(rawHtml, pagePath, appDir);

  const manifestRoutes = new Set((manifest.webPages || manifest.pages || []).map(p => p.route));
  const manifestDataModels = new Set((manifest.dataModels || []).map(m => m.name));
  const manifestWorkflows = new Set((manifest.workflows || []).map(w => w.name));

  // ------------------------------------------------------------------------
  // 1. RULE: Zero Native Alert Policy (Pass 8 & Core Rule)
  // ------------------------------------------------------------------------
  const alertRegex = /\b(alert|confirm|prompt)\s*\(/g;
  let alertMatch;
  while ((alertMatch = alertRegex.exec(combinedScript)) !== null) {
    // Exclude legitimate helper names like showConfirmModal or confirmPassword
    const beforeIndex = Math.max(0, alertMatch.index - 20);
    const context = combinedScript.substring(beforeIndex, alertMatch.index + 10);
    if (!context.includes('showConfirmModal') && !context.includes('Confirm') && !context.includes('.')) {
      issues.push({
        rule: 'Pass 08: Notifications & Zero Native Dialogs',
        type: 'NATIVE_DIALOG_VIOLATION',
        message: `Native browser "${alertMatch[1]}()" found in script. Use window.rapiderApi.showNotification or showConfirmModal instead.`,
        snippet: context
      });
    }
  }

  // ------------------------------------------------------------------------
  // 2. RULE: Primary Button Contrast (#ffffff !important) (Pass 19)
  // ------------------------------------------------------------------------
  const hasPrimaryButton = /class=["'][^"']*\b(btn primary|btn-primary|primary)\b[^"']*["']/i.test(cleanMarkup);
  if (hasPrimaryButton) {
    const hasWhiteStyle = /color\s*:\s*#ffffff\s*!important/i.test(rawHtml) ||
                          /color\s*:\s*#fff\s*!important/i.test(rawHtml) ||
                          /text-white/i.test(rawHtml) ||
                          /text-primary-button-text/i.test(rawHtml);
    if (!hasWhiteStyle) {
      issues.push({
        rule: 'Pass 19: UI Best Practices & Contrast',
        type: 'BUTTON_CONTRAST_MISSING',
        message: 'Primary button (.primary, .btn-primary) detected without explicit "#ffffff !important" contrast enforcement.'
      });
    }
  }

  // ------------------------------------------------------------------------
  // 3. RULE: Dead Links & Broken Navigation (Pass 1)
  // ------------------------------------------------------------------------
  const linkRegex = /<a\b([^>]*)>(.*?)<\/a>/gis;
  let linkMatch;
  while ((linkMatch = linkRegex.exec(cleanMarkup)) !== null) {
    metrics.linksTotal++;
    const attrs = linkMatch[1];
    const linkText = linkMatch[2].replace(/<[^>]*>/g, '').trim();

    const hrefMatch = attrs.match(/href=["']([^"']*)["']/i);
    const href = hrefMatch ? hrefMatch[1].trim() : '';

    if (!href || href === '#' || href === 'javascript:void(0)') {
      const hasAction = /data-action|onclick|id=/i.test(attrs);
      if (!hasAction) {
        issues.push({
          rule: 'Pass 01: Routing & Events',
          type: 'DEAD_LINK',
          message: `Link "${linkText || 'Unlabeled'}" has empty or '#' href with no click action handler.`,
          snippet: `<a ${attrs}>`
        });
        continue;
      }
    }

    // STRICT RULE: Forbid .html file links and hardcoded CDN / DigitalOcean Spaces / HTTP app page URLs
    if (
      href &&
      (/\.html(\?.*|#.*)?$/i.test(href) ||
       /digitaloceanspaces\.com/i.test(href) ||
       /^https?:\/\/localhost[:/]/i.test(href))
    ) {
      issues.push({
        rule: 'Pass 01: Routing & Events',
        type: 'HTML_URL_LINK_VIOLATION',
        message: `Link "${linkText || href}" uses a raw .html or full URL ("${href}") which resolves to the CDN asset URL and breaks the Rapider host wrapper. Enforce clean route paths (e.g. href="/roster" or window.rapiderApi.navigate('/roster')).`,
        snippet: `<a ${attrs}>`
      });
      continue;
    }

    // Clean route path check (e.g. href="/roster" or href="roster" or href="#/roster")
    if (href && !href.startsWith('http') && !href.startsWith('mailto') && !href.startsWith('tel') && !href.startsWith('javascript:') && href !== '#') {
      let routeKey = href.split('?')[0].split('#')[0];
      if (href.startsWith('#/')) {
        routeKey = href.substring(2).split('?')[0];
      } else if (href.startsWith('#')) {
        routeKey = '';
      } else if (routeKey.startsWith('/')) {
        routeKey = routeKey.substring(1);
      }

      if (routeKey && manifestRoutes.size > 0 && !manifestRoutes.has(routeKey)) {
        // Also check if it's an asset download link
        if (!routeKey.startsWith('assets/')) {
          warnings.push({
            rule: 'Pass 01: Routing & Events',
            type: 'UNREGISTERED_ROUTE',
            message: `Link "${linkText}" points to route "/${routeKey}" (from href="${href}") which is not defined in manifest webPages.`
          });
        }
      }
    }

    metrics.linksValid++;
  }

  // Also check inline/embedded scripts for dynamic .html links or location.href = '*.html' navigation
  if (
    /href\s*=\s*["'`][^"'`]*\.html/i.test(combinedScript) ||
    /location\.href\s*=\s*[^;\n]*\.html/i.test(combinedScript) ||
    /digitaloceanspaces\.com\/app\//i.test(combinedScript)
  ) {
    issues.push({
      rule: 'Pass 01: Routing & Events',
      type: 'SCRIPT_HTML_URL_VIOLATION',
      message: `Page script constructs .html URLs (e.g. href="\${file}.html" or location.href="...html") or hardcoded CDN URLs, which resolve against <base href> and break the Rapider host wrapper. Enforce clean route paths (e.g. "/roster") and window.rapiderApi.navigate('/roster').`,
      snippet: 'Script .html navigation detected'
    });
  }

  // ------------------------------------------------------------------------
  // 4. RULE: Dead Buttons & Non-CRUD Workflow Handlers (Pass 1 & Workflow Rule)
  // ------------------------------------------------------------------------
  const buttonRegex = /<button\b([^>]*)>(.*?)<\/button>/gis;
  let btnMatch;
  while ((btnMatch = buttonRegex.exec(cleanMarkup)) !== null) {
    metrics.buttonsTotal++;
    const attrs = btnMatch[1];
    const btnText = btnMatch[2].replace(/<[^>]*>/g, '').trim().toLowerCase();

    const idMatch = attrs.match(/id=["']([^"']+)["']/i);
    const btnId = idMatch ? idMatch[1] : null;

    const dataActionMatch = attrs.match(/data-action=["']([^"']+)["']/i);
    const dataAction = dataActionMatch ? dataActionMatch[1] : null;

    const hasOnclick = /onclick=["'][^"']+["']/i.test(attrs);
    const isSubmitType = /type=["']submit["']/i.test(attrs);

    let isWiredInScript = false;
    if (btnId) {
      const idPattern = new RegExp(`['"\`#]${btnId}['"\`]`, 'i');
      if (idPattern.test(combinedScript)) {
        isWiredInScript = true;
      }
    }
    if (dataAction) {
      const actionPattern = new RegExp(`['"\`]${dataAction}['"\`]`, 'i');
      if (actionPattern.test(combinedScript)) {
        isWiredInScript = true;
      }
    }

    if (!isWiredInScript) {
      const dataAttrMatches = attrs.match(/data-[a-z0-9-]+(?:=["'][^"']*["'])?/gi) || [];
      for (const dam of dataAttrMatches) {
        const attrName = dam.split('=')[0].trim();
        const attrValMatch = dam.match(/=["']([^"']+)["']/);
        const attrVal = attrValMatch ? attrValMatch[1] : null;
        const camelName = attrName.replace(/^data-/, '').replace(/-([a-z0-9])/gi, (_, c) => c.toUpperCase());
        if (new RegExp(`dataset\\.${camelName}`, 'i').test(combinedScript)) {
          isWiredInScript = true;
          break;
        }
        if (new RegExp(`['"\`\\[]${attrName}['"\`\\]]`, 'i').test(combinedScript)) {
          isWiredInScript = true;
          break;
        }
        if (attrVal && new RegExp(`['"\`]${attrVal}['"\`]`, 'i').test(combinedScript)) {
          isWiredInScript = true;
          break;
        }
      }
    }

    const hasClassSelector = /class=["']([^"']+)["']/i.test(attrs);
    if (!isWiredInScript && hasClassSelector) {
      const classAttr = attrs.match(/class=["']([^"']+)["']/i)[1];
      const classes = classAttr.split(/\s+/).filter(c => c && !c.startsWith('btn') && !c.startsWith('text-') && !c.startsWith('bg-'));
      for (const cls of classes) {
        if (new RegExp(`['"\`.]${cls}[\\b'"\`,\\s]`, 'i').test(combinedScript)) {
          isWiredInScript = true;
          break;
        }
      }
    }

    const isCloseBtn = btnText === '×' || btnText === 'close' || /modalclose|close/i.test(attrs);
    const isWired = hasOnclick || isWiredInScript || isSubmitType || isCloseBtn || /window\.print/i.test(attrs);

    if (isWired) {
      metrics.buttonsWithActions++;
    } else {
      // Check if button text indicates a critical business action
      const isActionVerb = NON_CRUD_ACTION_VERBS.some(verb => btnText.includes(verb));
      if (isActionVerb) {
        issues.push({
          rule: 'Pass 01: Routing & Events (Workflow Rule)',
          type: 'DEAD_ACTION_BUTTON',
          message: `Button "${btnText}" performs an action but has no event listener, onclick, data-action, or form submission handler.`,
          snippet: `<button ${attrs}>${btnText}</button>`
        });
      } else {
        warnings.push({
          rule: 'Pass 01: Routing & Events',
          type: 'UNWIRED_BUTTON',
          message: `Button "${btnText || 'Icon'}" does not appear to have an attached event handler or action target.`,
          snippet: `<button ${attrs}>`
        });
      }
    }
  }

  // ------------------------------------------------------------------------
  // 5. RULE: SWR Caching & SDK Model Conformance (Pass 2 & Pass 3)
  // ------------------------------------------------------------------------
  const sdkCallRegex = /window\.rapiderApi\s*\.\s*([a-zA-Z0-9_]+)\s*\(\s*['"`]([a-zA-Z0-9_]+)['"`]/g;
  let sdkMatch;
  while ((sdkMatch = sdkCallRegex.exec(combinedScript)) !== null) {
    metrics.sdkCallsTotal++;
    const method = sdkMatch[1];
    const modelName = sdkMatch[2];

    // Method SWR check
    if (method === 'find') {
      issues.push({
        rule: 'Pass 02: SWR Caching Implementation',
        type: 'NON_SWR_FIND_CALL',
        message: `Deprecated "window.rapiderApi.find('${modelName}')" used. Must use "findSWR" for responsive cache-first rendering.`
      });
    }
    if (method === 'count') {
      issues.push({
        rule: 'Pass 02: SWR Caching Implementation',
        type: 'NON_SWR_COUNT_CALL',
        message: `Deprecated "window.rapiderApi.count('${modelName}')" used. Must use "countSWR" for cache-first stats.`
      });
    }

    // Workflow vs Model name validation
    if (method === 'startWorkflow') {
      if (manifestWorkflows.size > 0 && !manifestWorkflows.has(modelName)) {
        warnings.push({
          rule: 'Pass 03: Data Model & UI Compatibility',
          type: 'UNKNOWN_PAGE_WORKFLOW',
          message: `SDK startWorkflow call references workflow "${modelName}" which is not registered in app.manifest.json workflows.`
        });
      }
    } else {
      const CRUD_METHODS = new Set(['find', 'findSWR', 'findById', 'count', 'countSWR', 'create', 'update', 'updateById', 'delete', 'deleteById']);
      if (CRUD_METHODS.has(method) && manifestDataModels.size > 0 && !manifestDataModels.has(modelName)) {
        warnings.push({
          rule: 'Pass 03: Data Model & UI Compatibility',
          type: 'UNKNOWN_SDK_DATA_MODEL',
          message: `SDK call references model "${modelName}" which is not defined in app.manifest.json dataModels.`
        });
      }
    }
  }

  // ------------------------------------------------------------------------
  // 5b. RULE: Live Data-Binding & Static Mock Elimination (Pass 02 & Pass 14)
  // ------------------------------------------------------------------------
  const hasSwrCall = /window\.rapiderApi\s*\.\s*(findSWR|countSWR)\s*\(/i.test(combinedScript);
  if (hasSwrCall) {
    // 5b.1 Unbound SWR call check: statement like "await window.rapiderApi.findSWR(...);" without assignment
    const unboundRegex = /(?:^|[;{}]\s*)(?:await\s+)?window\.rapiderApi\s*\.\s*(?:findSWR|countSWR)\s*\([^;)]*\)\s*;/g;
    let unboundMatch;
    while ((unboundMatch = unboundRegex.exec(combinedScript)) !== null) {
      issues.push({
        rule: 'Pass 02: SWR Caching Implementation (Live Data-Binding)',
        type: 'UNBOUND_SWR_CALL',
        message: 'SDK findSWR/countSWR call result is discarded without assignment or DOM binding. SWR results must be stored and dynamically rendered into DOM containers.',
        snippet: unboundMatch[0].trim()
      });
    }

    // 5b.2 Static mock table rows: check if cleanMarkup contains <tbody> with hardcoded <tr> mock rows
    const tbodyRegex = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/gi;
    let tbodyMatch;
    while ((tbodyMatch = tbodyRegex.exec(cleanMarkup)) !== null) {
      const tbodyContent = tbodyMatch[1];
      const trCount = (tbodyContent.match(/<tr\b/gi) || []).length;
      if (trCount > 1 || /data-row|data-record|\btd-person\b/i.test(tbodyContent)) {
        issues.push({
          rule: 'Pass 02: SWR Caching Implementation (No Mock Data)',
          type: 'STATIC_MOCK_TABLE_ROWS',
          message: `Table <tbody> contains static hardcoded rows (${trCount} rows). Tables must start empty or show loading skeletons, and be populated dynamically via JavaScript from findSWR data.`,
          snippet: tbodyContent.slice(0, 120).trim()
        });
      }
    }

    // 5b.3 Empty state handling (Pass 14): check if script handles empty data
    const hasEmptyStateHandling = /\.length\s*===?\s*0|!\w+\.length|\bempty-state\b|\bdata-empty\b|\bno records\b/i.test(combinedScript);
    const hasEmptyMarkup = /class=["'][^"']*\bempty(-state)?\b[^"']*["']/i.test(cleanMarkup);
    if (!hasEmptyStateHandling && !hasEmptyMarkup) {
      issues.push({
        rule: 'Pass 14: Empty/Loading/Error States',
        type: 'MISSING_EMPTY_STATE_HANDLING',
        message: 'Page uses findSWR to query records but does not implement empty state handling when 0 records are returned from the database.'
      });
    }

    // 5b.4 Scoped helper call check (esc / toast): check if scripts call esc() without definition
    const scriptsInPage = (rawHtml.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi) || []);
    scriptsInPage.forEach((scriptTag, idx) => {
      const scriptCode = scriptTag.replace(/<\/?script\b[^>]*>/gi, '');
      if (/\besc\s*\(/.test(scriptCode)) {
        const hasEscDef = /\b(?:const|let|function|var)\s+esc\b|\bwindow\.esc\b/.test(scriptCode);
        if (!hasEscDef && !/\bwindow\.esc\s*=\s*esc\b/.test(rawHtml)) {
          issues.push({
            rule: 'Pass 02: SWR Caching Implementation (Script Scope Integrity)',
            type: 'UNDECLARED_HELPER_CALL',
            message: `Script #${idx + 1} calls esc() to format live data without declaring esc in its scope or exposing window.esc, causing a runtime ReferenceError that crashes data rendering.`,
            snippet: scriptCode.slice(0, 100).trim()
          });
        }
      }
    });

    // 5b.5 Form Mutation SDK Binding (Pass 02 / Pass 05): verify save forms call SDK mutations
    const saveFormMatch = /<form\b[^>]*data-save-form[^>]*>/i.test(cleanMarkup);
    if (saveFormMatch) {
      const hasSdkMutation = /window\.rapiderApi\s*\.\s*(create|update|updateById|delete|deleteById|triggerWorkflow|startWorkflow)|window\.rapiderPeopleAdapter/i.test(combinedScript);
      if (!hasSdkMutation) {
        issues.push({
          rule: 'Pass 02: SDK Mutation & Form Persistence',
          type: 'UNBOUND_SAVE_FORM',
          message: 'Page contains <form data-save-form> but does not bind submission to SDK mutation methods (create/updateById/startWorkflow). Form inputs will not be persisted to the backend database.'
        });
      }
    }
  }

  // ------------------------------------------------------------------------
  // 5c. RULE: Anti-Wireframe & Strict Detail/Routing/AI Verification
  // ------------------------------------------------------------------------
  // 5c.1 Forbid leftover static design-preview mocks & wireframe persona strings
  const forbiddenMockPatterns = [
    { regex: /No AI request or business action was sent/i, label: 'Mocked AI preview response ("No AI request or business action was sent")' },
    { regex: /Design preview\s*·\s*AI not connected/i, label: 'Disconnected AI preview footer ("Design preview · AI not connected")' },
    { regex: /Sample data for design review/i, label: 'Static wireframe footer ("Sample data for design review")' },
    { regex: /data-action=["']reset-preview["']/i, label: 'Wireframe reset-preview button' },
    { regex: /amelia\.brooks@example\.com|EMP-0108|People around Amelia|Help me prepare Amelia/i, label: 'Hardcoded Amelia Brooks wireframe persona data in DOM' },
    { regex: /No live action was sent/i, label: 'Local preview confirm stub ("No live action was sent")' },
    { regex: /No backend data was changed|No backend record was changed/i, label: 'Local preview form stub ("No backend data/record was changed")' },
    { regex: /Local preview only\.\s*No live data/i, label: 'Local preview dialog notice ("Local preview only. No live data...")' },
    { regex: /No AI service is connected in this design/i, label: 'Disconnected AI preview message ("No AI service is connected in this design")' },
    { regex: /Sample workspace\s*·\s*No live service connected/i, label: 'Disconnected workspace footer ("Sample workspace · No live service connected")' },
    { regex: /saved in this browser preview/i, label: 'Local browser preview save message ("saved in this browser preview")' }
  ];
  for (const fp of forbiddenMockPatterns) {
    if (fp.regex.test(rawHtml)) {
      issues.push({
        rule: 'Pass 02 & Pass 14: Zero Static Wireframe Mocks',
        type: 'LEFTOVER_WIREFRAME_MOCK',
        message: `${fp.label} detected in page. Pre-designed wireframes must be fully converted to live SDK data bindings without static preview stubs.`
      });
    }
  }

  // 5c.2 Forbid name-based routing (?person=) and enforce ID-based routing (?id=)
  if (/[?&]person=/i.test(rawHtml) || /\.get\(\s*['"`]person['"`]\s*\)/i.test(combinedScript)) {
    const hasIdParam = /getRouteParam\(\s*['"`]id['"`]\s*\)|\.get\(\s*['"`]id['"`]\s*\)|[?&]id=/i.test(rawHtml);
    if (!hasIdParam || /[?&]person=\$\{/i.test(combinedScript)) {
      issues.push({
        rule: 'Pass 01: Routing & Record ID Resolution',
        type: 'NAME_BASED_ROUTING_VIOLATION',
        message: 'Page routes or resolves records by display name ("?person=...") instead of unique record ID ("?id=<uuid>"). All detail, profile, edit, and change routes MUST pass and resolve records by ID.'
      });
    }
  }

  // 5c.3 Detail/Profile tabs must switch in-page tab panels, NOT navigate away to root pages
  const tabsNavRegex = /<nav\b[^>]*class=["'][^"']*\btabs\b[^"']*["'][^>]*>([\s\S]*?)<\/nav>/gi;
  let tabsNavMatch;
  while ((tabsNavMatch = tabsNavRegex.exec(cleanMarkup)) !== null) {
    const tabsInner = tabsNavMatch[1];
    const tabLinks = [...tabsInner.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis)];
    for (const tl of tabLinks) {
      const tabHref = tl[1].trim();
      const tabLabel = tl[2].replace(/<[^>]*>/g, '').trim();
      if (tabHref.startsWith('#/') || (tabHref.startsWith('/') && !tabHref.startsWith('//'))) {
        const targetRoute = tabHref.replace(/^#?\//, '').split('?')[0];
        const currentRoute = path.basename(pagePath, '.html');
        if (targetRoute && targetRoute !== currentRoute) {
          issues.push({
            rule: 'Pass 01: Detail Page Tab Isolation',
            type: 'DETAIL_TABS_NAVIGATE_TO_ROOT_PAGE',
            message: `Tab "${tabLabel}" inside <nav class="tabs"> navigates away to root page "${tabHref}" instead of switching an in-page tab view for the current record. Use <button type="button" data-tab="..."> with scoped tab panels.`,
            snippet: tl[0]
          });
        }
      }
    }
  }

  // 5c.4 Ask AI & inline AI thread inputs must connect to window.rapiderApi SDK
  const hasAiElements = /data-action=["']ai["']|data-ai-inline|data-ai-form/i.test(cleanMarkup);
  if (hasAiElements) {
    const hasSdkAiBinding = /window\.rapiderApi\s*\.\s*(triggerWorkflow|startWorkflow|executeAction|broadcast|create)/i.test(combinedScript);
    if (!hasSdkAiBinding) {
      issues.push({
        rule: 'Pass 07: AI Assistant & Contextual Thread SDK Integration',
        type: 'MOCKED_AI_INPUT_VIOLATION',
        message: 'Page contains Ask AI / inline thread inputs ([data-action="ai"], [data-ai-inline]) that are not wired to window.rapiderApi SDK methods.'
      });
    }
  }

  // ------------------------------------------------------------------------
  // 6. RULE: Modals and Dialogs (Pass 4)
  // ------------------------------------------------------------------------
  const dialogRegex = /<dialog\b([^>]*)>/gi;
  let dialogMatch;
  while ((dialogMatch = dialogRegex.exec(cleanMarkup)) !== null) {
    metrics.modalsTotal++;
    const dialogAttrs = dialogMatch[1];
    const dialogId = (dialogAttrs.match(/id=["']([^"']+)["']/i) || [])[1];
    if (dialogId) {
      const isReferenced = new RegExp(`['"\`#]${dialogId}['"\`]`, 'i').test(combinedScript) ||
                           new RegExp(`getElementById\\(['"\`]${dialogId}['"\`]\\)`, 'i').test(rawHtml);
      if (!isReferenced) {
        warnings.push({
          rule: 'Pass 04: Modal Usage',
          type: 'ORPHANED_DIALOG',
          message: `<dialog id="${dialogId}"> has no visible trigger or open script in the page.`
        });
      }
    }
  }

  // ------------------------------------------------------------------------
  // 7. RULE: Search Inputs & Filtering Handlers (Pass 20)
  // ------------------------------------------------------------------------
  const searchInputRegex = /<input\b[^>]*(id=["']search["']|placeholder=["'][^"']*search[^"']*["'])[^>]*>/gi;
  if (searchInputRegex.test(cleanMarkup)) {
    const hasSearchHandler = /['"`#]search['"`]|\.filter\(|addEventListener\(['"`](input|keyup)['"`]/i.test(combinedScript);
    if (!hasSearchHandler) {
      warnings.push({
        rule: 'Pass 20: Search, Active Filter Tags & Reset Standards',
        type: 'SEARCH_INPUT_WITHOUT_HANDLER',
        message: 'Search input found in HTML but no search/filter listener detected in script.'
      });
    }
  }

  // ------------------------------------------------------------------------
  // 8. RULE: Dark & Light Theme Compliance (Pass 11)
  // ------------------------------------------------------------------------
  let hasDarkModeSupport = false;
  if (/(\.dark\b|html\.dark|color-scheme:\s*dark|prefers-color-scheme)/i.test(combinedStyle)) {
    hasDarkModeSupport = true;
  }
  const linkCssRegex = /<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi;
  let linkCssMatch;
  while ((linkCssMatch = linkCssRegex.exec(rawHtml)) !== null) {
    const href = linkCssMatch[1];
    if (!href.startsWith('http') && !href.startsWith('//')) {
      const candidates = [
        path.resolve(path.dirname(pagePath), href),
        path.resolve(appDir, href.replace(/^\//, '')),
        path.resolve(appDir, 'assets', path.basename(href)),
        path.resolve(appDir, 'assets/themes', path.basename(href))
      ];
      for (const cand of candidates) {
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
          const cssContent = fs.readFileSync(cand, 'utf8');
          if (/(\.dark\b|html\.dark|color-scheme:\s*dark|prefers-color-scheme)/i.test(cssContent)) {
            hasDarkModeSupport = true;
            break;
          }
        }
      }
    } else if (href.includes('tailwind') || href.includes('rapider')) {
      hasDarkModeSupport = true;
    }
  }

  // Check for un-adapted white card backgrounds (e.g. bg-white without dark:bg-)
  const whiteBgRegex = /class=["']([^"']*\bbg-white\b[^"']*)["']/gi;
  let whiteBgMatch;
  while ((whiteBgMatch = whiteBgRegex.exec(cleanMarkup)) !== null) {
    const classList = whiteBgMatch[1];
    if (!classList.includes('dark:bg-') && !classList.includes('bg-primary') && !classList.includes('text-white') && !classList.includes('!text-white')) {
      warnings.push({
        rule: 'Pass 11: Dark & Light Theme Compliance',
        type: 'HARDCODED_LIGHT_BACKGROUND',
        message: `Container has "bg-white" without a corresponding "dark:bg-*" variant class (${classList.slice(0, 50)}).`,
        snippet: `<div class="${classList}">`
      });
      break;
    }
  }

  // Check for hardcoded dark text without dark variant (e.g. text-slate-900 without dark:text-)
  const darkTextRegex = /class=["']([^"']*\b(text-slate-900|text-gray-900|text-black)\b[^"']*)["']/gi;
  let darkTextMatch;
  while ((darkTextMatch = darkTextRegex.exec(cleanMarkup)) !== null) {
    const classList = darkTextMatch[1];
    if (!classList.includes('dark:text-')) {
      warnings.push({
        rule: 'Pass 11: Dark & Light Theme Compliance',
        type: 'HARDCODED_DARK_TEXT',
        message: `Text has hardcoded dark color without a corresponding "dark:text-*" variant (${classList.slice(0, 50)}).`,
        snippet: `<div class="${classList}">`
      });
      break;
    }
  }

  // Check for inline style hardcoded light background
  const inlineStyleWhiteBg = /style=["'][^"']*\bbackground(-color)?:\s*(#ffffff|#fff|white)\b[^"']*["']/gi;
  if (inlineStyleWhiteBg.test(cleanMarkup)) {
    warnings.push({
      rule: 'Pass 11: Dark & Light Theme Compliance',
      type: 'INLINE_STYLE_WHITE_BACKGROUND',
      message: 'Inline style hardcodes white background without theme adaptability or CSS variables.'
    });
  }

  // ------------------------------------------------------------------------
  // 14. RULE: Schema Payload Field Validation against app.manifest.json (Pass 3 & Pass 9)
  // ------------------------------------------------------------------------
  if (manifest && manifest.dataModels && typeof manifest.dataModels === 'object') {
    const implicitSystemFields = new Set([
      'id', '_id', 'isDeleted', 'createdDate', 'createdBy', 'createdById',
      'updatedDate', 'updatedBy', 'updatedById', 'deletedDate', 'deletedBy', 'deletedById'
    ]);

    const manifestModelsMap = new Map();
    const dmList = Array.isArray(manifest.dataModels)
      ? manifest.dataModels
      : Object.entries(manifest.dataModels).map(([k, v]) => ({ name: k, ...v }));
    for (const dm of dmList) {
      if (!dm || !dm.name) continue;
      const fieldMap = {};
      const rawFields = dm.fields || dm.properties || [];
      if (Array.isArray(rawFields)) {
        for (const f of rawFields) {
          if (f && f.name) fieldMap[f.name] = f.type || 'string';
        }
      } else if (rawFields && typeof rawFields === 'object') {
        for (const [fk, fv] of Object.entries(rawFields)) {
          fieldMap[fk] = (fv && fv.type) ? fv.type : 'string';
        }
      }
      manifestModelsMap.set(dm.name, fieldMap);
    }

    const extractTopLevelProps = (objLiteralBody) => {
      const props = [];
      let depth = 0;
      let inStr = null;
      let cur = '';
      const segments = [];
      for (let i = 0; i < objLiteralBody.length; i++) {
        const ch = objLiteralBody[i];
        const prev = i > 0 ? objLiteralBody[i - 1] : '';
        if (inStr) {
          cur += ch;
          if (ch === inStr && prev !== '\\') inStr = null;
          continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') {
          inStr = ch;
          cur += ch;
          continue;
        }
        if (ch === '{' || ch === '[' || ch === '(') depth++;
        else if (ch === '}' || ch === ']' || ch === ')') depth = Math.max(0, depth - 1);
        if (ch === ',' && depth === 0) {
          segments.push(cur);
          cur = '';
        } else {
          cur += ch;
        }
      }
      if (cur.trim()) segments.push(cur);
      for (const seg of segments) {
        const cleaned = seg.replace(/\/\/[^\n]*\n/g, '').trim();
        const propMatch = cleaned.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:\s*([\s\S]+)$/);
        if (propMatch) {
          props.push({ key: propMatch[1], expr: propMatch[2].trim() });
        }
      }
      return props;
    };

    const verifyPayloadKeys = (entityName, objBody, callLabel) => {
      const fieldMap = manifestModelsMap.get(entityName);
      if (!fieldMap) return;
      const allowedFields = new Set([...Object.keys(fieldMap), ...implicitSystemFields]);
      const props = extractTopLevelProps(objBody);
      const invalidKeys = props.map(p => p.key).filter((k) => !allowedFields.has(k));
      if (invalidKeys.length > 0) {
        issues.push({
          rule: 'Pass 03 & Pass 09: Schema Payload Compatibility',
          type: 'INVALID_SCHEMA_PAYLOAD_FIELD',
          message: `${callLabel} for entity "${entityName}" sends field(s) [${invalidKeys.join(', ')}] not defined in app.manifest.json dataModels.${entityName}.fields (${Object.keys(fieldMap).join(', ')}). This causes HTTP 400/422 errors.`,
          snippet: `${callLabel}('${entityName}', { ${invalidKeys.join(', ')} ... })`
        });
      }
      for (const { key, expr } of props) {
        const expectedType = fieldMap[key];
        if (expectedType === 'string' && (/^(?:\d+|Number\(|parseInt\(|parseFloat\()/.test(expr) || /\?\s*\d+\s*:\s*\d+/.test(expr))) {
          issues.push({
            rule: 'Pass 03 & Pass 09: Schema Payload Type Compatibility',
            type: 'SCHEMA_FIELD_TYPE_MISMATCH',
            message: `${callLabel} for entity "${entityName}" passes numeric expression (${expr}) to string field "${key}". LoopBack 4 rejects number values for string columns with HTTP 400 Bad Request.`,
            snippet: `${key}: ${expr}`
          });
        }
      }
    };

    const createInlineRegex = /rapiderApi\.create\(\s*['"`]([A-Za-z0-9_]+)['"`]\s*,\s*\{([\s\S]{1,1200}?)\}\s*\)/g;
    let createMatch;
    while ((createMatch = createInlineRegex.exec(combinedScript)) !== null) {
      verifyPayloadKeys(createMatch[1], createMatch[2], 'rapiderApi.create');
    }

    const updateInlineRegex = /rapiderApi\.updateById\(\s*['"`]([A-Za-z0-9_]+)['"`]\s*,\s*[^,]+\s*,\s*\{([\s\S]{1,1200}?)\}\s*\)/g;
    let updateMatch;
    while ((updateMatch = updateInlineRegex.exec(combinedScript)) !== null) {
      verifyPayloadKeys(updateMatch[1], updateMatch[2], 'rapiderApi.updateById');
    }

    const namedPayloadCreateRegex = /const\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*\{([\s\S]{1,1200}?)\};\s*(?:await\s+)?(?:window\.)?rapiderApi\.(create|updateById)\(\s*['"`]([A-Za-z0-9_]+)['"`]/g;
    let namedMatch;
    while ((namedMatch = namedPayloadCreateRegex.exec(combinedScript)) !== null) {
      verifyPayloadKeys(namedMatch[4], namedMatch[2], `rapiderApi.${namedMatch[3]}`);
    }
  }

  // ------------------------------------------------------------------------
  // 15. RULE: Container Queries without Ancestor @container (Pass 06)
  // ------------------------------------------------------------------------
  const containerQueryRegex = /class=["'][^"']*\b@(sm|md|lg|xl|2xl):[a-z0-9-]+[^"']*["']/gi;
  if (containerQueryRegex.test(cleanMarkup)) {
    const hasContainerRoot = /class=["'][^"']*\b@container\b[^"']*["']/i.test(cleanMarkup) ||
                             /class=["'][^"']*\b@container\b[^"']*["']/i.test(rawHtml);
    if (!hasContainerRoot) {
      issues.push({
        rule: 'Pass 06: Responsive Layouts & Container Queries',
        type: 'CONTAINER_QUERY_WITHOUT_CONTAINER_ROOT',
        message: 'Page uses Tailwind container query modifiers (@sm:, @md:, @lg:, etc.) without declaring "@container" on any ancestor wrapper. Container queries fail silently without an explicit container context.'
      });
    }
  }

  // ------------------------------------------------------------------------
  // 16. RULE: Inner Viewport min-h-screen Causing Double Scrollbars (Pass 06)
  // ------------------------------------------------------------------------
  const mainTagMatch = cleanMarkup.match(/<main\b([^>]*)>/i);
  if (mainTagMatch) {
    const mainAttrs = mainTagMatch[1];
    if (/min-h-screen/i.test(mainAttrs)) {
      issues.push({
        rule: 'Pass 06: Responsive Layouts (Single Scrollbar Standard)',
        type: 'INNER_VIEWPORT_MIN_H_SCREEN_VIOLATION',
        message: '<main> element declares "min-h-screen" inside the App Shell. The outer viewport already controls height (h-screen overflow-hidden). Adding "min-h-screen" inside <main> induces double vertical scrollbars. Use "flex-1 overflow-y-auto" instead.',
        snippet: `<main ${mainAttrs}>`
      });
    }
  }

  // ------------------------------------------------------------------------
  // 17. RULE: Header Fixed Height (h-16 / 64px) Discrepancy (Pass 06)
  // ------------------------------------------------------------------------
  const headerTagMatch = cleanMarkup.match(/<header\b([^>]*)>/i);
  if (headerTagMatch) {
    const headerAttrs = headerTagMatch[1];
    if (!/\bh-16\b/i.test(headerAttrs) && !/style=["'][^"']*height:\s*64px/i.test(headerAttrs)) {
      warnings.push({
        rule: 'Pass 06: Responsive Layouts (Header Alignment)',
        type: 'TOP_HEADER_HEIGHT_DISCREPANCY',
        message: 'Top <header> does not declare canonical fixed height "h-16" (64px). Mismatched header heights cause vertical layout shift across application routes.',
        snippet: `<header ${headerAttrs.slice(0, 80)}...>`
      });
    }
  }

  // ------------------------------------------------------------------------
  // 18. RULE: Sidebar Inline Display Override in JS (Pass 01 & Pass 19)
  // ------------------------------------------------------------------------
  const sidebarInlineDisplayRegex = /(?:sidebar|aside|menuItem|sidebarLabel|navLabel)\w*\.style\.display\s*=/i;
  if (sidebarInlineDisplayRegex.test(combinedScript)) {
    issues.push({
      rule: 'Pass 01: Routing & Pass 19: UI Best Practices',
      type: 'SIDEBAR_INLINE_DISPLAY_OVERRIDE',
      message: 'Script directly overrides .style.display on sidebar/navigation elements. Sidebar collapse MUST be driven strictly by toggling CSS classes (e.g. .collapsed or [data-collapsed="true"]) on the <aside> container.',
      snippet: 'sidebar.style.display assignment detected'
    });
  }

  // ------------------------------------------------------------------------
  // 19. RULE: Collapsed Sidebar CSS Label Visibility (Pass 19)
  // ------------------------------------------------------------------------
  const hasCollapseToggle = /collapse|sidebar-toggle|btn-collapse|toggle-sidebar/i.test(cleanMarkup) ||
                            /collapse|toggleSidebar|toggleCollapse/i.test(combinedScript);
  if (hasCollapseToggle) {
    const hasCollapsedLabelCss = /\.sidebar-label\b[^{]*\{[^}]*display\s*:\s*none\s*!important/i.test(combinedStyle) ||
                                 /aside\.collapsed\b[^{]*\{[^}]*display\s*:\s*none/i.test(combinedStyle) ||
                                 /\[data-collapsed=["']?true["']?\]\s+\.sidebar-label\b[^{]*\{[^}]*display\s*:\s*none\s*!important/i.test(combinedStyle);
    if (!hasCollapsedLabelCss) {
      warnings.push({
        rule: 'Pass 19: UI Best Practices & Sidebar Standard',
        type: 'SIDEBAR_COLLAPSED_LABEL_VISIBILITY',
        message: 'Sidebar collapse mechanism detected, but CSS lacks ".sidebar-label { display: none !important; }" under collapsed state, which causes text fragments to leak in narrow mode.'
      });
    }
  }

  // ------------------------------------------------------------------------
  // 20. RULE: White Text on Light/Neutral Background (Pass 07 & Pass 19)
  // ------------------------------------------------------------------------
  const forbiddenWhiteOnLightRegex = /class=["'][^"']*\b(bg-button-bg|bg-alt-background|bg-slate-100|bg-gray-100|bg-slate-50|bg-gray-50)\b[^"']*\b(text-white|!text-white)\b[^"']*["']/gi;
  let whiteLightMatch;
  while ((whiteLightMatch = forbiddenWhiteOnLightRegex.exec(cleanMarkup)) !== null) {
    issues.push({
      rule: 'Pass 07: Themes & Styling & Pass 19: Contrast',
      type: 'WHITE_TEXT_ON_LIGHT_BACKGROUND',
      message: `Element pairs "${whiteLightMatch[1]}" with "${whiteLightMatch[2]}". In light mode, light backgrounds render white text unreadable. Use semantic "text-secondary-button-text" or dark text for light backgrounds.`,
      snippet: whiteLightMatch[0]
    });
  }

  // ------------------------------------------------------------------------
  // 21. RULE: CSS Structural Integrity (Unbalanced Braces) (Pass 07)
  // ------------------------------------------------------------------------
  const styleTags = rawHtml.match(/<style\b[^>]*>([\s\S]*?)<\/style>/gi) || [];
  for (let i = 0; i < styleTags.length; i++) {
    const styleCode = styleTags[i].replace(/<\/?style\b[^>]*>/gi, '');
    const openCount = (styleCode.match(/\{/g) || []).length;
    const closeCount = (styleCode.match(/\}/g) || []).length;
    if (openCount !== closeCount) {
      issues.push({
        rule: 'Pass 07: Themes & Styling (CSS Integrity)',
        type: 'UNBALANCED_CSS_BRACES',
        message: `<style> block #${i + 1} has unbalanced curly braces (${openCount} "{" vs ${closeCount} "}"). Unbalanced CSS syntax silently breaks subsequent page styling.`,
        snippet: styleCode.slice(0, 100).trim() + '...'
      });
    }
  }

  // ------------------------------------------------------------------------
  // 22. RULE: Seed / Sample Data Button in Header Isolation (Pass 14)
  // ------------------------------------------------------------------------
  if (headerTagMatch) {
    const headerContentMatch = cleanMarkup.match(/<header\b[^>]*>([\s\S]*?)<\/header>/i);
    if (headerContentMatch) {
      const headerHtml = headerContentMatch[1];
      if (/seed\s*(demo|sample)|install\s*sample|seed\s*data|populate\s*demo/i.test(headerHtml)) {
        issues.push({
          rule: 'Pass 14: Empty/Loading/Error States (Header Isolation)',
          type: 'SEED_BUTTON_IN_HEADER_VIOLATION',
          message: '"Seed Demo Records" / "Sample Data" button detected inside <header>. Seed demo data buttons are strictly forbidden in top navigation/headers and may ONLY be rendered inside empty-state cards when records.length === 0.',
          snippet: headerHtml.slice(0, 120).trim()
        });
      }
    }
  }

  // ------------------------------------------------------------------------
  // 23. RULE: Modal Dismissal (Backdrop Click / ESC Key) (Pass 04)
  // ------------------------------------------------------------------------
  const hasModalElement = /<dialog\b|class=["'][^"']*\b(modal|modal-container)\b[^"']*["']|role=["']dialog["']/i.test(cleanMarkup);
  if (hasModalElement && combinedScript) {
    const hasEscKeyHandler = /['"`]Escape['"`]|keyCode\s*===?\s*27|key\s*===?\s*['"`]Escape['"`]/i.test(combinedScript);
    const hasBackdropHandler = /e\.target\s*===|event\.target\s*===|\.backdrop|data-dismiss|closeModal|closePageModal/i.test(combinedScript);
    if (!hasEscKeyHandler && !hasBackdropHandler) {
      warnings.push({
        rule: 'Pass 04: Modals Usage (Universal Dismissal)',
        type: 'MODAL_DISMISSAL_MISSING',
        message: 'Modal element detected, but script lacks standard backdrop click dismissal or Escape key listener to close active overlays.'
      });
    }
  }

  // ------------------------------------------------------------------------
  // 24. RULE: Table Row Click Hijacking Risk (Pass 04 & Pass 19)
  // ------------------------------------------------------------------------
  if (/(?:tbody|tr|table)\w*\.addEventListener\(\s*['"`]click['"`]/i.test(combinedScript) && /window\.rapiderApi\s*\.\s*navigate/i.test(combinedScript)) {
    const hasClosestGuard = /closest\(\s*['"`][^'"`]*(button|a|input|\[data-action\])/i.test(combinedScript);
    if (!hasClosestGuard) {
      warnings.push({
        rule: 'Pass 04: Modals & Pass 19: UI Standards',
        type: 'TABLE_ROW_CLICK_HIJACKING_RISK',
        message: 'Table row click listener navigates to route without guarding against clicks on child buttons/links (e.target.closest("button, a, input, select, [data-action]")). Clicking row action buttons may inadvertently trigger row navigation.'
      });
    }
  }

  // ------------------------------------------------------------------------
  // 25. RULE: JavaScript Syntax & Parse Integrity (Pass 09: Error Handling)
  // ------------------------------------------------------------------------
  const inlineScriptMatches = [...rawHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  inlineScriptMatches.forEach((m, idx) => {
    const attrs = m[1] || '';
    const code = m[2] || '';
    if (!code.trim() || /type=["'](?:application\/json|application\/ld\+json|text\/template|importmap)["']/i.test(attrs)) return;
    try {
      new vm.Script(code, { filename: `${relativePagePath}#script${idx + 1}` });
    } catch (syntaxErr) {
      issues.push({
        rule: 'Pass 09: Error Handling & JS Parse Integrity',
        type: 'JS_SYNTAX_ERROR',
        message: `<script> block #${idx + 1} fails JavaScript syntax parsing: ${syntaxErr.message}`,
        snippet: code.slice(0, 120).trim()
      });
    }
  });

  // ------------------------------------------------------------------------
  // 26. RULE: No Unconditional Auto-Seeding POST Spam on Load (Pass 14)
  // ------------------------------------------------------------------------
  if (/if\s*\(\(\!(?:timesheets|balances|requests|records)\s*\|\|\s*(?:timesheets|balances|requests|records)\.length\s*===\s*0\)\s*&&\s*typeof\s+window\.rapiderApi\.create\s*===\s*["']function["']\)/i.test(combinedScript)) {
    issues.push({
      rule: 'Pass 14: Empty/Loading/Error States (No Auto-Seed POST Spam)',
      type: 'AUTO_SEED_ON_LOAD_VIOLATION',
      message: 'Page automatically calls window.rapiderApi.create() inside DOMContentLoaded when 0 records are returned. Demo record seeding MUST be triggered explicitly by a user action inside an empty-state card, never automatically on page load.'
    });
  }

  // ------------------------------------------------------------------------
  // 27. RULE: No Unhandled Synchronous SWR Promise Rejections (Pass 02 & 09)
  // ------------------------------------------------------------------------
  if (/var\s+_swrRes_\d+\s*=\s*window\.rapiderApi\.(?:findSWR|countSWR)\([^;]+\);(?!\s*Promise\.resolve\(_swrRes_\d+\)\.catch)/i.test(combinedScript)) {
    issues.push({
      rule: 'Pass 02: SWR & Pass 09: Error Handling (Unhandled SWR Promise Rejection)',
      type: 'UNHANDLED_SWR_PROMISE_REJECTION',
      message: 'Synchronous findSWR / countSWR call is not guarded with Promise.resolve(...).catch(...) or awaited inside a try/catch block, causing an unhandled promise rejection if the backend request fails.'
    });
  }

  // ------------------------------------------------------------------------
  // 28. RULE: Native <dialog> Modal Centering Under Tailwind v4 Preflight (Pass 04 & 19)
  // ------------------------------------------------------------------------
  if (/\bdialog\s*\{[^}]*\}/i.test(combinedStyle) && !/\bdialog[^{]*\{[^}]*margin\s*:\s*auto/i.test(combinedStyle)) {
    issues.push({
      rule: 'Pass 04: Modals & Pass 19: UI Standards (Dialog Viewport Centering)',
      type: 'DIALOG_NOT_CENTERED',
      message: '<dialog> CSS block is missing explicit `margin: auto;`. Under Tailwind v4 preflight (`* { margin: 0 }`), native <dialog> modals are pinned to the top-left corner unless `margin: auto` is explicitly set.'
    });
  }

  // ------------------------------------------------------------------------
  // 29. RULE: Scoped .field input CSS for Checkboxes and Radios (Pass 05 & 19)
  // ------------------------------------------------------------------------
  if (/\.field\s+input\s*,\s*\n?\s*\.field\s+select/i.test(combinedStyle) && !/\.field\s+input\[type=["']checkbox["']\]|\.field\s+input:not\(\[type=["']checkbox["']\]\)/i.test(combinedStyle)) {
    issues.push({
      rule: 'Pass 05: Forms & Pass 19: UI Standards (Checkbox Input Sizing)',
      type: 'UNSCOPED_CHECKBOX_INPUT_CSS',
      message: '`.field input` applies `display: block; width: 100%; min-height: 42px` to all inputs without excluding `input[type="checkbox"]` / `input[type="radio"]`, causing checkboxes inside `.field` labels to render as oversized full-width blocks.'
    });
  }

  // ------------------------------------------------------------------------
  // 30. RULE: No Unguarded Duplicate Submit Handler in QA Bridge (Pass 03 & 13)
  // ------------------------------------------------------------------------
  if (rawHtml.includes('id="rapider-qa-bridge"') && /document\.addEventListener\(['"]submit['"],\s*async\s+function\(e\)\s*\{(?!\s*if\s*\(e\.defaultPrevented\))/i.test(rawHtml)) {
    issues.push({
      rule: 'Pass 03: SDK Usage & Pass 13: Form Submissions (No Duplicate Submit)',
      type: 'UNGUARDED_QA_BRIDGE_SUBMIT',
      message: '#rapider-qa-bridge submit listener does not check `if (e.defaultPrevented) return;`, causing a duplicate unmapped `window.rapiderApi.create` call (HTTP 400/422) after the page form handler already handled submission.'
    });
  }

  // ------------------------------------------------------------------------
  // 31. RULE: Suite Brand & Collapsible Sidebar Navigation Standards (Pass 21)
  // ------------------------------------------------------------------------
  const hasSidebar = /<aside\b[^>]*class=["'][^"']*sidebar/i.test(rawHtml) || /class=["'][^"']*\bsidebar\b/i.test(rawHtml);
  if (hasSidebar) {
    // Check for fake Rapider brandmarks in sidebar
    if (/<span\s+class=["']brandmark["']>\s*r\s*<\/span>/i.test(rawHtml) || /class=["']brandlogo["']>\s*r\s*<\/span>/i.test(rawHtml) || /<span\s+class=["']brandsub["']>\s*rapider\s*ai\s*<\/span>/i.test(rawHtml)) {
      issues.push({
        rule: 'Pass 21: Suite Brand & Collapsible Sidebar Navigation Standards',
        type: 'FAKE_RAPIDER_BRANDMARK_IN_SIDEBAR',
        message: 'Page sidebar contains legacy fake purple "r" brandmark or "rapider ai" subtitle instead of authentic Suite Icon and Suite Title.'
      });
    }

    // Check for collapsible sidebar script/mechanism
    const hasCollapsibleScript = rawHtml.includes('data-collapsible-sidebar') || rawHtml.includes('rapider_sidebar_collapsed');
    if (!hasCollapsibleScript) {
      issues.push({
        rule: 'Pass 21: Suite Brand & Collapsible Sidebar Navigation Standards',
        type: 'MISSING_COLLAPSIBLE_SIDEBAR',
        message: 'Page sidebar is missing the collapsible sidebar mechanism, hover expand caret, or localStorage persistence.'
      });
    }

    // Check for saturated primary blue on sidebar navigation items
    if (/class=["'][^"']*\b(bg-primary|bg-blue-600|bg-blue-500)\b[^"']*\b(!text-white|text-white)\b[^"']*["'][^>]*>\s*<i\b[^>]*class=["'][^"']*\bfa-/i.test(rawHtml) && /<aside\b/i.test(rawHtml)) {
      issues.push({
        rule: 'Pass 21: Suite Brand & Collapsible Sidebar Navigation Standards',
        type: 'FORBIDDEN_PRIMARY_BLUE_IN_SIDEBAR_NAV',
        message: 'Sidebar navigation item uses saturated primary blue color (e.g. bg-primary text-white). Inactive items must be muted slate (#67728a), and active items must use subtle soft lavender/purple (#f3f0ff background with #53389e text).'
      });
    }

    // Check for mobile menu hamburger button (Pass 06 & Pass 21)
    const hasMobileMenuBtn = rawHtml.includes('mobile-menu') || rawHtml.includes('data-action="menu"') || rawHtml.includes('data-action=\'menu\'');
    if (!hasMobileMenuBtn) {
      warnings.push({
        rule: 'Pass 06: Responsive Layouts & Pass 21: Sidebar Standards',
        type: 'MISSING_MOBILE_MENU_TRIGGER',
        message: 'Page has a sidebar but lacks a mobile hamburger menu button (.mobile-menu / data-action="menu") in the top header for mobile screens.'
      });
    }
  }

  // ------------------------------------------------------------------------
  // 22. RULE: Pass 22 — Domain Fidelity, Spec Alignment & Anti-Boilerplate
  // ------------------------------------------------------------------------
  const bulkBoilerplateWatermarks = [
    { regex: /Sub-200ms target SLA/i, label: 'Sub-200ms target SLA' },
    { regex: /Audit trail verified/i, label: 'Audit trail verified' },
    { regex: /Passing policy checks/i, label: 'Passing policy checks' },
    { regex: /Live SWR synchronized/i, label: 'Live SWR synchronized' },
    { regex: /Enterprise Primary Record|Enterprise Operations Record|Enterprise Compliance Record/i, label: 'Enterprise Primary/Operations/Compliance Record boilerplate' },
    { regex: />\s*METADATA\s*\/\s*CODE\s*</i, label: 'Generic METADATA / CODE table header' }
  ];
  for (const wm of bulkBoilerplateWatermarks) {
    if (wm.regex.test(rawHtml)) {
      issues.push({
        rule: 'Pass 22: Domain Fidelity & Anti-Boilerplate',
        type: 'BULK_TEMPLATE_WATERMARK_DETECTED',
        message: `Page contains bulk boilerplate generator watermark ("${wm.label}"). Every page must be uniquely designed from the SOW and target dataModel schema.`
      });
    }
  }

  if (pageSpec) {
    const devDetails = (pageSpec.developmentDetails || pageSpec.description || '').trim();
    if (devDetails.length >= 35) {
      // 22.1 Verbatim spec dump check
      const normalizedDetails = devDetails.replace(/\s+/g, ' ').trim();
      const visibleText = cleanMarkup.replace(/<[^>]+>/g, ' ').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
      if (visibleText.includes(normalizedDetails)) {
        issues.push({
          rule: 'Pass 22: Domain Fidelity & Anti-Boilerplate',
          type: 'VERBATIM_SPEC_DUMP_IN_UI',
          message: `Page dumps raw manifest developmentDetails verbatim into user-facing UI ("${normalizedDetails.slice(0, 80)}..."). Implement the described UX instead of printing the developer prompt.`
        });
      }

      // 22.2 Required custom element alignment with pageSpec
      if (/rapider-kanban/i.test(devDetails) && !/<rapider-kanban\b/i.test(rawHtml)) {
        issues.push({
          rule: 'Pass 22: Domain Fidelity & Anti-Boilerplate',
          type: 'MISSING_SPEC_KANBAN_COMPONENT',
          message: `Page specification requires "<rapider-kanban>", but <rapider-kanban> is absent from "${relativePagePath}".`
        });
      }
      if (/rapider-phone-input/i.test(devDetails) && !/<rapider-phone-input\b|RapiderPhoneInput/i.test(rawHtml)) {
        issues.push({
          rule: 'Pass 22: Domain Fidelity & Anti-Boilerplate',
          type: 'MISSING_SPEC_PHONE_COMPONENT',
          message: `Page specification requires "<rapider-phone-input>", but <rapider-phone-input> is absent from "${relativePagePath}".`
        });
      }

      // 22.3 Target DataModel alignment with pageSpec
      const domainKey = (manifest.domainKey || '').toLowerCase();
      const specNamedModels = [];
      for (const m of (manifest.dataModels || [])) {
        if (!m || !m.name) continue;
        const modelRegex = new RegExp(`\\b${m.name}\\b`);
        if (modelRegex.test(devDetails)) {
          specNamedModels.push(m.name);
        }
      }
      // Prefer models belonging to the app's own domainKey if present in specNamedModels
      const primarySpecModels = specNamedModels.filter(name => !domainKey || name.toLowerCase().startsWith(domainKey));
      const expectedModelsToCheck = primarySpecModels.length > 0 ? primarySpecModels : specNamedModels;

      if (expectedModelsToCheck.length > 0) {
        const boundModelsInPage = new Set();
        const boundRegex = /window\.rapiderApi\s*\.\s*(?:findSWR|countSWR|findById|create|update|updateById|delete|deleteById)\s*\(\s*['"`]([a-zA-Z0-9_]+)['"`]/g;
        let bm;
        while ((bm = boundRegex.exec(combinedScript)) !== null) {
          boundModelsInPage.add(bm[1]);
        }
        const matchesAnyExpected = expectedModelsToCheck.some(em => boundModelsInPage.has(em));
        if (!matchesAnyExpected) {
          issues.push({
            rule: 'Pass 22: Domain Fidelity & Anti-Boilerplate',
            type: 'SPEC_DATA_MODEL_MISMATCH',
            message: `Page specification explicitly targets [${expectedModelsToCheck.join(', ')}], but page binds [${Array.from(boundModelsInPage).join(', ') || 'NONE'}].`
          });
        }
      }
    }
  }

  // 22.4 Real Domain Schema Field Hydration Check
  const GENERIC_SYSTEM_FIELDS = new Set([
    'id', '_id', 'isDeleted', 'status', 'version', 'createdDate', 'updatedDate',
    'createdBy', 'createdById', 'updatedBy', 'projectId', 'tenantId'
  ]);
  const boundReadWriteModels = new Set();
  const rwRegex = /window\.rapiderApi\s*\.\s*(?:findSWR|findById|create|update|updateById)\s*\(\s*['"`]([a-zA-Z0-9_]+)['"`]/g;
  let rwm;
  while ((rwm = rwRegex.exec(combinedScript)) !== null) {
    boundReadWriteModels.add(rwm[1]);
  }
  if (boundReadWriteModels.size > 0 && Array.isArray(manifest.dataModels)) {
    let maxDomainFieldsMatched = 0;
    let checkedModelWithEnoughFields = false;
    for (const modelName of boundReadWriteModels) {
      const modelDef = manifest.dataModels.find(m => m.name === modelName);
      if (!modelDef || !Array.isArray(modelDef.fields)) continue;
      const domainFields = modelDef.fields
        .map(f => f.name)
        .filter(fn => fn && !GENERIC_SYSTEM_FIELDS.has(fn));
      if (domainFields.length >= 3) {
        checkedModelWithEnoughFields = true;
        let matched = 0;
        for (const fn of domainFields) {
          if (new RegExp(`\\b${fn}\\b`).test(rawHtml)) matched++;
        }
        if (matched > maxDomainFieldsMatched) maxDomainFieldsMatched = matched;
      }
    }
    if (checkedModelWithEnoughFields && maxDomainFieldsMatched < 3) {
      issues.push({
        rule: 'Pass 22: Domain Fidelity & Anti-Boilerplate',
        type: 'INSUFFICIENT_DOMAIN_FIELD_HYDRATION',
        message: `Page binds [${Array.from(boundReadWriteModels).join(', ')}] but references only ${maxDomainFieldsMatched} domain-specific schema fields (minimum 3 required). Render real model attributes instead of generic placeholder fields.`
      });
    }
  }

  // Record structural fingerprint for cross-page anti-clone verification
  const thHeaders = Array.from(cleanMarkup.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi))
    .map(m => m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().toLowerCase())
    .filter(Boolean);
  metrics.thSignature = thHeaders.join('|');

  return {
    pagePath: relativePagePath,
    passed: issues.length === 0,
    issuesCount: issues.length,
    warningsCount: warnings.length,
    issues,
    warnings,
    metrics
  };
}

/**
 * Audits an entire application across all its webPages (or a single targetRoute when building one-by-one).
 */
function auditMicroapp(appDir, options = {}) {
  const resolvedAppDir = path.resolve(appDir);
  const manifestPath = path.join(resolvedAppDir, 'app.manifest.json');
  const targetRoute = options.targetRoute || null;

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found at ${manifestPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const allPages = manifest.webPages || manifest.pages || [];
  const pages = targetRoute
    ? allPages.filter(p => p.route === targetRoute)
    : allPages;

  if (targetRoute && pages.length === 0) {
    throw new Error(`Target route "${targetRoute}" is not defined in app.manifest.json webPages.`);
  }

  const results = {
    appName: manifest.name || path.basename(resolvedAppDir),
    appKey: manifest.key || '',
    appDir: resolvedAppDir,
    targetRoute,
    timestamp: new Date().toISOString(),
    totalPages: allPages.length,
    pagesAudited: 0,
    pagesPassed: 0,
    pagesFailed: 0,
    totalIssues: 0,
    totalWarnings: 0,
    pageResults: [],
    manifestChecks: []
  };

  // 1. Audit manifest registered pages (or single targetRoute)
  for (const p of pages) {
    const filePath = p.htmlFilePath || `pages/${p.route}/${p.route}.html`;
    const fullPath = path.join(resolvedAppDir, filePath);

    const pageAudit = auditHtmlPage(fullPath, resolvedAppDir, manifest, p);
    pageAudit.route = p.route;
    pageAudit.pageName = p.name;

    results.pagesAudited++;
    if (pageAudit.passed) {
      results.pagesPassed++;
    } else {
      results.pagesFailed++;
    }

    results.totalIssues += pageAudit.issuesCount;
    results.totalWarnings += pageAudit.warningsCount;
    results.pageResults.push(pageAudit);
  }

  // 1b. Cross-page anti-clone check across all currently built pages on disk
  const builtTableSignatures = new Map();
  for (const p of allPages) {
    if (p.displayInMenu === false || p.displayOnMenu === false) continue;
    const fp = path.join(resolvedAppDir, p.htmlFilePath || `pages/${p.route}/${p.route}.html`);
    if (!fs.existsSync(fp)) continue;
    const raw = fs.readFileSync(fp, 'utf8');
    const clean = raw.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
    const ths = Array.from(clean.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi))
      .map(m => m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().toLowerCase())
      .filter(Boolean);
    if (ths.length >= 4) {
      const sig = ths.join('|');
      if (builtTableSignatures.has(sig)) {
        const otherRoute = builtTableSignatures.get(sig);
        if (!targetRoute || targetRoute === p.route || targetRoute === otherRoute) {
          results.manifestChecks.push({
            rule: 'Pass 22: Domain Fidelity & Anti-Clone',
            type: 'CROSS_PAGE_TABLE_CLONE_DETECTED',
            message: `Routes "${otherRoute}" and "${p.route}" share identical 4+ column table headers ("${sig}"). Each page must implement its distinct domain layout and entity columns.`
          });
        }
      } else {
        builtTableSignatures.set(sig, p.route);
      }
    }
  }

  // 2. Cross-check disk pages against manifest
  const pagesFolder = path.join(resolvedAppDir, 'pages');
  if (fs.existsSync(pagesFolder)) {
    const subdirs = fs.readdirSync(pagesFolder, { withFileTypes: true });
    for (const sub of subdirs) {
      if (sub.isDirectory() && sub.name !== 'assets') {
        const expectedHtml = path.join(pagesFolder, sub.name, `${sub.name}.html`);
        const isRegistered = allPages.some(p => p.route === sub.name || (p.htmlFilePath && p.htmlFilePath.includes(sub.name)));
        if (!isRegistered && fs.existsSync(expectedHtml)) {
          results.manifestChecks.push({
            rule: 'Pass 13: Manifest Sync',
            type: 'UNREGISTERED_DISK_PAGE',
            message: `Page exists on disk at "pages/${sub.name}/${sub.name}.html" but is not registered in app.manifest.json webPages.`
          });
        }
      }
    }
  }

  // 3. Check for micro-header clutter in webPages (Pass 13: count >= 3 rule)
  const sectionGroups = new Map();
  for (const p of allPages) {
    const groupTitle = (p.sectionTitle || p.group || p.section || '').trim();
    if (groupTitle && p.displayOnMenu !== false && p.displayInMenu !== false) {
      const list = sectionGroups.get(groupTitle) || [];
      list.push(p.route || p.name);
      sectionGroups.set(groupTitle, list);
    }
  }
  for (const [title, items] of sectionGroups.entries()) {
    if (items.length < 3) {
      results.manifestChecks.push({
        rule: 'Pass 13: Manifest Sync (Sidebar Grouping)',
        type: 'MANIFEST_MICRO_HEADER_CLUTTER',
        message: `Sidebar section title "${title}" groups only ${items.length} item(s) ([${items.join(', ')}]). Section titles MUST group at least 3 menu items (count >= 3). Consolidate into a broader section title or leave title empty for flat menu items.`
      });
    }
  }

  // 4. Check manifest status invariant (Pass 13: status must be at least "app-metadata-completed")
  const validCompletedStatuses = ['app-metadata-completed', 'pages_implemented', 'qa_passed', 'completed'];
  const manifestStatus = (manifest.status || '').trim();
  if (manifestStatus && !validCompletedStatuses.includes(manifestStatus)) {
    results.manifestChecks.push({
      rule: 'Pass 13: Manifest Sync (Status Invariant)',
      type: 'MANIFEST_IN_PROGRESS_STATUS_VIOLATION',
      message: `app.manifest.json has status "${manifestStatus}". When building app pages, manifest status MUST be at least "app-metadata-completed" (or "pages_implemented", "qa_passed", "completed"). Leaving status as "${manifestStatus}" causes Rapider UI to display the unfinished App Builder wizard instead of the live application.`
    });
  }

  results.is100PercentCompliant = results.totalIssues === 0 && results.manifestChecks.length === 0;
  return results;
}

/**
 * Format audit results as human-readable Markdown
 */
function formatAuditMarkdown(results) {
  let md = `# Deterministic QA Audit Report: ${results.appName}\n\n`;
  md += `**Execution Time:** ${results.timestamp}  \n`;
  md += `**Overall Compliance:** ${results.is100PercentCompliant ? '✅ 100% PASS' : '❌ ISSUES DETECTED'}  \n`;
  md += `**Pages Evaluated:** ${results.pagesAudited} (${results.pagesPassed} Passed, ${results.pagesFailed} Failed)  \n`;
  md += `**Total Strict Issues:** ${results.totalIssues}  \n`;
  md += `**Total Warnings:** ${results.totalWarnings}  \n\n`;

  md += `## Page Results Summary\n\n`;
  md += `| Route | Page Name | Status | Issues | Warnings | Buttons Wired |\n`;
  md += `|---|---|:---:|:---:|:---:|:---:|\n`;

  for (const pr of results.pageResults) {
    const statusBadge = pr.passed ? '✅ Pass' : '❌ Fail';
    const wiredRatio = `${pr.metrics.buttonsWithActions} / ${pr.metrics.buttonsTotal}`;
    md += `| \`${pr.route}\` | ${pr.pageName} | ${statusBadge} | ${pr.issuesCount} | ${pr.warningsCount} | ${wiredRatio} |\n`;
  }

  if (results.totalIssues > 0 || results.manifestChecks.length > 0) {
    md += `\n## Detailed Strict Issues (Action Required)\n\n`;
    for (const pr of results.pageResults) {
      if (pr.issues.length > 0) {
        md += `### \`${pr.route}\` (${pr.pagePath})\n\n`;
        for (const issue of pr.issues) {
          md += `- **[${issue.rule}] ${issue.type}:** ${issue.message}\n`;
          if (issue.snippet) md += `  \`\`\`html\n  ${issue.snippet}\n  \`\`\`\n`;
        }
        md += '\n';
      }
    }
    for (const mc of results.manifestChecks) {
      md += `- **[${mc.rule}] ${mc.type}:** ${mc.message}\n`;
    }
  }

  return md;
}

module.exports = {
  auditHtmlPage,
  auditMicroapp,
  formatAuditMarkdown
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const routeArg = args.find(a => a.startsWith('--route='));
  const targetRoute = routeArg ? routeArg.split('=')[1] : null;
  const positional = args.filter(a => !a.startsWith('--'));
  const targetDir = positional[0] ? path.resolve(positional[0]) : process.cwd();
  console.log(`Running deterministic QA auditor on: ${targetDir}${targetRoute ? ` (route: ${targetRoute})` : ''}`);
  try {
    const audit = auditMicroapp(targetDir, { targetRoute });
    console.log(formatAuditMarkdown(audit));
    process.exit(audit.is100PercentCompliant ? 0 : 1);
  } catch (e) {
    console.error(`Audit execution failed:`, e.message);
    process.exit(1);
  }
}
