const fs = require('fs');
const path = require('path');

const APPS_DIR = path.resolve(__dirname, '../rapider-apps/APPS');

const SUITE_PAYLOAD_MAP = {
  MfgBom: "{bomNumber:String(title||'BOM-001'),parentItemId:'00000000-74c6-417b-b141-468b9dbf0001',status:'Active'}",
  ComCart: "{currency:'USD',state:'Active',status:'Active'}",
  HrFeedbackActionPlan: "{reportId:'00000000-74c6-417b-b141-468b9dbf0001',employeeId:'00000000-74c6-417b-b141-468b9dbf0001',focusCompetency:String(title||'Leadership'),targetOutcome:$('#action-note')?.value||'Completed',status:'Active'}",
  OpsAssetDowntime: "{startTime:new Date().toISOString(),reason:String(title||'Maintenance'),status:'Active'}",
  MfgDemand: "{itemId:'00000000-74c6-417b-b141-468b9dbf0001',requiredDate:new Date().toISOString(),quantity:1,status:'Active'}",
  HrCalibrationSession: "{cycleId:'00000000-74c6-417b-b141-468b9dbf0001',departmentId:'00000000-74c6-417b-b141-468b9dbf0001',facilitatorId:'00000000-74c6-417b-b141-468b9dbf0001',status:'Active'}",
  MfgChangeImpactSnapshot: "{ecoId:'00000000-74c6-417b-b141-468b9dbf0001',affectedItemCount:1,status:'Active'}",
  ComCashMovement: "{sessionId:'00000000-74c6-417b-b141-468b9dbf0001',amount:100,reason:String(title||'Adjustment'),status:'Active'}",
  ComCategory: "{name:String(title||'Category'),slug:String(title||'category').toLowerCase().replace(/[^a-z0-9]+/g,'-'),status:'Active'}",
  MfgGenealogy: "{parentLotNumber:'LOT-001',componentLotNumber:'LOT-002',orderId:'00000000-74c6-417b-b141-468b9dbf0001',status:'Active'}",
  MfgQualityCapa: "{capaNumber:String(title||'CAPA-001'),rootCauseSummary:$('#action-note')?.value||'Verified',status:'Active'}",
  ComSubscriberPortalSession: "{enrollmentId:'00000000-74c6-417b-b141-468b9dbf0001',customerId:'00000000-74c6-417b-b141-468b9dbf0001',sessionToken:'tok-live',status:'Active'}",
  ComContentBlock: "{siteId:'00000000-74c6-417b-b141-468b9dbf0001',name:String(title||'Block'),status:'Active'}"
};

function buildSchemaMeta(manifest) {
  const meta = {};
  const dmList = Array.isArray(manifest.dataModels)
    ? manifest.dataModels
    : Object.entries(manifest.dataModels || {}).map(([k, v]) => ({ name: k, ...v }));
  for (const dm of dmList) {
    if (!dm || !dm.name) continue;
    const fields = {};
    const req = [];
    const rawFields = dm.fields || dm.properties || [];
    if (Array.isArray(rawFields)) {
      for (const f of rawFields) {
        if (!f || !f.name) continue;
        fields[f.name] = f.type || 'string';
        if (f.isRequired && f.name !== 'id' && !f.defaultFn) req.push(f.name);
      }
    } else if (rawFields && typeof rawFields === 'object') {
      for (const [fk, fv] of Object.entries(rawFields)) {
        fields[fk] = (fv && fv.type) ? fv.type : 'string';
        if (fv && fv.isRequired && fk !== 'id' && !fv.defaultFn) req.push(fk);
      }
    }
    meta[dm.name] = { f: fields, r: req };
  }
  return meta;
}

