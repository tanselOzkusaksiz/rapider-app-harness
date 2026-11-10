/**
 * slideshow.js
 * TourXel Screen Guides Slideshow Harness Controller.
 * Handles catalog navigation, image pan/zoom, markdown rendering, draggable splitter,
 * and Rapider workspace authentication via apiClient.
 */

class TourXelSlideshowApp {
  constructor() {
    this.catalog = [];
    this.modules = [];
    this.currentIndex = 0;
    this.currentScreen = null;
    this.currentLang = 'tr'; // 'tr' | 'en'
    this.currentImageMode = 'annotated'; // 'annotated' | 'raw' | 'sec1' | 'sec2'...
    this.isSidebarOpen = false;
    this.activeModuleFilter = 'all';

    // Viewer Zoom & Pan state
    this.zoomScale = 1;
    this.panX = 0;
    this.panY = 0;
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.isPeekingRaw = false;

    // Splitter state
    this.isResizingSplitter = false;

    // Cache
    this.markdownCache = {};

    // DOM Elements Cache
    this.dom = {
      appShell: document.getElementById('app-shell'),
      sidebar: document.getElementById('sidebar'),
      sidebarBackdrop: document.getElementById('sidebar-backdrop'),
      btnToggleSidebar: document.getElementById('btn-toggle-sidebar'),
      btnCloseSidebar: document.getElementById('btn-close-sidebar'),
      sidebarCountBadge: document.getElementById('sidebar-count-badge'),
      sidebarSearchInput: document.getElementById('sidebar-search-input'),
      sidebarModulePills: document.getElementById('sidebar-module-pills'),
      sidebarNavList: document.getElementById('sidebar-nav-list'),
      
      // Header Nav
      btnPrev: document.getElementById('btn-prev'),
      btnNext: document.getElementById('btn-next'),
      currentSlideNo: document.getElementById('current-slide-no'),
      totalSlidesCount: document.getElementById('total-slides-count'),
      slideSelect: document.getElementById('slide-select'),
      btnToggleLang: document.getElementById('btn-toggle-lang'),
      langFlag: document.getElementById('lang-flag'),
      langLabel: document.getElementById('lang-label'),

      // Workspace & Auth
      projectBadge: document.getElementById('project-badge'),
      projectStatusDot: document.getElementById('project-status-dot'),
      projectNameText: document.getElementById('project-name-text'),
      projectSelectorMenu: document.getElementById('project-selector-menu'),
      btnOpenAuth: document.getElementById('btn-open-auth'),
      authModal: document.getElementById('auth-modal'),
      authCloseBtn: document.getElementById('auth-close-btn'),
      authForm: document.getElementById('auth-login-form'),
      authBanner: document.getElementById('auth-banner'),
      authProjectSelect: document.getElementById('auth-project-select'),

      // Content Area Image Viewer
      contentArea: document.getElementById('content-area'),
      modeBtnAnnotated: document.getElementById('mode-btn-annotated'),
      modeBtnRaw: document.getElementById('mode-btn-raw'),
      sectionPillsContainer: document.getElementById('section-images-strip'),
      imageMetaPill: document.getElementById('image-meta-pill'),
      viewportStage: document.getElementById('viewport-stage'),
      canvasWrapper: document.getElementById('image-canvas-wrapper'),
      mainImage: document.getElementById('main-image'),
      imageLoadingOverlay: document.getElementById('image-loading-overlay'),
      btnZoomIn: document.getElementById('btn-zoom-in'),
      btnZoomOut: document.getElementById('btn-zoom-out'),
      btnZoomReset: document.getElementById('btn-zoom-reset'),
      btnFullscreen: document.getElementById('btn-fullscreen'),

      // Splitter
      splitter: document.getElementById('splitter'),

      // Right Panel Markdown
      rightPanel: document.getElementById('right-panel'),
      guideFileBadge: document.getElementById('guide-file-badge'),
      routePill: document.getElementById('route-pill'),
      btnViewManual: document.getElementById('btn-view-manual'),
      btnToggleRawMd: document.getElementById('btn-toggle-raw-md'),
      btnCopyMd: document.getElementById('btn-copy-md'),
      markdownContainer: document.getElementById('markdown-container'),
      rawMarkdownView: document.getElementById('raw-markdown-view'),

      // Modals
      manualModal: document.getElementById('manual-modal'),
      manualModalTitle: document.getElementById('manual-modal-title'),
      manualModalBody: document.getElementById('manual-modal-body'),
      manualModalCloseBtn: document.getElementById('manual-modal-close-btn'),
      toastContainer: document.getElementById('toast-container')
    };
  }

