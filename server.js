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
                webPagesCount: (manifest.webPages || []).length || (manifest.pages || []).length
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
    <base data-rapider-injected="true" href="/">
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
        findById: function(entityName, id, filter) { return this.request('findById', entityName, { id, filter }); },
        updateById: function(entityName, id, body) { return this.request('updateById', entityName, { id, body }); },
        deleteById: function(entityName, id) { return this.request('deleteById', entityName, { id }); },
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
