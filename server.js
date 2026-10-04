const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');

// --- CLI ARGUMENTS & CONFIG ---
const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : fallback;
};

const PORT = parseInt(process.env.PORT || getArg('port', '3300'), 10);
const DEFAULT_BACKEND = process.env.BACKEND_URL || getArg('backend', 'http://localhost:8081');
const DEFAULT_APP_DIR = path.resolve(
  __dirname,
  getArg('app', '../rapider-apps/rapider-app-crm-sys-comprehensive-crm-system')
);
const RAPIDER_APPS_ROOT = path.resolve(__dirname, '../rapider-apps');

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static files for harness UI
app.use(express.static(path.join(__dirname, 'public')));

// Static files for the currently loaded app (so /assets/... resolves to the app's assets folder)
app.use((req, res, next) => {
  let appPath = DEFAULT_APP_DIR;
  try {
    const referer = req.get('Referer');
    if (referer) {
      // The iframe loads from /api/page-content?appPath=...
      const refererUrl = new URL(referer);
      if (refererUrl.searchParams.has('appPath')) {
        appPath = path.resolve(refererUrl.searchParams.get('appPath'));
      }
    }
  } catch (e) {
    // Ignore invalid referer parsing
  }

  // 1. Check exact requested path (e.g., appPath + /assets/js/...)
  const targetPath = path.join(appPath, req.path);
  if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
    return res.sendFile(targetPath);
  }

  // 2. Fallback: if it's an /assets/ request but the file is actually at the app root 
  // (happens because of the <base href="/assets/"> tag injected by the harness)
  if (req.path.startsWith('/assets/')) {
    const rootTargetPath = path.join(appPath, req.path.substring(7)); // remove '/assets'
    if (fs.existsSync(rootTargetPath) && fs.statSync(rootTargetPath).isFile()) {
      return res.sendFile(rootTargetPath);
    }
  }

  next();
});

// Cache theme CSS in memory
let cachedThemeCss = '';
const themeCssPath = path.join(__dirname, 'public/assets/themes/rapider-tailwind-theme.css');
if (fs.existsSync(themeCssPath)) {
  cachedThemeCss = fs.readFileSync(themeCssPath, 'utf8');
}

/**
 * Scan ../rapider-apps to discover all available applications
 */