  async init() {
    this.setupEventListeners();
    this.setupSplitter();
    this.setupImageViewer();
    this.setupKeyboardShortcuts();
    this.restoreSplitterWidth();

    // 1. Initialize Auth via apiClient
    await this.initAuth();

    // 2. Load Screen Guides Catalog
    await this.loadCatalog();

    // 3. Resolve initial route / screen
    this.resolveInitialScreen();
  }

  // ==========================================================================
  // CATALOG LOADING & ROUTING
  // ==========================================================================
  async loadCatalog() {
    try {
      const res = await fetch('/api/screen-guides/catalog');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this.catalog = data.screens || [];
      this.modules = data.modules || [];

      if (this.dom.totalSlidesCount) {
        this.dom.totalSlidesCount.innerText = this.catalog.length;
      }
      if (this.dom.sidebarCountBadge) {
        this.dom.sidebarCountBadge.innerText = this.catalog.length;
      }

      this.renderModuleFilterPills();
      this.renderSidebarNavList();
      this.populateSlideSelect();
    } catch (err) {
      console.error('[Slideshow] Failed to load catalog:', err);
      this.showToast({ type: 'error', message: 'Failed to load screen catalog.' });
    }
  }

  resolveInitialScreen() {
    if (!this.catalog || this.catalog.length === 0) return;

    // Check hash (e.g. #22 or #/22 or #/screen/22)
    const hash = window.location.hash.replace(/^#\/?(screen\/)?/, '').trim();
    let targetIndex = -1;

    if (hash) {
      targetIndex = this.catalog.findIndex(s => s.no === hash || s.prefix === hash);
    }

    if (targetIndex === -1) {
      // Check query param ?no=22
      const urlParams = new URLSearchParams(window.location.search);
      const noParam = urlParams.get('no') || urlParams.get('screen');
      if (noParam) {
        targetIndex = this.catalog.findIndex(s => s.no === noParam);
      }
    }

    // Default to screen 22 if present (user sample) or first screen
    if (targetIndex === -1) {
      const sample22 = this.catalog.findIndex(s => s.no === '22');
      targetIndex = sample22 !== -1 ? sample22 : 0;
    }

    this.goToScreenByIndex(targetIndex);
  }

  goToScreenByIndex(index) {
    if (index < 0 || index >= this.catalog.length) return;
    this.currentIndex = index;
    this.currentScreen = this.catalog[index];
    this.currentImageMode = 'annotated'; // reset to annotated image on page switch

    // Update URL Hash without trigger loop
    window.location.hash = `#/${this.currentScreen.no}`;

    // Update Header
    if (this.dom.currentSlideNo) {
      this.dom.currentSlideNo.innerText = this.currentScreen.no;
    }
    if (this.dom.slideSelect) {
      this.dom.slideSelect.value = this.currentScreen.no;
    }
    if (this.dom.btnPrev) {
      this.dom.btnPrev.disabled = this.currentIndex === 0;
    }
    if (this.dom.btnNext) {
      this.dom.btnNext.disabled = this.currentIndex === this.catalog.length - 1;
    }

    // Update Sidebar active state & scroll into view
    this.updateActiveSidebarItem();

    // Render Viewport Image
    this.renderActiveImage();

    // Render Sub-section pills
    this.renderSectionPills();

    // Render Markdown on Right Panel
    this.loadAndRenderMarkdown();
  }

  goToPrevScreen() {
    if (this.currentIndex > 0) {
      this.goToScreenByIndex(this.currentIndex - 1);
    }
  }

  goToNextScreen() {
    if (this.currentIndex < this.catalog.length - 1) {
      this.goToScreenByIndex(this.currentIndex + 1);
    }
  }

  // ==========================================================================
  // SIDEBAR NAVIGATION RENDERING
  // ==========================================================================
  renderModuleFilterPills() {
    if (!this.dom.sidebarModulePills) return;
    this.dom.sidebarModulePills.innerHTML = '';

    const allBtn = document.createElement('button');
    allBtn.className = `module-pill ${this.activeModuleFilter === 'all' ? 'active' : ''}`;
    allBtn.innerText = 'Tümü (All 53)';
    allBtn.addEventListener('click', () => {
      this.activeModuleFilter = 'all';
      this.renderModuleFilterPills();
      this.renderSidebarNavList();
    });
    this.dom.sidebarModulePills.appendChild(allBtn);

    this.modules.forEach(mod => {
      const pill = document.createElement('button');
      pill.className = `module-pill ${this.activeModuleFilter === mod.id ? 'active' : ''}`;
      pill.innerText = this.currentLang === 'tr' ? mod.nameTr : mod.nameEn;
      pill.addEventListener('click', () => {
        this.activeModuleFilter = mod.id;
        this.renderModuleFilterPills();
        this.renderSidebarNavList();
      });
      this.dom.sidebarModulePills.appendChild(pill);
    });
  }

  renderSidebarNavList() {
    if (!this.dom.sidebarNavList) return;
    this.dom.sidebarNavList.innerHTML = '';

    const searchTerm = (this.dom.sidebarSearchInput?.value || '').toLowerCase().trim();

    let lastModuleId = null;

    this.catalog.forEach(screen => {
      // Filter by module
      if (this.activeModuleFilter !== 'all' && screen.module.id !== this.activeModuleFilter) {
        return;
      }

      // Filter by search
      if (searchTerm) {
        const matchNo = screen.no.toLowerCase().includes(searchTerm);
        const matchTitleTr = screen.titleTr.toLowerCase().includes(searchTerm);
        const matchTitleEn = screen.titleEn.toLowerCase().includes(searchTerm);
        const matchRoute = screen.route.toLowerCase().includes(searchTerm);
        const matchMod = screen.module.nameTr.toLowerCase().includes(searchTerm);
        if (!matchNo && !matchTitleTr && !matchTitleEn && !matchRoute && !matchMod) {
          return;
        }
      }

      // Render module heading if new
      if (screen.module.id !== lastModuleId) {
        lastModuleId = screen.module.id;
        const heading = document.createElement('div');
        heading.className = 'nav-module-heading';
        heading.innerHTML = `<i class="${screen.module.icon}"></i> <span>${this.currentLang === 'tr' ? screen.module.nameTr : screen.module.nameEn}</span>`;
        this.dom.sidebarNavList.appendChild(heading);
      }

      const item = document.createElement('a');
      item.href = `#/${screen.no}`;
      item.className = `nav-item ${this.currentScreen && this.currentScreen.no === screen.no ? 'active' : ''}`;
      item.dataset.no = screen.no;

      const title = this.currentLang === 'tr' ? screen.titleTr : screen.titleEn;

      item.innerHTML = `
        <span class="nav-item-no">${screen.no}</span>
        <div class="nav-item-body">
          <span class="nav-item-title" title="${escapeHtml(title)}">${escapeHtml(title)}</span>
          <span class="nav-item-route">${escapeHtml(screen.route)}</span>
        </div>
      `;

      item.addEventListener('click', (e) => {
        e.preventDefault();
        const targetIdx = this.catalog.findIndex(s => s.no === screen.no);
        if (targetIdx !== -1) {
          this.goToScreenByIndex(targetIdx);
        }
      });

      this.dom.sidebarNavList.appendChild(item);
    });
  }

  updateActiveSidebarItem() {
    if (!this.dom.sidebarNavList) return;
    const items = this.dom.sidebarNavList.querySelectorAll('.nav-item');
    items.forEach(el => {
      if (el.dataset.no === this.currentScreen.no) {
        el.classList.add('active');
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        el.classList.remove('active');
      }
    });
  }

  populateSlideSelect() {
    if (!this.dom.slideSelect) return;
    this.dom.slideSelect.innerHTML = '';
    this.catalog.forEach(screen => {
      const opt = document.createElement('option');
      opt.value = screen.no;
      const title = this.currentLang === 'tr' ? screen.titleTr : screen.titleEn;
      opt.innerText = `${screen.no} - ${title}`;
      this.dom.slideSelect.appendChild(opt);
    });
  }

  // ==========================================================================
  // IMAGE VIEWER & PAN / ZOOM
  // ==========================================================================
  setupImageViewer() {
    // Mode toggle buttons
    if (this.dom.modeBtnAnnotated) {
      this.dom.modeBtnAnnotated.addEventListener('click', () => this.setImageMode('annotated'));
    }
    if (this.dom.modeBtnRaw) {
      this.dom.modeBtnRaw.addEventListener('click', () => this.setImageMode('raw'));
    }

    // Zoom buttons
    if (this.dom.btnZoomIn) {
      this.dom.btnZoomIn.addEventListener('click', () => this.zoom(0.2));
    }
    if (this.dom.btnZoomOut) {
      this.dom.btnZoomOut.addEventListener('click', () => this.zoom(-0.2));
    }
    if (this.dom.btnZoomReset) {
      this.dom.btnZoomReset.addEventListener('click', () => this.resetZoom());
    }
    if (this.dom.btnFullscreen) {
      this.dom.btnFullscreen.addEventListener('click', () => this.toggleFullscreen());
    }

    // Wheel Zoom
    if (this.dom.viewportStage) {
      this.dom.viewportStage.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.15 : -0.15;
        this.zoom(delta);
      }, { passive: false });
    }

