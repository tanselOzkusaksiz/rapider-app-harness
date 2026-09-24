/**
 * harness.js
 * Main UI Controller for Rappider Application Test Harness.
 */

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
      jsonViewerContent: document.getElementById('json-viewer-content'),
      jsonViewerCloseBtn: document.getElementById('json-viewer-close-btn')
    };

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
    if (window.apiClient.isAuthenticated() && !this.isOfflineMode) {
      try {
        await window.apiClient.fetchUserProjects();
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

    const webPages = this.manifest.webPages || [];
    const filterText = (this.dom.sidebarSearchInput?.value || '').toLowerCase().trim();

    webPages.forEach(page => {
      if (filterText && !page.name.toLowerCase().includes(filterText) && !page.route.toLowerCase().includes(filterText)) {
        return;
      }

      const item = document.createElement('a');
      item.className = 'nav-item';
      item.href = `#/${page.route}`;
      item.dataset.route = page.route;

      const iconClass = page.icon || this.inferPageIcon(page.name, page.route);

      item.innerHTML = `
        <div class="nav-item-left">
          <i class="${iconClass}"></i>
          <span>${page.name}</span>
        </div>
        <span class="nav-item-route">${page.route}</span>
      `;

      item.addEventListener('click', (e) => {
        e.preventDefault();
        this.navigate(page.route);
      });

      this.dom.sidebarNavList.appendChild(item);
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
    const cleanCurrent = current.replace(/^\//, '').split('?')[0].split('/')[0];

    const items = this.dom.sidebarNavList.querySelectorAll('.nav-item');
    items.forEach(item => {
      const itemRoute = item.dataset.route.replace(/^\//, '').split('/')[0];
      if (itemRoute === cleanCurrent) {
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
    
    let queryStr = '';
    if (payload && payload.queryParams) {
      const searchParams = new URLSearchParams();
      for (const key in payload.queryParams) {
        searchParams.append(key, payload.queryParams[key]);
      }
      queryStr = '?' + searchParams.toString();
    }

    const cleanRoute = routeStr.replace(/^\//, '');
    window.location.hash = `#/${cleanRoute}${queryStr}`;
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
    const webPages = this.manifest.webPages || [];
    
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

    // Fallback if not directly in webPages
    let htmlFilePath = matchedPage?.htmlFilePath;
    if (!htmlFilePath) {
      // Convention fallback: pages/[route]/[route].html
      const baseSlug = route.split('/')[0];
      htmlFilePath = `pages/${baseSlug}/${baseSlug}.html`;
    }

    // Update URL bar
    if (this.dom.urlBarText) {
      this.dom.urlBarText.innerText = `/${route}`;
    }

    // Show Loader
    if (this.dom.iframeLoader) this.dom.iframeLoader.classList.add('active');

    const paramQuery = Object.keys(params).length > 0 
      ? `&routeParams=${encodeURIComponent(JSON.stringify(params))}&id=${encodeURIComponent(params.id || '')}` 
      : '';
    const iframeUrl = `/api/page-content?appPath=${encodeURIComponent(this.activeApp.absolutePath)}&filePath=${encodeURIComponent(htmlFilePath)}&isDark=${this.isDarkTheme}${paramQuery}&t=${Date.now()}`;
    
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
  }

  resolveHtmlPathForRoute(route) {
    if (!this.manifest) return `pages/${route}/${route}.html`;
    const matched = (this.manifest.webPages || []).find(p => p.route === route);
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

      if (savedUrl) {
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
    if (this.dom.modalCloseBtn) {
      this.dom.modalCloseBtn.addEventListener('click', () => this.closePageModal());
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

  }
}

// Instantiate on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  window.harness = new RappiderHarness();
});