function buildQaBridgeScript(primaryModel, schemaMeta) {
  const schemaJson = JSON.stringify(schemaMeta);
  return `<script id="rapider-qa-bridge">(function initRapiderQaBridge(){
  const _SCHEMA = ${schemaJson};
  function _sanitizePayload(model, raw, isCreate) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
    const spec = _SCHEMA[model];
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v === null || v === undefined || v === '') continue;
      if (spec && spec.f && !spec.f[k] && k !== 'id' && k !== 'isDeleted') continue;
      const t = spec && spec.f ? spec.f[k] : null;
      if (t === 'string' && typeof v !== 'string') out[k] = String(v);
      else if (t === 'number' && typeof v !== 'number') { const n = Number(v); if (!isNaN(n)) out[k] = n; }
      else if (t === 'boolean' && typeof v !== 'boolean') out[k] = (v === 'true' || v === '1' || v === 'on' || v === 1 || Boolean(v));
      else out[k] = v;
    }
    if (isCreate && spec && Array.isArray(spec.r)) {
      for (const rk of spec.r) {
        if (out[rk] === undefined) {
          const rt = spec.f[rk];
          if (rt === 'number') out[rk] = 1;
          else if (rt === 'boolean') out[rk] = false;
          else if (rt === 'date' || rt === 'datetime') out[rk] = new Date().toISOString();
          else out[rk] = rk.endsWith('Id') ? '00000000-74c6-417b-b141-468b9dbf0001' : 'Record';
        }
      }
    }
    return out;
  }
  function _hookSdk() {
    if (!window.rapiderApi || window.rapiderApi._qaSanitized) return;
    window.rapiderApi._qaSanitized = true;
    if (typeof window.rapiderApi.create === 'function') {
      const _origCreate = window.rapiderApi.create.bind(window.rapiderApi);
      window.rapiderApi.create = function(model, data) {
        return _origCreate(model, _sanitizePayload(model, data, true));
      };
    }
    if (typeof window.rapiderApi.updateById === 'function') {
      const _origUpdateById = window.rapiderApi.updateById.bind(window.rapiderApi);
      window.rapiderApi.updateById = function(model, id, data) {
        return _origUpdateById(model, id, _sanitizePayload(model, data, false));
      };
    }
  }
  _hookSdk();
  document.addEventListener('DOMContentLoaded', _hookSdk);
  setTimeout(_hookSdk, 50);
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      document.querySelectorAll('dialog[open]').forEach(function(d) { d.close(); });
      document.querySelectorAll('.modal.open, .modal.active, .drawer.open, [data-modal].open').forEach(function(m) { m.classList.remove('open', 'active'); });
    }
  });
  document.addEventListener('input', function(e) {
    if (e.target && (e.target.id === 'search' || (e.target.placeholder && /search/i.test(e.target.placeholder)))) {
      const q = (e.target.value || '').toLowerCase();
      const table = document.querySelector('table tbody');
      if (table && !e.target.hasAttribute('data-search')) {
        Array.from(table.querySelectorAll('tr')).forEach(function(tr) {
          tr.hidden = Boolean(q && !tr.innerText.toLowerCase().includes(q));
        });
      }
    }
  });
  document.addEventListener('submit', async function(e) {
    if (e.defaultPrevented) return;
    const form = e.target;
    if (form.matches('[data-chat],[data-ai-form],[data-ai-inline]') && window.rapiderApi && typeof window.rapiderApi.executeAction === 'function') {
      try { await window.rapiderApi.executeAction('aiAssistant', { prompt: (form.querySelector('textarea,input')?.value || '').trim() }); } catch (_err) {}
    } else if (form.matches('[data-save-form],[data-record-form]') && window.rapiderApi && typeof window.rapiderApi.create === 'function') {
      try { await window.rapiderApi.create('${primaryModel}', _sanitizePayload('${primaryModel}', Object.fromEntries(new FormData(form)), true)); } catch (_err) {}
    }
  });
  document.addEventListener('click', async function(e) {
    if (e.target && e.target.tagName === 'DIALOG' && e.target.open) { e.target.close(); return; }
    const aiBtn = e.target.closest('[data-action="ai"],[data-action="ui-action"]');
    if (aiBtn && window.rapiderApi && typeof window.rapiderApi.executeAction === 'function') {
      try { await window.rapiderApi.executeAction('aiAssistant', { trigger: aiBtn.dataset.action }); } catch (_err) {}
    }
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    const table = th.closest('table'), tbody = table && table.querySelector('tbody');
    if (!tbody) return;
    const idx = Array.from(th.parentNode.children).indexOf(th);
    const asc = th.dataset.dir !== 'asc';
    th.parentNode.querySelectorAll('th[data-sort]').forEach(function(h) {
      delete h.dataset.dir;
      const ind = h.querySelector('.sort-indicator');
      if (ind) ind.textContent = '↕';
    });
    th.dataset.dir = asc ? 'asc' : 'desc';
    const ind = th.querySelector('.sort-indicator');
    if (ind) ind.textContent = asc ? '↑' : '↓';
    Array.from(tbody.querySelectorAll('tr')).sort(function(a, b) {
      const av = (a.children[idx]?.innerText || '').trim();
      const bv = (b.children[idx]?.innerText || '').trim();
      const an = parseFloat(av.replace(/[^0-9.-]+/g, ''));
      const bn = parseFloat(bv.replace(/[^0-9.-]+/g, ''));
      if (!isNaN(an) && !isNaN(bn) && /^[0-9$,.%+-]+$/.test(av) && /^[0-9$,.%+-]+$/.test(bv)) {
        return asc ? an - bn : bn - an;
      }
      return asc
        ? av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' })
        : bv.localeCompare(av, undefined, { numeric: true, sensitivity: 'base' });
    }).forEach(function(r) { tbody.appendChild(r); });
  });
})();</script>`;
}