    // Drag to pan
    const wrapper = this.dom.canvasWrapper;
    if (wrapper) {
      wrapper.addEventListener('mousedown', (e) => {
        if (this.zoomScale <= 1) return;
        this.isDragging = true;
        this.dragStartX = e.clientX - this.panX;
        this.dragStartY = e.clientY - this.panY;
        wrapper.classList.add('is-dragging');
      });

      window.addEventListener('mousemove', (e) => {
        if (!this.isDragging) return;
        this.panX = e.clientX - this.dragStartX;
        this.panY = e.clientY - this.dragStartY;
        this.applyTransform();
      });

      window.addEventListener('mouseup', () => {
        if (this.isDragging) {
          this.isDragging = false;
          wrapper.classList.remove('is-dragging');
        }
      });
    }

    // Image load / error handlers
    if (this.dom.mainImage) {
      this.dom.mainImage.addEventListener('load', () => {
        if (this.dom.imageLoadingOverlay) {
          this.dom.imageLoadingOverlay.classList.remove('active');
        }
        if (this.dom.imageMetaPill) {
          const w = this.dom.mainImage.naturalWidth;
          const h = this.dom.mainImage.naturalHeight;
          const modeLabel = this.currentImageMode === 'raw' ? 'Ham Görsel' : 'Numaralı';
          this.dom.imageMetaPill.innerText = `${modeLabel} • ${w} × ${h}px`;
        }
      });

      this.dom.mainImage.addEventListener('error', () => {
        if (this.dom.imageLoadingOverlay) {
          this.dom.imageLoadingOverlay.classList.remove('active');
        }
        if (this.dom.imageMetaPill) {
          this.dom.imageMetaPill.innerText = 'Görsel yüklenemedi';
        }
      });
    }
  }

  setImageMode(mode) {
    this.currentImageMode = mode;
    if (this.dom.modeBtnAnnotated) {
      this.dom.modeBtnAnnotated.classList.toggle('active', mode === 'annotated');
    }
    if (this.dom.modeBtnRaw) {
      this.dom.modeBtnRaw.classList.toggle('active', mode === 'raw');
    }

    // Update section pills active state
    if (this.dom.sectionPillsContainer) {
      const pills = this.dom.sectionPillsContainer.querySelectorAll('.section-pill');
      pills.forEach(p => p.classList.toggle('active', p.dataset.mode === mode));
    }

    this.renderActiveImage();
  }

  renderActiveImage() {
    if (!this.currentScreen || !this.dom.mainImage) return;

    if (this.dom.imageLoadingOverlay) {
      this.dom.imageLoadingOverlay.classList.add('active');
    }

    let imageSrc = '';
    if (this.currentImageMode === 'raw') {
      imageSrc = `/api/screen-guides/image/raw/${encodeURIComponent(this.currentScreen.rawImage)}`;
    } else if (this.currentImageMode === 'annotated') {
      imageSrc = `/api/screen-guides/image/images/${encodeURIComponent(this.currentScreen.annotatedImage)}`;
    } else {
      // Sub-section image (e.g. 22_operation_03_entrance_sec1.png)
      imageSrc = `/api/screen-guides/image/images/${encodeURIComponent(this.currentImageMode)}`;
    }

    this.dom.mainImage.src = imageSrc;
    this.resetZoom();
  }

  renderSectionPills() {
    if (!this.dom.sectionPillsContainer) return;
    this.dom.sectionPillsContainer.innerHTML = '';

    if (!this.currentScreen || !this.currentScreen.sectionImages || this.currentScreen.sectionImages.length === 0) {
      return;
    }

    // Add Main Annotated Pill
    const mainPill = document.createElement('button');
    mainPill.className = `section-pill ${this.currentImageMode === 'annotated' ? 'active' : ''}`;
    mainPill.dataset.mode = 'annotated';
    mainPill.innerText = 'Tam Ekran (Full)';
    mainPill.addEventListener('click', () => this.setImageMode('annotated'));
    this.dom.sectionPillsContainer.appendChild(mainPill);

    // Add each section pill
    this.currentScreen.sectionImages.forEach((secImg, idx) => {
      const pill = document.createElement('button');
      pill.className = `section-pill ${this.currentImageMode === secImg ? 'active' : ''}`;
      pill.dataset.mode = secImg;
      pill.innerText = `Bölüm ${idx + 1}`;
      pill.title = secImg;
      pill.addEventListener('click', () => this.setImageMode(secImg));
      this.dom.sectionPillsContainer.appendChild(pill);
    });
  }

  zoom(delta) {
    this.zoomScale = Math.min(Math.max(0.6, this.zoomScale + delta), 4.0);
    if (this.zoomScale <= 1) {
      this.panX = 0;
      this.panY = 0;
      this.dom.canvasWrapper?.classList.remove('can-drag');
    } else {
      this.dom.canvasWrapper?.classList.add('can-drag');
    }
    this.applyTransform();
  }

  resetZoom() {
    this.zoomScale = 1;
    this.panX = 0;
    this.panY = 0;
    this.dom.canvasWrapper?.classList.remove('can-drag');
    this.applyTransform();
  }

  applyTransform() {
    if (!this.dom.canvasWrapper) return;
    this.dom.canvasWrapper.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoomScale})`;
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      this.dom.viewportStage?.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  // ==========================================================================
  // SPLITTER DRAGGING & RESIZING
  // ==========================================================================
  setupSplitter() {
    const splitter = this.dom.splitter;
    const rightPanel = this.dom.rightPanel;
    if (!splitter || !rightPanel) return;

    splitter.addEventListener('mousedown', (e) => {
      this.isResizingSplitter = true;
      splitter.classList.add('is-dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isResizingSplitter) return;
      const windowWidth = window.innerWidth;
      const newPanelWidth = windowWidth - e.clientX;

      if (newPanelWidth >= 300 && newPanelWidth <= windowWidth - 360) {
        rightPanel.style.width = `${newPanelWidth}px`;
        localStorage.setItem('tourxel_slideshow_panel_width', newPanelWidth);
      }
    });

    window.addEventListener('mouseup', () => {
      if (this.isResizingSplitter) {
        this.isResizingSplitter = false;
        splitter.classList.remove('is-dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });

    // Double click to reset width
    splitter.addEventListener('dblclick', () => {
      const defaultWidth = 520;
      rightPanel.style.width = `${defaultWidth}px`;
      localStorage.setItem('tourxel_slideshow_panel_width', defaultWidth);
      this.showToast({ type: 'info', message: 'Panel width reset to default (520px).' });
    });
  }

  restoreSplitterWidth() {
    try {
      const savedWidth = localStorage.getItem('tourxel_slideshow_panel_width');
      if (savedWidth && this.dom.rightPanel) {
        const widthNum = parseInt(savedWidth, 10);
        if (widthNum >= 300 && widthNum <= window.innerWidth - 360) {
          this.dom.rightPanel.style.width = `${widthNum}px`;
        }
      }
    } catch (_) {}
  }

  // ==========================================================================
  // MARKDOWN RENDERING (RIGHT PANEL)
  // ==========================================================================
  async loadAndRenderMarkdown() {
    if (!this.currentScreen) return;

    const fileToFetch = this.currentLang === 'tr' ? this.currentScreen.trGuide : this.currentScreen.enGuide;

    // Update panel header badges
    if (this.dom.guideFileBadge) {
      this.dom.guideFileBadge.innerText = fileToFetch;
      this.dom.guideFileBadge.title = fileToFetch;
    }
    if (this.dom.routePill) {
      this.dom.routePill.innerText = this.currentScreen.route;
    }
    if (this.dom.btnViewManual) {
      this.dom.btnViewManual.innerText = `📖 ${this.currentScreen.manualFile || 'Manual'}`;
      this.dom.btnViewManual.title = `Open manual chapter: ${this.currentScreen.manual}`;
    }

    try {
      let content = this.markdownCache[fileToFetch];
      if (!content) {
        const res = await fetch(`/api/screen-guides/markdown/${encodeURIComponent(fileToFetch)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        content = await res.text();
        this.markdownCache[fileToFetch] = content;
      }

      this.renderMarkdown(content);

      if (this.dom.rawMarkdownView) {
        this.dom.rawMarkdownView.value = content;
      }
    } catch (err) {
      console.error('[Slideshow] Failed to load markdown:', err);
      if (this.dom.markdownContainer) {
        this.dom.markdownContainer.innerHTML = `<div style="color: #ef4444; padding: 20px;">Rehber markdown dosyası yüklenemedi: ${escapeHtml(err.message)}</div>`;
      }
    }
  }

  renderMarkdown(rawMd) {
    if (!this.dom.markdownContainer) return;

    // Pre-process image paths so they point to /api/screen-guides/image/images/*
    let processedMd = rawMd.replace(/!\[([^\]]*)\]\((images\/[^)]+)\)/g, (match, alt, imgPath) => {
      const cleanImg = imgPath.replace(/^images\//, '');
      return `![${alt}](/api/screen-guides/image/images/${cleanImg})`;
    });

    processedMd = processedMd.replace(/!\[([^\]]*)\]\((raw_captures\/[^)]+)\)/g, (match, alt, imgPath) => {
      const cleanImg = imgPath.replace(/^raw_captures\//, '');
      return `![${alt}](/api/screen-guides/image/raw/${cleanImg})`;
    });

    if (window.marked) {
      const html = window.marked.parse(processedMd);
      this.dom.markdownContainer.innerHTML = html;
      this.postProcessRenderedMarkdown();
    } else {
      this.dom.markdownContainer.innerText = rawMd;
    }

    // Scroll to top
    const panelBody = document.querySelector('.right-panel-body');
    if (panelBody) panelBody.scrollTop = 0;
  }

  postProcessRenderedMarkdown() {
    const container = this.dom.markdownContainer;
    if (!container) return;

    // 1. Intercept internal markdown links
    container.querySelectorAll('a').forEach(link => {
      const href = link.getAttribute('href');
      if (!href) return;

      // Handle Guide Links (e.g. 21_operation_02_lunch_dinner_screen_guide_tr.md)
      if (href.endsWith('.md')) {
        const targetGuideFile = pathBasename(href);
        const matchedScreen = this.catalog.find(s => s.trGuide === targetGuideFile || s.enGuide === targetGuideFile);

        if (matchedScreen) {
          link.addEventListener('click', (e) => {
            e.preventDefault();
            this.goToScreenByIndex(matchedScreen.index);
          });
          link.style.cursor = 'pointer';
          link.title = `Jump to Screen ${matchedScreen.no}: ${matchedScreen.titleTr}`;
        } else if (href.includes('reference_manual') || href.startsWith('0') || href.startsWith('1')) {
          // Manual link
          link.addEventListener('click', (e) => {
            e.preventDefault();
            this.openManualModal(targetGuideFile);
          });
          link.style.cursor = 'pointer';
        }
      } else if (href.startsWith('http')) {
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
      }
    });

    // 2. Click on image inside markdown to preview in main content area
    container.querySelectorAll('img').forEach(img => {
      img.addEventListener('click', () => {
        const src = img.getAttribute('src');
        if (src) {
          const filename = pathBasename(src);
          this.setImageMode(filename);
        }
      });
    });
  }

  // ==========================================================================
  // REFERENCE MANUAL MODAL
  // ==========================================================================
  async openManualModal(filename) {
    const cleanFilename = pathBasename(filename || this.currentScreen?.manualFile);
    if (!cleanFilename) return;

    if (this.dom.manualModalTitle) {
      this.dom.manualModalTitle.innerHTML = `<i class="fas fa-book-open" style="color: #6366f1;"></i> <span>TourXel El Kitabı: ${escapeHtml(cleanFilename)}</span>`;
    }

    if (this.dom.manualModalBody) {
      this.dom.manualModalBody.innerHTML = '<div style="padding: 20px; text-align:center;"><div class="spinner" style="margin: 0 auto 10px;"></div>Bölüm yükleniyor...</div>';
    }

    if (this.dom.manualModal) {
      this.dom.manualModal.classList.add('active');
    }

    try {
      const res = await fetch(`/api/screen-guides/manual/${encodeURIComponent(cleanFilename)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const mdContent = await res.text();
      if (window.marked && this.dom.manualModalBody) {
        this.dom.manualModalBody.innerHTML = `<div class="markdown-body">${window.marked.parse(mdContent)}</div>`;
      }
    } catch (err) {
      if (this.dom.manualModalBody) {
        this.dom.manualModalBody.innerHTML = `<div style="color:#ef4444; padding:20px;">El kitabı bölümü yüklenemedi: ${escapeHtml(err.message)}</div>`;
      }
    }
  }

  closeManualModal() {
    if (this.dom.manualModal) {
      this.dom.manualModal.classList.remove('active');
    }
  }

  // ==========================================================================
  // AUTHENTICATION & RAPIDER WORKSPACE
  // ==========================================================================
  async initAuth() {
    if (!window.apiClient) return;

    // Listen to API client updates
    this.updateAuthBadge();

    // Check if session exists or try silent login
    try {
      if (window.apiClient.isAuthenticated() && window.apiClient.projectId) {
        await window.apiClient.fetchUserProjects();
        this.updateAuthBadge();
        this.populateProjectDropdown();
      } else {
        const configRes = await fetch('/api/config');
        if (configRes.ok) {
          const config = await configRes.json();
          if (config.HARNESS_TEST_EMAIL && config.HARNESS_TEST_PASSWORD) {
            await window.apiClient.login(
              config.HARNESS_TEST_EMAIL,
              config.HARNESS_TEST_PASSWORD,
              config.BACKEND_URL || 'https://dev.api.rappider.com'
            );
            if (config.HARNESS_TEST_PROJECT_ID) {
              await window.apiClient.changeActiveProject(config.HARNESS_TEST_PROJECT_ID);
            }
            this.updateAuthBadge();
            this.populateProjectDropdown();
          }
        }
      }
    } catch (err) {
      console.warn('[Auth] Silent login check:', err.message);
      this.updateAuthBadge();
    }
  }

  updateAuthBadge() {
    const isAuth = window.apiClient && window.apiClient.isAuthenticated();
    if (this.dom.projectStatusDot) {
      this.dom.projectStatusDot.className = `status-dot ${isAuth ? 'connected' : ''}`;
    }
    if (this.dom.projectNameText) {
      if (isAuth) {
        const projectId = window.apiClient.projectId || '';
        const project = window.apiClient.projects ? window.apiClient.projects.find(p => p.id === projectId) : null;
        let displayName = projectId.length > 12 ? projectId.substring(0, 8) + '...' : projectId;
        if (project && project.name) {
          displayName = project.name.length > 20 ? project.name.substring(0, 20) + '...' : project.name;
        }
        this.dom.projectNameText.innerText = `Workspace: ${displayName}`;
      } else {
        this.dom.projectNameText.innerText = 'Rapider Connect';
      }
    }
  }

  populateProjectDropdown() {
    if (!this.dom.projectSelectorMenu) return;
    this.dom.projectSelectorMenu.innerHTML = '';

    const projects = window.apiClient ? window.apiClient.projects : [];
    if (!projects || projects.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'app-selector-item';
      empty.innerText = 'No workspaces available';
      this.dom.projectSelectorMenu.appendChild(empty);
      return;
    }

    projects.forEach(p => {
      const item = document.createElement('div');
      item.className = `app-selector-item ${p.id === window.apiClient.projectId ? 'active' : ''}`;
      item.innerHTML = `
        <span style="font-weight: 600;">${escapeHtml(p.name || p.id)}</span>
        <span style="font-family: var(--font-mono); font-size: 10px; color: var(--text-muted);">${p.id.substring(0, 8)}</span>
      `;
      item.addEventListener('click', async () => {
        try {
          await window.apiClient.changeActiveProject(p.id);
          this.updateAuthBadge();
          this.populateProjectDropdown();
          this.dom.projectSelectorMenu.classList.remove('active');
          this.showToast({ type: 'success', message: `Switched to workspace: ${p.name || p.id}` });
        } catch (err) {
          this.showToast({ type: 'error', message: 'Failed to switch workspace.' });
        }
      });
      this.dom.projectSelectorMenu.appendChild(item);
    });
  }

  openAuthModal() {
    if (this.dom.authModal) {
      this.dom.authModal.classList.add('active');
    }
  }

  closeAuthModal() {
    if (this.dom.authModal) {
      this.dom.authModal.classList.remove('active');
    }
  }

  // ==========================================================================
  // EVENT LISTENERS & SHORTCUTS
  // ==========================================================================
  setupEventListeners() {
    // Sidebar toggle
    if (this.dom.btnToggleSidebar) {
      this.dom.btnToggleSidebar.addEventListener('click', () => this.toggleSidebar());
    }
    if (this.dom.btnCloseSidebar) {
      this.dom.btnCloseSidebar.addEventListener('click', () => this.toggleSidebar(false));
    }
    if (this.dom.sidebarBackdrop) {
      this.dom.sidebarBackdrop.addEventListener('click', () => this.toggleSidebar(false));
    }

    // Sidebar search
    if (this.dom.sidebarSearchInput) {
      this.dom.sidebarSearchInput.addEventListener('input', () => this.renderSidebarNavList());
    }

    // Prev / Next Buttons
    if (this.dom.btnPrev) {
      this.dom.btnPrev.addEventListener('click', () => this.goToPrevScreen());
    }
    if (this.dom.btnNext) {
      this.dom.btnNext.addEventListener('click', () => this.goToNextScreen());
    }

    // Slide Select Jump
    if (this.dom.slideSelect) {
      this.dom.slideSelect.addEventListener('change', (e) => {
        const no = e.target.value;
        const targetIdx = this.catalog.findIndex(s => s.no === no);
        if (targetIdx !== -1) {
          this.goToScreenByIndex(targetIdx);
        }
      });
    }

    // Language Toggle
    if (this.dom.btnToggleLang) {
      this.dom.btnToggleLang.addEventListener('click', () => this.toggleLanguage());
    }

    // Project Badge click
    if (this.dom.projectBadge) {
      this.dom.projectBadge.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.apiClient && window.apiClient.isAuthenticated()) {
          this.dom.projectSelectorMenu?.classList.toggle('active');
        } else {
          this.openAuthModal();
        }
      });

      document.addEventListener('click', (e) => {
        if (this.dom.projectSelectorMenu && !this.dom.projectBadge.contains(e.target)) {
          this.dom.projectSelectorMenu.classList.remove('active');
        }
      });
    }

    // Auth Close & Form
    if (this.dom.authCloseBtn) {
      this.dom.authCloseBtn.addEventListener('click', () => this.closeAuthModal());
    }
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
          if (this.dom.authBanner) this.dom.authBanner.className = 'auth-banner';

          await window.apiClient.login(username, password, backendUrl);
          if (projectId) {
            await window.apiClient.changeActiveProject(projectId);
          }
          this.updateAuthBadge();
          this.populateProjectDropdown();
          this.showToast({ type: 'success', message: `Connected to Rapider as ${username}` });
          this.closeAuthModal();
        } catch (err) {
          if (this.dom.authBanner) {
            this.dom.authBanner.className = 'auth-banner error';
            this.dom.authBanner.innerText = err.message || 'Login failed.';
          }
        } finally {
          btn.disabled = false;
          btn.innerText = 'Sign In & Connect';
        }
      });
    }

    // Reference manual modal close
    if (this.dom.manualModalCloseBtn) {
      this.dom.manualModalCloseBtn.addEventListener('click', () => this.closeManualModal());
    }
    if (this.dom.btnViewManual) {
      this.dom.btnViewManual.addEventListener('click', () => this.openManualModal());
    }

    // Copy Markdown
    if (this.dom.btnCopyMd) {
      this.dom.btnCopyMd.addEventListener('click', () => {
        const text = this.dom.rawMarkdownView?.value || '';
        navigator.clipboard.writeText(text).then(() => {
          this.showToast({ type: 'success', message: 'Markdown copied to clipboard!' });
        });
      });
    }

    // Toggle Raw / Rendered
    if (this.dom.btnToggleRawMd) {
      this.dom.btnToggleRawMd.addEventListener('click', () => {
        const isRaw = this.dom.rawMarkdownView.style.display === 'block';
        if (isRaw) {
          this.dom.rawMarkdownView.style.display = 'none';
          this.dom.markdownContainer.style.display = 'block';
          this.dom.btnToggleRawMd.innerHTML = '<i class="fas fa-code"></i> Raw';
        } else {
          this.dom.rawMarkdownView.style.display = 'block';
          this.dom.markdownContainer.style.display = 'none';
          this.dom.btnToggleRawMd.innerHTML = '<i class="fas fa-eye"></i> Rendered';
        }
      });
    }

    // URL Hash Change Listener
    window.addEventListener('hashchange', () => {
      const hash = window.location.hash.replace(/^#\/?(screen\/)?/, '').trim();
      if (hash && (!this.currentScreen || this.currentScreen.no !== hash)) {
        const targetIdx = this.catalog.findIndex(s => s.no === hash || s.prefix === hash);
        if (targetIdx !== -1) {
          this.goToScreenByIndex(targetIdx);
        }
      }
    });
  }

  toggleSidebar(forceState) {
    this.isSidebarOpen = forceState !== undefined ? forceState : !this.isSidebarOpen;
    this.dom.appShell?.classList.toggle('sidebar-open', this.isSidebarOpen);
  }

  toggleLanguage() {
    this.currentLang = this.currentLang === 'tr' ? 'en' : 'tr';
    if (this.dom.langFlag) {
      this.dom.langFlag.innerText = this.currentLang === 'tr' ? '🇹🇷' : '🇬🇧';
    }
    if (this.dom.langLabel) {
      this.dom.langLabel.innerText = this.currentLang.toUpperCase();
    }
    this.renderModuleFilterPills();
    this.renderSidebarNavList();
    this.populateSlideSelect();
    this.loadAndRenderMarkdown();
    this.showToast({ type: 'info', message: `Language: ${this.currentLang === 'tr' ? 'Türkçe' : 'English'}` });
  }

  setupKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      // Don't trigger if user is typing in an input
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        return;
      }

      if (e.key === 'ArrowLeft' || e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        this.goToPrevScreen();
      } else if (e.key === 'ArrowRight' || e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        this.goToNextScreen();
      } else if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        this.setImageMode(this.currentImageMode === 'raw' ? 'annotated' : 'raw');
      } else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        this.toggleLanguage();
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        this.toggleSidebar();
      } else if (e.key === '0' || e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        this.resetZoom();
      } else if (e.code === 'Space' && !this.isPeekingRaw) {
        // Hold Spacebar to Peek Raw Image
        e.preventDefault();
        if (this.currentImageMode !== 'raw') {
          this.isPeekingRaw = true;
          this.setImageMode('raw');
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space' && this.isPeekingRaw) {
        e.preventDefault();
        this.isPeekingRaw = false;
        this.setImageMode('annotated');
      }
    });
  }

  showToast({ type = 'info', message }) {
    if (!this.dom.toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? 'check-circle' : (type === 'error' ? 'exclamation-circle' : 'info-circle');
    toast.innerHTML = `<i class="fas fa-${icon}"></i> <span>${escapeHtml(message)}</span>`;
    this.dom.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(12px)';
      setTimeout(() => toast.remove(), 250);
    }, 3200);
  }
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pathBasename(p) {
  if (!p) return '';
  return p.split(/[\\/]/).pop();
}

// Instantiate on DOM load
window.addEventListener('DOMContentLoaded', () => {
  window.slideshowApp = new TourXelSlideshowApp();
  window.slideshowApp.init();
});
