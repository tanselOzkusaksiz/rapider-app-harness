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
function auditHtmlPage(pagePath, appDir, manifest) {
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
        if (new RegExp(`['"\`.]${cls}['"\`]`, 'i').test(combinedScript)) {
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
 * Audits an entire application across all its webPages.
 */
function auditMicroapp(appDir) {
  const resolvedAppDir = path.resolve(appDir);
  const manifestPath = path.join(resolvedAppDir, 'app.manifest.json');

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found at ${manifestPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const pages = manifest.webPages || manifest.pages || [];

  const results = {
    appName: manifest.name || path.basename(resolvedAppDir),
    appKey: manifest.key || '',
    appDir: resolvedAppDir,
    timestamp: new Date().toISOString(),
    totalPages: pages.length,
    pagesAudited: 0,
    pagesPassed: 0,
    pagesFailed: 0,
    totalIssues: 0,
    totalWarnings: 0,
    pageResults: [],
    manifestChecks: []
  };

  // 1. Audit manifest registered pages
  for (const p of pages) {
    const filePath = p.htmlFilePath || `pages/${p.route}/${p.route}.html`;
    const fullPath = path.join(resolvedAppDir, filePath);

    const pageAudit = auditHtmlPage(fullPath, resolvedAppDir, manifest);
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

  // 2. Cross-check disk pages against manifest
  const pagesFolder = path.join(resolvedAppDir, 'pages');
  if (fs.existsSync(pagesFolder)) {
    const subdirs = fs.readdirSync(pagesFolder, { withFileTypes: true });
    for (const sub of subdirs) {
      if (sub.isDirectory() && sub.name !== 'assets') {
        const expectedHtml = path.join(pagesFolder, sub.name, `${sub.name}.html`);
        const isRegistered = pages.some(p => p.route === sub.name || (p.htmlFilePath && p.htmlFilePath.includes(sub.name)));
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
  const targetDir = args[0] ? path.resolve(args[0]) : process.cwd();
  console.log(`Running deterministic QA auditor on: ${targetDir}`);
  try {
    const audit = auditMicroapp(targetDir);
    console.log(formatAuditMarkdown(audit));
    process.exit(audit.is100PercentCompliant ? 0 : 1);
  } catch (e) {
    console.error(`Audit execution failed:`, e.message);
    process.exit(1);
  }
}