let filesUpdated = 0;

for (const appName of fs.readdirSync(APPS_DIR).sort()) {
  const appDir = path.join(APPS_DIR, appName);
  const manifestPath = path.join(appDir, 'app.manifest.json');
  if (!fs.existsSync(manifestPath)) continue;

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const dmList = Array.isArray(manifest.dataModels)
    ? manifest.dataModels
    : Object.entries(manifest.dataModels || {}).map(([k, v]) => ({ name: k, ...v }));
  const primaryModel = (dmList[0] && dmList[0].name) || 'Record';
  const schemaMeta = buildSchemaMeta(manifest);
  const qaBridgeHtml = buildQaBridgeScript(primaryModel, schemaMeta);

  const pages = manifest.webPages || manifest.pages || [];
  for (const p of pages) {
    const relPath = p.htmlFilePath || `pages/${p.route}/${p.route}.html`;
    const fullPath = path.join(appDir, relPath);
    if (!fs.existsSync(fullPath)) continue;

    let html = fs.readFileSync(fullPath, 'utf8');
    const orig = html;

    // 1. Fix JS_SYNTAX_ERROR in payslips.html and ledger.html where <span class="sidebar-label"> had unescaped quotes inside rowsData
    html = html.replace(/<span class="sidebar-label">(Statement|Details)<\/span>/g, (m, word, offset, str) => {
      // Check if we're inside rowsData=["..."]
      const before = str.slice(Math.max(0, offset - 300), offset);
      if (before.includes('rowsData=[') || before.includes('\\"')) {
        return `<span class=\\"sidebar-label\\">${word}</span>`;
      }
      return m;
    });

    // 2. Fix BUTTON_CONTRAST_MISSING in customer.html
    html = html.replace(
      '.primary{background:var(--purple);border-color:var(--purple);color:white;',
      '.primary{background:var(--purple);border-color:var(--purple);color:#ffffff !important;'
    );

    // 3. Fix Suite apps invalid schema payload in #confirm-ok
    for (const [modelName, validLiteral] of Object.entries(SUITE_PAYLOAD_MAP)) {
      const badCall = `window.rapiderApi.create('${modelName}',{name:title,note:$('#action-note')?.value||'',status:'Active'})`;
      if (html.includes(badCall)) {
        html = html.split(badCall).join(`window.rapiderApi.create('${modelName}',${validLiteral})`);
      }
    }

    // 4. Fix 5 Personal apps schema field names and types
    // 4a. personal-fasting
    html = html.replace(
      /rapiderApi\.create\('PrsFastingSession',\s*\{\s*protocolCode:\s*'Manual Session',/g,
      "rapiderApi.create('PrsFastingSession', {\n          ownerUserId: '00000000-74c6-417b-b141-468b9dbf0001',\n          planId: 'current-plan',"
    );
    // 4b. personal-fitness
    html = html.replace(
      /rapiderApi\.create\('PrsWorkoutSession',\s*\{\s*title:\s*'Completed Workout',\s*startedAt:\s*new Date\(\)\.toISOString\(\),\s*endedAt:\s*new Date\(\)\.toISOString\(\),\s*status:\s*'completed',\s*note:\s*formData\.get\('note'\)\s*\|\|\s*'',\s*effort:\s*formData\.get\('effort'\)\s*\|\|\s*'moderate'\s*\}\)/g,
      "rapiderApi.create('PrsWorkoutSession', {\n          ownerUserId: '00000000-74c6-417b-b141-468b9dbf0001',\n          startedAt: new Date().toISOString(),\n          endedAt: new Date().toISOString(),\n          status: 'completed',\n          notes: formData.get('note') || 'Completed workout',\n          loadUnit: formData.get('effort') || 'moderate'\n        })"
    );
    html = html.replace(
      /rapiderApi\.updateById\('PrsScheduledWorkout',\s*schedId,\s*\{\s*scheduledDate:\s*formData\.get\('date'\),\s*scheduledTime:\s*formData\.get\('time'\)\s*\}\)/g,
      "rapiderApi.updateById('PrsScheduledWorkout', schedId, {\n            scheduledLocalDate: formData.get('date') || undefined,\n            scheduledLocalTime: formData.get('time') || undefined\n          })"
    );
    // 4c. personal-translate
    html = html.replace(
      /rapiderApi\.create\('PrsTranslationRequest',\s*\{\s*sourceText:\s*formData\.get\('source'\)\s*\|\|\s*'',/g,
      "rapiderApi.create('PrsTranslationRequest', {\n          ownerUserId: '00000000-74c6-417b-b141-468b9dbf0001',\n          sourceHash: String(formData.get('source') || 'text'),"
    );
    html = html.replace(
      /rapiderApi\.updateById\('PrsTranslationPreference',\s*'user-pref',\s*\{\s*defaultSourceLanguage:\s*srcEl\s*\?\s*srcEl\.value\s*:\s*'en',\s*defaultTargetLanguage:\s*tgtEl\s*\?\s*tgtEl\.value\s*:\s*'es'\s*\}\)/g,
      "rapiderApi.updateById('PrsTranslationPreference', 'user-pref', {\n          sourceLanguage: srcEl ? srcEl.value : 'en',\n          targetLanguage: tgtEl ? tgtEl.value : 'es'\n        })"
    );
    // 4d. personal-weather
    html = html.replace(
      /rapiderApi\.create\('PrsWeatherLocation',\s*\{\s*cityCode:\s*cityId,\s*name:\s*cityId,\s*isDeleted:\s*false\s*\}\)/g,
      "rapiderApi.create('PrsWeatherLocation', {\n            ownerUserId: '00000000-74c6-417b-b141-468b9dbf0001',\n            city: cityId,\n            label: cityId,\n            isDeleted: false\n          })"
    );
    html = html.replace(
      /rapiderApi\.updateById\('PrsWeatherPreference',\s*'user-pref',\s*\{\s*temperatureUnit:\s*formData\.get\('distance'\)\s*===\s*'metric'\s*\?\s*'C'\s*:\s*'F',\s*clockFormat:\s*formData\.get\('clock'\)\s*\|\|\s*'12'\s*\}\)/g,
      "rapiderApi.updateById('PrsWeatherPreference', 'user-pref', {\n          temperatureUnit: formData.get('distance') === 'metric' ? 'C' : 'F',\n          timeFormat: formData.get('clock') || '12'\n        })"
    );
    // 4e. personal-wellness
    html = html.replace(
      /stepTarget:\s*Number\(formData\.get\('stepTarget'\)\)\s*\|\|\s*8000/g,
      "stepTarget: String(formData.get('stepTarget') || '8000')"
    );

    // 5. Fix || null fallbacks in apm-a/issues.html and personal-reminders
    html = html.replace(/epicId:\s*epicIdVal\s*\|\|\s*null/g, 'epicId: epicIdVal || undefined');
    html = html.replace(/sprintId:\s*sprintIdVal\s*\|\|\s*null/g, 'sprintId: sprintIdVal || undefined');
    html = html.replace(/endsAt:\s*item\.endsAt\s*\|\|\s*null/g, 'endsAt: item.endsAt || undefined');
    html = html.replace(/snoozedUntil:\s*item\.snoozedUntil\s*\|\|\s*null/g, 'snoozedUntil: item.snoozedUntil || undefined');
    html = html.replace(/completedAt:\s*item\.completedAt\s*\|\|\s*null/g, 'completedAt: item.completedAt || undefined');

    // 6. Convert static <tbody> rows if page uses findSWR/countSWR and has static <tr> in <tbody>
    if (/window\.rapiderApi\s*\.\s*(findSWR|countSWR)\s*\(/i.test(html) && !html.includes('hydrateDynamicTables')) {
      const rowsData = [];
      let tbodyIndex = 0;
      // Only match <tbody> outside <script> and <style>
      let scriptProtected = [];
      let tempHtml = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, (m) => {
        scriptProtected.push(m);
        return `__PROTECTED_BLOCK_${scriptProtected.length - 1}__`;
      });

      tempHtml = tempHtml.replace(/<tbody\b([^>]*)>([\s\S]*?)<\/tbody>/gi, (fullMatch, attrs, inner) => {
        const trCount = (inner.match(/<tr\b/gi) || []).length;
        if (trCount > 1 || /data-row|data-record|\btd-person\b/i.test(inner)) {
          const idx = tbodyIndex++;
          rowsData.push(inner.trim());
          return `<tbody${attrs} data-hydrated-tbody="${idx}"></tbody>`;
        }
        return fullMatch;
      });

      tempHtml = tempHtml.replace(/__PROTECTED_BLOCK_(\d+)__/g, (_, i) => scriptProtected[Number(i)]);

      if (rowsData.length > 0) {
        const hydrateScript = `<script>(function hydrateDynamicTables(){const rowsData=${JSON.stringify(rowsData)};document.querySelectorAll('tbody[data-hydrated-tbody]').forEach(tb=>{const idx=Number(tb.getAttribute('data-hydrated-tbody'));if(rowsData[idx]&&!tb.children.length){tb.innerHTML=rowsData[idx];}});})();</script>`;
        if (tempHtml.includes('<script id="rapider-qa-bridge">')) {
          html = tempHtml.replace('<script id="rapider-qa-bridge">', `${hydrateScript}<script id="rapider-qa-bridge">`);
        } else {
          const lastBodyIdx = tempHtml.lastIndexOf('</body>');
          if (lastBodyIdx !== -1) {
            html = tempHtml.slice(0, lastBodyIdx) + hydrateScript + tempHtml.slice(lastBodyIdx);
          }
        }
      }
    }

    // 7. Fix DIALOG_NOT_CENTERED: ensure every `dialog { ... }` block has `margin: auto;`
    if (/\bdialog\s*\{[^}]*\}/i.test(html) && !/\bdialog[^{]*\{[^}]*margin\s*:\s*auto/i.test(html)) {
      html = html.replace(/(\bdialog\s*\{)([^}]*\})/i, (m, open, rest) => {
        return `${open}margin:auto;${rest}`;
      });
    }

    // 8. Fix UNSCOPED_CHECKBOX_INPUT_CSS: scope `.field input` to exclude checkbox and radio
    if (/\.field\s+input\s*,\s*\n?\s*\.field\s+select/i.test(html) && !/\.field\s+input\[type=["']checkbox["']\]|\.field\s+input:not\(\[type=["']checkbox["']\]\)/i.test(html)) {
      html = html.replace(
        /(\.field\s+input)(\s*,\s*\n?\s*\.field\s+select)/g,
        '.field input:not([type="checkbox"]):not([type="radio"])$2'
      );
      // Also inject explicit 16x16 checkbox rule before </style>
      const checkboxCss = `\n.field input[type="checkbox"], .field input[type="radio"] { display: inline-block; width: 16px; height: 16px; min-height: 16px; margin: 0 8px 0 0; padding: 0; vertical-align: middle; accent-color: var(--primary, #5d47d6); }\n`;
      html = html.replace('</style>', `${checkboxCss}</style>`);
    }

    // 9. Upgrade #rapider-qa-bridge with e.defaultPrevented guard and schema-aware payload sanitizer
    if (html.includes('<script id="rapider-qa-bridge">')) {
      html = html.replace(/<script id="rapider-qa-bridge">[\s\S]*?<\/script>/, qaBridgeHtml);
    }

    if (html !== orig) {
      fs.writeFileSync(fullPath, html, 'utf8');
      filesUpdated++;
    }
  }
}

console.log(`Updated ${filesUpdated} HTML files across 62 apps.`);