app.get('/api/apps', (req, res) => {
  try {
    const apps = [];
    if (fs.existsSync(RAPIDER_APPS_ROOT)) {
      const entries = fs.readdirSync(RAPIDER_APPS_ROOT, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          const appDir = path.join(RAPIDER_APPS_ROOT, entry.name);
          const manifestPath = path.join(appDir, 'app.manifest.json');
          if (fs.existsSync(manifestPath)) {
            try {
              const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
              apps.push({
                folderName: entry.name,
                absolutePath: appDir,
                name: manifest.name || entry.name,
                key: manifest.key || entry.name,
                description: manifest.description || '',
                iconUrl: manifest.iconUrl || manifest.icon || 'fas fa-cubes',
                tags: manifest.tags || [],
                webPagesCount: (manifest.webPages || manifest.uiPageImplementationPlan || manifest.pages || []).length
              });
            } catch (err) {
              // Manifest parse error - still include folder
              apps.push({
                folderName: entry.name,
                absolutePath: appDir,
                name: entry.name,
                key: entry.name,
                description: 'Invalid manifest',
                iconUrl: 'fas fa-exclamation-triangle',
                tags: []
              });
            }
          }
        }
      }
    }
    res.json({ apps, defaultAppDir: DEFAULT_APP_DIR, defaultBackend: DEFAULT_BACKEND });
  } catch (error) {
    console.error('Error scanning apps:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Retrieve app.manifest.json for the specified or default app
 */
app.get('/api/app-manifest', (req, res) => {
  try {
    const targetDir = req.query.appPath ? path.resolve(req.query.appPath) : DEFAULT_APP_DIR;
    const manifestPath = path.join(targetDir, 'app.manifest.json');

    if (!fs.existsSync(manifestPath)) {
      return res.status(404).json({ error: `Manifest not found at ${manifestPath}` });
    }

    const content = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(content);
    res.json({
      manifest,
      appPath: targetDir,
      manifestPath
    });
  } catch (error) {
    console.error('Error loading manifest:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Render and serve an HTML page from the target app, injecting:
 * 1. rapider-tailwind-theme.css (injected as <style type="text/tailwindcss">)
 * 2. Tailwind v4 browser compiler CDN
 * 3. ng-zorro-antd CSS CDN
 * 4. rapider-components.js (Web Components bundle)
 * 5. FontAwesome kit
 * 6. window.rapiderApi SDK bridge script
 */

app.post('/api/log', express.json(), (req, res) => {
  console.log('[BROWSER]', req.body);
  res.sendStatus(200);
});

app.get('/api/page-content', (req, res) => {
  try {
    const targetDir = req.query.appPath ? path.resolve(req.query.appPath) : DEFAULT_APP_DIR;
    const filePath = req.query.filePath; // e.g. "pages/dashboard/dashboard.html"
    const isDark = req.query.isDark === 'true';

    if (!filePath) {
      return res.status(400).send('<h1>Missing filePath query parameter</h1>');
    }

    const fullFilePath = path.join(targetDir, filePath);
    if (!fs.existsSync(fullFilePath)) {
      return res.status(404).send(`<h1>File not found: ${filePath}</h1><p>Looked in: ${fullFilePath}</p>`);
    }

    let rawHtml = fs.readFileSync(fullFilePath, 'utf8');
    
    // Prevent browser caching of injected HTML
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // Reload theme CSS if needed
    if (!cachedThemeCss && fs.existsSync(themeCssPath)) {
      cachedThemeCss = fs.readFileSync(themeCssPath, 'utf8');
    }

    let routeParams = {};
    if (req.query.routeParams) {
      try {
        routeParams = JSON.parse(req.query.routeParams);
      } catch (e) {}
    }
    if (req.query.id) {
      routeParams.id = req.query.id;
    }

    const builtHtml = buildSandboxHtml(rawHtml, cachedThemeCss, isDark, routeParams);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(builtHtml);
  } catch (error) {
    console.error('Error preparing page content:', error);
    res.status(500).send(`<h1>Error generating page preview:</h1><pre>${error.stack}</pre>`);
  }
});

/**
 * PURE FUNCTION: Builds complete sandbox HTML matching rapider-ui's buildSandboxHtml
 */
function buildSandboxHtml(rawCode, themeCss, isDark = false, routeParams = {}) {
  const activeClassMode = isDark ? 'class="dark"' : '';
  const tailwindCdnUrl = 'https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4';
  const ngZorroCdnUrl = 'https://cdn.jsdelivr.net/npm/ng-zorro-antd@21.2.1/ng-zorro-antd.min.css';
  const customComponentsBundle = `/assets/js/rapider-components.js?v=${Date.now()}`;
  const fontAwesomeCdnUrl = 'https://kit.fontawesome.com/5b23df26dc.js';

  let completeHtml = rawCode || '';

  // 1. Strip duplicate/conflicting tags injected by templates or hallucinated by AI
  completeHtml = completeHtml.replace(/<script[^>]*tailwindcss[^>]*><\/script>/gi, '');
  completeHtml = completeHtml.replace(/<script[^>]*fontawesome[^>]*><\/script>/gi, '');
  completeHtml = completeHtml.replace(/<script[^>]*rapider-components[^>]*><\/script>/gi, '');
  completeHtml = completeHtml.replace(/<link[^>]*rapider-tailwind-theme[^>]*>/gi, '');
  completeHtml = completeHtml.replace(/<link[^>]*ng-zorro-antd[^>]*>/gi, '');

  // 2. Head assets matching rapider-ui exactly
  let injectedHeadAssets = `
    <script data-rapider-injected="true">
      window.addEventListener('error', function(e) {
        fetch('/api/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'error', message: e.message, filename: e.filename, lineno: e.lineno }) });
      });
      window.addEventListener('unhandledrejection', function(e) {
        fetch('/api/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'unhandledrejection', message: e.reason ? e.reason.stack || e.reason : 'unknown' }) });
      });
      const originalConsoleLog = console.log;
      console.log = function(...args) {
        fetch('/api/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'log', message: args.join(' ') }) }).catch(()=>null);
        originalConsoleLog.apply(console, args);
      };
      const originalConsoleError = console.error;
      console.error = function(...args) {
        fetch('/api/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'error-log', message: args.join(' ') }) }).catch(()=>null);
        originalConsoleError.apply(console, args);
      };
    </script>
  
    <base data-rapider-injected="true" href="/assets/">
    <style data-rapider-injected="true" type="text/tailwindcss">
${themeCss}
    </style>
    <script data-rapider-injected="true" src="${tailwindCdnUrl}"></script>
    <link data-rapider-injected="true" rel="stylesheet" href="${ngZorroCdnUrl}">
    <script data-rapider-injected="true" src="${customComponentsBundle}" type="module" defer onerror="console.error('Failed to load rapider-components bundle');"></script>
    <script data-rapider-injected="true" src="${fontAwesomeCdnUrl}" crossorigin="anonymous"></script>
    <link data-rapider-injected="true" href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet" crossorigin="anonymous">
    <link data-rapider-injected="true" rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css" crossorigin="anonymous">
    <style data-rapider-injected="true">
      html, body {
        margin: 0;
        padding: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        background-color: var(--color-body-background, #f9fbfd);
        color: var(--color-text-main, #343a40);
        min-height: 100vh;
      }
      .dark html, .dark body, html.dark body {
        background-color: var(--color-body-background, #1f2126);
        color: var(--color-text-main, #f0f4f8);
      }
    </style>
  `;

  // 3. window.rapiderApi Client SDK Script (communicates via postMessage to parent harness)
  const rapiderSdkScript = `
    <script data-rapider-injected="true">
      window.rapiderApi = {
        routeParams: ${JSON.stringify(routeParams)},
        getRouteParam: function(key) {
          return this.routeParams ? this.routeParams[key] : null;
        },
        // --- API REQUEST BROKER ---
        request: function(operation, entityName, payload = {}) {
          return new Promise((resolve, reject) => {
            const reqId = Math.random().toString(36).substr(2, 9);
            
            const handler = function(event) {
              if (event.data && event.data.reqId === reqId) {
                window.removeEventListener('message', handler);
                if (event.data.type === 'RAPIDER_API_RESPONSE') {
                  resolve(event.data.payload);
                } else if (event.data.type === 'RAPIDER_API_ERROR') {
                  reject(new Error(event.data.error));
                }
              }
            };
            
            window.addEventListener('message', handler);
            
            window.parent.postMessage({
              type: 'RAPIDER_API_REQUEST',
              reqId: reqId,
              operation: operation,
              entityName: entityName,
              payload: payload
            }, '*');
          });
        },
        create: function(entityName, body) { return this.request('create', entityName, { body }); },
        find: function(entityName, filter) { return this.request('find', entityName, { filter }); },
        showToast: function() {
          if (typeof document === 'undefined') return;
          let toast = document.getElementById('swr-toast');
          if (!toast) {
            toast = document.createElement('div');
            toast.id = 'swr-toast';
            toast.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#172137;color:#fff;padding:12px 20px;border-radius:8px;font-size:13px;box-shadow:0 10px 25px rgba(0,0,0,0.2);display:flex;align-items:center;gap:10px;z-index:9999;transition:opacity 0.3s;opacity:0;pointer-events:none;';
            toast.innerHTML = '<i class="fas fa-sync fa-spin"></i> Checking for updates...';
            document.body.appendChild(toast);
            setTimeout(() => toast.style.opacity = '1', 10);
          }
        },
        hideToast: function() {
          if (typeof document === 'undefined') return;
          const toast = document.getElementById('swr-toast');
          if (toast) {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
          }
        },
        findSWR: function(entityName, filter, callback) {
          const cacheKey = 'swr_find_' + entityName + '_' + JSON.stringify(filter || {});
          let cachedData = null;
          try {
            const cached = sessionStorage.getItem(cacheKey);
            if (cached) {
              cachedData = JSON.parse(cached);
              this.showToast();
              if (callback) callback(cachedData, true);
            }
          } catch(e) {}
          
          const reqPromise = this.request('find', entityName, { filter }).then(data => {
            try { sessionStorage.setItem(cacheKey, JSON.stringify(data)); } catch(e) {}
            if (cachedData) this.hideToast();
            if (callback) callback(data, false);
            return data;
          }).catch(err => {
            if (cachedData) this.hideToast();
            throw err;
          });
          
          if (cachedData) {
             return Promise.resolve(cachedData);
          }
          return reqPromise;
        },
        countSWR: function(entityName, where, callback) {
          const cacheKey = 'swr_count_' + entityName + '_' + JSON.stringify(where || {});
          let cachedData = null;
          try {
            const cached = sessionStorage.getItem(cacheKey);
            if (cached) {
              cachedData = JSON.parse(cached);
              this.showToast();
              if (callback) callback(cachedData, true);
            }
          } catch(e) {}
          
          const reqPromise = this.request('count', entityName, { where }).then(data => {
            try { sessionStorage.setItem(cacheKey, JSON.stringify(data)); } catch(e) {}
            if (cachedData) this.hideToast();
            if (callback) callback(data, false);
            return data;
          }).catch(err => {
            if (cachedData) this.hideToast();
            throw err;
          });
          
          if (cachedData) {
             return Promise.resolve(cachedData);
          }
          return reqPromise;
        },
        findById: function(entityName, id, filter) { return this.request('findById', entityName, { id, filter }); },
        updateById: function(entityName, id, body) { return this.request('updateById', entityName, { id, body }); },
        update: function(entityName, id, body) { return this.request('updateById', entityName, { id, body }); },
        deleteById: function(entityName, id) { return this.request('deleteById', entityName, { id }); },
        delete: function(entityName, id) { return this.request('deleteById', entityName, { id }); },
        count: function(entityName, where) { return this.request('count', entityName, { where }); },

        // --- CROSS-IFRAME EVENT BUS ---
        listeners: {},
        broadcast: function(eventName, payload) {
          window.parent.postMessage({
            type: 'RAPIDER_BROADCAST',
            eventName: eventName,
            payload: payload
          }, '*');
        },
        on: function(eventName, callback) {
          if (!this.listeners[eventName]) this.listeners[eventName] = [];
          this.listeners[eventName].push(callback);
        },

        // --- UI ACTIONS & NAVIGATION BROKER ---
        executeAction: function(actionConfig) {
          window.parent.postMessage({
            type: 'RAPIDER_UI_ACTION',
            action: actionConfig
          }, '*');
        },
        showNotification: function(notificationConfig) {
          this.executeAction({ type: 'showNotification', payload: { notification: notificationConfig } });
        },
        navigate: function(route) {
          this.executeAction({ type: 'navigate', payload: { route: route } });
        },
        showPageModal: function(modalConfig) {
          this.executeAction({ type: 'showPageModal', payload: { pageModal: modalConfig } });
        },
        showPageDrawer: function(drawerConfig) {
          this.executeAction({ type: 'showPageDrawer', payload: { pageDrawer: drawerConfig } });
        },
        showPageSplitter: function(splitterConfig) {
          this.executeAction({ type: 'showPageSplitter', payload: { pageSplitter: splitterConfig } });
        }
      };

      // Native Window Listeners
      window.addEventListener('message', function(event) {
        if (!event.data) return;

        // Dark Mode Toggle from Harness
        if (event.data.type === 'TOGGLE_DARK_MODE') {
          if (event.data.isDark) {
            document.documentElement.classList.add('dark');
          } else {
            document.documentElement.classList.remove('dark');
          }
        }

        // Cross-Iframe Broadcasts from Harness Broker
        if (event.data.type === 'RAPIDER_BROADCAST_RECEIVE') {
          const callbacks = window.rapiderApi.listeners[event.data.eventName] || [];
          callbacks.forEach(cb => cb(event.data.payload));
        }
      });
    </script>
  `;

  // Inject into document
  if (!completeHtml.includes('<head>')) {
    completeHtml = `
      <!DOCTYPE html>
      <html ${activeClassMode} lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          ${injectedHeadAssets}
          ${rapiderSdkScript}
        </head>
        <body class="bg-body-background text-primary-text min-h-screen">
          ${completeHtml}
        </body>
      </html>
    `;
  } else {
    completeHtml = completeHtml.replace('</head>', `${injectedHeadAssets}\n${rapiderSdkScript}\n</head>`);
    if (activeClassMode) {
      if (completeHtml.includes('<html')) {
        if (!completeHtml.includes('class="dark"')) {
          completeHtml = completeHtml.replace('<html', `<html ${activeClassMode}`);
        }
      } else {
        completeHtml = `<html ${activeClassMode}>\n${completeHtml}\n</html>`;
      }
    } else {
      completeHtml = completeHtml.replace(/<html[^>]*class=["'][^"']*dark[^"']*["'][^>]*>/i, match => match.replace('dark', '').trim());
    }
    
    // Align with production viewer: replace local assets/ paths to absolute /assets/ so base tag doesn't double them
    completeHtml = completeHtml.replace(/(href|src)=["'](?:\.\/|\/)?assets\/(.*?)["']/gi, `$1="/assets/$2"`);

    // Move <base href="/assets/"> to the VERY beginning of <head>
    completeHtml = completeHtml.replace(/<base data-rapider-injected="true" href="\/assets\/">/g, '');
    completeHtml = completeHtml.replace(/<head[^>]*>/i, match => match + '\n    <base data-rapider-injected="true" href="/assets/">');
  }

  return completeHtml;
}

/**
 * Universal Reverse Proxy for Backend Calls
 * Resolves target backend from header `x-target-backend-url` or falls back to DEFAULT_BACKEND.
 * Completely eliminates browser CORS hurdles during local testing.
 */
app.all('/api/proxy/*', (req, res) => {
  const targetBaseUrl = req.headers['x-target-backend-url'] || DEFAULT_BACKEND;
  const targetPath = req.params[0]; // subpath after /api/proxy/
  
  // Reconstruct full query string
  const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  const fullTargetUrl = `${targetBaseUrl.replace(/\/$/, '')}/${targetPath}${queryString}`;

  try {
    const parsedUrl = new URL(fullTargetUrl);
    const isHttps = parsedUrl.protocol === 'https:';
    const client = isHttps ? https : http;

    // Filter and prepare headers to forward
    const forwardedHeaders = { ...req.headers };
    delete forwardedHeaders['host'];
    delete forwardedHeaders['x-target-backend-url'];
    delete forwardedHeaders['content-length'];

    const requestOptions = {
      method: req.method,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      headers: forwardedHeaders,
      timeout: 30000
    };

    const proxyReq = client.request(requestOptions, (proxyRes) => {
      res.status(proxyRes.statusCode);
      // Forward response headers
      Object.keys(proxyRes.headers).forEach(header => {
        res.setHeader(header, proxyRes.headers[header]);
      });
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error(`[Proxy Error] ${req.method} ${fullTargetUrl}:`, err.message);
      res.status(502).json({
        error: 'Proxy Error',
        message: err.message,
        targetUrl: fullTargetUrl
      });
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      res.status(504).json({ error: 'Gateway Timeout', targetUrl: fullTargetUrl });
    });

    // Write body if present
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
      const bodyData = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      proxyReq.setHeader('Content-Type', 'application/json');
      proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
      proxyReq.write(bodyData);
    }

    proxyReq.end();
  } catch (err) {
    console.error(`[Proxy Exception] ${fullTargetUrl}:`, err.message);
    res.status(500).json({ error: 'Proxy Setup Exception', message: err.message });
  }
});

app.get('/api/config', (req, res) => {
  const envPath = require('path').join(__dirname, '../.env');
  const config = {};
  if (require('fs').existsSync(envPath)) {
    const content = require('fs').readFileSync(envPath, 'utf8');
    content.split('\n').forEach(line => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) config[match[1].trim()] = match[2].trim().replace(/^['"](.*)['"]$/, '$1');
    });
  }
  res.json(config);
});

// Fallback to index.html for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log('================================================================');
  console.log(`🚀 Rappider Application Test Harness is running!`);
  console.log(`📡 URL: http://localhost:${PORT}`);
  console.log(`🎯 Default App: ${DEFAULT_APP_DIR}`);
  console.log(`🔗 Target Backend: ${DEFAULT_BACKEND}`);
  console.log('================================================================');
});
