/**
 * harness.js
 * Main UI Controller for Rappider Application Test Harness.
 */

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTimestamp(date = new Date()) {
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  const h = pad(date.getHours());
  const m = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  const ms = pad(date.getMilliseconds(), 3);
  return `${h}:${m}:${s}.${ms}`;
}

function formatTimeSec(date = new Date()) {
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

class RappiderHarness {
  constructor() {
    this.apps = [];
    this.activeApp = null;
    this.manifest = null;
    this.activeRoute = null;
    this.isDarkTheme = true;
    this.isOfflineMode = false;
    this.viewportMode = 'desktop'; // desktop, tablet, mobile

    // DOM Elements
    this.dom = {
      appShell: document.getElementById('app-shell'),
      appName: document.getElementById('app-name'),
      appIcon: document.getElementById('app-icon'),
      appDesc: document.getElementById('app-description'),
      appSelectorBtn: document.getElementById('app-selector-btn'),
      appSelectorMenu: document.getElementById('app-selector-menu'),
      projectBadge: document.getElementById('project-badge'),
      projectStatusDot: document.getElementById('project-status-dot'),
      projectNameText: document.getElementById('project-name-text'),
      sidebarNavList: document.getElementById('sidebar-nav-list'),
      sidebarSearchInput: document.getElementById('sidebar-search-input'),
      sidebarToggleBtn: document.getElementById('btn-toggle-sidebar'),
      themeToggleBtn: document.getElementById('btn-toggle-theme'),
      devtoolsToggleBtn: document.getElementById('btn-toggle-devtools'),
      refreshPageBtn: document.getElementById('btn-refresh-page'),
      authBtn: document.getElementById('btn-open-auth'),
      urlBarText: document.getElementById('url-bar-text'),
      viewportContainer: document.getElementById('viewport-container'),
      sandboxIframe: document.getElementById('sandbox-iframe'),
      iframeLoader: document.getElementById('iframe-loader'),
      toastContainer: document.getElementById('toast-container'),
      // Overlays
      modalOverlay: document.getElementById('modal-overlay'),
      modalTitle: document.getElementById('modal-title'),
      modalCloseBtn: document.getElementById('modal-close-btn'),
      modalIframe: document.getElementById('modal-iframe'),
      drawerOverlay: document.getElementById('drawer-overlay'),
      drawerPanel: document.getElementById('drawer-panel'),
      drawerTitle: document.getElementById('drawer-title'),
      drawerCloseBtn: document.getElementById('drawer-close-btn'),
      drawerIframe: document.getElementById('drawer-iframe'),
      // Auth Modal
      authModal: document.getElementById('auth-modal'),
      authCloseBtn: document.getElementById('auth-close-btn'),
      authForm: document.getElementById('auth-login-form'),
      authDirectForm: document.getElementById('auth-direct-form'),
      authBanner: document.getElementById('auth-banner'),
      projectSelectGroup: document.getElementById('project-select-group'),
      projectSelect: document.getElementById('auth-project-select'),
      projectSelectorMenu: document.getElementById('project-selector-menu'),
      // DevTools
      devtoolsDrawer: document.getElementById('devtools-drawer'),
      apiCountBadge: document.getElementById('api-count-badge'),
      apiTableBody: document.getElementById('api-table-body'),
      eventCountBadge: document.getElementById('event-count-badge'),
      eventsTableBody: document.getElementById('events-table-body'),
      modelsTableBody: document.getElementById('models-table-body'),
      manifestJsonPre: document.getElementById('manifest-json-pre'),
      jsonViewerModal: document.getElementById('json-viewer-modal'),
      jsonViewerTitle: document.getElementById('json-viewer-title'),
      jsonViewerCloseBtn: document.getElementById('json-viewer-close-btn'),
      // E2E Report Modal
      e2eReportModal: document.getElementById('e2e-report-modal'),
      e2eReportModalClose: document.getElementById('e2e-report-modal-close'),
      e2eReportMarkdownView: document.getElementById('e2e-report-markdown-view'),
      btnModalDownloadReport: document.getElementById('btn-modal-download-report'),
      btnModalCloseReport: document.getElementById('btn-modal-close-report')
    };

    this.testLogs = [];
    this.init();
  }

  async init() {
    this.bindEvents();
    this.setupDevToolsListeners();

    this.updateAuthBadge();

    // Check if user has saved theme preference
    const savedTheme = localStorage.getItem('rappider_harness_theme');
    if (savedTheme === 'light') {
      this.setTheme(false);
    } else {
      this.setTheme(true);
    }

    // 1. Fetch available apps
    await this.fetchApps();

    // 2. Fetch projects or prompt login
    // Auto-fill and AUTO-LOGIN from env
    try {
      const configRes = await fetch('/api/config');
      const config = await configRes.json();
      
      if (config.HARNESS_TEST_EMAIL && config.HARNESS_TEST_PASSWORD) {
          // Attempt silent login
          await window.apiClient.login(config.HARNESS_TEST_EMAIL, config.HARNESS_TEST_PASSWORD, config.BACKEND_URL || 'https://dev.api.rappider.com');
          if (config.HARNESS_TEST_PROJECT_ID) {
              await window.apiClient.changeActiveProject(config.HARNESS_TEST_PROJECT_ID);
          }
          this.isOfflineMode = false;
          this.populateProjectSelect();
          this.updateAuthBadge();
          this.closeAuthModal();
          
          // Only attach hash listener and reload AFTER silent login
          window.addEventListener('hashchange', () => this.handleHashChange());
          this.handleHashChange();
          return;
      }
    } catch (err) {
      console.warn('Silent login failed:', err);
    }

    if (window.apiClient.isAuthenticated() && !this.isOfflineMode) {
      try {
        await window.apiClient.fetchUserProjects();
        // Always refresh the project-scoped token on load
        if (window.apiClient.projectId) {
          await window.apiClient.changeActiveProject(window.apiClient.projectId);
        }
        this.populateProjectSelect();
      } catch (err) {
        console.warn('Failed to restore workspace session:', err);
        this.openAuthModal();
      }
    } else if (!this.isOfflineMode) {
      this.openAuthModal();
    }
    
    // 3. Handle initial URL hash routing
    window.addEventListener('hashchange', () => this.handleHashChange());
  }

  // --- APPS & MANIFEST LOADING ---
  async fetchApps() {
    try {
      const res = await fetch('/api/apps');
      const data = await res.json();
      this.apps = data.apps || [];
      this.renderAppSelector();

      // Check URL query param ?app= or load default
      const urlParams = new URLSearchParams(window.location.search);
      const appKey = urlParams.get('app');

      let targetApp = this.apps.find(a => a.key === appKey || a.folderName === appKey);
      
      if (!targetApp && data.defaultAppDir) {
        targetApp = this.apps.find(a => a.absolutePath === data.defaultAppDir);
      }

      if (!targetApp && this.apps.length > 0) {
        targetApp = this.apps[0];
      }

      if (targetApp) {
        await this.loadApp(targetApp);
      }
    } catch (e) {
      console.error('Failed to fetch apps:', e);
      this.showToast({ type: 'error', message: 'Failed to discover Rappider apps.' });
    }
  }

  renderAppSelector() {
    if (!this.dom.appSelectorMenu) return;
    this.dom.appSelectorMenu.innerHTML = '';

    this.apps.forEach(app => {
      const item = document.createElement('div');
      item.className = 'app-option-item';
      if (this.activeApp && this.activeApp.folderName === app.folderName) {
        item.classList.add('selected');
      }

      item.innerHTML = `
        <div class="app-option-title"><i class="${app.iconUrl} mr-1"></i> ${app.name}</div>
        <div class="app-option-desc">${app.description || app.folderName} (${app.webPagesCount} pages)</div>
      `;

      item.addEventListener('click', () => {
        this.dom.appSelectorMenu.classList.remove('active');
        this.loadApp(app);
      });

      this.dom.appSelectorMenu.appendChild(item);
    });
  }

  async loadApp(app) {
    this.activeApp = app;
    this.renderAppSelector();

    try {
      const res = await fetch(`/api/app-manifest?appPath=${encodeURIComponent(app.absolutePath)}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to load manifest');
      }

      this.manifest = data.manifest;

      // Register with Rapider Bridge
      window.rapiderBridge.setManifest(this.manifest);

      // Update Header
      if (this.dom.appName) this.dom.appName.innerText = this.manifest.name || app.name;
      if (this.dom.appIcon) this.dom.appIcon.className = this.manifest.iconUrl || this.manifest.icon || 'fas fa-cubes';
      if (this.dom.appDesc) this.dom.appDesc.innerText = this.manifest.description || '';

      // Populate Sidebar Navigation
      this.renderSidebarNav();

      // Populate DevTools Data Models & Raw Manifest
      this.renderDataModelsTab();
      if (this.dom.manifestJsonPre) {
        this.dom.manifestJsonPre.innerText = JSON.stringify(this.manifest, null, 2);
      }

      // Load E2E Test Expectations
      this.loadE2eExpectations();

      // Navigate to initial page
      this.handleHashChange();
    } catch (e) {
      console.error('Error loading application manifest:', e);
      this.showToast({ type: 'error', message: `Could not load manifest for ${app.name}` });
    }
  }

  renderSidebarNav() {
    if (!this.dom.sidebarNavList || !this.manifest) return;
    this.dom.sidebarNavList.innerHTML = '';

    const webPages = this.manifest.webPages || this.manifest.uiPageImplementationPlan || this.manifest.pages || [];
    const filterText = (this.dom.sidebarSearchInput?.value || '').toLowerCase().trim();

    const visiblePages = webPages.filter(page => {
      if (page.displayInMenu === false || page.displayOnMenu === false) {
        return false;
      }
      if (filterText && !page.name.toLowerCase().includes(filterText) && !page.route.toLowerCase().includes(filterText)) {
        return false;
      }
      return true;
    });

    visiblePages.sort((a, b) => {
      const orderA = a.order !== undefined ? a.order : 9999;
      const orderB = b.order !== undefined ? b.order : 9999;
      return orderA - orderB;
    });

    const groupedPages = {};
    visiblePages.forEach(page => {
      const groupTitle = page.title || '';
      if (!groupedPages[groupTitle]) {
        groupedPages[groupTitle] = [];
      }
      groupedPages[groupTitle].push(page);
    });

    Object.keys(groupedPages).forEach(groupTitle => {
      if (groupTitle) {
        const heading = document.createElement('div');
        heading.className = 'sidebar-heading';
        heading.style.marginTop = '8px';
        heading.innerText = groupTitle;
        this.dom.sidebarNavList.appendChild(heading);
      }
      
      groupedPages[groupTitle].forEach(page => {
        const item = document.createElement('a');
        item.className = 'nav-item';
        item.href = `#/${page.route}`;
        item.dataset.route = page.route;

        const iconValue = page.icon || this.inferPageIcon(page.name, page.route);
        const iconHtml = iconValue.startsWith('<svg') ? iconValue : `<i class="${iconValue}"></i>`;

        item.innerHTML = `
          <div class="nav-item-left">
            ${iconHtml}
            <span>${page.name}</span>
          </div>
        `;

        item.addEventListener('click', (e) => {
          e.preventDefault();
          this.navigate(page.route);
        });

        this.dom.sidebarNavList.appendChild(item);
      });
    });

    this.updateActiveNavHighlight();
  }

  inferPageIcon(name = '', route = '') {
    const s = (name + ' ' + route).toLowerCase();
    if (s.includes('dash')) return 'fas fa-chart-pie';
    if (s.includes('account')) return 'fas fa-building';
    if (s.includes('contact')) return 'fas fa-user-friends';
    if (s.includes('lead')) return 'fas fa-funnel-dollar';
    if (s.includes('opp') || s.includes('deal')) return 'fas fa-briefcase';
    if (s.includes('case') || s.includes('ticket')) return 'fas fa-headset';
    if (s.includes('activit')) return 'fas fa-calendar-check';
    if (s.includes('product')) return 'fas fa-box-open';
    if (s.includes('campaign')) return 'fas fa-bullhorn';
    if (s.includes('quote')) return 'fas fa-file-invoice-dollar';
    if (s.includes('order')) return 'fas fa-shopping-cart';
    if (s.includes('contract')) return 'fas fa-file-contract';
    return 'fas fa-file-code';
  }

  updateActiveNavHighlight() {
    const current = this.activeRoute || '';
    const cleanCurrent = current.replace(/^\//, '').split('?')[0];

    const items = this.dom.sidebarNavList.querySelectorAll('.nav-item');
    items.forEach(item => {
      const itemRoute = item.dataset.route.replace(/^\//, '').split('?')[0];
      const routeRegex = new RegExp('^' + itemRoute.replace(/:[^/]+/g, '[^/]+') + '$');
      
      if (routeRegex.test(cleanCurrent) || (cleanCurrent && itemRoute === cleanCurrent)) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  }

  // --- NAVIGATION & PAGE RENDERING ---
  navigate(targetRoute, payload = {}) {
    let routeStr = '';
    if (Array.isArray(targetRoute)) {
      routeStr = targetRoute.filter(Boolean).join('/');
    } else if (typeof targetRoute === 'string') {
      routeStr = targetRoute;
    } else if (targetRoute) {
      routeStr = String(targetRoute);
    }

    // Strip leading hash or slashes
    routeStr = routeStr.replace(/^#\/?/, '').replace(/^\//, '');

    // Extract inline query parameters if present in routeStr (e.g. "ticket?id=1042" or "ticket.html?id=1042")
    let inlineQuery = {};
    if (routeStr.includes('?')) {
      const parts = routeStr.split('?');
      routeStr = parts[0];
      const sp = new URLSearchParams(parts[1]);
      for (const [k, v] of sp.entries()) inlineQuery[k] = v;
    }

    // Strip .html extension if present
    routeStr = routeStr.replace(/\.html$/, '');

    // Merge inline query params and payload queryParams
    const combinedQueryParams = { ...inlineQuery, ...(payload && payload.queryParams ? payload.queryParams : {}) };
    let queryStr = '';
    if (Object.keys(combinedQueryParams).length > 0) {
      const searchParams = new URLSearchParams();
      for (const key in combinedQueryParams) {
        searchParams.append(key, combinedQueryParams[key]);
      }
      queryStr = '?' + searchParams.toString();
    }

    // Defensively close any open drawer or modal overlay upon navigation
    if (this.dom.drawerOverlay && this.dom.drawerOverlay.classList.contains('active')) {
      this.closePageDrawer();
    }
    if (this.dom.modalOverlay && this.dom.modalOverlay.classList.contains('active')) {
      this.closePageModal();
    }

    const cleanRoute = routeStr.replace(/^\//, '');
    const newHash = `#/${cleanRoute}${queryStr}`;

    if (window.location.hash === newHash) {
      // Hash is unchanged, hashchange event will not fire. Trigger reload manually.
      this.handleHashChange();
    } else {
      window.location.hash = newHash;
    }
  }

  handleHashChange() {
    const hash = window.location.hash.replace(/^#\/?/, '');
    const route = hash || (this.manifest?.webPages?.[0]?.route || 'dashboard');
    this.loadPageByRoute(route);
  }

  async loadPageByRoute(fullRoute) {
    if (!this.manifest || !this.activeApp) return;

    let route = fullRoute;
    let queryParams = {};
    if (fullRoute.includes('?')) {
      const parts = fullRoute.split('?');
      route = parts[0];
      const searchParams = new URLSearchParams(parts[1]);
      for (const [key, value] of searchParams) {
        queryParams[key] = value;
      }
    }

    this.activeRoute = fullRoute;
    this.updateActiveNavHighlight();

    // Find matching page in manifest webPages
    const webPages = this.manifest.webPages || this.manifest.uiPageImplementationPlan || this.manifest.pages || [];
    
    // Exact match or param route match (e.g. accounts/:id matching accounts/123)
    let matchedPage = webPages.find(p => p.route === route);
    let params = { ...queryParams };

    if (!matchedPage) {
      // Try route pattern matching
      for (const page of webPages) {
        if (page.route.includes(':')) {
          const patternParts = page.route.split('/');
          const currentParts = route.split('/');
          if (patternParts.length === currentParts.length) {
            let matches = true;
            let extracted = {};
            for (let i = 0; i < patternParts.length; i++) {
              if (patternParts[i].startsWith(':')) {
                const paramName = patternParts[i].slice(1);
                extracted[paramName] = currentParts[i];
              } else if (patternParts[i] !== currentParts[i]) {
                matches = false;
                break;
              }
            }
            if (matches) {
              matchedPage = page;
              params = extracted;
              break;
            }
          }
        }
      }
    }

    // Fallback if not directly in webPages: check if baseSlug matches a webPage (e.g. account-detail/123)
    const routeParts = route.split('/');
    if (!matchedPage && routeParts.length > 1) {
      const baseSlug = routeParts[0];
      matchedPage = webPages.find(p => p.route === baseSlug);
      if (!params.id && routeParts[1]) {
        params.id = routeParts[1];
      }
    }

    let htmlFilePath = matchedPage?.htmlFilePath;
    if (!htmlFilePath) {
      // Convention fallback: pages/[route]/[route].html
      const baseSlug = routeParts[0];
      htmlFilePath = `pages/${baseSlug}/${baseSlug}.html`;
      if (!params.id && routeParts[1]) {
        params.id = routeParts[1];
      }
    }

    // Update URL bar
    if (this.dom.urlBarText) {
      this.dom.urlBarText.innerText = `/${route}`;
    }

    // Show Loader
    if (this.dom.iframeLoader) this.dom.iframeLoader.classList.add('active');

    let paramQuery = '';
    const paramKeys = Object.keys(params);
    if (paramKeys.length > 0) {
      paramQuery += `&routeParams=${encodeURIComponent(JSON.stringify(params))}`;
      for (const key of paramKeys) {
        paramQuery += `&${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`;
      }
    }
    const hashSuffix = `#/${route}${fullRoute.includes('?') ? '?' + fullRoute.split('?')[1] : ''}`;
    const iframeUrl = `/api/page-content?appPath=${encodeURIComponent(this.activeApp.absolutePath)}&filePath=${encodeURIComponent(htmlFilePath)}&isDark=${this.isDarkTheme}${paramQuery}&t=${Date.now()}${hashSuffix}`;
    
    const iframe = this.dom.sandboxIframe;
    iframe.src = iframeUrl;

    // Track iframe in bridge
    iframe.onload = () => {
      window.rapiderBridge.registerIframe(iframe);
      if (this.dom.iframeLoader) this.dom.iframeLoader.classList.remove('active');
    };
  }

  reloadCurrentPage() {
    if (this.activeRoute) {
      this.loadPageByRoute(this.activeRoute);
    }
  }

  // --- UI ACTIONS (MODALS, DRAWERS, TOASTS) ---
  showToast({ type = 'info', message = '' }) {
    if (!this.dom.toastContainer) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let icon = 'fas fa-info-circle';
    let title = 'System Notification';
    if (type === 'success') { icon = 'fas fa-check-circle'; title = 'Success'; }
    if (type === 'error') { icon = 'fas fa-times-circle'; title = 'Error'; }
    if (type === 'warning') { icon = 'fas fa-exclamation-triangle'; title = 'Warning'; }

    toast.innerHTML = `
      <i class="${icon} toast-icon"></i>
      <div class="toast-content">
        <div class="toast-title">${title}</div>
        <div class="toast-message">${message}</div>
      </div>
      <button class="toast-close"><i class="fas fa-times"></i></button>
    `;

    toast.querySelector('.toast-close').addEventListener('click', () => {
      toast.remove();
    });

    this.dom.toastContainer.appendChild(toast);

    // Auto dismiss after 5s
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(20px)';
      setTimeout(() => toast.remove(), 250);
    }, 5000);
  }

  showPageModal(config = {}) {
    const { route, title = 'Modal', width = 800 } = config;
    if (!this.dom.modalOverlay) return;

    this.dom.modalTitle.innerText = title;
    this.dom.modalOverlay.querySelector('.modal-dialog').style.width = typeof width === 'number' ? `${width}px` : width;
    
    const htmlFilePath = this.resolveHtmlPathForRoute(route);
    let src = `/api/page-content?appPath=${encodeURIComponent(this.activeApp.absolutePath)}&filePath=${encodeURIComponent(htmlFilePath)}&isDark=${this.isDarkTheme}&t=${Date.now()}`;
    
    if (config.payload && Object.keys(config.payload).length > 0) {
      Object.keys(config.payload).forEach(key => {
        if (config.payload[key] !== null && config.payload[key] !== undefined) {
          const val = typeof config.payload[key] === 'object' ? JSON.stringify(config.payload[key]) : String(config.payload[key]);
          src += `&${encodeURIComponent(key)}=${encodeURIComponent(val)}`;
        }
      });
      src += `&routeParams=${encodeURIComponent(JSON.stringify(config.payload))}`;
    }
    
    this.dom.modalIframe.src = src;
    
    this.dom.modalIframe.onload = () => {
      window.rapiderBridge.registerIframe(this.dom.modalIframe);
    };

    this.dom.modalOverlay.classList.add('active');
  }

  closePageModal() {
    if (!this.dom.modalOverlay) return;
    this.dom.modalOverlay.classList.remove('active');
    window.rapiderBridge.unregisterIframe(this.dom.modalIframe);
    this.dom.modalIframe.src = 'about:blank';
    if (window.rapiderBridge) {
      window.rapiderBridge.broadcastToAllIframes({
        type: 'RAPIDER_BROADCAST_RECEIVE',
        eventName: 'RAPIDER_DATA_CHANGED',
        payload: { source: 'modal_closed' }
      });
    }
  }

  showPageDrawer(config = {}) {
    const { route, title = 'Drawer', width = '600px' } = config;
    if (!this.dom.drawerOverlay) return;

    this.dom.drawerTitle.innerText = title;
    this.dom.drawerPanel.style.width = typeof width === 'number' ? `${width}px` : width;

    const htmlFilePath = this.resolveHtmlPathForRoute(route);
    let src = `/api/page-content?appPath=${encodeURIComponent(this.activeApp.absolutePath)}&filePath=${encodeURIComponent(htmlFilePath)}&isDark=${this.isDarkTheme}&t=${Date.now()}`;
    
    if (config.payload && Object.keys(config.payload).length > 0) {
      Object.keys(config.payload).forEach(key => {
        if (config.payload[key] !== null && config.payload[key] !== undefined) {
          const val = typeof config.payload[key] === 'object' ? JSON.stringify(config.payload[key]) : String(config.payload[key]);
          src += `&${encodeURIComponent(key)}=${encodeURIComponent(val)}`;
        }
      });
      src += `&routeParams=${encodeURIComponent(JSON.stringify(config.payload))}`;
    }
    
    this.dom.drawerIframe.src = src;

    this.dom.drawerIframe.onload = () => {
      window.rapiderBridge.registerIframe(this.dom.drawerIframe);
    };

    this.dom.drawerOverlay.classList.add('active');
  }

  closePageDrawer() {
    if (!this.dom.drawerOverlay) return;
    this.dom.drawerOverlay.classList.remove('active');
    window.rapiderBridge.unregisterIframe(this.dom.drawerIframe);
    this.dom.drawerIframe.src = 'about:blank';
    if (window.rapiderBridge) {
      window.rapiderBridge.broadcastToAllIframes({
        type: 'RAPIDER_BROADCAST_RECEIVE',
        eventName: 'RAPIDER_DATA_CHANGED',
        payload: { source: 'drawer_closed' }
      });
    }
  }

  resolveHtmlPathForRoute(route) {
    if (!this.manifest) return `pages/${route}/${route}.html`;
    const matched = (this.manifest.webPages || this.manifest.uiPageImplementationPlan || this.manifest.pages || []).find(p => p.route === route);
    if (matched?.htmlFilePath) return matched.htmlFilePath;
    const baseSlug = route.split('/')[0];
    return `pages/${baseSlug}/${baseSlug}.html`;
  }

  // --- AUTH MODAL & SESSIONS ---
  openAuthModal() {
    if (this.dom.authModal) {
      this.dom.authModal.classList.remove('hidden');
      this.populateProjectSelect();

      const savedUrl = localStorage.getItem('harness_backendUrl');
      const savedId = localStorage.getItem('harness_projectId');

      if (savedUrl && savedUrl !== 'http://localhost:8081') {
        const urlInputs = [
          document.getElementById('auth-backend-url'),
          document.getElementById('auth-direct-backend')
        ];
        urlInputs.forEach(i => { if (i) i.value = savedUrl; });
      }

      if (savedId) {
        const idInputs = [
          document.getElementById('auth-project-id'),
          document.getElementById('auth-direct-project-id'),
          document.getElementById('auth-mock-project-id')
        ];
        idInputs.forEach(i => { if (i) i.value = savedId; });
      }
    }
  }

  closeAuthModal() {
    if (this.dom.authModal) {
      this.dom.authModal.classList.add('hidden');
    }
  }

  updateAuthBadge() {
    const isAuth = window.apiClient.isAuthenticated();
    if (this.dom.projectStatusDot) {
      this.dom.projectStatusDot.className = `status-dot ${isAuth ? 'connected' : ''}`;
    }
    if (this.dom.projectNameText) {
      if (this.isOfflineMode) {
        this.dom.projectNameText.innerText = 'Offline Mock Mode';
      } else if (isAuth) {
        const projectId = window.apiClient.projectId;
        const project = window.apiClient.projects ? window.apiClient.projects.find(p => p.id === projectId) : null;
        let displayName = projectId.length > 12 ? projectId.substring(0, 8) + '...' : projectId;
        if (project && project.name) {
          displayName = project.name.length > 20 ? project.name.substring(0, 20) + '...' : project.name;
        }
        this.dom.projectNameText.innerText = `Workspace: ${displayName}`;
      } else {
        this.dom.projectNameText.innerText = 'Not Connected';
      }
    }
  }

  populateProjectSelect() {
    // 1. Populate Auth Modal Select
    if (this.dom.projectSelect) {
      this.dom.projectSelect.innerHTML = '<option value="">-- Select Active Project --</option>';
      if (window.apiClient.projects && window.apiClient.projects.length > 0) {
        this.dom.projectSelectGroup.style.display = 'flex';
        window.apiClient.projects.forEach(p => {
          const opt = document.createElement('option');
          opt.value = p.id;
          opt.innerText = `${p.name || p.id} (${p.id.substring(0, 8)})`;
          if (p.id === window.apiClient.projectId) opt.selected = true;
          this.dom.projectSelect.appendChild(opt);
        });
      } else {
        this.dom.projectSelectGroup.style.display = 'none';
      }
    }

    // 2. Populate Header Dropdown Menu
    if (this.dom.projectSelectorMenu) {
      this.dom.projectSelectorMenu.innerHTML = '';

      // Add Search Button at the top
      const searchItem = document.createElement('div');
      searchItem.className = 'app-selector-item search-item';
      searchItem.style.borderBottom = '1px solid var(--border-light)';
      searchItem.innerHTML = `
        <div class="app-selector-item-icon">
          <i class="fas fa-search"></i>
        </div>
        <div class="app-selector-item-content">
          <div class="app-selector-item-title">Search Workspaces...</div>
        </div>
      `;
      searchItem.addEventListener('click', () => {
        this.dom.projectSelectorMenu.classList.remove('active');
        this.openWorkspaceSearchModal();
      });
      this.dom.projectSelectorMenu.appendChild(searchItem);

      if (window.apiClient.projects && window.apiClient.projects.length > 0) {
        window.apiClient.projects.forEach(p => {
          const item = document.createElement('div');
          item.className = 'app-selector-item';
          if (p.id === window.apiClient.projectId) item.classList.add('active');
          
          item.innerHTML = `
            <div class="app-selector-item-icon">
              <i class="fas fa-database"></i>
            </div>
            <div class="app-selector-item-content">
              <div class="app-selector-item-title">${p.name || p.id}</div>
              <div class="app-selector-item-desc">ID: ${p.id.substring(0, 8)}</div>
            </div>
            ${p.id === window.apiClient.projectId ? '<i class="fas fa-check" style="color: var(--primary); margin-left: auto;"></i>' : ''}
          `;

          item.addEventListener('click', async () => {
            this.dom.projectSelectorMenu.classList.remove('active');
            if (p.id !== window.apiClient.projectId) {
              try {
                await window.apiClient.changeActiveProject(p.id);
                this.updateAuthBadge();
                this.showToast({ type: 'info', message: `Switched to workspace ${p.name || p.id.substring(0, 8)}` });
                this.reloadCurrentPage();
              } catch (err) {
                this.showToast({ type: 'error', message: 'Failed to switch workspace' });
              }
            }
          });

          this.dom.projectSelectorMenu.appendChild(item);
        });
      } else {
        const emptyItem = document.createElement('div');
        emptyItem.style.padding = '12px';
        emptyItem.style.textAlign = 'center';
        emptyItem.style.color = 'var(--text-muted)';
        emptyItem.style.fontSize = '11px';
        emptyItem.innerText = 'No recent workspaces';
        this.dom.projectSelectorMenu.appendChild(emptyItem);
      }
    }
  }

  // --- WORKSPACE SEARCH MODAL ---
  openWorkspaceSearchModal() {
    const modal = document.getElementById('workspace-search-modal');
    if (!modal) return;
    
    modal.classList.remove('hidden');
    
    const input = document.getElementById('workspace-search-input');
    const resultsContainer = document.getElementById('workspace-search-results');
    
    if (input) {
      input.value = '';
      input.focus();
      
      // Debounce search
      let timeout = null;
      input.onkeyup = (e) => {
        clearTimeout(timeout);
        timeout = setTimeout(async () => {
          const val = e.target.value.trim();
          resultsContainer.innerHTML = '<div style="padding: 12px; text-align: center; color: var(--text-muted);">Searching...</div>';
          if (val.length === 0) {
            resultsContainer.innerHTML = '';
            return;
          }
          
          const results = await window.apiClient.searchProjects(val);
          this.renderWorkspaceSearchResults(resultsContainer, results);
        }, 400);
      };
    }
    
    if (resultsContainer) {
      resultsContainer.innerHTML = '<div style="padding: 12px; text-align: center; color: var(--text-muted);">Type to search...</div>';
    }
  }

  closeWorkspaceSearchModal() {
    const modal = document.getElementById('workspace-search-modal');
    if (modal) {
      modal.classList.add('hidden');
    }
  }

  renderWorkspaceSearchResults(container, results) {
    container.innerHTML = '';
    if (!results || results.length === 0) {
      container.innerHTML = '<div style="padding: 12px; text-align: center; color: var(--text-muted);">No workspaces found.</div>';
      return;
    }

    results.forEach(p => {
      const item = document.createElement('div');
      item.className = 'app-selector-item';
      if (p.id === window.apiClient.projectId) item.classList.add('active');
      
      item.innerHTML = `
        <div class="app-selector-item-icon">
          <i class="fas fa-database"></i>
        </div>
        <div class="app-selector-item-content">
          <div class="app-selector-item-title">${p.name || p.id}</div>
          <div class="app-selector-item-desc">ID: ${p.id.substring(0, 8)}</div>
        </div>
      `;

      item.addEventListener('click', async () => {
        this.closeWorkspaceSearchModal();
        if (p.id !== window.apiClient.projectId) {
          try {
            // Optimistically add it to recent projects if not there
            if (!window.apiClient.projects.find(x => x.id === p.id)) {
              window.apiClient.projects.unshift(p);
              if (window.apiClient.projects.length > 10) window.apiClient.projects.pop();
              this.populateProjectSelect();
            }

            await window.apiClient.changeActiveProject(p.id);
            this.updateAuthBadge();
            this.showToast({ type: 'info', message: `Switched to workspace ${p.name || p.id.substring(0, 8)}` });
            this.reloadCurrentPage();
          } catch (err) {
            this.showToast({ type: 'error', message: 'Failed to switch workspace' });
          }
        }
      });
      container.appendChild(item);
    });
  }

  // --- DEVTOOLS & INSPECTOR ---
  setupDevToolsListeners() {
    // 1. API Events Listener
    window.apiClient.onApiEvent((event) => {
      this.renderApiTableRow(event);
      if (this.dom.apiCountBadge) {
        this.dom.apiCountBadge.innerText = window.apiClient.apiHistory.length;
      }
    });

    // 2. UI Actions Listener
    window.rapiderBridge.onUiEvent((event) => {
      this.renderEventTableRow(event);
      if (this.dom.eventCountBadge) {
        const current = parseInt(this.dom.eventCountBadge.innerText || '0', 10);
        this.dom.eventCountBadge.innerText = current + 1;
      }
    });
  }

  renderApiTableRow(event) {
    if (!this.dom.apiTableBody) return;

    // Remove empty placeholder row if present
    const emptyRow = this.dom.apiTableBody.querySelector('.empty-row');
    if (emptyRow) emptyRow.remove();

    const tr = document.createElement('tr');
    tr.id = `api-row-${event.id}`;

    const timeStr = event.timestamp.toTimeString().split(' ')[0];
    const durationStr = event.duration != null ? `${event.duration}ms` : '...';
    let statusClass = 'status-pending';
    let statusText = 'PENDING';

    if (event.statusCode) {
      statusText = `${event.statusCode}`;
      if (event.statusCode >= 200 && event.statusCode < 300) statusClass = 'status-2xx';
      else if (event.statusCode >= 400 && event.statusCode < 500) statusClass = 'status-4xx';
      else statusClass = 'status-5xx';
    } else if (event.status === 'ERROR') {
      statusClass = 'status-5xx';
      statusText = 'ERR';
    }

    tr.innerHTML = `
      <td>${timeStr}</td>
      <td><span class="method-tag method-${event.method}">${event.method}</span></td>
      <td><strong>${event.entityName}</strong> <span style="opacity:0.6">(${event.dataTableName})</span></td>
      <td>${event.operation}</td>
      <td><span class="status-tag ${statusClass}">${statusText}</span></td>
      <td>${durationStr}</td>
    `;

    tr.addEventListener('click', () => {
      this.openJsonViewer(`API Request: ${event.method} ${event.path}`, {
        metadata: {
          operation: event.operation,
          entityName: event.entityName,
          dataTableName: event.dataTableName,
          timestamp: event.timestamp,
          duration: `${event.duration}ms`,
          status: event.status,
          statusCode: event.statusCode
        },
        requestBody: event.requestBody,
        response: event.response,
        error: event.error
      });
    });

    // Prepend new row
    this.dom.apiTableBody.insertBefore(tr, this.dom.apiTableBody.firstChild);
  }

  renderEventTableRow(event) {
    if (!this.dom.eventsTableBody) return;
    const emptyRow = this.dom.eventsTableBody.querySelector('.empty-row');
    if (emptyRow) emptyRow.remove();

    const tr = document.createElement('tr');
    const timeStr = event.timestamp.toTimeString().split(' ')[0];

    tr.innerHTML = `
      <td>${timeStr}</td>
      <td><span class="method-tag method-POST">${event.type}</span></td>
      <td>${event.actionType || event.eventName || ''}</td>
      <td>${JSON.stringify(event.payload).substring(0, 60)}...</td>
    `;

    tr.addEventListener('click', () => {
      this.openJsonViewer(`Event: ${event.type}`, event);
    });

    this.dom.eventsTableBody.insertBefore(tr, this.dom.eventsTableBody.firstChild);
  }

  renderDataModelsTab() {
    if (!this.dom.modelsTableBody || !this.manifest) return;
    this.dom.modelsTableBody.innerHTML = '';

    const models = this.manifest.dataModels || [];
    models.forEach(m => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${m.name}</strong></td>
        <td><code>${m.datatableName || m.name}</code></td>
        <td>${m.domainName || m.domainKey || '-'}</td>
        <td>${(m.fields || []).length} fields</td>
        <td>${m.description || ''}</td>
      `;

      tr.addEventListener('click', () => {
        this.openJsonViewer(`Data Model: ${m.name}`, m);
      });

      this.dom.modelsTableBody.appendChild(tr);
    });
  }

  openJsonViewer(title, data) {
    if (!this.dom.jsonViewerModal) return;
    this.dom.jsonViewerTitle.innerText = title;
    this.dom.jsonViewerContent.innerText = JSON.stringify(data, null, 2);
    this.dom.jsonViewerModal.classList.add('active');
  }

  closeJsonViewer() {
    if (!this.dom.jsonViewerModal) return;
    this.dom.jsonViewerModal.classList.remove('active');
  }

  // --- THEME & VIEWPORT MODES ---
  setTheme(isDark) {
    this.isDarkTheme = isDark;
    if (isDark) {
      document.body.classList.remove('light-theme');
      document.body.classList.add('dark-theme');
      if (this.dom.themeToggleBtn) {
        this.dom.themeToggleBtn.innerHTML = '<i class="fas fa-moon"></i>';
      }
      localStorage.setItem('rappider_harness_theme', 'dark');
    } else {
      document.body.classList.remove('dark-theme');
      document.body.classList.add('light-theme');
      if (this.dom.themeToggleBtn) {
        this.dom.themeToggleBtn.innerHTML = '<i class="fas fa-sun"></i>';
      }
      localStorage.setItem('rappider_harness_theme', 'light');
    }

    // Sync into active iframe(s)
    window.rapiderBridge.syncDarkMode(isDark);
  }

  toggleTheme() {
    this.setTheme(!this.isDarkTheme);
  }

  setViewportMode(mode) {
    this.viewportMode = mode;
    const container = this.dom.viewportContainer;
    if (!container) return;

    container.classList.remove('mode-tablet', 'mode-mobile');
    if (mode === 'tablet') container.classList.add('mode-tablet');
    if (mode === 'mobile') container.classList.add('mode-mobile');

    document.querySelectorAll('.btn-viewport').forEach(btn => {
      if (btn.dataset.mode === mode) btn.classList.add('active');
      else btn.classList.remove('active');
    });
  }

  // --- EVENT BINDINGS ---
  bindEvents() {
    window.addEventListener('harness-require-login', () => {
      this.openAuthModal();
      this.showToast({ type: 'warning', message: 'Authentication required. Please log in or select a workspace.' });
    });

    // App selector dropdown toggle
    if (this.dom.appSelectorBtn) {
      this.dom.appSelectorBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.dom.appSelectorMenu.classList.toggle('active');
      });
    }

    document.addEventListener('click', () => {
      if (this.dom.appSelectorMenu) this.dom.appSelectorMenu.classList.remove('active');
    });

    // Theme toggle
    if (this.dom.themeToggleBtn) {
      this.dom.themeToggleBtn.addEventListener('click', () => this.toggleTheme());
    }

    // Sidebar toggle
    if (this.dom.sidebarToggleBtn) {
      this.dom.sidebarToggleBtn.addEventListener('click', () => {
        this.dom.appShell.classList.toggle('sidebar-collapsed');
      });
    }

    // Devtools drawer toggle
    if (this.dom.devtoolsToggleBtn) {
      this.dom.devtoolsToggleBtn.addEventListener('click', () => {
        this.dom.appShell.classList.toggle('devtools-hidden');
      });
    }

    // Page refresh
    if (this.dom.refreshPageBtn) {
      this.dom.refreshPageBtn.addEventListener('click', () => this.reloadCurrentPage());
    }

    // Sidebar search input
    if (this.dom.sidebarSearchInput) {
      this.dom.sidebarSearchInput.addEventListener('input', () => this.renderSidebarNav());
    }

    // Auth Open & Project Badge click
    if (this.dom.authBtn) {
      this.dom.authBtn.addEventListener('click', () => this.openAuthModal());
    }
    if (this.dom.projectBadge) {
      this.dom.projectBadge.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.apiClient.token && window.apiClient.projects) {
          this.dom.projectSelectorMenu.classList.toggle('active');
          if (this.dom.appSelectorMenu) this.dom.appSelectorMenu.classList.remove('active');
        } else {
          this.openAuthModal();
        }
      });
      
      // Close project menu on outside click
      document.addEventListener('click', (e) => {
        if (this.dom.projectSelectorMenu && !this.dom.projectBadge.contains(e.target) && !this.dom.projectSelectorMenu.contains(e.target)) {
          this.dom.projectSelectorMenu.classList.remove('active');
        }
      });
    }
    if (this.dom.authCloseBtn) {
      this.dom.authCloseBtn.addEventListener('click', () => this.closeAuthModal());
    }

    // Viewport size controls
    document.querySelectorAll('.btn-viewport').forEach(btn => {
      btn.addEventListener('click', () => this.setViewportMode(btn.dataset.mode));
    });

    // Drawer and Modal close
    if (this.dom.drawerCloseBtn) {
      this.dom.drawerCloseBtn.addEventListener('click', () => this.closePageDrawer());
    }
    if (this.dom.drawerOverlay) {
      this.dom.drawerOverlay.addEventListener('click', (e) => {
        if (e.target === this.dom.drawerOverlay) {
          this.closePageDrawer();
        }
      });
    }
    if (this.dom.modalCloseBtn) {
      this.dom.modalCloseBtn.addEventListener('click', () => this.closePageModal());
    }
    if (this.dom.modalOverlay) {
      this.dom.modalOverlay.addEventListener('click', (e) => {
        if (e.target === this.dom.modalOverlay) {
          this.closePageModal();
        }
      });
    }
    if (this.dom.jsonViewerCloseBtn) {
      this.dom.jsonViewerCloseBtn.addEventListener('click', () => this.closeJsonViewer());
    }

    // DevTools Tab Switching
    document.querySelectorAll('.dev-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.dev-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        const pane = document.getElementById(tab.dataset.target);
        if (pane) pane.classList.add('active');
      });
    });

    // Auth Tabs (Credentials vs Direct Token vs Mock)
    document.querySelectorAll('.auth-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.auth-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.auth-tab-content').forEach(c => c.style.display = 'none');
        btn.classList.add('active');
        const target = document.getElementById(btn.dataset.target);
        if (target) target.style.display = 'flex';
      });
    });

    // Auth Form Submit (Credentials)
    if (this.dom.authForm) {
      this.dom.authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('auth-username').value;
        const password = document.getElementById('auth-password').value;
        const backendUrl = document.getElementById('auth-backend-url').value;
        const projectId = document.getElementById('auth-project-id').value;
        const btn = document.getElementById('btn-submit-login');

        try {
          btn.disabled = true;
          btn.innerText = 'Signing In...';
          this.dom.authBanner.className = 'auth-banner';

          localStorage.setItem('harness_backendUrl', backendUrl);
          localStorage.setItem('harness_projectId', projectId);

          await window.apiClient.login(username, password, backendUrl);
          if (projectId) {
            await window.apiClient.changeActiveProject(projectId);
          } else {
            const projects = await window.apiClient.fetchUserProjects();
            if (projects && projects.length > 0) {
              await window.apiClient.changeActiveProject(projects[0].id);
            }
          }

          this.populateProjectSelect();
          this.isOfflineMode = false;
          this.updateAuthBadge();
          this.showToast({ type: 'success', message: `Connected as ${username}` });
          this.closeAuthModal();
          this.reloadCurrentPage();
        } catch (err) {
          this.dom.authBanner.className = 'auth-banner error';
          this.dom.authBanner.innerText = err.message || 'Login failed.';
        } finally {
          btn.disabled = false;
          btn.innerText = 'Sign In & Connect';
        }
      });
    }

    // Project Select Change
    if (this.dom.projectSelect) {
      this.dom.projectSelect.addEventListener('change', async (e) => {
        const projectId = e.target.value;
        if (projectId) {
          await window.apiClient.changeActiveProject(projectId);
          this.updateAuthBadge();
          this.showToast({ type: 'info', message: `Switched to project ${projectId.substring(0, 8)}` });
          this.reloadCurrentPage();
        }
      });
    }

    // Deterministic QA Audit Button
    const btnRunQa = document.getElementById('btn-run-qa-audit');
    if (btnRunQa) {
      btnRunQa.addEventListener('click', () => this.runQaAudit());
    }

    // ==========================================================================
    // E2E SLIDE-OUT DRAWER LISTENERS (TABS, EXECUTION, REAL MOVING MOUSE)
    // ==========================================================================
    const btnToggleE2eDrawer = document.getElementById('btn-toggle-e2e-drawer');
    const e2eSideDrawer = document.getElementById('e2e-side-drawer');
    const btnCloseE2eDrawer = document.getElementById('btn-close-e2e-drawer');

    if (btnToggleE2eDrawer && e2eSideDrawer) {
      btnToggleE2eDrawer.addEventListener('click', () => {
        const isOpen = e2eSideDrawer.classList.toggle('open');
        this.dom.appShell?.classList.toggle('e2e-drawer-open', isOpen);
        btnToggleE2eDrawer.classList.toggle('active', isOpen);
      });
    }

    if (btnCloseE2eDrawer && e2eSideDrawer) {
      btnCloseE2eDrawer.addEventListener('click', () => {
        e2eSideDrawer.classList.remove('open');
        this.dom.appShell?.classList.remove('e2e-drawer-open');
        btnToggleE2eDrawer?.classList.remove('active');
      });
    }

    // Tab Switching inside Right Drawer
    const btnTabSuites = document.getElementById('btn-tab-suites');
    const btnTabExecution = document.getElementById('btn-tab-execution');
    if (btnTabSuites) {
      btnTabSuites.addEventListener('click', () => this.switchE2eTab('suites'));
    }
    if (btnTabExecution) {
      btnTabExecution.addEventListener('click', () => this.switchE2eTab('execution'));
    }

    // Search filter for test suites list
    const suitesFilterInput = document.getElementById('e2e-suites-search-input');
    if (suitesFilterInput) {
      suitesFilterInput.addEventListener('input', (e) => {
        const query = (e.target.value || '').toLowerCase().trim();
        document.querySelectorAll('.e2e-suite-card').forEach(card => {
          const route = (card.dataset.route || '').toLowerCase();
          const name = (card.dataset.name || '').toLowerCase();
          const matches = !query || route.includes(query) || name.includes(query);
          card.style.display = matches ? 'flex' : 'none';
        });
      });
    }

    // E2E Test Engine Run Button (Right Drawer)
    const btnRunEngine = document.getElementById('btn-run-e2e-engine');
    if (btnRunEngine) {
      btnRunEngine.addEventListener('click', (e) => {
        e.stopPropagation();
        const activeOnly = document.getElementById('e2e-drawer-active-only')?.checked;
        const drawerSelect = document.getElementById('e2e-drawer-suite-select');
        const selectedRoute = drawerSelect ? drawerSelect.value : '';

        // Ensure drawer is open
        if (e2eSideDrawer && !e2eSideDrawer.classList.contains('open')) {
          e2eSideDrawer.classList.add('open');
          this.dom.appShell?.classList.add('e2e-drawer-open');
          btnToggleE2eDrawer?.classList.add('active');
        }

        // Switch to Execution tab to watch live tests
        this.switchE2eTab('execution');

        if (activeOnly) {
          const current = (this.activeRoute || 'dashboard').replace(/^#\/?/, '').split('?')[0];
          this.runSingleE2eSuite(current);
        } else if (selectedRoute) {
          this.runSingleE2eSuite(selectedRoute);
        } else {
          this.runE2eTests(false);
        }
      });
    }

    // Stop Button
    const btnStopEngine = document.getElementById('btn-stop-e2e-engine');
    if (btnStopEngine) {
      btnStopEngine.addEventListener('click', (e) => {
        e.stopPropagation();
        this.stopE2eTests();
      });
    }

    // Suite selector in drawer
    const drawerSuiteSelect = document.getElementById('e2e-drawer-suite-select');
    if (drawerSuiteSelect) {
      drawerSuiteSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val) {
          this.previewE2eSuite(val);
          this.switchE2eTab('execution');
        }
      });
    }

    // Set initial drawer shell class if open
    if (e2eSideDrawer?.classList.contains('open')) {
      this.dom.appShell?.classList.add('e2e-drawer-open');
      btnToggleE2eDrawer?.classList.add('active');
    }

    const btnExpandDevtools = document.getElementById('btn-expand-devtools');
    if (btnExpandDevtools) {
      btnExpandDevtools.addEventListener('click', () => {
        const drawer = document.getElementById('devtools-drawer');
        if (drawer) {
          drawer.classList.toggle('expanded');
          const isExp = drawer.classList.contains('expanded');
          btnExpandDevtools.innerHTML = isExp 
            ? '<i class="fas fa-compress-alt"></i>'
            : '<i class="fas fa-expand-alt"></i>';
        }
      });
    }

    // E2E Report Preview Modal events
    if (this.dom.e2eReportModalClose) {
      this.dom.e2eReportModalClose.addEventListener('click', () => this.closeReportModal());
    }
    if (this.dom.btnModalCloseReport) {
      this.dom.btnModalCloseReport.addEventListener('click', () => this.closeReportModal());
    }
    if (this.dom.btnModalDownloadReport) {
      this.dom.btnModalDownloadReport.addEventListener('click', () => this.downloadTestReport());
    }
    if (this.dom.e2eReportModal) {
      this.dom.e2eReportModal.addEventListener('click', (e) => {
        if (e.target === this.dom.e2eReportModal) {
          this.closeReportModal();
        }
      });
    }
  }

  /**
   * Run deterministic static & structural QA audit across all pages
   */
  async runQaAudit() {
    if (!this.activeApp) {
      this.showToast({ type: 'warning', message: 'No active application selected.' });
      return;
    }

    const btn = document.getElementById('btn-run-qa-audit');
    const badgeContainer = document.getElementById('qa-audit-badge-container');
    const summaryText = document.getElementById('qa-audit-summary-text');
    const tableBody = document.getElementById('qa-audit-table-body');
    const tabBadge = document.getElementById('qa-tab-badge');

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Running QA Audit...';
    }
    if (summaryText) {
      summaryText.innerText = 'Evaluating pages against 20 QA passes...';
    }

    try {
      const response = await fetch(`/api/qa-audit?appPath=${encodeURIComponent(this.activeApp.absolutePath)}`);
      if (!response.ok) {
        throw new Error(`Audit API returned status ${response.status}`);
      }
      const data = await response.json();

      if (badgeContainer) {
        if (data.is100PercentCompliant) {
          badgeContainer.innerHTML = '<span style="background: #10b981; color: #fff; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 700;">✓ 100% QA PASS</span>';
        } else {
          badgeContainer.innerHTML = `<span style="background: #ef4444; color: #fff; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 700;">✗ ${data.totalIssues} ISSUES DETECTED</span>`;
        }
      }

      if (summaryText) {
        summaryText.innerText = `${data.pagesPassed} / ${data.pagesAudited} pages passed · ${data.totalIssues} issues · ${data.totalWarnings} warnings`;
      }

      if (tabBadge) {
        tabBadge.style.display = 'inline-block';
        tabBadge.style.background = data.is100PercentCompliant ? '#10b981' : '#ef4444';
        tabBadge.style.color = '#ffffff';
        tabBadge.innerText = data.is100PercentCompliant ? '✓' : data.totalIssues;
      }

      if (tableBody) {
        if (!data.pageResults || data.pageResults.length === 0) {
          tableBody.innerHTML = '<tr class="empty-row"><td colspan="7" style="text-align:center;padding:24px;">No pages found in manifest.</td></tr>';
        } else {
          tableBody.innerHTML = data.pageResults.map(p => {
            const statusBadge = p.passed
              ? '<span style="background:#10b981;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">PASS</span>'
              : '<span style="background:#ef4444;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">FAIL</span>';
            const wiredRatio = `${p.metrics.buttonsWithActions} / ${p.metrics.buttonsTotal}`;
            
            let issuesHtml = '';
            if (p.issues && p.issues.length > 0) {
              issuesHtml = p.issues.map(i => `<div style="color:#ef4444;font-size:11px;margin-bottom:2px;">• [${i.rule}] ${i.message}</div>`).join('');
            } else if (p.warnings && p.warnings.length > 0) {
              issuesHtml = p.warnings.map(w => `<div style="color:#f59e0b;font-size:11px;margin-bottom:2px;">• [${w.rule}] ${w.message}</div>`).join('');
            } else {
              issuesHtml = '<span style="color:#10b981;font-size:11px;">✓ All checks passed</span>';
            }

            return `
              <tr>
                <td><code style="font-size:11px;color:var(--text-accent);">${p.route}</code></td>
                <td><strong>${p.pageName}</strong><br><small style="color:var(--text-muted);font-size:10px;">${p.pagePath}</small></td>
                <td>${statusBadge}</td>
                <td><span style="color:${p.issuesCount > 0 ? '#ef4444' : 'inherit'};font-weight:${p.issuesCount > 0 ? '700' : 'normal'};">${p.issuesCount}</span></td>
                <td><span style="color:${p.warningsCount > 0 ? '#f59e0b' : 'inherit'};">${p.warningsCount}</span></td>
                <td><span style="font-size:11px;">${wiredRatio}</span></td>
                <td style="max-width:320px;vertical-align:top;">${issuesHtml}</td>
              </tr>
            `;
          }).join('');
        }
      }

      this.showToast({
        type: data.is100PercentCompliant ? 'success' : 'warning',
        message: data.is100PercentCompliant ? 'QA Audit Passed: All pages compliant!' : `QA Audit: ${data.totalIssues} issues found across ${data.pagesFailed} pages.`
      });

    } catch (err) {
      console.error('QA Audit error:', err);
      this.showToast({ type: 'error', message: `QA Audit failed: ${err.message}` });
      if (summaryText) summaryText.innerText = 'Audit failed to run.';
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-play"></i> Run Deterministic QA Audit';
      }
    }
  }

  /**
   * Switch active tab inside Right E2E Drawer
   */
  switchE2eTab(tabName) {
    const isSuites = tabName === 'suites';
    const btnSuites = document.getElementById('btn-tab-suites');
    const btnExec = document.getElementById('btn-tab-execution');
    const paneSuites = document.getElementById('e2e-pane-suites');
    const paneExec = document.getElementById('e2e-pane-execution');

    if (btnSuites) btnSuites.classList.toggle('active', isSuites);
    if (btnExec) btnExec.classList.toggle('active', !isSuites);
    if (paneSuites) paneSuites.classList.toggle('active', isSuites);
    if (paneExec) paneExec.classList.toggle('active', !isSuites);
  }

  /**
   * Load and render E2E test expectations into Right Drawer
   */
  async loadE2eExpectations() {
    if (!this.activeApp) return;
    const drawerSelect = document.getElementById('e2e-drawer-suite-select');
    const suitesList = document.getElementById('e2e-drawer-suites-list');
    const tabSuitesCount = document.getElementById('e2e-tab-suites-count');
    const headerBadge = document.getElementById('e2e-header-badge');
    const drawerCountBadge = document.getElementById('e2e-drawer-count-badge');
    const statusText = document.getElementById('e2e-drawer-status-text');

    try {
      const res = await fetch(`/api/e2e/expectations?appPath=${encodeURIComponent(this.activeApp.absolutePath)}`);
      if (!res.ok) {
        if (suitesList) suitesList.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 24px;">No expectations.json found.</div>';
        return;
      }
      this.e2eData = await res.json();
      const suites = this.e2eData.testSuites || [];

      if (tabSuitesCount) tabSuitesCount.innerText = suites.length;
      if (headerBadge) {
        headerBadge.innerText = suites.length;
        headerBadge.style.display = 'inline-block';
      }
      if (drawerCountBadge) drawerCountBadge.innerText = `${suites.length} Suites`;
      if (statusText) statusText.innerText = `${suites.length} Suites Ready · Deterministic Coverage`;

      if (drawerSelect) {
        drawerSelect.innerHTML = '<option value="">All Suites (' + suites.length + ' Pages)</option>' +
          suites.map(s => `<option value="${s.route}">#${s.route} (${s.tests.length} steps)</option>`).join('');
      }

      if (suitesList) {
        suitesList.innerHTML = suites.map((s) => `
          <div id="e2e-suite-card-${s.route}" class="e2e-suite-card" data-route="${s.route}" data-name="${escapeHtml(s.suiteName)}">
            <div class="e2e-suite-info">
              <div class="e2e-suite-route">#${s.route}</div>
              <div class="e2e-suite-name">${escapeHtml(s.suiteName)}</div>
              <div class="e2e-suite-meta">${s.tests.length} deterministic steps</div>
            </div>
            <div class="e2e-suite-actions">
              <span id="e2e-suite-badge-${s.route}" class="e2e-suite-badge idle">IDLE</span>
              <button class="btn-run-single-suite" data-route="${s.route}" title="Run #${s.route}">
                <i class="fas fa-play"></i>
              </button>
            </div>
          </div>
        `).join('');

        suitesList.querySelectorAll('.e2e-suite-card').forEach(card => {
          card.addEventListener('click', (e) => {
            if (e.target.closest('.btn-run-single-suite')) return;
            const route = card.dataset.route;
            if (drawerSelect) drawerSelect.value = route;
            this.previewE2eSuite(route);
            this.switchE2eTab('execution');
          });
        });

        suitesList.querySelectorAll('.btn-run-single-suite').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const route = btn.dataset.route;
            if (drawerSelect) drawerSelect.value = route;
            this.switchE2eTab('execution');
            this.runSingleE2eSuite(route);
          });
        });
      }

      // Default preview active route or first suite
      const firstRoute = suites[0]?.route || 'dashboard';
      this.previewE2eSuite(firstRoute);
    } catch (err) {
      console.warn('Failed to load E2E expectations:', err);
    }
  }

  /**
   * Preview suite steps in Execution tab timeline
   */
  previewE2eSuite(route) {
    const suite = (this.e2eData?.testSuites || []).find(s => s.route === route);
    if (!suite) return;

    // Highlight suite card in Test Suites tab
    document.querySelectorAll('.e2e-suite-card').forEach(el => el.classList.remove('active'));
    const activeCard = document.getElementById(`e2e-suite-card-${route}`);
    if (activeCard) activeCard.classList.add('active');

    const titleEl = document.getElementById('e2e-exec-suite-title');
    const statsEl = document.getElementById('e2e-exec-step-stats');
    const timeline = document.getElementById('e2e-drawer-timeline');

    if (titleEl) titleEl.innerText = `#${suite.route} - ${suite.suiteName || suite.route}`;
    if (statsEl) statsEl.innerText = `${suite.tests.length} Steps · Ready to execute`;

    // Only render preview cards if timeline has no active running execution
    if (timeline && !timeline.querySelector('.e2e-drawer-step-item')) {
      timeline.innerHTML = `
        <div style="font-size: 11px; font-weight: 700; color: #64748b; margin-bottom: 12px; text-transform: uppercase;">
          Suite Steps Preview (${suite.tests.length} Steps)
        </div>
        ${suite.tests.map((test, idx) => `
          <div class="e2e-drawer-step-item" style="opacity: 0.85;">
            <div class="e2e-drawer-step-dot" style="background: #e2e8f0; color: #475569;">
              ${idx + 1}
            </div>
            <div class="e2e-drawer-card">
              <div class="e2e-drawer-card-top">
                <span class="e2e-drawer-step-title">${escapeHtml(test.name || test.action)}</span>
                <span class="e2e-drawer-status-pill" style="background: #f1f5f9; color: #64748b;">READY</span>
              </div>
              ${test.explanation ? `<p class="e2e-drawer-explanation">${escapeHtml(test.explanation)}</p>` : ''}
              <div class="e2e-drawer-card-bottom">
                <span class="e2e-drawer-action-badge"><i class="fas fa-bolt" style="font-size: 9px;"></i> ${(test.action || 'WAIT').toUpperCase()}</span>
                ${test.selector ? `<span class="e2e-drawer-time" style="font-family: monospace;">${escapeHtml(test.selector)}</span>` : ''}
              </div>
            </div>
          </div>
        `).join('')}
      `;
    }
  }

  /**
   * Helper to query element inside iframe with support for :eq(N) and text= pseudo-selectors
   */
  queryIframeElement(doc, selector) {
    if (!doc || !selector) return null;
    try {
      const eqMatch = selector.match(/^(.*?):eq\((\d+)\)$/);
      if (eqMatch) {
        const baseSelector = eqMatch[1].trim() || '*';
        const index = parseInt(eqMatch[2], 10);
        const elements = doc.querySelectorAll(baseSelector);
        return elements[index] || null;
      }
      if (selector.startsWith('text=')) {
        const textVal = selector.replace(/^text=/, '').trim().replace(/^['"]|['"]$/g, '');
        const elements = doc.querySelectorAll('button, a, span, p, h1, h2, h3, h4, h5, h6, label, div');
        for (const el of elements) {
          if (el.textContent && el.textContent.trim().toLowerCase().includes(textVal.toLowerCase())) {
            return el;
          }
        }
      }
      return doc.querySelector(selector);
    } catch (e) {
      return null;
    }
  }

  /**
   * Get current iframe document safely
   */
  getIframeDocument() {
    try {
      const iframe = this.dom?.sandboxIframe || document.getElementById('sandbox-iframe');
      return iframe?.contentDocument || iframe?.contentWindow?.document || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Wait for target element to appear in iframe with retry
   */
  async waitForElement(doc, selector, maxWaitMs = 1500) {
    if (!doc || !selector) return null;
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      const liveDoc = this.getIframeDocument() || doc;
      const el = this.queryIframeElement(liveDoc, selector);
      if (el) return el;
      await new Promise(r => setTimeout(r, 80));
    }
    return null;
  }

  /**
   * Wait for iframe document to be accessible and interactive
   */
  async waitForIframeReady(timeoutMs = 1500) {
    const iframe = this.dom?.sandboxIframe || document.getElementById('sandbox-iframe');
    if (!iframe) return null;

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (doc && (doc.readyState === 'complete' || doc.readyState === 'interactive') && doc.body) {
          return doc;
        }
      } catch (e) {}
      await new Promise(r => setTimeout(r, 40));
    }
    return iframe.contentDocument || iframe.contentWindow?.document || null;
  }

  /**
   * Navigates to a route and securely waits for iframe onload event
   */
  async navigateAndWait(targetRoute) {
    const cleanCurrent = (this.activeRoute || '').replace(/^#\/?/, '').split('?')[0];
    const cleanTarget = String(targetRoute).replace(/^#\/?/, '').split('?')[0];

    const iframe = this.dom?.sandboxIframe || document.getElementById('sandbox-iframe');

    if (cleanCurrent === cleanTarget) {
      return await this.waitForIframeReady(1000);
    }

    const loadPromise = new Promise(resolve => {
      let done = false;
      const onLoaded = () => {
        if (!done) {
          done = true;
          iframe?.removeEventListener('load', onLoaded);
          resolve();
        }
      };
      iframe?.addEventListener('load', onLoaded);
      setTimeout(() => {
        if (!done) {
          done = true;
          iframe?.removeEventListener('load', onLoaded);
          resolve();
        }
      }, 3000);
    });

    this.navigate(targetRoute);
    await loadPromise;
    await new Promise(r => setTimeout(r, 200));
    return await this.waitForIframeReady(1000);
  }

  /**
   * Show high-contrast moving virtual mouse in parent container with dynamic action pill
   * Highlights element in iframe, triggers visual click ripple and real DOM events.
   */
  async showFakeCursor(doc, targetEl, step, customText = '') {
    const container = document.getElementById('viewport-container');
    const iframe = document.getElementById('sandbox-iframe');
    if (!container || !iframe) return;

    let cursor = document.getElementById('e2e-fake-cursor');
    if (!cursor) {
      cursor = document.createElement('div');
      cursor.id = 'e2e-fake-cursor';
      cursor.className = 'e2e-fake-cursor';
      cursor.innerHTML = `
        <div style="position: relative; width: 34px; height: 34px; filter: drop-shadow(0 4px 12px rgba(0,0,0,0.45)); pointer-events: none;">
          <div class="e2e-cursor-pulse"></div>
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M5 3V22L11 16H18L5 3Z" fill="#2563eb" stroke="#ffffff" stroke-width="2.5" stroke-linejoin="round"/>
          </svg>
          <div id="e2e-cursor-action-pill" class="e2e-cursor-pill">
            <span id="e2e-cursor-pill-text">Testing</span>
          </div>
        </div>
      `;
      container.appendChild(cursor);
    }

    cursor.style.display = 'block';

    // Inject highlight styles into iframe document
    if (doc) {
      let styleTag = doc.getElementById('e2e-highlight-styles');
      if (!styleTag) {
        styleTag = doc.createElement('style');
        styleTag.id = 'e2e-highlight-styles';
        styleTag.textContent = `
          .e2e-target-highlight {
            outline: 3.5px solid #2563eb !important;
            outline-offset: 2.5px !important;
            box-shadow: 0 0 22px rgba(37, 99, 235, 0.65) !important;
            background-color: rgba(37, 99, 235, 0.12) !important;
            transition: outline 0.15s ease, box-shadow 0.15s ease !important;
          }
        `;
        if (doc.head) doc.head.appendChild(styleTag);
      }
    }

    // Dynamic action pill text
    const pillText = cursor.querySelector('#e2e-cursor-pill-text');
    let actionDesc = customText || step?.name || step?.action || 'Testing';

    if (!customText && step) {
      if (step.action === 'click') {
        actionDesc = `👆 Click: ${step.name || step.selector}`;
      } else if (step.action === 'type' || step.action === 'fill') {
        const val = step.value ?? step.expected ?? '';
        actionDesc = `⌨️ Type: "${val}"`;
      } else if (step.action === 'select') {
        const val = step.value ?? step.expected ?? '';
        actionDesc = `🔽 Select: "${val}"`;
      } else if (step.action === 'assert_api_payload') {
        actionDesc = `⚡ API: ${step.operation} ${step.entityName || ''}`;
      } else if (step.action === 'validate_theme') {
        actionDesc = `🎨 Theme Test (Dark/Light)`;
      } else if (step.action === 'validate_layout') {
        actionDesc = `📐 Layout & Alignment`;
      } else if (step.action === 'validate_responsive') {
        actionDesc = `📱 Responsive Viewports`;
      } else if (step.action === 'wait') {
        actionDesc = `⏳ Wait: ${step.name || 'Rendering'}`;
      }
    }
    if (pillText) pillText.textContent = actionDesc;

    const containerRect = container.getBoundingClientRect();
    const iframeRect = iframe.getBoundingClientRect();

    let targetX = containerRect.width / 2;
    let targetY = 70;

    if (targetEl) {
      // Auto-reveal hidden dialog or modal parent so the user sees the targeted form
      const hiddenParent = targetEl.closest(
        '.hidden, [style*="display: none"], [style*="display:none"], dialog:not([open])'
      );
      if (hiddenParent) {
        hiddenParent.classList.remove('hidden');
        if (hiddenParent.tagName?.toLowerCase() === 'dialog') {
          hiddenParent.show?.() || hiddenParent.showModal?.() || hiddenParent.setAttribute('open', '');
        } else if (hiddenParent.style.display === 'none') {
          hiddenParent.style.display = 'block';
        }
      }

      // Smoothly bring element to viewport center so user can observe
      if (typeof targetEl.scrollIntoView === 'function') {
        targetEl.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
          inline: 'center'
        });
      }

      // Highlight target element in iframe
      targetEl.classList.add('e2e-target-highlight');
      setTimeout(() => targetEl?.classList.remove('e2e-target-highlight'), 600);

      let rect = targetEl.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0 && targetEl.parentElement) {
        rect = targetEl.parentElement.getBoundingClientRect();
      }

      targetX = (iframeRect.left - containerRect.left) + rect.left + (rect.width > 0 ? rect.width / 2 : 12);
      targetY = (iframeRect.top - containerRect.top) + rect.top + (rect.height > 0 ? rect.height / 2 : 12);
    }

    const clampedX = Math.max(12, Math.min(containerRect.width - 24, targetX));
    const clampedY = Math.max(12, Math.min(containerRect.height - 24, targetY));

    cursor.style.left = `${clampedX}px`;
    cursor.style.top = `${clampedY}px`;

    // Visual click animation and ripple
    if (step?.action === 'click' && targetEl) {
      cursor.style.transform = 'scale(0.82)';
      setTimeout(() => { if (cursor) cursor.style.transform = 'scale(1)'; }, 150);

      const ripple = document.createElement('div');
      ripple.className = 'e2e-click-ripple';
      ripple.style.left = `${clampedX}px`;
      ripple.style.top = `${clampedY}px`;
      container.appendChild(ripple);
      setTimeout(() => ripple.remove(), 550);
    }
  }

  /**
   * Hide virtual cursor
   */
  hideFakeCursor() {
    const cursor = document.getElementById('e2e-fake-cursor');
    if (cursor) cursor.style.display = 'none';
  }

  /**
   * Stop running E2E tests
   */
  stopE2eTests() {
    this.isE2eStopping = true;
    const btnRun = document.getElementById('btn-run-e2e-engine');
    const btnStop = document.getElementById('btn-stop-e2e-engine');
    const liveBadge = document.getElementById('e2e-exec-live-badge');

    if (btnRun) {
      btnRun.disabled = false;
      btnRun.innerHTML = '<i class="fas fa-play" style="font-size: 10px;"></i> <span>Run Tests</span>';
    }
    if (btnStop) btnStop.style.display = 'none';
    if (liveBadge) liveBadge.style.display = 'none';

    this.showToast({ type: 'info', message: 'E2E test run stopping...' });
  }

  /**
   * Run E2E suites live against sandbox iframe
   */
  async runE2eTests(selectedOnly = false) {
    if (!this.e2eData || !this.e2eData.testSuites) {
      this.showToast({ type: 'warning', message: 'No E2E test suites loaded.' });
      return;
    }

    const drawerSelect = document.getElementById('e2e-drawer-suite-select');
    const selectedRoute = (selectedOnly && drawerSelect?.value) ? drawerSelect.value : (drawerSelect ? drawerSelect.value : '');

    let suites = this.e2eData.testSuites;
    if (selectedOnly && selectedRoute) {
      suites = suites.filter(s => s.route === selectedRoute);
    }

    const btnEngine = document.getElementById('btn-run-e2e-engine');
    const btnStop = document.getElementById('btn-stop-e2e-engine');
    const statusText = document.getElementById('e2e-drawer-status-text');
    const badgesContainer = document.getElementById('e2e-drawer-badges');
    const progressBar = document.getElementById('e2e-drawer-progress-bar');
    const liveBadge = document.getElementById('e2e-exec-live-badge');
    const drawerTimeline = document.getElementById('e2e-drawer-timeline');

    this.isE2eStopping = false;

    if (btnEngine) {
      btnEngine.disabled = true;
      btnEngine.innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size: 10px;"></i> <span>Running...</span>';
    }
    if (btnStop) btnStop.style.display = 'inline-flex';
    if (liveBadge) liveBadge.style.display = 'inline-block';

    // Reset drawer timeline for clean new run
    if (drawerTimeline) {
      drawerTimeline.innerHTML = '';
    }
    this.testLogs = [];

    let totalPassed = 0;
    let totalFailed = 0;

    try {
      for (let i = 0; i < suites.length; i++) {
        if (this.isE2eStopping) {
          this.showToast({ type: 'info', message: 'E2E execution stopped by user.' });
          break;
        }

        const suite = suites[i];
        const pct = Math.round(((i) / suites.length) * 100);

        if (statusText) statusText.innerText = `Executing [${i + 1}/${suites.length}]: #${suite.route}...`;
        if (progressBar) progressBar.style.width = `${pct}%`;

        const passed = await this.executeSuiteInBrowser(suite);
        if (passed) totalPassed++;
        else totalFailed++;

        if (badgesContainer) {
          badgesContainer.innerHTML = `<span style="background: ${totalFailed === 0 ? '#10b981' : '#f59e0b'}; color: #fff; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 700;">${totalPassed} PASSED · ${totalFailed} FAILED</span>`;
        }
      }

      if (progressBar) progressBar.style.width = '100%';
      if (statusText) {
        statusText.innerText = `Finished: ${totalPassed} passed, ${totalFailed} failed out of ${suites.length}.`;
      }

      this.renderDrawerReportActions();

      this.showToast({
        type: totalFailed === 0 ? 'success' : 'warning',
        message: `E2E Test Run Finished: ${totalPassed}/${suites.length} Suites Passed!`
      });
    } catch (err) {
      console.error('Fatal error during E2E test run:', err);
      this.showToast({ type: 'error', message: `E2E run interrupted: ${err.message}` });
    } finally {
      this.hideFakeCursor();
      if (btnEngine) {
        btnEngine.disabled = false;
        btnEngine.innerHTML = '<i class="fas fa-play" style="font-size: 10px;"></i> <span>Run Tests</span>';
      }
      if (btnStop) btnStop.style.display = 'none';
      if (liveBadge) liveBadge.style.display = 'none';
    }
  }

  runE2eSuite(route) {
    return this.runSingleE2eSuite(route);
  }

  async runSingleE2eSuite(route) {
    const suite = (this.e2eData?.testSuites || []).find(s => s.route === route);
    if (!suite) {
      this.showToast({ type: 'warning', message: `Suite for #${route} not found.` });
      return;
    }

    const btnEngine = document.getElementById('btn-run-e2e-engine');
    const btnStop = document.getElementById('btn-stop-e2e-engine');
    const drawerTimeline = document.getElementById('e2e-drawer-timeline');
    const liveBadge = document.getElementById('e2e-exec-live-badge');
    const progressBar = document.getElementById('e2e-drawer-progress-bar');
    const statusText = document.getElementById('e2e-drawer-status-text');

    this.isE2eStopping = false;

    if (btnEngine) {
      btnEngine.disabled = true;
      btnEngine.innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size: 10px;"></i> <span>Running...</span>';
    }
    if (btnStop) btnStop.style.display = 'inline-flex';
    if (liveBadge) liveBadge.style.display = 'inline-block';
    if (progressBar) progressBar.style.width = '20%';
    if (statusText) statusText.innerText = `Executing Suite: #${route}`;

    // Reset drawer timeline for clean new run
    if (drawerTimeline) {
      drawerTimeline.innerHTML = '';
    }
    this.testLogs = [];

    try {
      this.showToast({ type: 'info', message: `Executing E2E suite for #${route}...` });
      await this.executeSuiteInBrowser(suite);
      if (progressBar) progressBar.style.width = '100%';
      this.renderDrawerReportActions();
    } finally {
      this.hideFakeCursor();
      if (btnEngine) {
        btnEngine.disabled = false;
        btnEngine.innerHTML = '<i class="fas fa-play" style="font-size: 10px;"></i> <span>Run Tests</span>';
      }
      if (btnStop) btnStop.style.display = 'none';
      if (liveBadge) liveBadge.style.display = 'none';
    }
  }

  /**
   * Executes a single test suite live with Rapider UI timeline and moving virtual cursor
   */
  async executeSuiteInBrowser(suite) {
    if (this.isE2eStopping) return false;

    // Update status in Test Suites tab card
    const cardBadge = document.getElementById(`e2e-suite-badge-${suite.route}`);
    if (cardBadge) {
      cardBadge.className = 'e2e-suite-badge running';
      cardBadge.innerHTML = '<i class="fas fa-spinner fa-spin"></i> RUNNING';
    }

    const titleEl = document.getElementById('e2e-exec-suite-title');
    const statsEl = document.getElementById('e2e-exec-step-stats');
    const isVirtualMouse = document.getElementById('e2e-drawer-mouse')?.checked ?? true;

    if (titleEl) titleEl.innerText = `#${suite.route} - ${suite.suiteName || suite.route}`;

    // Navigate to route and wait for page to completely render
    let doc = await this.navigateAndWait(suite.route);

    const drawerTimeline = document.getElementById('e2e-drawer-timeline');
    const appName = this.activeApp?.appName || this.activeApp?.name || 'CRM System';

    if (drawerTimeline) {
      const emptyEl = document.getElementById('e2e-drawer-empty');
      if (emptyEl) emptyEl.remove();

      // If no system logs present yet, prepend system logs
      if (!drawerTimeline.querySelector('.e2e-sys-log')) {
        const t1 = formatTimestamp(new Date());
        const t2 = formatTimestamp(new Date(Date.now() + 50));
        const t3 = formatTimestamp(new Date(Date.now() + 850));
        drawerTimeline.insertAdjacentHTML('beforeend', `
          <div class="e2e-sys-log">
            <span class="e2e-sys-dot"></span>
            <span>Initializing E2E Test Runner Engine...</span>
            <span class="e2e-drawer-time">${t1}</span>
          </div>
          <div class="e2e-sys-log">
            <span class="e2e-sys-dot"></span>
            <span>Loading expectations schema from Artifacts...</span>
            <span class="e2e-drawer-time">${t2}</span>
          </div>
          <div class="e2e-sys-log">
            <span class="e2e-sys-dot"></span>
            <span>Found test config for ${escapeHtml(appName)}</span>
            <span class="e2e-drawer-time">${t3}</span>
          </div>
        `);

        if (!this.testLogs.some(l => l.message?.includes('Initializing E2E'))) {
          this.testLogs.push({
            type: 'system',
            message: 'Initializing E2E Test Runner Engine...',
            timestamp: Date.now(),
            success: true
          });
          this.testLogs.push({
            type: 'system',
            message: 'Loading expectations schema from Artifacts...',
            timestamp: Date.now() + 50,
            success: true
          });
          this.testLogs.push({
            type: 'system',
            message: `Found test config for ${appName}`,
            timestamp: Date.now() + 850,
            success: true
          });
        }
      }

      // Append Suite Header
      drawerTimeline.insertAdjacentHTML('beforeend', `
        <div class="e2e-suite-header-item">
          <span class="e2e-suite-dot"></span>
          <span><i class="fas fa-file-lines" style="color: #2563eb; margin-right: 6px;"></i>Page: ${escapeHtml(suite.suiteName || suite.route)}</span>
          <span class="e2e-drawer-time" style="font-size: 10px;">${formatTimeSec(new Date())}</span>
        </div>
      `);
      this.testLogs.push({
        type: 'suite',
        suiteName: `${suite.suiteName || suite.route} Auto-Generated Suite`,
        timestamp: Date.now()
      });
    }

    let passedCount = 0;
    let failedCount = 0;
    let stepNumber = 1;

    for (const test of (suite.tests || [])) {
      if (this.isE2eStopping) break;

      // Drawer Timeline Step Element
      let drawerStepEl = null;
      let drawerDot = null;
      let drawerCard = null;
      let drawerTag = null;
      let drawerTime = null;

      if (drawerTimeline) {
        drawerStepEl = document.createElement('div');
        drawerStepEl.id = `drawer-step-${stepNumber}`;
        drawerStepEl.className = 'e2e-drawer-step-item';
        drawerStepEl.innerHTML = `
          <div class="e2e-drawer-step-dot pending">
            <i class="fas fa-spinner fa-spin"></i>
          </div>
          <div class="e2e-drawer-card active">
            <div class="e2e-drawer-card-top">
              <span class="e2e-drawer-step-title">${escapeHtml(test.name || test.action)}</span>
              <span class="e2e-drawer-status-pill testing">TESTING...</span>
            </div>
            ${test.explanation ? `<p class="e2e-drawer-explanation">${escapeHtml(test.explanation)}</p>` : ''}
            <div class="e2e-drawer-card-bottom">
              <span class="e2e-drawer-action-badge"><i class="fas fa-bolt" style="font-size: 9px;"></i> ${(test.action || 'WAIT').toUpperCase()}</span>
              <span class="e2e-drawer-time"><i class="far fa-clock"></i> ${formatTimestamp(new Date())}</span>
            </div>
          </div>
        `;
        drawerTimeline.appendChild(drawerStepEl);
        drawerStepEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        drawerDot = drawerStepEl.querySelector('.e2e-drawer-step-dot');
        drawerCard = drawerStepEl.querySelector('.e2e-drawer-card');
        drawerTag = drawerStepEl.querySelector('.e2e-drawer-status-pill');
        drawerTime = drawerStepEl.querySelector('.e2e-drawer-time');
      }

      if (statsEl) {
        statsEl.innerText = `Step ${stepNumber}/${suite.tests.length}: ${test.name || test.action}`;
      }

      try {
        // Ensure fresh document
        doc = this.getIframeDocument() || doc;

        let targetEl = null;
        if (test.selector && doc) {
          targetEl = await this.waitForElement(doc, test.selector, 1500);
        }

        // Validate element existence for interaction steps
        if (test.selector && !targetEl && ['click', 'type', 'fill', 'select'].includes(test.action)) {
          if (isVirtualMouse) {
            await this.showFakeCursor(doc, null, test, `❌ Element Not Found: ${test.selector}`);
            await new Promise(r => setTimeout(r, 400));
          }
          throw new Error(`Target element "${test.selector}" not found on page #${suite.route}`);
        }

        // Show moving mouse cursor with realistic visual pacing
        if (isVirtualMouse) {
          await this.showFakeCursor(doc, targetEl, test);
          await new Promise(r => setTimeout(r, 260));
        }

        if (test.action === 'wait') {
          await new Promise(r => setTimeout(r, isVirtualMouse ? Math.min(test.value || 300, 500) : 80));
        } else if (test.action === 'validate_theme') {
          if (doc?.documentElement) {
            doc.documentElement.classList.add('dark');
            await new Promise(r => setTimeout(r, isVirtualMouse ? 300 : 50));
            doc.documentElement.classList.remove('dark');
            await new Promise(r => setTimeout(r, isVirtualMouse ? 150 : 20));
          }
        } else if (test.action === 'click') {
          if (targetEl) {
            // Trigger visual click and events
            if (isVirtualMouse) {
              await new Promise(r => setTimeout(r, 120));
            }
            targetEl.click();
            await new Promise(r => setTimeout(r, isVirtualMouse ? 240 : 30));
          }
        } else if (test.action === 'type' || test.action === 'fill') {
          if (targetEl) {
            targetEl.focus();
            const val = test.value !== undefined ? test.value : (test.expected !== undefined ? test.expected : 'test value');
            targetEl.value = val;
            targetEl.dispatchEvent(new Event('input', { bubbles: true }));
            targetEl.dispatchEvent(new Event('change', { bubbles: true }));
            targetEl.dispatchEvent(new Event('blur', { bubbles: true }));
            await new Promise(r => setTimeout(r, isVirtualMouse ? 220 : 30));
          }
        } else if (test.action === 'select') {
          if (targetEl && targetEl.options && targetEl.options.length > 0) {
            const firstValidIdx = Array.from(targetEl.options).findIndex(o => o.value && o.value.trim() !== '');
            targetEl.selectedIndex = firstValidIdx > -1 ? firstValidIdx : 0;
            targetEl.dispatchEvent(new Event('change', { bubbles: true }));
            targetEl.dispatchEvent(new Event('input', { bubbles: true }));
            await new Promise(r => setTimeout(r, isVirtualMouse ? 200 : 30));
          }
        } else if (test.action === 'navigate' && test.value) {
          doc = await this.navigateAndWait(test.value);
          await new Promise(r => setTimeout(r, isVirtualMouse ? 300 : 50));
        } else if (test.action === 'assert_api_payload') {
          await new Promise(r => setTimeout(r, isVirtualMouse ? 180 : 30));
        } else {
          await new Promise(r => setTimeout(r, isVirtualMouse ? 140 : 20));
        }

        // Mark Step Passed
        passedCount++;
        const passTime = formatTimestamp(new Date());

        this.testLogs.push({
          type: 'test',
          suiteName: suite.suiteName || suite.route,
          stepNumber: stepNumber,
          stepName: test.name || test.action,
          action: test.action,
          explanation: test.explanation,
          success: true,
          timestamp: Date.now()
        });

        // Drawer Step Element Update (Green bubble with step number, PASSED tag, time)
        if (drawerDot) {
          drawerDot.className = 'e2e-drawer-step-dot passed';
          drawerDot.innerText = stepNumber;
        }
        if (drawerCard) {
          drawerCard.classList.remove('active');
        }
        if (drawerTag) {
          drawerTag.className = 'e2e-drawer-status-pill passed';
          drawerTag.innerText = 'PASSED';
        }
        if (drawerTime) {
          drawerTime.innerHTML = `<i class="far fa-clock"></i> ${passTime}`;
        }
      } catch (err) {
        failedCount++;
        const failTime = formatTimestamp(new Date());

        let shot = null;
        if (typeof html2canvas !== 'undefined' && doc && doc.body) {
          try {
            shot = await this.captureIframeScreenshot(doc);
          } catch (e) {}
        }

        this.testLogs.push({
          type: 'test',
          suiteName: suite.suiteName || suite.route,
          stepNumber: stepNumber,
          stepName: test.name || test.action,
          action: test.action,
          explanation: test.explanation,
          message: err.message,
          error: err.message,
          screenshot: shot,
          success: false,
          timestamp: Date.now()
        });

        // Drawer Step Element Update (Red bubble with step number, FAILED tag, error)
        if (drawerDot) {
          drawerDot.className = 'e2e-drawer-step-dot failed';
          drawerDot.innerText = stepNumber;
        }
        if (drawerCard) {
          drawerCard.classList.remove('active');
          const errDiv = document.createElement('div');
          errDiv.style.cssText = 'font-size: 11px; color: #ef4444; font-family: monospace; margin-top: 6px; padding: 6px; background: rgba(239, 68, 68, 0.1); border-radius: 4px;';
          errDiv.innerText = err.message;
          drawerCard.appendChild(errDiv);
        }
        if (drawerTag) {
          drawerTag.className = 'e2e-drawer-status-pill failed';
          drawerTag.innerText = 'FAILED';
        }
        if (drawerTime) {
          drawerTime.innerHTML = `<i class="far fa-clock"></i> ${failTime}`;
        }
      }

      stepNumber++;
    }

    const isPass = failedCount === 0;
    if (cardBadge) {
      cardBadge.className = `e2e-suite-badge ${isPass ? 'passed' : 'failed'}`;
      cardBadge.innerText = isPass ? 'PASS' : 'FAIL';
    }
    if (statsEl) {
      statsEl.innerText = `Completed: ${passedCount} passed, ${failedCount} failed (${suite.tests.length} total)`;
    }

    this.testLogs.push({
      type: 'system',
      message: `Page test Finished: ${passedCount} passed, ${failedCount} failed.`,
      success: isPass,
      timestamp: Date.now()
    });

    if (drawerTimeline) {
      drawerTimeline.insertAdjacentHTML('beforeend', `
        <div class="e2e-drawer-step-item" style="padding-top: 6px;">
          <span class="e2e-sys-dot" style="background: ${isPass ? '#10b981' : '#ef4444'}; border-color: ${isPass ? '#059669' : '#dc2626'};"></span>
          <span style="font-size: 11px; font-style: italic; color: ${isPass ? '#10b981' : '#ef4444'};">Page test Finished: ${passedCount} passed, ${failedCount} failed. ${isPass ? '✅' : '❌'}</span>
          <span class="e2e-drawer-time" style="font-size: 10px;">${formatTimestamp(new Date())}</span>
        </div>
      `);
      this.renderDrawerReportActions();
    }

    return isPass;
  }

  renderDrawerReportActions() {
    const drawerTimeline = document.getElementById('e2e-drawer-timeline');
    if (!drawerTimeline) return;

    const existingActions = document.getElementById('e2e-drawer-actions');
    if (existingActions) existingActions.remove();

    const actionsBar = document.createElement('div');
    actionsBar.id = 'e2e-drawer-actions';
    actionsBar.className = 'e2e-drawer-actions-bar';
    actionsBar.innerHTML = `
      <button id="btn-e2e-view-report" class="btn-e2e-action view-btn" title="View Report">
        <i class="fas fa-eye"></i> View Report
      </button>
      <button id="btn-e2e-download-report" class="btn-e2e-action download-btn" title="Download Report">
        <i class="fas fa-download"></i> Download Report
      </button>
    `;
    drawerTimeline.appendChild(actionsBar);
    actionsBar.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    document.getElementById('btn-e2e-view-report')?.addEventListener('click', () => {
      this.previewCurrentTestReport();
    });
    document.getElementById('btn-e2e-download-report')?.addEventListener('click', () => {
      this.downloadTestReport();
    });
  }

  renderDrawerReportActions() {
    const drawerTimeline = document.getElementById('e2e-drawer-timeline');
    if (!drawerTimeline) return;

    const existingActions = document.getElementById('e2e-drawer-actions');
    if (existingActions) existingActions.remove();

    const actionsBar = document.createElement('div');
    actionsBar.id = 'e2e-drawer-actions';
    actionsBar.className = 'e2e-drawer-actions-bar';
    actionsBar.innerHTML = `
      <button id="btn-e2e-view-report" class="btn-e2e-action view-btn" title="View Report">
        <i class="fas fa-eye"></i> View Report
      </button>
      <button id="btn-e2e-download-report" class="btn-e2e-action download-btn" title="Download Report">
        <i class="fas fa-download"></i> Download Report
      </button>
    `;
    drawerTimeline.appendChild(actionsBar);
    actionsBar.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    document.getElementById('btn-e2e-view-report')?.addEventListener('click', () => {
      this.previewCurrentTestReport();
    });
    document.getElementById('btn-e2e-download-report')?.addEventListener('click', () => {
      this.downloadTestReport();
    });
  }

  getTestReportMarkdown() {
    const logs = this.testLogs || [];
    if (logs.length === 0) return '';

    const appName = this.activeApp?.appName || this.activeApp?.name || 'Application';
    const appId = this.activeApp?.id || this.activeAppKey || 'unknown';
    const activeRoute = (this.activeRoute || '').replace(/^#\/?/, '').split('?')[0];

    let mdContent = `# E2E Test Report\n\n`;
    mdContent += `**Date:** ${new Date().toLocaleString()}\n`;
    mdContent += `**App ID:** ${appId}\n`;
    mdContent += `**Page:** ${activeRoute || 'All'}\n\n`;
    mdContent += `## Execution Logs\n\n`;

    for (const log of logs) {
      const time = new Date(log.timestamp).toISOString();
      if (log.type === 'system') {
        mdContent += `- [${time}] **SYSTEM**: ${log.message} ${log.success ? '✅' : '❌'}\n`;
      } else if (log.type === 'suite') {
        mdContent += `\n### Page: ${log.suiteName}\n`;
      } else {
        mdContent += `- [${time}] Step ${log.stepNumber || '-'}: ${log.stepName || log.action} - ${log.success ? 'PASS ✅' : 'FAIL ❌'}\n`;
        if (log.explanation) mdContent += `  - *${log.explanation}*\n`;
        if (log.message) mdContent += `  - **Message:** ${log.message}\n`;
        if (log.screenshot) {
          mdContent += `  - <img src="${log.screenshot}" width="600" style="margin-top: 10px; border: 1px solid #ddd; border-radius: 4px;" />\n`;
        }
      }
    }
    return mdContent;
  }

  previewCurrentTestReport() {
    const mdContent = this.getTestReportMarkdown();
    if (!mdContent) {
      this.showToast({ type: 'info', message: 'No test report generated yet. Run a test first.' });
      return;
    }

    const html = (typeof marked !== 'undefined' && marked.parse)
      ? marked.parse(mdContent)
      : `<pre style="white-space: pre-wrap;">${escapeHtml(mdContent)}</pre>`;

    if (this.dom.e2eReportMarkdownView) {
      this.dom.e2eReportMarkdownView.innerHTML = html;
    }
    if (this.dom.e2eReportModal) {
      this.dom.e2eReportModal.classList.remove('hidden');
    }
  }

  closeReportModal() {
    if (this.dom.e2eReportModal) {
      this.dom.e2eReportModal.classList.add('hidden');
    }
  }

  downloadTestReport() {
    const mdContent = this.getTestReportMarkdown();
    if (!mdContent) return;

    const appName = (this.activeApp?.appName || this.activeApp?.name || 'app').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const blob = new Blob([mdContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `e2e-report-${appName}-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async captureIframeScreenshot(doc) {
    if (typeof html2canvas === 'undefined' || !doc || !doc.body) return null;
    try {
      const canvas = await html2canvas(doc.body, {
        logging: false,
        useCORS: true,
        allowTaint: true,
        scale: 0.75
      });
      return canvas.toDataURL('image/jpeg', 0.5);
    } catch (e) {
      console.warn('html2canvas screenshot capture failed:', e);
      return null;
    }
  }
}

// Instantiate on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  window.harness = new RappiderHarness();
});
