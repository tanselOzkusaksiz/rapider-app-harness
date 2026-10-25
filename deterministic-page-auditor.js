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

    // Relative HTML link check
    if (href && !href.startsWith('http') && !href.startsWith('#') && !href.startsWith('mailto') && !href.startsWith('tel')) {
      const cleanHref = href.split('?')[0].split('#')[0];
      const targetInRoot = path.join(appDir, cleanHref);
      const targetInPages = path.join(appDir, 'pages', cleanHref);
      if (!fs.existsSync(targetInRoot) && !fs.existsSync(targetInPages)) {
        issues.push({
          rule: 'Pass 01: Routing & Events',
          type: 'BROKEN_LINK_TARGET',
          message: `Link "${linkText}" points to non-existent file: "${cleanHref}".`,
          snippet: `<a href="${href}">`
        });
        continue;
      }
    }

    // Hash route check
    if (href && href.startsWith('#/')) {
      const routeKey = href.substring(2).split('?')[0];
      if (manifestRoutes.size > 0 && !manifestRoutes.has(routeKey)) {
        warnings.push({
          rule: 'Pass 01: Routing & Events',
          type: 'UNREGISTERED_HASH_ROUTE',
          message: `Link "${linkText}" points to hash route "#/${routeKey}" which is not defined in manifest webPages.`
        });
      }
    }

    metrics.linksValid++;
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

    // Model name validation
    if (manifestDataModels.size > 0 && !manifestDataModels.has(modelName)) {
      warnings.push({
        rule: 'Pass 03: Data Model & UI Compatibility',
        type: 'UNKNOWN_SDK_DATA_MODEL',
        message: `SDK call references model "${modelName}" which is not defined in app.manifest.json dataModels.`
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
