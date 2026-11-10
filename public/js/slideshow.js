/**
 * slideshow.js
 * Client-side controller for the TourXel Screen Guides Slideshow Harness.
 *
 * Features:
 * - Light theme by default (with Light/Dark theme toggle)
 * - Collapsible left menu with all 53 screens grouped by 9 functional suites + search & module filtering
 * - Center image viewer with top toggle: Annotated Picture (numbered badges) vs Raw Picture + section zoom strips
 * - Interactive pan & zoom (mouse wheel zoom, drag pan, Spacebar hold for quick Raw comparison, fullscreen)
 * - Draggable vertical splitter to resize the right panel dynamically
 * - Right panel with dual mode:
 *     1. Ekran Rehberi (Markdown) — renders the screen guide Markdown (TR / EN)
 *     2. Report & Request (Tasks) — full Rapider UI App Builder clone (Screen Capture only, no bubble pinning)
 *        saving bug reports, feature requests, annotated screenshots, and replies into the current active app.
 * - Full Rapider Authentication & Workspace Selection integration via window.apiClient
 */

class ScreenGuidesSlideshowApp {
  constructor() {
    this.catalog = [];
    this.modules = [];
    this.currentIndex = 0;
    this.language = localStorage.getItem('slideshow_lang') || 'tr'; // 'tr' | 'en'
    this.imageMode = 'annotated'; // 'annotated' | 'raw'
    this.activeSectionUrl = null; // null = main image, or section image url
    this.activeModuleFilter = 'ALL';
    this.searchQuery = '';
    this.showRawMarkdown = false;
    this.currentMarkdownRaw = '';

    // Theme state (Light theme is default per user requirement)
    this.theme = localStorage.getItem('slideshow_theme') || 'light';

    // Right panel mode ('guide' | 'tasks')
    this.rightPanelMode = 'guide';

    // Pan & Zoom state
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.isPanning = false;
    this.panStartX = 0;
    this.panStartY = 0;
    this.spacebarPeekActive = false;

    // Splitter state
    this.isResizingRightPanel = false;
    this.rightPanelWidth = parseInt(localStorage.getItem('slideshow_right_panel_width'), 10) || 560;

    // Active App & Tasks ("Report & Request") state
    this.availableApps = [];
    this.activeApp = null; // { id, name, appKey, source: 'workspace' | 'local' }
    this.appTasks = [];
    this.isLoadingTasks = false;
    this.selectedTaskType = 'ALL'; // 'ALL' | 'Bug' | 'Feature'
    this.selectedTaskStatuses = [];
    this.taskSearchQuery = '';
    this.filterReportedByMe = false;
    this.taskPageScope = 'all'; // 'current' | 'all'
    this.activeTaskDetail = null;
    this.isEditingTaskDetail = false;
    this.taskPendingDelete = null;
    this.replyScreenshotUrls = [];
    this.isSubmittingReply = false;

    this.allTaskStatuses = [
      'Open',
      'Approved',
      'Reopened',
      'In Progress',
      'Planned',
      'Under Review',
      'Testing',
      'Completed',
      'Resolved',
      'Closed'
    ];

    // Screen Capture & Annotation Modal state
    this.captureContext = 'task'; // 'task' | 'reply'
    this.captureSourceMode = 'current'; // 'current' | 'raw' | 'annotated'
    this.captureTaskType = 'Bug'; // 'Bug' | 'Feature'
    this.captureTool = 'arrow'; // 'pen' | 'arrow' | 'rect' | 'number'
    this.captureColor = '#ef4444';
    this.captureLineWidth = 4;
    this.captureShapes = [];
    this.isDrawingShape = false;
    this.currentDraftShape = null;
    this.isSavingCaptureTask = false;

    this.init();
  }

  async init() {
    this.cacheDOM();
    this.initTheme();
    this.applySavedRightPanelWidth();
    this.bindEvents();
    this.bindTasksEvents();
    this.bindScreenCaptureEvents();
    this.renderTaskFilterStatusCheckboxes();

    // Load catalog first so slideshow is immediately interactive
    await this.loadCatalog();

    // Initialize Rapider Auth & Workspace connection in parallel
    await this.initRapiderAuth();

    // Discover Workspace & Harness Apps and load Tasks for the active app
    await this.loadActiveApps();
  }

  cacheDOM() {
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

      // Header Navigation
      btnPrev: document.getElementById('btn-prev'),
      btnNext: document.getElementById('btn-next'),
      slideNumberBadge: document.getElementById('current-slide-no'),
      slideTotalBadge: document.getElementById('total-slides-count'),
      slideSelect: document.getElementById('slide-select'),
      btnToggleLang: document.getElementById('btn-toggle-lang'),
      langFlag: document.getElementById('lang-flag'),
      langLabel: document.getElementById('lang-label'),
      btnToggleTheme: document.getElementById('btn-toggle-theme'),
      themeIcon: document.getElementById('theme-icon'),

      // Header Report & Request + Active App Selector
      btnReportRequest: document.getElementById('btn-report-request'),
      headerTasksCountBadge: document.getElementById('header-tasks-count-badge'),
      activeAppWrapper: document.getElementById('active-app-selector-wrapper'),
      activeAppBadge: document.getElementById('active-app-badge'),
      activeAppNameText: document.getElementById('active-app-name-text'),
      activeAppMenu: document.getElementById('active-app-selector-menu'),

      // Center Viewer
      modeBtnAnnotated: document.getElementById('mode-btn-annotated'),
      modeBtnRaw: document.getElementById('mode-btn-raw'),
      sectionPillsContainer: document.getElementById('section-images-strip'),
      imageMetaPill: document.getElementById('image-meta-pill'),
      btnZoomIn: document.getElementById('btn-zoom-in'),
      btnZoomOut: document.getElementById('btn-zoom-out'),
      btnZoomReset: document.getElementById('btn-zoom-reset'),
      btnFullscreen: document.getElementById('btn-fullscreen'),
      viewportStage: document.getElementById('viewport-stage'),
      imageCanvasWrapper: document.getElementById('image-canvas-wrapper'),
      mainImage: document.getElementById('main-image'),
      imageLoadingOverlay: document.getElementById('image-loading-overlay'),

      // Splitter & Right Panel
      splitter: document.getElementById('splitter'),
      rightPanel: document.getElementById('right-panel'),
      tabBtnGuide: document.getElementById('tab-btn-guide'),
      tabBtnTasks: document.getElementById('tab-btn-tasks'),
      panelTabTasksBadge: document.getElementById('panel-tab-tasks-badge'),
      rightPanelGuideView: document.getElementById('right-panel-guide-view'),
      rightPanelTasksView: document.getElementById('right-panel-tasks-view'),

      // Guide Markdown View
      guideFileBadge: document.getElementById('guide-file-badge'),
      routePill: document.getElementById('route-pill'),
      btnViewManual: document.getElementById('btn-view-manual'),
      btnToggleRawMd: document.getElementById('btn-toggle-raw-md'),
      btnCopyMd: document.getElementById('btn-copy-md'),
      markdownScrollBody: document.getElementById('markdown-scroll-body') || document.querySelector('.right-panel-body'),
      markdownContainer: document.getElementById('markdown-container'),
      rawMarkdownView: document.getElementById('raw-markdown-view'),

      // Tasks Panel View
      tasksActiveAppPill: document.getElementById('tasks-active-app-pill'),
      btnRefreshTasks: document.getElementById('btn-refresh-tasks'),
      refreshTasksIcon: document.getElementById('refresh-tasks-icon'),
      btnCloseTasksPanel: document.getElementById('btn-close-tasks-panel'),
      tasksListSection: document.getElementById('tasks-list-section'),
      btnReportBug: document.getElementById('btn-report-bug'),
      btnRequestFeature: document.getElementById('btn-request-feature'),
      statCardAll: document.getElementById('stat-card-all'),
      statCardBug: document.getElementById('stat-card-bug'),
      statCardFeature: document.getElementById('stat-card-feature'),
      statCountAll: document.getElementById('stat-count-all'),
      statCountBug: document.getElementById('stat-count-bug'),
      statCountFeature: document.getElementById('stat-count-feature'),
      taskSearchInput: document.getElementById('task-search-input'),
      btnClearTaskSearch: document.getElementById('btn-clear-task-search'),
      btnTaskFilterDropdown: document.getElementById('btn-task-filter-dropdown'),
      taskFilterCountBadge: document.getElementById('task-filter-count-badge'),
      taskFilterMenu: document.getElementById('task-filter-menu'),
      filterReportedByMeCheckbox: document.getElementById('filter-reported-by-me'),
      btnPresetAttention: document.getElementById('btn-preset-attention'),
      btnPresetDone: document.getElementById('btn-preset-done'),
      filterStatusList: document.getElementById('filter-status-list'),
      btnResetAllTaskFilters: document.getElementById('btn-reset-all-task-filters'),
      btnScopeCurrent: document.getElementById('btn-scope-current'),
      btnScopeAll: document.getElementById('btn-scope-all'),
      scopeCountCurrent: document.getElementById('scope-count-current'),
      scopeCountAll: document.getElementById('scope-count-all'),
      taskActiveFiltersBar: document.getElementById('task-active-filters-bar'),
      taskActiveFilterChips: document.getElementById('task-active-filter-chips'),
      btnClearActiveFilters: document.getElementById('btn-clear-active-filters'),
      tasksListContainer: document.getElementById('tasks-list-container'),

      // Task Detail View
      taskDetailSection: document.getElementById('task-detail-section'),
      btnBackToTasks: document.getElementById('btn-back-to-tasks'),
      btnDetailEditTask: document.getElementById('btn-detail-edit-task'),
      btnDetailDeleteTask: document.getElementById('btn-detail-delete-task'),
      taskDetailBody: document.getElementById('task-detail-body'),
      taskReplyInput: document.getElementById('task-reply-input'),
      replyAttachedScreenshots: document.getElementById('reply-attached-screenshots'),
      btnReplyScreenCapture: document.getElementById('btn-reply-screen-capture'),
      btnSendReply: document.getElementById('btn-send-reply'),

      // Screen Capture & Annotation Modal
      screenCaptureModal: document.getElementById('screen-capture-modal'),
      captureModalTitle: document.getElementById('capture-modal-title'),
      btnCaptureSrcCurrent: document.getElementById('btn-capture-src-current'),
      btnCaptureSrcRaw: document.getElementById('btn-capture-src-raw'),
      btnCaptureSrcAnnotated: document.getElementById('btn-capture-src-annotated'),
      drawNextNumberBadge: document.getElementById('draw-next-number-badge'),
      drawColorSwatches: document.getElementById('draw-color-swatches'),
      btnDrawUndo: document.getElementById('btn-draw-undo'),
      btnDrawClear: document.getElementById('btn-draw-clear'),
      btnCloseCaptureModal: document.getElementById('btn-close-capture-modal'),
      captureCanvasStage: document.getElementById('capture-canvas-stage'),
      captureBaseImage: document.getElementById('capture-base-image'),
      screenAnnotationCanvas: document.getElementById('screen-annotation-canvas'),
      captureFormIcon: document.getElementById('capture-form-icon'),
      captureFormHeading: document.getElementById('capture-form-heading'),
      captureFormSubtitle: document.getElementById('capture-form-subtitle'),
      captureTargetAppBadge: document.getElementById('capture-target-app-badge'),
      captureTargetPageBadge: document.getElementById('capture-target-page-badge'),
      captureTaskTypeGroup: document.getElementById('capture-task-type-group'),
      btnCaptureTypeBug: document.getElementById('btn-capture-type-bug'),
      btnCaptureTypeFeature: document.getElementById('btn-capture-type-feature'),
      captureTaskTitleGroup: document.getElementById('capture-task-title-group'),
      captureTaskTitle: document.getElementById('capture-task-title'),
      captureDescLabel: document.getElementById('capture-desc-label'),
      captureTaskDesc: document.getElementById('capture-task-desc'),
      btnCancelCaptureTask: document.getElementById('btn-cancel-capture-task'),
      btnSaveCaptureTask: document.getElementById('btn-save-capture-task'),
      btnSaveCaptureLabel: document.getElementById('btn-save-capture-label'),

      // Screenshot Preview & Delete Task Modals
      screenshotPreviewModal: document.getElementById('screenshot-preview-modal'),
      screenshotPreviewImg: document.getElementById('screenshot-preview-img'),
      screenshotPreviewOpenTab: document.getElementById('screenshot-preview-open-tab'),
      screenshotPreviewCloseBtn: document.getElementById('screenshot-preview-close-btn'),
      deleteTaskModal: document.getElementById('delete-task-modal'),
      deleteTaskCloseBtn: document.getElementById('delete-task-close-btn'),
      deleteTaskMessage: document.getElementById('delete-task-message'),
      btnCancelDeleteTask: document.getElementById('btn-cancel-delete-task'),
      btnConfirmDeleteTask: document.getElementById('btn-confirm-delete-task'),

      // Auth & Workspace UI
      projectWrapper: document.getElementById('project-selector-wrapper'),
      projectBadge: document.getElementById('project-badge'),
      projectStatusDot: document.getElementById('project-status-dot'),
      projectNameText: document.getElementById('project-name-text'),
      projectMenu: document.getElementById('project-selector-menu'),
      btnOpenAuth: document.getElementById('btn-open-auth'),
      authModal: document.getElementById('auth-modal'),
      authCloseBtn: document.getElementById('auth-close-btn'),
      authForm: document.getElementById('auth-login-form'),
      authBanner: document.getElementById('auth-banner'),
      authBackendUrl: document.getElementById('auth-backend-url'),
      authProjectId: document.getElementById('auth-project-id'),
      authUsername: document.getElementById('auth-username'),
      authPassword: document.getElementById('auth-password'),
      btnSubmitLogin: document.getElementById('btn-submit-login'),

      // Reference Manual Modal
      manualModal: document.getElementById('manual-modal'),
      manualModalTitle: document.getElementById('manual-modal-title'),
      manualModalBody: document.getElementById('manual-modal-body'),
      manualModalCloseBtn: document.getElementById('manual-modal-close-btn'),

      // Toast
      toastContainer: document.getElementById('toast-container')
    };
  }

  // ==========================================================================
  // THEME MANAGEMENT (LIGHT THEME DEFAULT)
  // ==========================================================================

  initTheme() {
    this.applyTheme(this.theme);
  }

  applyTheme(theme) {
    this.theme = theme === 'dark' ? 'dark' : 'light';
    localStorage.setItem('slideshow_theme', this.theme);
    if (this.theme === 'dark') {
      document.body.classList.remove('light-theme');
      document.body.classList.add('dark-theme');
      if (this.dom.themeIcon) {
        this.dom.themeIcon.className = 'fas fa-sun';
      }
    } else {
      document.body.classList.remove('dark-theme');
      document.body.classList.add('light-theme');
      if (this.dom.themeIcon) {
        this.dom.themeIcon.className = 'fas fa-moon';
      }
    }
  }

  toggleTheme() {
    this.applyTheme(this.theme === 'light' ? 'dark' : 'light');
    this.showToast(
      this.theme === 'light' ? 'Açık tema (Light Theme) aktif' : 'Koyu tema (Dark Theme) aktif',
      'info'
    );
  }

  // ==========================================================================
  // RIGHT PANEL MODE SWITCHER (GUIDE MARKDOWN vs REPORT & REQUEST TASKS)
  // ==========================================================================

  switchRightPanelMode(mode) {
    this.rightPanelMode = mode === 'tasks' ? 'tasks' : 'guide';
    const isTasks = this.rightPanelMode === 'tasks';

    if (this.dom.tabBtnGuide) this.dom.tabBtnGuide.classList.toggle('active', !isTasks);
    if (this.dom.tabBtnTasks) this.dom.tabBtnTasks.classList.toggle('active', isTasks);
    if (this.dom.btnReportRequest) this.dom.btnReportRequest.classList.toggle('active', isTasks);

    if (this.dom.rightPanelGuideView) {
      this.dom.rightPanelGuideView.classList.toggle('active', !isTasks);
      this.dom.rightPanelGuideView.style.display = isTasks ? 'none' : 'flex';
    }
    if (this.dom.rightPanelTasksView) {
      this.dom.rightPanelTasksView.classList.toggle('active', isTasks);
      this.dom.rightPanelTasksView.style.display = isTasks ? 'flex' : 'none';
    }

    if (isTasks) {
      this.renderTasksList();
    }
  }

  // ==========================================================================
  // CORE SLIDESHOW EVENT BINDINGS
  // ==========================================================================

  bindEvents() {
    // Sidebar toggle (collapsed by default)
    this.dom.btnToggleSidebar?.addEventListener('click', () => this.toggleSidebar());
    this.dom.btnCloseSidebar?.addEventListener('click', () => this.toggleSidebar(false));
    this.dom.sidebarBackdrop?.addEventListener('click', () => this.toggleSidebar(false));

    // Sidebar search
    this.dom.sidebarSearchInput?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.trim();
      this.renderSidebarList();
    });

    // Prev / Next & Slide Selector
    this.dom.btnPrev?.addEventListener('click', () => this.prevSlide());
    this.dom.btnNext?.addEventListener('click', () => this.nextSlide());
    this.dom.slideSelect?.addEventListener('change', (e) => {
      const idx = parseInt(e.target.value, 10);
      if (!isNaN(idx)) this.goToSlide(idx);
    });

    // Language Switcher (TR / EN)
    this.dom.btnToggleLang?.addEventListener('click', () => this.toggleLanguage());

    // Theme Switcher (Light / Dark)
    this.dom.btnToggleTheme?.addEventListener('click', () => this.toggleTheme());

    // Right Panel Mode Tabs & Header Report & Request Button
    this.dom.btnReportRequest?.addEventListener('click', () => {
      this.switchRightPanelMode(this.rightPanelMode === 'tasks' ? 'guide' : 'tasks');
    });
    this.dom.tabBtnGuide?.addEventListener('click', () => this.switchRightPanelMode('guide'));
    this.dom.tabBtnTasks?.addEventListener('click', () => this.switchRightPanelMode('tasks'));
    this.dom.btnCloseTasksPanel?.addEventListener('click', () => this.switchRightPanelMode('guide'));

    // Active App Dropdown Toggle
    this.dom.activeAppBadge?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.dom.projectMenu?.classList.remove('open');
      this.dom.activeAppMenu?.classList.toggle('open');
    });

    // Image Mode Toggle: Annotated vs Raw
    this.dom.modeBtnAnnotated?.addEventListener('click', () => this.setImageMode('annotated'));
    this.dom.modeBtnRaw?.addEventListener('click', () => this.setImageMode('raw'));

    // Zoom & Fullscreen Controls
    this.dom.btnZoomIn?.addEventListener('click', () => this.adjustZoom(0.25));
    this.dom.btnZoomOut?.addEventListener('click', () => this.adjustZoom(-0.25));
    this.dom.btnZoomReset?.addEventListener('click', () => this.resetZoom());
    this.dom.btnFullscreen?.addEventListener('click', () => this.toggleFullscreen());

    // Mouse Wheel Zoom on Viewport Stage
    this.dom.viewportStage?.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.15 : -0.15;
      this.adjustZoom(delta);
    }, { passive: false });

    // Drag to Pan Image
    this.dom.viewportStage?.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      this.isPanning = true;
      this.panStartX = e.clientX - this.panX;
      this.panStartY = e.clientY - this.panY;
      this.dom.imageCanvasWrapper?.classList.add('is-dragging');
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isPanning) {
        this.panX = e.clientX - this.panStartX;
        this.panY = e.clientY - this.panStartY;
        this.applyTransform();
      }
      if (this.isResizingRightPanel) {
        this.handleSplitterMove(e);
      }
    });

    window.addEventListener('mouseup', () => {
      if (this.isPanning) {
        this.isPanning = false;
        this.dom.imageCanvasWrapper?.classList.remove('is-dragging');
      }
      if (this.isResizingRightPanel) {
        this.isResizingRightPanel = false;
        this.dom.splitter?.classList.remove('is-dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        localStorage.setItem('slideshow_right_panel_width', String(this.rightPanelWidth));
      }
    });

    // Double-click on image to toggle zoom 1x <-> 1.75x
    this.dom.viewportStage?.addEventListener('dblclick', () => {
      if (this.zoom > 1.05) {
        this.resetZoom();
      } else {
        this.zoom = 1.75;
        this.applyTransform();
      }
    });

    // Draggable Splitter for Right Panel
    this.dom.splitter?.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.isResizingRightPanel = true;
      this.dom.splitter.classList.add('is-dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    // Double-click splitter to reset width to 560px
    this.dom.splitter?.addEventListener('dblclick', () => {
      this.rightPanelWidth = 560;
      this.applySavedRightPanelWidth();
      localStorage.setItem('slideshow_right_panel_width', '560');
    });

    // Right Panel Markdown Actions
    this.dom.btnToggleRawMd?.addEventListener('click', () => this.toggleRawMarkdown());
    this.dom.btnCopyMd?.addEventListener('click', () => this.copyMarkdown());
    this.dom.btnViewManual?.addEventListener('click', () => this.openReferenceManualModal());
    this.dom.manualModalCloseBtn?.addEventListener('click', () => this.closeReferenceManualModal());
    this.dom.manualModal?.addEventListener('click', (e) => {
      if (e.target === this.dom.manualModal) this.closeReferenceManualModal();
    });

    // Image load events
    this.dom.mainImage?.addEventListener('load', () => {
      this.dom.imageLoadingOverlay?.classList.remove('active');
      const nw = this.dom.mainImage.naturalWidth;
      const nh = this.dom.mainImage.naturalHeight;
      if (nw && nh && this.dom.imageMetaPill) {
        const modeLabel = this.activeSectionUrl
          ? 'Bölüm (Section)'
          : (this.imageMode === 'annotated' ? 'Numaralı' : 'Ham (Raw)');
        this.dom.imageMetaPill.textContent = `${modeLabel} • ${nw} × ${nh}px`;
      }
    });

    this.dom.mainImage?.addEventListener('error', () => {
      this.dom.imageLoadingOverlay?.classList.remove('active');
      if (this.dom.imageMetaPill) {
        this.dom.imageMetaPill.textContent = 'Görsel bulunamadı';
      }
    });

    // Workspace Selector & Auth Modal Events
    this.dom.projectBadge?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.dom.activeAppMenu?.classList.remove('open');
      this.dom.projectMenu?.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
      if (this.dom.projectWrapper && !this.dom.projectWrapper.contains(e.target)) {
        this.dom.projectMenu?.classList.remove('open');
      }
      if (this.dom.activeAppWrapper && !this.dom.activeAppWrapper.contains(e.target)) {
        this.dom.activeAppMenu?.classList.remove('open');
      }
      if (
        this.dom.taskFilterMenu &&
        !this.dom.taskFilterMenu.contains(e.target) &&
        !this.dom.btnTaskFilterDropdown?.contains(e.target)
      ) {
        this.dom.taskFilterMenu.classList.remove('open');
      }
    });

    this.dom.authCloseBtn?.addEventListener('click', () => this.closeAuthModal());
    this.dom.authModal?.addEventListener('click', (e) => {
      if (e.target === this.dom.authModal) this.closeAuthModal();
    });
    this.dom.authForm?.addEventListener('submit', (e) => this.handleLoginSubmit(e));

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) {
        if (e.key === 'Escape') e.target.blur();
        return;
      }

      // If screen capture modal is open, Escape closes it and Ctrl+Z undoes shape
      if (this.dom.screenCaptureModal?.classList.contains('open')) {
        if (e.key === 'Escape') {
          this.closeScreenCaptureModal();
        } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
          e.preventDefault();
          this.undoCaptureShape();
        }
        return;
      }

      if (e.key === 'ArrowLeft' || e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        this.prevSlide();
      } else if (e.key === 'ArrowRight' || e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        this.nextSlide();
      } else if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        this.setImageMode(this.imageMode === 'annotated' ? 'raw' : 'annotated');
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        this.toggleSidebar();
      } else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        this.toggleLanguage();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        this.toggleFullscreen();
      } else if (e.code === 'Space' && !this.spacebarPeekActive) {
        // Hold Spacebar to temporarily peek at Raw image while viewing Annotated
        if (this.imageMode === 'annotated' && !this.activeSectionUrl) {
          e.preventDefault();
          this.spacebarPeekActive = true;
          this.updateViewerImage('raw');
        }
      } else if (e.key === 'Escape') {
        this.toggleSidebar(false);
        this.closeReferenceManualModal();
        this.closeAuthModal();
        this.closeScreenshotPreviewModal();
        this.closeDeleteTaskModal();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space' && this.spacebarPeekActive) {
        this.spacebarPeekActive = false;
        this.updateViewerImage(this.imageMode);
      }
    });

    // Hash routing (#/22 or #slide=22)
    window.addEventListener('hashchange', () => this.syncFromHash());
  }

  // ==========================================================================
  // CATALOG & SLIDESHOW METHODS
  // ==========================================================================

  async loadCatalog() {
    try {
      const res = await fetch('/api/screen-guides/catalog');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const rawScreens = data.screens || [];
      this.modules = data.modules || [];

      // Normalize screen fields from screen-guides-router.js
      this.catalog = rawScreens.map((s) => {
        const mod = s.module || {};
        const guideTrFile = s.guideTrFile || s.trGuide || '';
        const guideEnFile = s.guideEnFile || s.enGuide || guideTrFile;
        const annotatedImageUrl =
          s.annotatedImageUrl ||
          (s.annotatedImage ? `/api/screen-guides/image/annotated/${encodeURIComponent(s.annotatedImage)}` : '');
        const rawImageUrl =
          s.rawImageUrl ||
          (s.rawImage ? `/api/screen-guides/image/raw/${encodeURIComponent(s.rawImage)}` : '');

        const sectionImages = (s.sectionImages || []).map((sec, idx) => {
          if (typeof sec === 'string') {
            const match = sec.match(/_sec(\d+)\.png$/i);
            return {
              secNo: match ? match[1] : String(idx + 1),
              filename: sec,
              url: `/api/screen-guides/image/annotated/${encodeURIComponent(sec)}`
            };
          }
          return sec;
        });

        return {
          ...s,
          moduleId: s.moduleId || mod.id || '99',
          moduleNameTr: s.moduleNameTr || mod.nameTr || '',
          moduleNameEn: s.moduleNameEn || mod.nameEn || '',
          moduleIcon: s.moduleIcon || mod.icon || 'fas fa-folder',
          guideTrFile,
          guideEnFile,
          annotatedImageUrl,
          rawImageUrl,
          sectionImages
        };
      });

      if (this.dom.sidebarCountBadge) {
        this.dom.sidebarCountBadge.textContent = String(this.catalog.length);
      }
      if (this.dom.slideTotalBadge) {
        this.dom.slideTotalBadge.textContent = String(this.catalog.length);
      }

      this.updateLanguageUI();
      this.renderModulePills();
      this.renderSidebarList();
      this.renderSlideSelectDropdown();

      // Check initial URL hash or start at index 0
      if (!this.syncFromHash()) {
        await this.goToSlide(0, false);
      }
    } catch (err) {
      console.error('[Slideshow] Failed to load catalog:', err);
      this.showToast(`Rehber kataloğu yüklenemedi: ${err.message}`, 'error');
    }
  }

  syncFromHash() {
    const hash = window.location.hash || '';
    const match = hash.match(/(\d+)/);
    if (match && this.catalog.length > 0) {
      const targetNo = match[1].padStart(2, '0');
      const idx = this.catalog.findIndex(
        (s) => s.no === targetNo || parseInt(s.no, 10) === parseInt(targetNo, 10)
      );
      if (idx !== -1) {
        if (idx !== this.currentIndex || !this.currentMarkdownRaw) {
          this.goToSlide(idx, false);
        }
        return true;
      }
    }
    return false;
  }

  toggleSidebar(forceState) {
    if (!this.dom.appShell) return;
    const isOpen = this.dom.appShell.classList.contains('sidebar-open');
    const nextState = typeof forceState === 'boolean' ? forceState : !isOpen;
    this.dom.appShell.classList.toggle('sidebar-open', nextState);
    if (nextState) {
      setTimeout(() => this.scrollActiveNavItemIntoView(), 120);
    }
  }

  renderModulePills() {
    if (!this.dom.sidebarModulePills) return;
    const allLabel = this.language === 'tr' ? 'Tümü (53)' : 'All (53)';
    let html = `<button class="module-pill ${this.activeModuleFilter === 'ALL' ? 'active' : ''}" data-mod="ALL">${allLabel}</button>`;

    for (const mod of this.modules) {
      const count = this.catalog.filter((s) => s.moduleId === mod.id).length;
      if (count === 0) continue;
      const label = this.language === 'tr' ? mod.nameTr.split('&')[0].trim() : mod.nameEn.split('&')[0].trim();
      const activeClass = this.activeModuleFilter === mod.id ? 'active' : '';
      html += `<button class="module-pill ${activeClass}" data-mod="${mod.id}" title="${this.escapeHtml(this.language === 'tr' ? mod.nameTr : mod.nameEn)}">${mod.id} • ${this.escapeHtml(label)} (${count})</button>`;
    }

    this.dom.sidebarModulePills.innerHTML = html;
    this.dom.sidebarModulePills.querySelectorAll('.module-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.activeModuleFilter = btn.getAttribute('data-mod') || 'ALL';
        this.renderModulePills();
        this.renderSidebarList();
      });
    });
  }

  renderSidebarList() {
    if (!this.dom.sidebarNavList) return;
    const q = this.searchQuery.toLowerCase();

    const filtered = this.catalog
      .map((screen, index) => ({ screen, index }))
      .filter(({ screen }) => {
        if (this.activeModuleFilter !== 'ALL' && screen.moduleId !== this.activeModuleFilter) {
          return false;
        }
        if (!q) return true;
        return (
          screen.no.toLowerCase().includes(q) ||
          screen.titleTr.toLowerCase().includes(q) ||
          screen.titleEn.toLowerCase().includes(q) ||
          screen.route.toLowerCase().includes(q) ||
          screen.guideTrFile.toLowerCase().includes(q)
        );
      });

    if (filtered.length === 0) {
      this.dom.sidebarNavList.innerHTML = `
        <div style="padding: 24px 12px; text-align: center; color: var(--text-muted); font-size: 12px;">
          <i class="fas fa-search" style="font-size: 18px; margin-bottom: 8px; display: block; opacity: 0.5;"></i>
          Eşleşen ekran rehberi bulunamadı.
        </div>
      `;
      return;
    }

    let html = '';
    let lastModuleId = null;

    for (const { screen, index } of filtered) {
      if (screen.moduleId !== lastModuleId) {
        lastModuleId = screen.moduleId;
        const modTitle = this.language === 'tr' ? screen.moduleNameTr : screen.moduleNameEn;
        html += `
          <div class="nav-module-heading">
            <i class="${screen.moduleIcon || 'fas fa-folder'}"></i>
            <span>${screen.moduleId} — ${this.escapeHtml(modTitle)}</span>
          </div>
        `;
      }

      const isActive = index === this.currentIndex;
      const title = this.language === 'tr' ? screen.titleTr : screen.titleEn;

      html += `
        <div class="nav-item nav-screen-item ${isActive ? 'active' : ''}" data-index="${index}">
          <span class="nav-item-no">${this.escapeHtml(screen.no)}</span>
          <div class="nav-item-body">
            <div class="nav-item-title"><strong>${this.escapeHtml(screen.no)}</strong> | ${this.escapeHtml(title)}</div>
            <div class="nav-item-route">${this.escapeHtml(screen.route)}</div>
          </div>
        </div>
      `;
    }

    this.dom.sidebarNavList.innerHTML = html;
    this.dom.sidebarNavList.querySelectorAll('.nav-item').forEach((item) => {
      item.addEventListener('click', () => {
        const idx = parseInt(item.getAttribute('data-index'), 10);
        if (!isNaN(idx)) {
          this.goToSlide(idx);
          this.toggleSidebar(false);
        }
      });
    });
  }

  renderSlideSelectDropdown() {
    if (!this.dom.slideSelect) return;
    let html = '';
    this.catalog.forEach((screen, idx) => {
      const title = this.language === 'tr' ? screen.titleTr : screen.titleEn;
      html += `<option value="${idx}" ${idx === this.currentIndex ? 'selected' : ''}>${screen.no} — ${this.escapeHtml(title)}</option>`;
    });
    this.dom.slideSelect.innerHTML = html;
  }

  scrollActiveNavItemIntoView() {
    const activeEl = this.dom.sidebarNavList?.querySelector('.nav-item.active');
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  async goToSlide(index, updateHash = true) {
    if (!this.catalog.length) return;
    const boundedIndex = Math.max(0, Math.min(index, this.catalog.length - 1));
    this.currentIndex = boundedIndex;
    this.activeSectionUrl = null;
    this.resetZoom();

    const screen = this.catalog[this.currentIndex];
    if (!screen) return;

    if (updateHash) {
      const targetHash = `#/${screen.no}`;
      if (window.location.hash !== targetHash) {
        history.replaceState(null, '', targetHash);
      }
    }

    // Update Header Controls
    if (this.dom.slideNumberBadge) {
      this.dom.slideNumberBadge.textContent = `${screen.no}`;
    }
    if (this.dom.slideSelect) {
      this.dom.slideSelect.value = String(this.currentIndex);
    }
    if (this.dom.btnPrev) {
      this.dom.btnPrev.disabled = this.currentIndex === 0;
    }
    if (this.dom.btnNext) {
      this.dom.btnNext.disabled = this.currentIndex === this.catalog.length - 1;
    }

    // Highlight active item in sidebar
    this.dom.sidebarNavList?.querySelectorAll('.nav-item').forEach((el) => {
      const idx = parseInt(el.getAttribute('data-index'), 10);
      el.classList.toggle('active', idx === this.currentIndex);
    });

    // Update Section Images Strip
    this.renderSectionPills(screen);

    // Update Center Image
    this.updateViewerImage(this.imageMode);

    // Update Right Panel Metadata Badges
    const mdFilename = this.language === 'tr' ? screen.guideTrFile : screen.guideEnFile;
    if (this.dom.guideFileBadge) {
      this.dom.guideFileBadge.textContent = mdFilename;
      this.dom.guideFileBadge.title = mdFilename;
    }
    if (this.dom.routePill) {
      this.dom.routePill.textContent = screen.route;
      this.dom.routePill.title = `Uygulama Rotası: ${screen.route}`;
    }
    if (this.dom.btnViewManual) {
      this.dom.btnViewManual.style.display = screen.manualFile ? 'inline-flex' : 'none';
      this.dom.btnViewManual.title = `Referans El Kitabı: ${screen.manualFile}`;
    }

    // Refresh Tasks scope counts if tasks are loaded
    this.updateTaskCountsUI();
    if (this.rightPanelMode === 'tasks') {
      this.renderTasksList();
    }

    // Load & Render Markdown Content on the Right Panel
    await this.loadAndRenderMarkdown(screen);
  }

  prevSlide() {
    if (this.currentIndex > 0) {
      this.goToSlide(this.currentIndex - 1);
    }
  }

  nextSlide() {
    if (this.currentIndex < this.catalog.length - 1) {
      this.goToSlide(this.currentIndex + 1);
    }
  }

  setImageMode(mode) {
    this.imageMode = mode === 'raw' ? 'raw' : 'annotated';
    this.activeSectionUrl = null;

    this.dom.modeBtnAnnotated?.classList.toggle('active', this.imageMode === 'annotated');
    this.dom.modeBtnRaw?.classList.toggle('active', this.imageMode === 'raw');

    this.dom.sectionPillsContainer?.querySelectorAll('.section-pill').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-sec') === 'MAIN');
    });

    this.updateViewerImage(this.imageMode);
  }

  renderSectionPills(screen) {
    if (!this.dom.sectionPillsContainer) return;
    const sections = screen.sectionImages || [];
    if (sections.length === 0) {
      this.dom.sectionPillsContainer.innerHTML = '';
      return;
    }

    const fullLabel = this.language === 'tr' ? 'Tam Ekran (Full)' : 'Full Screen';
    let html = `<button class="section-pill ${!this.activeSectionUrl ? 'active' : ''}" data-sec="MAIN">${fullLabel}</button>`;

    sections.forEach((sec) => {
      const label = this.language === 'tr' ? `Bölüm ${sec.secNo}` : `Section ${sec.secNo}`;
      const isActive = this.activeSectionUrl === sec.url;
      html += `<button class="section-pill ${isActive ? 'active' : ''}" data-sec="${sec.url}" title="${sec.filename}">${label}</button>`;
    });

    this.dom.sectionPillsContainer.innerHTML = html;
    this.dom.sectionPillsContainer.querySelectorAll('.section-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        const secVal = btn.getAttribute('data-sec');
        this.dom.sectionPillsContainer.querySelectorAll('.section-pill').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');

        if (secVal === 'MAIN') {
          this.activeSectionUrl = null;
          this.resetZoom();
          this.updateViewerImage(this.imageMode);
        } else {
          this.activeSectionUrl = secVal;
          this.resetZoom();
          this.loadMainImageUrl(secVal);
        }
      });
    });
  }

  updateViewerImage(modeOverride) {
    const screen = this.catalog[this.currentIndex];
    if (!screen) return;

    if (this.activeSectionUrl) {
      this.loadMainImageUrl(this.activeSectionUrl);
      return;
    }

    const effectiveMode = modeOverride || this.imageMode;
    let targetUrl = effectiveMode === 'raw' ? screen.rawImageUrl : screen.annotatedImageUrl;
    if (!targetUrl) {
      targetUrl = screen.annotatedImageUrl || screen.rawImageUrl || '';
    }

    this.dom.modeBtnAnnotated?.classList.toggle('active', effectiveMode === 'annotated');
    this.dom.modeBtnRaw?.classList.toggle('active', effectiveMode === 'raw');

    this.loadMainImageUrl(targetUrl);
  }

  loadMainImageUrl(url) {
    if (!this.dom.mainImage) return;
    if (!url) {
      this.dom.mainImage.src = '';
      if (this.dom.imageMetaPill) this.dom.imageMetaPill.textContent = 'Görsel mevcut değil';
      return;
    }

    if (this.dom.mainImage.getAttribute('src') === url) {
      return;
    }

    this.dom.imageLoadingOverlay?.classList.add('active');
    this.dom.mainImage.src = url;
  }

  adjustZoom(delta) {
    const nextZoom = Math.max(0.4, Math.min(4.0, +(this.zoom + delta).toFixed(2)));
    this.zoom = nextZoom;
    if (this.zoom <= 1) {
      this.panX = 0;
      this.panY = 0;
    }
    this.applyTransform();
  }

  resetZoom() {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.applyTransform();
  }

  applyTransform() {
    if (!this.dom.imageCanvasWrapper) return;
    this.dom.imageCanvasWrapper.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
    this.dom.imageCanvasWrapper.classList.toggle('can-drag', this.zoom > 1.01 || Math.abs(this.panX) > 5 || Math.abs(this.panY) > 5);
  }

  toggleFullscreen() {
    const target = this.dom.viewportStage || document.documentElement;
    if (!document.fullscreenElement) {
      target.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }

  handleSplitterMove(e) {
    if (!this.dom.rightPanel) return;
    const newWidth = window.innerWidth - e.clientX;
    const clamped = Math.max(320, Math.min(window.innerWidth * 0.8, newWidth));
    this.rightPanelWidth = Math.round(clamped);
    this.dom.rightPanel.style.width = `${this.rightPanelWidth}px`;
  }

  applySavedRightPanelWidth() {
    if (!this.dom.rightPanel) return;
    const clamped = Math.max(320, Math.min(window.innerWidth * 0.78, this.rightPanelWidth));
    this.dom.rightPanel.style.width = `${Math.round(clamped)}px`;
  }

  toggleLanguage() {
    this.language = this.language === 'tr' ? 'en' : 'tr';
    localStorage.setItem('slideshow_lang', this.language);
    this.updateLanguageUI();
    this.renderModulePills();
    this.renderSidebarList();
    this.renderSlideSelectDropdown();

    const screen = this.catalog[this.currentIndex];
    if (screen) {
      this.renderSectionPills(screen);
      const mdFilename = this.language === 'tr' ? screen.guideTrFile : screen.guideEnFile;
      if (this.dom.guideFileBadge) this.dom.guideFileBadge.textContent = mdFilename;
      this.loadAndRenderMarkdown(screen);
    }
  }

  updateLanguageUI() {
    if (this.dom.langFlag) {
      this.dom.langFlag.textContent = this.language === 'tr' ? '🇹🇷' : '🇬🇧';
    }
    if (this.dom.langLabel) {
      this.dom.langLabel.textContent = this.language === 'tr' ? 'TR' : 'EN';
    }
  }

  async loadAndRenderMarkdown(screen) {
    if (!screen || !this.dom.markdownContainer) return;
    const filename = this.language === 'tr' ? screen.guideTrFile : screen.guideEnFile;

    this.dom.markdownContainer.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px; padding:24px 0; color:var(--text-secondary);">
        <div class="spinner" style="width:18px; height:18px; border-width:2px;"></div>
        <span>Rehber içeriği yükleniyor (${this.escapeHtml(filename)})...</span>
      </div>
    `;

    try {
      const res = await fetch(`/api/screen-guides/markdown/${encodeURIComponent(filename)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await res.json();
        this.currentMarkdownRaw = data.content || '';
      } else {
        this.currentMarkdownRaw = await res.text();
      }

      if (this.dom.rawMarkdownView) {
        this.dom.rawMarkdownView.value = this.currentMarkdownRaw;
      }

      // Rewrite relative image paths so they resolve against /screen-guides/images/ and /screen-guides/raw_captures/
      const processedMd = this.rewriteMarkdownPaths(this.currentMarkdownRaw);

      if (window.marked && typeof window.marked.parse === 'function') {
        this.dom.markdownContainer.innerHTML = window.marked.parse(processedMd);
      } else {
        this.dom.markdownContainer.innerHTML = `<pre>${this.escapeHtml(processedMd)}</pre>`;
      }

      this.bindMarkdownInternalLinks();

      // Scroll right panel body back to top on slide change
      const scrollBody = this.dom.markdownScrollBody || this.dom.markdownContainer.parentElement;
      if (scrollBody) {
        scrollBody.scrollTop = 0;
      }
    } catch (err) {
      console.error('[Slideshow] Markdown load error:', err);
      this.dom.markdownContainer.innerHTML = `
        <div style="padding: 16px; border: 1px solid rgba(239,68,68,0.4); background: rgba(239,68,68,0.08); border-radius: 8px; color: #ef4444;">
          <strong>Markdown dosyası yüklenemedi:</strong> ${this.escapeHtml(filename)}<br/>
          <span style="font-size:12px;">${this.escapeHtml(err.message)}</span>
        </div>
      `;
    }
  }

  rewriteMarkdownPaths(markdownText) {
    if (!markdownText) return '';
    return markdownText
      .replace(/!\[([^\]]*)\]\((?:\.\/)?images\/([^)]+)\)/g, '![$1](/screen-guides/images/$2)')
      .replace(/!\[([^\]]*)\]\((?:\.\/)?raw_captures\/([^)]+)\)/g, '![$1](/screen-guides/raw_captures/$2)');
  }

  bindMarkdownInternalLinks() {
    if (!this.dom.markdownContainer) return;

    // 1. Intercept links to other screen guides or reference manual chapters
    this.dom.markdownContainer.querySelectorAll('a').forEach((anchor) => {
      const href = anchor.getAttribute('href') || '';
      if (!href) return;

      // Reference manual link: ../reference_manual/03_Chapter2_Operations.md
      if (href.includes('reference_manual/')) {
        anchor.addEventListener('click', (e) => {
          e.preventDefault();
          const manualFile = href.split('reference_manual/').pop().split('#')[0];
          this.openReferenceManualModal(manualFile);
        });
        return;
      }

      // Index link: SCREEN_GUIDES_INDEX_TR.md or SCREEN_GUIDES_INDEX.md
      if (href.includes('SCREEN_GUIDES_INDEX')) {
        anchor.addEventListener('click', (e) => {
          e.preventDefault();
          this.toggleSidebar(true);
        });
        return;
      }

      // Another screen guide .md link (e.g. 21_operation_02_lunch_dinner_screen_guide_tr.md)
      if (href.endsWith('.md') || href.includes('_screen_guide')) {
        anchor.addEventListener('click', (e) => {
          e.preventDefault();
          const cleanFile = href.split('/').pop().split('#')[0];

          const isTrFile = cleanFile.endsWith('_tr.md');
          const currentScreen = this.catalog[this.currentIndex];
          if (
            currentScreen &&
            (currentScreen.guideTrFile === cleanFile || currentScreen.guideEnFile === cleanFile)
          ) {
            const targetLang = isTrFile ? 'tr' : 'en';
            if (this.language !== targetLang) {
              this.toggleLanguage();
            }
            return;
          }

          const targetIdx = this.catalog.findIndex(
            (s) => s.guideTrFile === cleanFile || s.guideEnFile === cleanFile
          );
          if (targetIdx !== -1) {
            this.goToSlide(targetIdx);
          }
        });
      }
    });

    // 2. Clicking an inline image inside the Markdown syncs it to the main left viewer
    this.dom.markdownContainer.querySelectorAll('img').forEach((img) => {
      img.title = 'Ana görüntüleyicide büyütmek için tıklayın';
      img.addEventListener('click', () => {
        const src = img.getAttribute('src');
        if (!src) return;
        this.activeSectionUrl = src;
        this.resetZoom();
        this.loadMainImageUrl(src);

        this.dom.sectionPillsContainer?.querySelectorAll('.section-pill').forEach((btn) => {
          btn.classList.toggle('active', btn.getAttribute('data-sec') === src);
        });
      });
    });
  }

  toggleRawMarkdown() {
    this.showRawMarkdown = !this.showRawMarkdown;
    if (this.dom.markdownContainer && this.dom.rawMarkdownView) {
      this.dom.markdownContainer.style.display = this.showRawMarkdown ? 'none' : 'block';
      this.dom.rawMarkdownView.classList.toggle('active', this.showRawMarkdown);
    }
    if (this.dom.btnToggleRawMd) {
      this.dom.btnToggleRawMd.innerHTML = this.showRawMarkdown
        ? '<i class="fas fa-eye"></i> <span style="margin-left:4px;">Preview</span>'
        : '<i class="fas fa-code"></i> <span style="margin-left:4px;">Raw</span>';
    }
  }

  async copyMarkdown() {
    if (!this.currentMarkdownRaw) return;
    try {
      await navigator.clipboard.writeText(this.currentMarkdownRaw);
      this.showToast('Markdown içeriği panoya kopyalandı!', 'success');
    } catch {
      this.showToast('Kopyalama başarısız oldu', 'error');
    }
  }

  async openReferenceManualModal(overrideFilename) {
    const screen = this.catalog[this.currentIndex];
    const filename = overrideFilename || screen?.manualFile;
    if (!filename || !this.dom.manualModal) return;

    this.dom.manualModal.classList.add('open');
    if (this.dom.manualModalTitle) {
      this.dom.manualModalTitle.innerHTML = `<i class="fas fa-book-open" style="color:var(--accent-primary);"></i> <span>Referans El Kitabı: ${this.escapeHtml(filename)}</span>`;
    }
    if (this.dom.manualModalBody) {
      this.dom.manualModalBody.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px; padding:24px;">
          <div class="spinner"></div>
          <span>El kitabı bölümü yükleniyor (${this.escapeHtml(filename)})...</span>
        </div>
      `;
    }

    try {
      const res = await fetch(`/api/screen-guides/manual/${encodeURIComponent(filename)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const contentType = res.headers.get('content-type') || '';
      const rawText = contentType.includes('application/json')
        ? ((await res.json()).content || '')
        : await res.text();
      const html = window.marked ? window.marked.parse(rawText) : `<pre>${this.escapeHtml(rawText)}</pre>`;
      if (this.dom.manualModalBody) {
        this.dom.manualModalBody.innerHTML = `<div class="markdown-body">${html}</div>`;
      }
    } catch (err) {
      if (this.dom.manualModalBody) {
        this.dom.manualModalBody.innerHTML = `<div style="color:#ef4444; padding:16px;">El kitabı yüklenemedi: ${this.escapeHtml(err.message)}</div>`;
      }
    }
  }

  closeReferenceManualModal() {
    this.dom.manualModal?.classList.remove('open');
  }

  // ==========================================================================
  // RAPIDER AUTHENTICATION & WORKSPACE SELECTION
  // ==========================================================================

  async initRapiderAuth() {
    const api = window.apiClient;
    if (!api) return;

    this.updateProjectStatusUI('connecting', 'Workspace Bağlanıyor...');

    try {
      const envRes = await fetch('/api/env-config');
      const envConfig = envRes.ok ? await envRes.json() : {};

      if (envConfig.BACKEND_URL && !localStorage.getItem('rapider_backend_url')) {
        api.setBackendUrl(envConfig.BACKEND_URL);
      }
      if (this.dom.authBackendUrl) {
        this.dom.authBackendUrl.value = api.backendUrl || envConfig.BACKEND_URL || '';
      }

      if (api.isAuthenticated()) {
        try {
          await api.fetchProjects();
          if (!api.projectId && envConfig.HARNESS_TEST_PROJECT_ID) {
            api.setProject(envConfig.HARNESS_TEST_PROJECT_ID);
          } else if (!api.projectId && api.projects.length > 0) {
            api.setProject(api.projects[0].id || api.projects[0]._id);
          }
          const activeProj = api.projects.find((p) => (p.id || p._id) === api.projectId);
          this.updateProjectStatusUI('connected', activeProj ? activeProj.name : `Workspace (${String(api.projectId).slice(0, 8)})`);
          this.renderProjectSelectorMenu();
          return;
        } catch {
          api.logout();
        }
      }

      if (envConfig.HARNESS_TEST_EMAIL && envConfig.HARNESS_TEST_PASSWORD) {
        if (this.dom.authUsername) this.dom.authUsername.value = envConfig.HARNESS_TEST_EMAIL;
        if (this.dom.authProjectId && envConfig.HARNESS_TEST_PROJECT_ID) {
          this.dom.authProjectId.value = envConfig.HARNESS_TEST_PROJECT_ID;
        }

        await api.login(envConfig.HARNESS_TEST_EMAIL, envConfig.HARNESS_TEST_PASSWORD);
        await api.fetchProjects();

        const targetProjId = envConfig.HARNESS_TEST_PROJECT_ID || (api.projects[0] && (api.projects[0].id || api.projects[0]._id));
        if (targetProjId) {
          api.setProject(targetProjId);
        }

        const activeProj = api.projects.find((p) => (p.id || p._id) === api.projectId);
        this.updateProjectStatusUI('connected', activeProj ? activeProj.name : 'Connected Workspace');
        this.renderProjectSelectorMenu();
      } else {
        this.updateProjectStatusUI('disconnected', 'Giriş Yapılmadı (Connect)');
        if (this.dom.btnOpenAuth) this.dom.btnOpenAuth.style.display = 'inline-flex';
      }
    } catch (err) {
      console.warn('[Slideshow] Auto-auth failed:', err);
      this.updateProjectStatusUI('disconnected', 'Workspace Bağlantısı Yok');
      if (this.dom.btnOpenAuth) this.dom.btnOpenAuth.style.display = 'inline-flex';
    }
  }

  updateProjectStatusUI(state, text) {
    if (this.dom.projectStatusDot) {
      this.dom.projectStatusDot.className = 'status-dot';
      if (state === 'connected') this.dom.projectStatusDot.classList.add('connected');
      else if (state === 'connecting') this.dom.projectStatusDot.classList.add('connecting');
    }
    if (this.dom.projectNameText) {
      this.dom.projectNameText.textContent = text;
    }
    if (this.dom.btnOpenAuth) {
      this.dom.btnOpenAuth.style.display = state === 'connected' ? 'none' : 'inline-flex';
    }
  }

  renderProjectSelectorMenu() {
    const api = window.apiClient;
    if (!this.dom.projectMenu || !api) return;

    const projects = api.projects || [];
    let html = `
      <div style="padding: 6px 10px; font-size: 10px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.5px;">
        Rapider Workspaces (${projects.length})
      </div>
    `;

    if (projects.length === 0) {
      html += `<div style="padding: 10px; font-size: 12px; color: var(--text-secondary);">Aktif workspace bulunamadı.</div>`;
    } else {
      for (const proj of projects) {
        const pid = proj.id || proj._id;
        const isCurrent = pid === api.projectId;
        html += `
          <div class="app-menu-item ${isCurrent ? 'active' : ''}" data-project-id="${this.escapeHtml(pid)}">
            <div style="display:flex; align-items:center; justify-content:space-between; width:100%;">
              <span style="font-weight: 600;">${this.escapeHtml(proj.name || 'Unnamed Workspace')}</span>
              ${isCurrent ? '<i class="fas fa-check" style="color: var(--accent-emerald); font-size: 11px;"></i>' : ''}
            </div>
            <span style="font-size: 10px; color: var(--text-muted); font-family: var(--font-mono);">${this.escapeHtml(pid)}</span>
          </div>
        `;
      }
    }

    html += `
      <div style="border-top: 1px solid var(--border-subtle); margin-top: 6px; padding-top: 6px; display:flex; gap:6px;">
        <button type="button" id="menu-btn-switch-account" class="btn-nav-link" style="flex:1; justify-content:center;">
          <i class="fas fa-user-cog"></i> Hesap / Sunucu Değiştir
        </button>
      </div>
    `;

    this.dom.projectMenu.innerHTML = html;

    this.dom.projectMenu.querySelectorAll('.app-menu-item[data-project-id]').forEach((item) => {
      item.addEventListener('click', async () => {
        const pid = item.getAttribute('data-project-id');
        if (!pid) return;
        api.setProject(pid);
        const selected = projects.find((p) => (p.id || p._id) === pid);
        this.updateProjectStatusUI('connected', selected ? selected.name : pid);
        this.renderProjectSelectorMenu();
        this.dom.projectMenu.classList.remove('open');
        this.showToast(`Aktif Workspace: ${selected ? selected.name : pid}`, 'success');
        await this.loadActiveApps();
      });
    });

    this.dom.projectMenu.querySelector('#menu-btn-switch-account')?.addEventListener('click', () => {
      this.dom.projectMenu.classList.remove('open');
      this.openAuthModal();
    });
  }

  openAuthModal() {
    this.dom.authModal?.classList.add('open');
    if (this.dom.authBanner) {
      this.dom.authBanner.className = 'auth-banner';
      this.dom.authBanner.textContent = '';
    }
  }

  closeAuthModal() {
    this.dom.authModal?.classList.remove('open');
  }

  async handleLoginSubmit(e) {
    e.preventDefault();
    const api = window.apiClient;
    if (!api) return;

    const backendUrl = this.dom.authBackendUrl?.value.trim();
    const targetProjectId = this.dom.authProjectId?.value.trim();
    const username = this.dom.authUsername?.value.trim();
    const password = this.dom.authPassword?.value;

    if (!username || !password) return;

    if (backendUrl) {
      api.setBackendUrl(backendUrl);
    }

    if (this.dom.btnSubmitLogin) {
      this.dom.btnSubmitLogin.disabled = true;
      this.dom.btnSubmitLogin.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Bağlanıyor...';
    }

    try {
      await api.login(username, password);
      await api.fetchProjects();

      if (targetProjectId) {
        api.setProject(targetProjectId);
      } else if (api.projects.length > 0) {
        api.setProject(api.projects[0].id || api.projects[0]._id);
      }

      const activeProj = api.projects.find((p) => (p.id || p._id) === api.projectId);
      this.updateProjectStatusUI('connected', activeProj ? activeProj.name : `Workspace (${String(api.projectId || '').slice(0, 8)})`);
      this.renderProjectSelectorMenu();
      this.closeAuthModal();
      this.showToast('Rapider sunucusuna başarıyla giriş yapıldı!', 'success');
      await this.loadActiveApps();
    } catch (err) {
      if (this.dom.authBanner) {
        this.dom.authBanner.className = 'auth-banner error';
        this.dom.authBanner.textContent = `Giriş hatası: ${err.message}`;
      }
    } finally {
      if (this.dom.btnSubmitLogin) {
        this.dom.btnSubmitLogin.disabled = false;
        this.dom.btnSubmitLogin.innerHTML = 'Giriş Yap & Bağlan';
      }
    }
  }

  // ==========================================================================
  // ACTIVE APP DISCOVERY & SELECTOR (WORKSPACE APPS + HARNESS APPS)
  // ==========================================================================

  async loadActiveApps() {
    const api = window.apiClient;
    const apps = [];

    // 1. Fetch Workspace App Definitions from Rapider Backend if authenticated
    if (api && api.isAuthenticated() && api.projectId) {
      try {
        const filterObj = {
          where: {
            and: [
              { projectId: api.projectId },
              { definitionType: 'App' }
            ]
          }
        };
        const filterParam = encodeURIComponent(JSON.stringify(filterObj));
        const res = await fetch(`/api/proxy/definitions?filter=${filterParam}`, {
          headers: api.getHeaders()
        });
        if (res.ok) {
          const defs = await res.json();
          if (Array.isArray(defs)) {
            for (const d of defs) {
              const id = d.id || d._id;
              if (!id) continue;
              const name = d.name || d.title || d.key || id;
              apps.push({
                id,
                name,
                appKey: d.key || d.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                source: 'workspace',
                projectId: d.projectId || api.projectId
              });
            }
          }
        }
      } catch (err) {
        console.warn('[Slideshow] Could not fetch workspace App definitions:', err);
      }
    }

    // 2. Also fetch local Harness Apps (/api/apps & /api/app-config)
    let defaultHarnessAppKey = null;
    try {
      const cfgRes = await fetch('/api/app-config');
      if (cfgRes.ok) {
        const cfg = await cfgRes.json();
        defaultHarnessAppKey = cfg.appKey || cfg.name || null;
      }
    } catch {
      // Ignore
    }

    try {
      const localRes = await fetch('/api/apps');
      if (localRes.ok) {
        const localData = await localRes.json();
        const localApps = localData.apps || [];
        for (const la of localApps) {
          const alreadyInWorkspace = apps.some(
            (a) => a.appKey === la.appKey || a.name.toLowerCase() === (la.name || '').toLowerCase()
          );
          if (!alreadyInWorkspace) {
            apps.push({
              id: la.id || la.appKey,
              name: la.name || la.appKey,
              appKey: la.appKey,
              source: 'local',
              projectId: api?.projectId || 'local'
            });
          }
        }
      }
    } catch (err) {
      console.warn('[Slideshow] Could not fetch local /api/apps:', err);
    }

    // 3. Ensure there is always a fallback TourXel App option if list is empty
    if (apps.length === 0) {
      apps.push({
        id: 'tourxel-screen-guides-app',
        name: 'TourXel Tour Management',
        appKey: 'tourxel',
        source: 'local',
        projectId: api?.projectId || 'local'
      });
    }

    this.availableApps = apps;

    // 4. Resolve active app selection:
    // Priority: URL ?appId= or ?app= -> saved localStorage -> TourXel app in workspace -> workspace app matching harness default -> first workspace app -> first local app
    const urlParams = new URLSearchParams(window.location.search);
    const paramApp = urlParams.get('appId') || urlParams.get('app');
    const savedAppId = localStorage.getItem('slideshow_active_app_id');

    let chosen = null;
    if (paramApp) {
      chosen = apps.find((a) => a.id === paramApp || a.appKey === paramApp);
    }
    if (!chosen && savedAppId) {
      chosen = apps.find((a) => a.id === savedAppId || a.appKey === savedAppId);
    }
    if (!chosen) {
      chosen = apps.find((a) => a.source === 'workspace' && /tourxel|tour|quotation|operation/i.test(`${a.name} ${a.appKey}`));
    }
    if (!chosen && defaultHarnessAppKey) {
      chosen = apps.find((a) => a.appKey === defaultHarnessAppKey || a.name === defaultHarnessAppKey);
    }
    if (!chosen) {
      chosen = apps.find((a) => a.source === 'workspace') || apps[0];
    }

    await this.setActiveApp(chosen, false);
  }

  async setActiveApp(appObj, showNotification = true) {
    if (!appObj) return;
    this.activeApp = appObj;
    localStorage.setItem('slideshow_active_app_id', appObj.id);

    if (this.dom.activeAppNameText) {
      this.dom.activeAppNameText.textContent = `App: ${appObj.name}`;
    }
    if (this.dom.tasksActiveAppPill) {
      this.dom.tasksActiveAppPill.textContent = appObj.name;
      this.dom.tasksActiveAppPill.title = `Active App: ${appObj.name} (${appObj.id})`;
    }
    if (this.dom.captureTargetAppBadge) {
      this.dom.captureTargetAppBadge.innerHTML = `<i class="fas fa-cube"></i> ${this.escapeHtml(appObj.name)}`;
    }

    this.renderActiveAppSelectorMenu();

    if (showNotification) {
      this.showToast(`Aktif Uygulama: ${appObj.name}`, 'info');
    }

    // Fetch tasks/comments for the selected active app
    await this.fetchAppTasks();
  }

  renderActiveAppSelectorMenu() {
    if (!this.dom.activeAppMenu) return;

    const workspaceApps = this.availableApps.filter((a) => a.source === 'workspace');
    const localApps = this.availableApps.filter((a) => a.source !== 'workspace');

    let html = '';

    if (workspaceApps.length > 0) {
      html += `
        <div style="padding: 6px 10px; font-size: 10px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.5px;">
          Workspace Apps (${workspaceApps.length})
        </div>
      `;
      for (const app of workspaceApps) {
        const isCurrent = this.activeApp && this.activeApp.id === app.id;
        html += `
          <div class="app-menu-item ${isCurrent ? 'active' : ''}" data-app-id="${this.escapeHtml(app.id)}">
            <div style="display:flex; align-items:center; justify-content:space-between; width:100%;">
              <span style="font-weight: 600;">${this.escapeHtml(app.name)}</span>
              ${isCurrent ? '<i class="fas fa-check" style="color: var(--accent-emerald); font-size: 11px;"></i>' : ''}
            </div>
            <span style="font-size: 10px; color: var(--text-muted); font-family: var(--font-mono);">${this.escapeHtml(app.id)}</span>
          </div>
        `;
      }
    }

    if (localApps.length > 0) {
      html += `
        <div style="padding: 8px 10px 4px; font-size: 10px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.5px; border-top: ${workspaceApps.length > 0 ? '1px solid var(--border-subtle)' : 'none'};">
          Harness Microapps (${localApps.length})
        </div>
      `;
      for (const app of localApps.slice(0, 25)) {
        const isCurrent = this.activeApp && this.activeApp.id === app.id;
        html += `
          <div class="app-menu-item ${isCurrent ? 'active' : ''}" data-app-id="${this.escapeHtml(app.id)}">
            <div style="display:flex; align-items:center; justify-content:space-between; width:100%;">
              <span style="font-weight: 600;">${this.escapeHtml(app.name)}</span>
              ${isCurrent ? '<i class="fas fa-check" style="color: var(--accent-emerald); font-size: 11px;"></i>' : ''}
            </div>
            <span style="font-size: 10px; color: var(--text-muted); font-family: var(--font-mono);">${this.escapeHtml(app.appKey)}</span>
          </div>
        `;
      }
    }

    this.dom.activeAppMenu.innerHTML = html;

    this.dom.activeAppMenu.querySelectorAll('.app-menu-item[data-app-id]').forEach((item) => {
      item.addEventListener('click', async () => {
        const appId = item.getAttribute('data-app-id');
        const found = this.availableApps.find((a) => a.id === appId);
        if (found) {
          this.dom.activeAppMenu.classList.remove('open');
          await this.setActiveApp(found, true);
        }
      });
    });
  }

  // ==========================================================================
  // REPORT & REQUEST (TASKS) PANEL — RAPIDER UI APP BUILDER CLONE
  // ==========================================================================

  bindTasksEvents() {
    // Primary Report Bug & Request Feature buttons (Screen Capture Only — No Bubble Reporting)
    this.dom.btnReportBug?.addEventListener('click', () => {
      this.openScreenCaptureModal('task', 'Bug');
    });
    this.dom.btnRequestFeature?.addEventListener('click', () => {
      this.openScreenCaptureModal('task', 'Feature');
    });

    // Refresh Tasks
    this.dom.btnRefreshTasks?.addEventListener('click', () => {
      this.fetchAppTasks(true);
    });

    // Summary Type Filter Cards (Total / Bug / Feature)
    [this.dom.statCardAll, this.dom.statCardBug, this.dom.statCardFeature].forEach((card) => {
      card?.addEventListener('click', () => {
        const type = card.getAttribute('data-type') || 'ALL';
        if (this.selectedTaskType === type && type !== 'ALL') {
          this.selectedTaskType = 'ALL';
        } else {
          this.selectedTaskType = type;
        }
        this.updateTaskFilterUI();
        this.renderTasksList();
      });
    });

    // Task Search Input
    this.dom.taskSearchInput?.addEventListener('input', (e) => {
      this.taskSearchQuery = e.target.value || '';
      if (this.dom.btnClearTaskSearch) {
        this.dom.btnClearTaskSearch.style.display = this.taskSearchQuery ? 'inline-flex' : 'none';
      }
      this.updateTaskFilterUI();
      this.renderTasksList();
    });

    this.dom.btnClearTaskSearch?.addEventListener('click', () => {
      this.taskSearchQuery = '';
      if (this.dom.taskSearchInput) this.dom.taskSearchInput.value = '';
      if (this.dom.btnClearTaskSearch) this.dom.btnClearTaskSearch.style.display = 'none';
      this.updateTaskFilterUI();
      this.renderTasksList();
    });

    // Filter Dropdown Toggle
    this.dom.btnTaskFilterDropdown?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.dom.taskFilterMenu?.classList.toggle('open');
    });

    // Reported by Me Checkbox
    this.dom.filterReportedByMeCheckbox?.addEventListener('change', (e) => {
      this.filterReportedByMe = !!e.target.checked;
      this.updateTaskFilterUI();
      this.renderTasksList();
    });

    // Quick Presets
    this.dom.btnPresetAttention?.addEventListener('click', () => {
      this.selectedTaskStatuses = ['Open', 'Reopened', 'In Progress', 'Under Review', 'Testing'];
      this.syncStatusCheckboxes();
      this.updateTaskFilterUI();
      this.renderTasksList();
    });

    this.dom.btnPresetDone?.addEventListener('click', () => {
      this.selectedTaskStatuses = ['Approved', 'Completed', 'Resolved', 'Closed'];
      this.syncStatusCheckboxes();
      this.updateTaskFilterUI();
      this.renderTasksList();
    });

    // Reset All Filters
    this.dom.btnResetAllTaskFilters?.addEventListener('click', () => this.resetAllTaskFilters());
    this.dom.btnClearActiveFilters?.addEventListener('click', () => this.resetAllTaskFilters());

    // Page Scope Segmented Toggle (Current Slide vs All Pages)
    this.dom.btnScopeCurrent?.addEventListener('click', () => {
      this.taskPageScope = 'current';
      this.dom.btnScopeCurrent.classList.add('active');
      this.dom.btnScopeAll?.classList.remove('active');
      this.renderTasksList();
    });

    this.dom.btnScopeAll?.addEventListener('click', () => {
      this.taskPageScope = 'all';
      this.dom.btnScopeAll.classList.add('active');
      this.dom.btnScopeCurrent?.classList.remove('active');
      this.renderTasksList();
    });

    // Task Detail View Events
    this.dom.btnBackToTasks?.addEventListener('click', () => this.closeTaskDetails());
    this.dom.btnDetailEditTask?.addEventListener('click', () => {
      if (!this.activeTaskDetail) return;
      this.isEditingTaskDetail = !this.isEditingTaskDetail;
      this.renderTaskDetailView();
    });
    this.dom.btnDetailDeleteTask?.addEventListener('click', () => {
      if (!this.activeTaskDetail) return;
      this.confirmDeleteTask(this.activeTaskDetail);
    });

    // Task Reply Screen Capture & Send Reply
    this.dom.btnReplyScreenCapture?.addEventListener('click', () => {
      this.openScreenCaptureModal('reply');
    });
    this.dom.btnSendReply?.addEventListener('click', () => {
      this.submitTaskReply();
    });

    // Screenshot Preview Modal Close
    this.dom.screenshotPreviewCloseBtn?.addEventListener('click', () => this.closeScreenshotPreviewModal());
    this.dom.screenshotPreviewModal?.addEventListener('click', (e) => {
      if (e.target === this.dom.screenshotPreviewModal) this.closeScreenshotPreviewModal();
    });

    // Delete Task Confirmation Modal
    this.dom.deleteTaskCloseBtn?.addEventListener('click', () => this.closeDeleteTaskModal());
    this.dom.btnCancelDeleteTask?.addEventListener('click', () => this.closeDeleteTaskModal());
    this.dom.deleteTaskModal?.addEventListener('click', (e) => {
      if (e.target === this.dom.deleteTaskModal) this.closeDeleteTaskModal();
    });
    this.dom.btnConfirmDeleteTask?.addEventListener('click', () => this.executeDeleteTask());
  }

  renderTaskFilterStatusCheckboxes() {
    if (!this.dom.filterStatusList) return;
    let html = '';
    for (const status of this.allTaskStatuses) {
      const checked = this.selectedTaskStatuses.includes(status) ? 'checked' : '';
      html += `
        <label class="filter-checkbox-row">
          <input type="checkbox" class="status-filter-cb" value="${this.escapeHtml(status)}" ${checked} />
          <span>${this.escapeHtml(status)}</span>
        </label>
      `;
    }
    this.dom.filterStatusList.innerHTML = html;
    this.dom.filterStatusList.querySelectorAll('.status-filter-cb').forEach((cb) => {
      cb.addEventListener('change', () => {
        const val = cb.value;
        if (cb.checked) {
          if (!this.selectedTaskStatuses.includes(val)) this.selectedTaskStatuses.push(val);
        } else {
          this.selectedTaskStatuses = this.selectedTaskStatuses.filter((s) => s !== val);
        }
        this.updateTaskFilterUI();
        this.renderTasksList();
      });
    });
  }

  syncStatusCheckboxes() {
    this.dom.filterStatusList?.querySelectorAll('.status-filter-cb').forEach((cb) => {
      cb.checked = this.selectedTaskStatuses.includes(cb.value);
    });
  }

  resetAllTaskFilters() {
    this.selectedTaskType = 'ALL';
    this.selectedTaskStatuses = [];
    this.taskSearchQuery = '';
    this.filterReportedByMe = false;
    if (this.dom.taskSearchInput) this.dom.taskSearchInput.value = '';
    if (this.dom.btnClearTaskSearch) this.dom.btnClearTaskSearch.style.display = 'none';
    if (this.dom.filterReportedByMeCheckbox) this.dom.filterReportedByMeCheckbox.checked = false;
    this.syncStatusCheckboxes();
    this.updateTaskFilterUI();
    this.renderTasksList();
  }

  updateTaskFilterUI() {
    // Summary stat cards active state
    this.dom.statCardAll?.classList.toggle('active', this.selectedTaskType === 'ALL');
    this.dom.statCardBug?.classList.toggle('active', this.selectedTaskType === 'Bug');
    this.dom.statCardFeature?.classList.toggle('active', this.selectedTaskType === 'Feature');

    // Filter count badge on button
    const filterCount = this.selectedTaskStatuses.length + (this.filterReportedByMe ? 1 : 0);
    if (this.dom.taskFilterCountBadge) {
      this.dom.taskFilterCountBadge.textContent = String(filterCount);
      this.dom.taskFilterCountBadge.style.display = filterCount > 0 ? 'inline-flex' : 'none';
    }

    // Active filter chips bar
    const hasAnyFilter =
      this.selectedTaskType !== 'ALL' ||
      this.selectedTaskStatuses.length > 0 ||
      this.filterReportedByMe ||
      this.taskSearchQuery.trim().length > 0;

    if (this.dom.taskActiveFiltersBar) {
      this.dom.taskActiveFiltersBar.style.display = hasAnyFilter ? 'flex' : 'none';
    }

    if (this.dom.taskActiveFilterChips && hasAnyFilter) {
      let chipsHtml = '';
      if (this.taskSearchQuery.trim()) {
        chipsHtml += `<span class="active-filter-chip" data-clear="search">Search: "${this.escapeHtml(this.taskSearchQuery.trim())}" <i class="fas fa-times"></i></span>`;
      }
      if (this.selectedTaskType !== 'ALL') {
        chipsHtml += `<span class="active-filter-chip" data-clear="type">Type: ${this.escapeHtml(this.selectedTaskType)} <i class="fas fa-times"></i></span>`;
      }
      if (this.filterReportedByMe) {
        chipsHtml += `<span class="active-filter-chip" data-clear="me">Reported by Me <i class="fas fa-times"></i></span>`;
      }
      for (const st of this.selectedTaskStatuses) {
        chipsHtml += `<span class="active-filter-chip" data-clear-status="${this.escapeHtml(st)}">${this.escapeHtml(st)} <i class="fas fa-times"></i></span>`;
      }
      this.dom.taskActiveFilterChips.innerHTML = chipsHtml;

      this.dom.taskActiveFilterChips.querySelectorAll('.active-filter-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          const clearKind = chip.getAttribute('data-clear');
          const clearStatus = chip.getAttribute('data-clear-status');
          if (clearKind === 'search') {
            this.taskSearchQuery = '';
            if (this.dom.taskSearchInput) this.dom.taskSearchInput.value = '';
            if (this.dom.btnClearTaskSearch) this.dom.btnClearTaskSearch.style.display = 'none';
          } else if (clearKind === 'type') {
            this.selectedTaskType = 'ALL';
          } else if (clearKind === 'me') {
            this.filterReportedByMe = false;
            if (this.dom.filterReportedByMeCheckbox) this.dom.filterReportedByMeCheckbox.checked = false;
          } else if (clearStatus) {
            this.selectedTaskStatuses = this.selectedTaskStatuses.filter((s) => s !== clearStatus);
            this.syncStatusCheckboxes();
          }
          this.updateTaskFilterUI();
          this.renderTasksList();
        });
      });
    }
  }

  getCurrentSlidePageIdentifier() {
    const screen = this.catalog[this.currentIndex];
    if (!screen) return '';
    return `slide-${screen.no}`;
  }

  isTaskMatchingCurrentSlide(task) {
    const screen = this.catalog[this.currentIndex];
    if (!screen || !task) return false;
    const slideId = `slide-${screen.no}`;
    return (
      task.pageId === slideId ||
      task.pageId === screen.no ||
      task.pageId === screen.route ||
      task.slideNo === screen.no ||
      task.route === screen.route
    );
  }

  getLocalTasksStorageKey(appId) {
    return `slideshow_local_tasks_${appId || 'default'}`;
  }

  loadLocalBackupTasks(appId) {
    try {
      const raw = localStorage.getItem(this.getLocalTasksStorageKey(appId));
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  saveLocalBackupTasks(appId, tasks) {
    try {
      localStorage.setItem(this.getLocalTasksStorageKey(appId), JSON.stringify(tasks));
    } catch {
      // Ignore quota errors
    }
  }

  mapCommentToTask(c) {
    const metadataMap = {};
    if (Array.isArray(c.metadata)) {
      c.metadata.forEach((m) => {
        if (m && m.key) metadataMap[m.key] = m.value;
      });
    }

    const rawText = c.content || c.text || '';
    const firstNewline = rawText.indexOf('\n');
    const fallbackTitle = firstNewline !== -1 ? rawText.substring(0, firstNewline).trim() : rawText.substring(0, 80);
    const fallbackDesc = firstNewline !== -1 ? rawText.substring(firstNewline).trim() : rawText;

    const categoryStr = String(c.category || metadataMap['category'] || '').toLowerCase();
    const type = categoryStr.includes('feature') ? 'Feature' : 'Bug';

    let screenshotUrl = metadataMap['screenshotUrl'] || '';
    if (!screenshotUrl) {
      const imgMatch = rawText.match(/!\[[^\]]*\]\(([^)]+)\)/);
      if (imgMatch) screenshotUrl = imgMatch[1];
    }

    const creatorName = c.createdByUser
      ? `${c.createdByUser.firstName || ''} ${c.createdByUser.lastName || ''}`.trim() ||
        c.createdByUser.email ||
        c.createdByUser.username ||
        'User'
      : metadataMap['creatorName'] || 'Developer';

    return {
      id: c.id || c._id,
      type,
      title: metadataMap['title'] || fallbackTitle || 'Untitled Task',
      description: metadataMap['description'] || fallbackDesc || '',
      content: rawText,
      status: c.status || 'Open',
      isApproved: c.isApproved !== undefined ? c.isApproved : null,
      createdDate: c.createdDate ? new Date(c.createdDate) : new Date(),
      createdBy: c.createdBy || '',
      creatorName,
      screenshotUrl,
      pageId: metadataMap['pageId'] || '',
      slideNo: metadataMap['slideNo'] || '',
      route: metadataMap['route'] || '',
      appId: c.relatedEntityId || metadataMap['appId'] || '',
      metadata: Array.isArray(c.metadata) ? c.metadata : [],
      subComments: Array.isArray(c.subComments) ? c.subComments : []
    };
  }

  async fetchAppTasks(showSpinner = false) {
    const api = window.apiClient;
    const targetAppId = this.activeApp?.id;
    if (!targetAppId) return;

    this.isLoadingTasks = true;
    if (showSpinner && this.dom.refreshTasksIcon) {
      this.dom.refreshTasksIcon.classList.add('fa-spin');
    }

    let backendTasks = [];
    if (api && api.isAuthenticated() && api.projectId) {
      try {
        const filterObj = {
          where: {
            and: [
              { projectId: api.projectId },
              { relatedEntityName: 'App' },
              { relatedEntityId: targetAppId },
              { or: [{ isDeleted: false }, { isDeleted: null }] }
            ]
          },
          include: [{ relation: 'subComments' }, { relation: 'createdByUser' }],
          order: ['createdDate DESC']
        };
        const filterParam = encodeURIComponent(JSON.stringify(filterObj));
        const res = await fetch(`/api/proxy/comments?filter=${filterParam}`, {
          headers: api.getHeaders()
        });
        if (res.ok) {
          const comments = await res.json();
          if (Array.isArray(comments)) {
            const topLevel = comments.filter((c) => !c.parentCommentId && c.isDeleted !== true);
            backendTasks = topLevel.map((c) => this.mapCommentToTask(c));
          }
        }
      } catch (err) {
        console.warn('[Slideshow] Error fetching comments from backend:', err);
      }
    }

    // Merge with any locally stored tasks for this app (that aren't already in backendTasks)
    const localTasks = this.loadLocalBackupTasks(targetAppId).map((t) => ({
      ...t,
      createdDate: t.createdDate ? new Date(t.createdDate) : new Date()
    }));

    const mergedMap = new Map();
    for (const bt of backendTasks) {
      mergedMap.set(bt.id, bt);
    }
    for (const lt of localTasks) {
      if (!mergedMap.has(lt.id)) {
        mergedMap.set(lt.id, lt);
      }
    }

    this.appTasks = Array.from(mergedMap.values()).sort(
      (a, b) => new Date(b.createdDate).getTime() - new Date(a.createdDate).getTime()
    );

    this.isLoadingTasks = false;
    if (this.dom.refreshTasksIcon) {
      this.dom.refreshTasksIcon.classList.remove('fa-spin');
    }

    this.updateTaskCountsUI();
    this.renderTasksList();

    // If detail view is open, refresh activeTaskDetail
    if (this.activeTaskDetail) {
      const updated = this.appTasks.find((t) => t.id === this.activeTaskDetail.id);
      if (updated) {
        this.activeTaskDetail = updated;
        this.renderTaskDetailView();
      }
    }
  }

  updateTaskCountsUI() {
    const allCount = this.appTasks.length;
    const bugCount = this.appTasks.filter((t) => t.type === 'Bug').length;
    const featureCount = this.appTasks.filter((t) => t.type === 'Feature').length;
    const currentSlideCount = this.appTasks.filter((t) => this.isTaskMatchingCurrentSlide(t)).length;

    if (this.dom.headerTasksCountBadge) this.dom.headerTasksCountBadge.textContent = String(allCount);
    if (this.dom.panelTabTasksBadge) this.dom.panelTabTasksBadge.textContent = String(allCount);
    if (this.dom.statCountAll) this.dom.statCountAll.textContent = String(allCount);
    if (this.dom.statCountBug) this.dom.statCountBug.textContent = String(bugCount);
    if (this.dom.statCountFeature) this.dom.statCountFeature.textContent = String(featureCount);
    if (this.dom.scopeCountCurrent) this.dom.scopeCountCurrent.textContent = String(currentSlideCount);
    if (this.dom.scopeCountAll) this.dom.scopeCountAll.textContent = String(allCount);
  }

  getFilteredTasks() {
    const q = this.taskSearchQuery.trim().toLowerCase();
    const currentUserId = window.apiClient?.user?.id || window.apiClient?.user?._id || '';

    return this.appTasks.filter((t) => {
      if (this.taskPageScope === 'current' && !this.isTaskMatchingCurrentSlide(t)) {
        return false;
      }
      if (this.selectedTaskType !== 'ALL' && t.type !== this.selectedTaskType) {
        return false;
      }
      if (this.selectedTaskStatuses.length > 0 && !this.selectedTaskStatuses.includes(t.status)) {
        return false;
      }
      if (this.filterReportedByMe && currentUserId && t.createdBy && t.createdBy !== currentUserId) {
        return false;
      }
      if (q) {
        const matchTitle = (t.title || '').toLowerCase().includes(q);
        const matchDesc = (t.description || '').toLowerCase().includes(q);
        const matchId = (t.id || '').toLowerCase().includes(q);
        const matchRoute = (t.route || '').toLowerCase().includes(q);
        if (!matchTitle && !matchDesc && !matchId && !matchRoute) return false;
      }
      return true;
    });
  }

  getStatusBadgeClass(status) {
    const s = String(status || 'Open');
    if (s === 'Approved' || s === 'Completed' || s === 'Resolved') return 'status-badge-emerald';
    if (s === 'In Progress' || s === 'Under Review' || s === 'Testing') return 'status-badge-blue';
    if (s === 'Planned') return 'status-badge-purple';
    if (s === 'Closed') return 'status-badge-slate';
    return 'status-badge-amber'; // Open, Reopened
  }

  renderTasksList() {
    if (!this.dom.tasksListContainer) return;

    const filtered = this.getFilteredTasks();

    if (this.isLoadingTasks && this.appTasks.length === 0) {
      this.dom.tasksListContainer.innerHTML = `
        <div class="tasks-empty-state">
          <div class="spinner" style="margin-bottom: 10px;"></div>
          <span>Loading tasks for ${this.escapeHtml(this.activeApp?.name || 'App')}...</span>
        </div>
      `;
      return;
    }

    if (filtered.length === 0) {
      this.dom.tasksListContainer.innerHTML = `
        <div class="tasks-empty-state">
          <div class="empty-icon-circle">
            <i class="fas fa-clipboard-check"></i>
          </div>
          <div class="empty-title">${this.appTasks.length === 0 ? 'No Tasks Reported Yet' : 'No Matching Tasks'}</div>
          <p class="empty-subtitle">
            ${
              this.appTasks.length === 0
                ? 'Click "Report Bug" or "Request Feature" above to capture & annotate the current screen and save a task to the active application.'
                : 'Try adjusting your search query, status filters, or switching Page Scope to "All Pages".'
            }
          </p>
        </div>
      `;
      return;
    }

    let html = '';
    for (const task of filtered) {
      const isBug = task.type === 'Bug';
      const statusClass = this.getStatusBadgeClass(task.status);
      const replyCount = Array.isArray(task.subComments) ? task.subComments.length : 0;
      const dateStr = task.createdDate ? new Date(task.createdDate).toLocaleDateString() : '';
      const slideBadgeLabel = task.slideNo ? `Slide #${task.slideNo}` : (task.route || task.pageId || '');

      const canApproveOrClose = task.isApproved === null || task.isApproved === undefined;
      const isClosedOrDone =
        task.isApproved === true ||
        task.isApproved === false ||
        task.status === 'Closed' ||
        task.status === 'Approved';

      html += `
        <div class="task-card" data-task-id="${this.escapeHtml(task.id)}">
          <div class="task-card-top">
            <div class="task-card-badges">
              <span class="task-type-pill ${isBug ? 'pill-bug' : 'pill-feature'}">
                <i class="fas ${isBug ? 'fa-bug' : 'fa-lightbulb'}"></i>
                <span>${isBug ? 'Bug' : 'Feature'}</span>
              </span>
              <span class="task-status-pill ${statusClass}">${this.escapeHtml(task.status)}</span>
              ${
                slideBadgeLabel
                  ? `<button type="button" class="task-slide-pill" data-goto-slide="${this.escapeHtml(task.slideNo || '')}" title="Navigate to slide">${this.escapeHtml(slideBadgeLabel)}</button>`
                  : ''
              }
            </div>

            <div class="task-card-quick-actions" onclick="event.stopPropagation();">
              ${
                canApproveOrClose
                  ? `
                    <button type="button" class="btn-card-Quick approve" data-approve-id="${this.escapeHtml(task.id)}" title="Approve Task">
                      <i class="fas fa-check"></i>
                    </button>
                    <button type="button" class="btn-card-Quick close-task" data-close-id="${this.escapeHtml(task.id)}" title="Close Task">
                      <i class="fas fa-times"></i>
                    </button>
                  `
                  : ''
              }
              ${
                isClosedOrDone
                  ? `
                    <button type="button" class="btn-card-Quick reopen" data-reopen-id="${this.escapeHtml(task.id)}" title="Reopen Task">
                      <i class="fas fa-redo"></i>
                    </button>
                  `
                  : ''
              }
              <button type="button" class="btn-card-Quick delete" data-delete-id="${this.escapeHtml(task.id)}" title="Delete Task">
                <i class="fas fa-trash-alt"></i>
              </button>
            </div>
          </div>

          <div class="task-card-title">${this.escapeHtml(task.title)}</div>

          ${
            task.screenshotUrl
              ? `
                <div class="task-card-screenshot" onclick="event.stopPropagation();" data-preview-url="${this.escapeHtml(task.screenshotUrl)}">
                  <img src="${this.escapeHtml(task.screenshotUrl)}" alt="Annotated Capture" loading="lazy" />
                  <span class="screenshot-zoom-badge"><i class="fas fa-search-plus"></i> View Capture</span>
                </div>
              `
              : ''
          }

          <div class="task-card-footer">
            <div class="task-card-meta">
              <span><i class="far fa-user"></i> ${this.escapeHtml(task.creatorName || 'Developer')}</span>
              <span>•</span>
              <span>${this.escapeHtml(dateStr)}</span>
            </div>
            <div class="task-card-replies">
              <i class="far fa-comment-dots"></i>
              <span>${replyCount}</span>
            </div>
          </div>
        </div>
      `;
    }

    this.dom.tasksListContainer.innerHTML = html;

    // Bind Task Card Click -> Open Detail View
    this.dom.tasksListContainer.querySelectorAll('.task-card').forEach((card) => {
      card.addEventListener('click', () => {
        const taskId = card.getAttribute('data-task-id');
        const task = this.appTasks.find((t) => t.id === taskId);
        if (task) this.openTaskDetails(task);
      });
    });

    // Bind Slide Navigation Pill
    this.dom.tasksListContainer.querySelectorAll('[data-goto-slide]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const slideNo = btn.getAttribute('data-goto-slide');
        if (slideNo) {
          const idx = this.catalog.findIndex((s) => s.no === slideNo);
          if (idx !== -1) this.goToSlide(idx);
        }
      });
    });

    // Bind Screenshot Preview
    this.dom.tasksListContainer.querySelectorAll('[data-preview-url]').forEach((box) => {
      box.addEventListener('click', (e) => {
        e.stopPropagation();
        const url = box.getAttribute('data-preview-url');
        if (url) this.openScreenshotPreviewModal(url);
      });
    });

    // Bind Approve / Close / Reopen / Delete
    this.dom.tasksListContainer.querySelectorAll('[data-approve-id]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const task = this.appTasks.find((t) => t.id === btn.getAttribute('data-approve-id'));
        if (task) this.setTaskApproval(task, true);
      });
    });

    this.dom.tasksListContainer.querySelectorAll('[data-close-id]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const task = this.appTasks.find((t) => t.id === btn.getAttribute('data-close-id'));
        if (task) this.setTaskApproval(task, false);
      });
    });

    this.dom.tasksListContainer.querySelectorAll('[data-reopen-id]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const task = this.appTasks.find((t) => t.id === btn.getAttribute('data-reopen-id'));
        if (task) this.setTaskApproval(task, null);
      });
    });

    this.dom.tasksListContainer.querySelectorAll('[data-delete-id]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const task = this.appTasks.find((t) => t.id === btn.getAttribute('data-delete-id'));
        if (task) this.confirmDeleteTask(task);
      });
    });
  }

  openTaskDetails(task) {
    this.activeTaskDetail = task;
    this.isEditingTaskDetail = false;
    this.replyScreenshotUrls = [];
    this.renderReplyScreenshotsPreview();

    if (this.dom.tasksListSection) this.dom.tasksListSection.style.display = 'none';
    if (this.dom.taskDetailSection) this.dom.taskDetailSection.style.display = 'flex';

    // If task belongs to a specific slide, navigate to it so user sees context
    if (task.slideNo) {
      const idx = this.catalog.findIndex((s) => s.no === task.slideNo);
      if (idx !== -1 && idx !== this.currentIndex) {
        this.goToSlide(idx);
      }
    }

    this.renderTaskDetailView();
  }

  closeTaskDetails() {
    this.activeTaskDetail = null;
    this.isEditingTaskDetail = false;
    if (this.dom.taskDetailSection) this.dom.taskDetailSection.style.display = 'none';
    if (this.dom.tasksListSection) this.dom.tasksListSection.style.display = 'flex';
    this.renderTasksList();
  }

  renderTaskDetailView() {
    const task = this.activeTaskDetail;
    if (!task || !this.dom.taskDetailBody) return;

    const isBug = task.type === 'Bug';
    const statusClass = this.getStatusBadgeClass(task.status);
    const dateStr = task.createdDate ? new Date(task.createdDate).toLocaleString() : '';

    // Strip embedded screenshot markdown from description text so we don't duplicate the preview card
    const cleanDescription = (task.description || '')
      .replace(/!\[Annotated Screen Capture\]\([^)]+\)/g, '')
      .trim();

    const descHtml = window.marked
      ? window.marked.parse(cleanDescription || '*No additional description provided.*')
      : `<p>${this.escapeHtml(cleanDescription)}</p>`;

    let html = `
      <div class="detail-meta-row">
        <span class="task-type-pill ${isBug ? 'pill-bug' : 'pill-feature'}">
          <i class="fas ${isBug ? 'fa-bug' : 'fa-lightbulb'}"></i>
          <span>${isBug ? 'Bug Report' : 'Feature Request'}</span>
        </span>

        <select id="detail-status-select" class="detail-status-select ${statusClass}">
          ${this.allTaskStatuses
            .map((st) => `<option value="${this.escapeHtml(st)}" ${st === task.status ? 'selected' : ''}>${this.escapeHtml(st)}</option>`)
            .join('')}
        </select>

        <div class="detail-approval-btns">
          ${
            task.isApproved === null || task.isApproved === undefined
              ? `
                <button type="button" id="btn-detail-approve" class="btn-detail-Quick approve">
                  <i class="fas fa-check"></i> Approve
                </button>
                <button type="button" id="btn-detail-close" class="btn-detail-Quick close-task">
                  <i class="fas fa-times"></i> Close
                </button>
              `
              : `
                <button type="button" id="btn-detail-reopen" class="btn-detail-Quick reopen">
                  <i class="fas fa-redo"></i> Reopen
                </button>
              `
          }
        </div>
      </div>
    `;

    if (this.isEditingTaskDetail) {
      html += `
        <div class="detail-edit-box">
          <label class="capture-label">Title</label>
          <input type="text" id="detail-edit-title" class="capture-input" value="${this.escapeHtml(task.title)}" />
          <label class="capture-label" style="margin-top:8px;">Description (Markdown)</label>
          <textarea id="detail-edit-desc" class="capture-textarea" rows="5">${this.escapeHtml(cleanDescription)}</textarea>
          <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:10px;">
            <button type="button" id="btn-cancel-detail-edit" class="btn-capture-cancel">Cancel</button>
            <button type="button" id="btn-save-detail-edit" class="btn-primary" style="color:#ffffff !important; padding:6px 14px; font-size:12px;">
              <i class="fas fa-save"></i> Save Changes
            </button>
          </div>
        </div>
      `;
    } else {
      html += `
        <h3 class="detail-task-title">${this.escapeHtml(task.title)}</h3>
        <div class="detail-author-line">
          <span><i class="far fa-user"></i> ${this.escapeHtml(task.creatorName || 'Developer')}</span>
          <span>•</span>
          <span>${this.escapeHtml(dateStr)}</span>
          ${task.slideNo ? `<span>• Slide #${this.escapeHtml(task.slideNo)} (${this.escapeHtml(task.route || '')})</span>` : ''}
        </div>
      `;

      if (task.screenshotUrl) {
        html += `
          <div class="detail-screenshot-card" id="detail-screenshot-preview">
            <img src="${this.escapeHtml(task.screenshotUrl)}" alt="Annotated Screen Capture" />
            <div class="detail-screenshot-caption">
              <span><i class="fas fa-camera-retro"></i> Annotated Screen Capture</span>
              <span>Click to enlarge <i class="fas fa-expand-alt"></i></span>
            </div>
          </div>
        `;
      }

      html += `
        <div class="detail-markdown-box markdown-body">
          ${descHtml}
        </div>
      `;
    }

    // Replies / Sub-comments section
    const replies = Array.isArray(task.subComments) ? task.subComments : [];
    html += `
      <div class="detail-replies-section">
        <div class="detail-replies-heading">
          <i class="far fa-comments"></i>
          <span>Discussion &amp; Replies (${replies.length})</span>
        </div>
        <div class="detail-replies-list">
          ${
            replies.length === 0
              ? `<div class="no-replies-box">No replies yet. Add a comment or screen capture below.</div>`
              : replies
                  .map((rep) => {
                    const repAuthor = rep.createdByUser
                      ? `${rep.createdByUser.firstName || ''} ${rep.createdByUser.lastName || ''}`.trim() || rep.createdByUser.email || 'User'
                      : rep.creatorName || 'Developer';
                    const repDate = rep.createdDate ? new Date(rep.createdDate).toLocaleString() : '';
                    const repBody = window.marked
                      ? window.marked.parse(rep.content || '')
                      : `<p>${this.escapeHtml(rep.content || '')}</p>`;
                    return `
                      <div class="reply-item-card">
                        <div class="reply-item-header">
                          <strong><i class="fas fa-user-circle"></i> ${this.escapeHtml(repAuthor)}</strong>
                          <span>${this.escapeHtml(repDate)}</span>
                        </div>
                        <div class="reply-item-body markdown-body">${repBody}</div>
                      </div>
                    `;
                  })
                  .join('')
          }
        </div>
      </div>
    `;

    this.dom.taskDetailBody.innerHTML = html;

    // Bind detail events
    this.dom.taskDetailBody.querySelector('#detail-status-select')?.addEventListener('change', (e) => {
      this.setTaskStatus(task, e.target.value);
    });
    this.dom.taskDetailBody.querySelector('#btn-detail-approve')?.addEventListener('click', () => {
      this.setTaskApproval(task, true);
    });
    this.dom.taskDetailBody.querySelector('#btn-detail-close')?.addEventListener('click', () => {
      this.setTaskApproval(task, false);
    });
    this.dom.taskDetailBody.querySelector('#btn-detail-reopen')?.addEventListener('click', () => {
      this.setTaskApproval(task, null);
    });
    this.dom.taskDetailBody.querySelector('#detail-screenshot-preview')?.addEventListener('click', () => {
      if (task.screenshotUrl) this.openScreenshotPreviewModal(task.screenshotUrl);
    });
    this.dom.taskDetailBody.querySelectorAll('.reply-item-body img').forEach((img) => {
      img.style.cursor = 'zoom-in';
      img.addEventListener('click', () => this.openScreenshotPreviewModal(img.src));
    });

    // Inline Edit Save / Cancel
    this.dom.taskDetailBody.querySelector('#btn-cancel-detail-edit')?.addEventListener('click', () => {
      this.isEditingTaskDetail = false;
      this.renderTaskDetailView();
    });
    this.dom.taskDetailBody.querySelector('#btn-save-detail-edit')?.addEventListener('click', () => {
      const newTitle = this.dom.taskDetailBody.querySelector('#detail-edit-title')?.value.trim();
      const newDesc = this.dom.taskDetailBody.querySelector('#detail-edit-desc')?.value.trim();
      if (newTitle) {
        this.saveTaskEdit(task, newTitle, newDesc || '');
      }
    });
  }

  async setTaskApproval(task, approvedState) {
    const newStatus = approvedState === true ? 'Approved' : approvedState === false ? 'Closed' : 'Reopened';
    const prevApproved = task.isApproved;
    const prevStatus = task.status;

    // Optimistic update
    task.isApproved = approvedState;
    task.status = newStatus;
    this.saveLocalBackupTasks(this.activeApp?.id, this.appTasks);
    this.renderTasksList();
    if (this.activeTaskDetail && this.activeTaskDetail.id === task.id) {
      this.renderTaskDetailView();
    }

    const api = window.apiClient;
    if (api && api.isAuthenticated() && !String(task.id).startsWith('local-')) {
      try {
        const res = await fetch(`/api/screen-guides/comments/${encodeURIComponent(task.id)}`, {
          method: 'PATCH',
          headers: api.getHeaders(),
          body: JSON.stringify({ isApproved: approvedState, status: newStatus })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        this.showToast(`Task marked as ${newStatus}`, 'success');
      } catch (err) {
        task.isApproved = prevApproved;
        task.status = prevStatus;
        this.renderTasksList();
        if (this.activeTaskDetail && this.activeTaskDetail.id === task.id) {
          this.renderTaskDetailView();
        }
        this.showToast(`Failed to update task: ${err.message}`, 'error');
      }
    } else {
      this.showToast(`Task marked as ${newStatus}`, 'success');
    }
  }

  async setTaskStatus(task, newStatus) {
    const prevStatus = task.status;
    task.status = newStatus;
    this.saveLocalBackupTasks(this.activeApp?.id, this.appTasks);
    this.renderTasksList();
    if (this.activeTaskDetail && this.activeTaskDetail.id === task.id) {
      this.renderTaskDetailView();
    }

    const api = window.apiClient;
    if (api && api.isAuthenticated() && !String(task.id).startsWith('local-')) {
      try {
        const res = await fetch(`/api/screen-guides/comments/${encodeURIComponent(task.id)}`, {
          method: 'PATCH',
          headers: api.getHeaders(),
          body: JSON.stringify({ status: newStatus })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        this.showToast(`Status updated to ${newStatus}`, 'success');
      } catch (err) {
        task.status = prevStatus;
        this.renderTasksList();
        this.showToast(`Failed to update status: ${err.message}`, 'error');
      }
    }
  }

  async saveTaskEdit(task, newTitle, newCleanDesc) {
    const fullDesc = task.screenshotUrl
      ? `${newCleanDesc}\n\n![Annotated Screen Capture](${task.screenshotUrl})`
      : newCleanDesc;
    const updatedContent = `${newTitle}\n\n${fullDesc}`;

    const updatedMetadata = Array.isArray(task.metadata) ? [...task.metadata] : [];
    const upsertMeta = (k, v) => {
      const idx = updatedMetadata.findIndex((m) => m && m.key === k);
      if (idx !== -1) updatedMetadata[idx] = { key: k, value: v };
      else updatedMetadata.push({ key: k, value: v });
    };
    upsertMeta('title', newTitle);
    upsertMeta('description', fullDesc);

    task.title = newTitle;
    task.description = fullDesc;
    task.content = updatedContent;
    task.metadata = updatedMetadata;
    this.isEditingTaskDetail = false;

    this.saveLocalBackupTasks(this.activeApp?.id, this.appTasks);
    this.renderTasksList();
    this.renderTaskDetailView();

    const api = window.apiClient;
    if (api && api.isAuthenticated() && !String(task.id).startsWith('local-')) {
      try {
        await fetch(`/api/screen-guides/comments/${encodeURIComponent(task.id)}`, {
          method: 'PATCH',
          headers: api.getHeaders(),
          body: JSON.stringify({ content: updatedContent, metadata: updatedMetadata })
        });
      } catch (err) {
        console.warn('[Slideshow] Could not sync task edit to backend:', err);
      }
    }
    this.showToast('Task updated successfully', 'success');
  }

  confirmDeleteTask(task) {
    this.taskPendingDelete = task;
    if (this.dom.deleteTaskMessage) {
      this.dom.deleteTaskMessage.textContent = `Are you sure you want to delete "${task.title}"? This action cannot be undone.`;
    }
    this.dom.deleteTaskModal?.classList.add('open');
  }

  closeDeleteTaskModal() {
    this.taskPendingDelete = null;
    this.dom.deleteTaskModal?.classList.remove('open');
  }

  async executeDeleteTask() {
    const task = this.taskPendingDelete;
    if (!task) return;
    this.closeDeleteTaskModal();

    // Optimistic removal
    this.appTasks = this.appTasks.filter((t) => t.id !== task.id);
    this.saveLocalBackupTasks(this.activeApp?.id, this.appTasks);

    if (this.activeTaskDetail && this.activeTaskDetail.id === task.id) {
      this.closeTaskDetails();
    } else {
      this.updateTaskCountsUI();
      this.renderTasksList();
    }

    const api = window.apiClient;
    if (api && api.isAuthenticated() && !String(task.id).startsWith('local-')) {
      try {
        await fetch(`/api/proxy/comments/${encodeURIComponent(task.id)}`, {
          method: 'DELETE',
          headers: api.getHeaders()
        });
      } catch (err) {
        console.warn('[Slideshow] Backend delete warning:', err);
      }
    }
    this.showToast('Task deleted', 'info');
  }

  renderReplyScreenshotsPreview() {
    if (!this.dom.replyAttachedScreenshots) return;
    if (this.replyScreenshotUrls.length === 0) {
      this.dom.replyAttachedScreenshots.style.display = 'none';
      this.dom.replyAttachedScreenshots.innerHTML = '';
      return;
    }

    this.dom.replyAttachedScreenshots.style.display = 'flex';
    this.dom.replyAttachedScreenshots.innerHTML = this.replyScreenshotUrls
      .map(
        (url, idx) => `
        <div class="reply-thumb-item">
          <img src="${this.escapeHtml(url)}" alt="Reply Attachment" />
          <button type="button" class="reply-thumb-remove" data-remove-idx="${idx}" title="Remove"><i class="fas fa-times"></i></button>
        </div>
      `
      )
      .join('');

    this.dom.replyAttachedScreenshots.querySelectorAll('.reply-thumb-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-remove-idx'), 10);
        this.replyScreenshotUrls.splice(idx, 1);
        this.renderReplyScreenshotsPreview();
      });
    });
  }

  async submitTaskReply() {
    const task = this.activeTaskDetail;
    if (!task || this.isSubmittingReply) return;

    const text = (this.dom.taskReplyInput?.value || '').trim();
    if (!text && this.replyScreenshotUrls.length === 0) {
      this.showToast('Please enter a comment or attach a screen capture.', 'error');
      return;
    }

    this.isSubmittingReply = true;
    const btn = this.dom.btnSendReply;
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
    }

    try {
      let finalContent = text;
      if (this.replyScreenshotUrls.length > 0) {
        const mdImages = this.replyScreenshotUrls.map((u) => `![Annotated Screen Capture](${u})`).join('\n\n');
        finalContent = finalContent ? `${finalContent}\n\n${mdImages}` : mdImages;
      }

      let savedReply = {
        id: `reply-${Date.now()}`,
        content: finalContent,
        createdDate: new Date().toISOString(),
        creatorName: window.apiClient?.user?.email || 'Developer'
      };

      const api = window.apiClient;
      if (api && api.isAuthenticated() && !String(task.id).startsWith('local-')) {
        try {
          const res = await fetch(`/api/proxy/comments/reply/${encodeURIComponent(task.id)}`, {
            method: 'POST',
            headers: api.getHeaders(),
            body: JSON.stringify({ content: finalContent })
          });
          if (res.ok) {
            const data = await res.json();
            if (data && (data.id || data._id)) {
              savedReply = data;
            }
          }
        } catch (err) {
          console.warn('[Slideshow] Reply backend post fallback to local:', err);
        }
      }

      if (!Array.isArray(task.subComments)) task.subComments = [];
      task.subComments.push(savedReply);
      this.saveLocalBackupTasks(this.activeApp?.id, this.appTasks);

      if (this.dom.taskReplyInput) this.dom.taskReplyInput.value = '';
      this.replyScreenshotUrls = [];
      this.renderReplyScreenshotsPreview();
      this.renderTaskDetailView();
      this.renderTasksList();
      this.showToast('Reply posted!', 'success');
    } finally {
      this.isSubmittingReply = false;
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origHtml;
      }
    }
  }

  openScreenshotPreviewModal(url) {
    if (!this.dom.screenshotPreviewModal || !url) return;
    if (this.dom.screenshotPreviewImg) this.dom.screenshotPreviewImg.src = url;
    if (this.dom.screenshotPreviewOpenTab) this.dom.screenshotPreviewOpenTab.href = url;
    this.dom.screenshotPreviewModal.classList.add('open');
  }

  closeScreenshotPreviewModal() {
    this.dom.screenshotPreviewModal?.classList.remove('open');
  }

  // ==========================================================================
  // FULL-SCREEN SCREEN CAPTURE & ANNOTATION MODAL (RAPIDER UI APP BUILDER)
  // ==========================================================================

  bindScreenCaptureEvents() {
    // Close / Cancel Modal
    this.dom.btnCloseCaptureModal?.addEventListener('click', () => this.closeScreenCaptureModal());
    this.dom.btnCancelCaptureTask?.addEventListener('click', () => this.closeScreenCaptureModal());

    // Source Image Switcher inside Capture Modal (Current View / Raw / Annotated)
    this.dom.btnCaptureSrcCurrent?.addEventListener('click', () => this.setCaptureSourceImage('current'));
    this.dom.btnCaptureSrcRaw?.addEventListener('click', () => this.setCaptureSourceImage('raw'));
    this.dom.btnCaptureSrcAnnotated?.addEventListener('click', () => this.setCaptureSourceImage('annotated'));

    // Drawing Tool Buttons (pen, arrow, rect, number)
    document.querySelectorAll('.draw-tool-btn[data-tool]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.captureTool = btn.getAttribute('data-tool') || 'arrow';
        document.querySelectorAll('.draw-tool-btn[data-tool]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // Color Swatches
    this.dom.drawColorSwatches?.querySelectorAll('.color-swatch').forEach((swatch) => {
      swatch.addEventListener('click', () => {
        this.captureColor = swatch.getAttribute('data-color') || '#ef4444';
        this.dom.drawColorSwatches.querySelectorAll('.color-swatch').forEach((s) => s.classList.remove('active'));
        swatch.classList.add('active');
      });
    });

    // Line Widths
    document.querySelectorAll('.width-btn[data-width]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.captureLineWidth = parseInt(btn.getAttribute('data-width'), 10) || 4;
        document.querySelectorAll('.width-btn[data-width]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // Undo & Clear
    this.dom.btnDrawUndo?.addEventListener('click', () => this.undoCaptureShape());
    this.dom.btnDrawClear?.addEventListener('click', () => this.clearCaptureShapes());

    // Task Type Switcher inside Modal (Bug Report vs Feature Request)
    this.dom.btnCaptureTypeBug?.addEventListener('click', () => this.setCaptureTaskType('Bug'));
    this.dom.btnCaptureTypeFeature?.addEventListener('click', () => this.setCaptureTaskType('Feature'));

    // Markdown Mini Toolbar in Capture Form
    document.querySelectorAll('.md-tool-btn[data-md]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mdAction = btn.getAttribute('data-md');
        this.insertCaptureMarkdownSyntax(mdAction);
      });
    });

    // Save Annotated Report / Reply Attachment
    this.dom.btnSaveCaptureTask?.addEventListener('click', () => this.saveCaptureTaskOrReply());

    // Canvas Mouse Drawing Events
    const canvas = this.dom.screenAnnotationCanvas;
    if (canvas) {
      canvas.addEventListener('mousedown', (e) => this.onCaptureCanvasMouseDown(e));
      canvas.addEventListener('mousemove', (e) => this.onCaptureCanvasMouseMove(e));
      window.addEventListener('mouseup', () => this.onCaptureCanvasMouseUp());
    }
  }

  openScreenCaptureModal(context = 'task', initialTaskType = 'Bug') {
    this.captureContext = context;
    this.captureShapes = [];
    this.currentDraftShape = null;
    this.isDrawingShape = false;
    this.captureTool = 'arrow';

    // Reset tool active state
    document.querySelectorAll('.draw-tool-btn[data-tool]').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-tool') === this.captureTool);
    });
    this.updateCaptureToolbarState();

    const screen = this.catalog[this.currentIndex];
    if (this.dom.captureTargetAppBadge) {
      this.dom.captureTargetAppBadge.innerHTML = `<i class="fas fa-cube"></i> ${this.escapeHtml(this.activeApp?.name || 'Active App')}`;
    }
    if (this.dom.captureTargetPageBadge && screen) {
      this.dom.captureTargetPageBadge.innerHTML = `<i class="fas fa-file-alt"></i> Slide #${this.escapeHtml(screen.no)} (${this.escapeHtml(screen.route)})`;
    }

    if (context === 'reply') {
      if (this.dom.captureModalTitle) this.dom.captureModalTitle.textContent = 'Capture & Annotate Screen for Reply';
      if (this.dom.captureFormHeading) this.dom.captureFormHeading.textContent = 'Attach Annotated Capture to Reply';
      if (this.dom.captureFormIcon) this.dom.captureFormIcon.className = 'fas fa-reply';
      if (this.dom.captureTaskTypeGroup) this.dom.captureTaskTypeGroup.style.display = 'none';
      if (this.dom.captureTaskTitleGroup) this.dom.captureTaskTitleGroup.style.display = 'none';
      if (this.dom.captureDescLabel) this.dom.captureDescLabel.textContent = 'Reply Comment (Optional)';
      if (this.dom.btnSaveCaptureLabel) this.dom.btnSaveCaptureLabel.textContent = 'Attach Capture';
      if (this.dom.captureTaskDesc) this.dom.captureTaskDesc.value = this.dom.taskReplyInput?.value || '';
    } else {
      if (this.dom.captureModalTitle) this.dom.captureModalTitle.textContent = 'Annotate Screen Capture & Report Task';
      if (this.dom.captureTaskTypeGroup) this.dom.captureTaskTypeGroup.style.display = 'flex';
      if (this.dom.captureTaskTitleGroup) this.dom.captureTaskTitleGroup.style.display = 'flex';
      if (this.dom.captureDescLabel) this.dom.captureDescLabel.textContent = 'Explanation (Markdown)';
      this.setCaptureTaskType(initialTaskType);

      // Pre-fill helpful slide context in title placeholder
      if (this.dom.captureTaskTitle) {
        this.dom.captureTaskTitle.value = '';
        this.dom.captureTaskTitle.placeholder = screen
          ? `e.g. Issue on [${screen.no}] ${this.language === 'tr' ? screen.titleTr : screen.titleEn}...`
          : 'Enter task title...';
      }
      if (this.dom.captureTaskDesc) {
        this.dom.captureTaskDesc.value = '';
      }
    }

    this.dom.screenCaptureModal?.classList.add('open');
    this.setCaptureSourceImage('current');

    setTimeout(() => {
      if (context === 'task') this.dom.captureTaskTitle?.focus();
      else this.dom.captureTaskDesc?.focus();
    }, 100);
  }

  closeScreenCaptureModal() {
    this.dom.screenCaptureModal?.classList.remove('open');
    this.isDrawingShape = false;
    this.currentDraftShape = null;
  }

  setCaptureTaskType(type) {
    this.captureTaskType = type === 'Feature' ? 'Feature' : 'Bug';
    const isBug = this.captureTaskType === 'Bug';

    if (this.dom.btnCaptureTypeBug) {
      this.dom.btnCaptureTypeBug.className = `capture-type-btn ${isBug ? 'active-bug' : ''}`;
    }
    if (this.dom.btnCaptureTypeFeature) {
      this.dom.btnCaptureTypeFeature.className = `capture-type-btn ${!isBug ? 'active-feature' : ''}`;
    }
    if (this.dom.captureFormIcon) {
      this.dom.captureFormIcon.className = isBug ? 'fas fa-bug' : 'fas fa-lightbulb';
      this.dom.captureFormIcon.style.color = isBug ? '#ef4444' : '#6366f1';
    }
    if (this.dom.captureFormHeading) {
      this.dom.captureFormHeading.textContent = isBug ? 'Bug Report Details' : 'Feature Request Details';
    }
    if (this.dom.btnSaveCaptureLabel) {
      this.dom.btnSaveCaptureLabel.textContent = isBug ? 'Save Bug Report' : 'Save Feature Request';
    }
  }

  setCaptureSourceImage(sourceMode) {
    this.captureSourceMode = sourceMode;
    this.dom.btnCaptureSrcCurrent?.classList.toggle('active', sourceMode === 'current');
    this.dom.btnCaptureSrcRaw?.classList.toggle('active', sourceMode === 'raw');
    this.dom.btnCaptureSrcAnnotated?.classList.toggle('active', sourceMode === 'annotated');

    const screen = this.catalog[this.currentIndex];
    let targetSrc = this.dom.mainImage?.getAttribute('src') || '';
    if (screen) {
      if (sourceMode === 'raw' && screen.rawImageUrl) {
        targetSrc = screen.rawImageUrl;
      } else if (sourceMode === 'annotated' && screen.annotatedImageUrl) {
        targetSrc = screen.annotatedImageUrl;
      }
    }

    const baseImg = this.dom.captureBaseImage;
    const canvas = this.dom.screenAnnotationCanvas;
    if (!baseImg || !canvas) return;

    baseImg.onload = () => {
      const nw = baseImg.naturalWidth || 1280;
      const nh = baseImg.naturalHeight || 800;
      canvas.width = nw;
      canvas.height = nh;
      this.redrawCaptureCanvas();
    };
    baseImg.src = targetSrc;
  }

  getNextCaptureNumber() {
    return this.captureShapes.filter((s) => s.type === 'number').length + 1;
  }

  updateCaptureToolbarState() {
    if (this.dom.drawNextNumberBadge) {
      this.dom.drawNextNumberBadge.textContent = String(this.getNextCaptureNumber());
    }
    if (this.dom.btnDrawUndo) {
      this.dom.btnDrawUndo.disabled = this.captureShapes.length === 0;
    }
    if (this.dom.btnDrawClear) {
      this.dom.btnDrawClear.disabled = this.captureShapes.length === 0;
    }
  }

  getCanvasCoords(e) {
    const canvas = this.dom.screenAnnotationCanvas;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / (rect.width || 1);
    const scaleY = canvas.height / (rect.height || 1);
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }

  onCaptureCanvasMouseDown(e) {
    if (e.button !== 0) return;
    const pt = this.getCanvasCoords(e);

    if (this.captureTool === 'number') {
      const num = this.getNextCaptureNumber();
      this.captureShapes.push({
        type: 'number',
        x: pt.x,
        y: pt.y,
        number: num,
        color: this.captureColor
      });
      this.updateCaptureToolbarState();
      this.redrawCaptureCanvas();
      return;
    }

    this.isDrawingShape = true;
    if (this.captureTool === 'pen') {
      this.currentDraftShape = {
        type: 'pen',
        points: [pt],
        color: this.captureColor,
        lineWidth: this.captureLineWidth
      };
    } else if (this.captureTool === 'arrow' || this.captureTool === 'rect') {
      this.currentDraftShape = {
        type: this.captureTool,
        startX: pt.x,
        startY: pt.y,
        endX: pt.x,
        endY: pt.y,
        color: this.captureColor,
        lineWidth: this.captureLineWidth
      };
    }
  }

  onCaptureCanvasMouseMove(e) {
    if (!this.isDrawingShape || !this.currentDraftShape) return;
    const pt = this.getCanvasCoords(e);

    if (this.currentDraftShape.type === 'pen') {
      this.currentDraftShape.points.push(pt);
    } else {
      this.currentDraftShape.endX = pt.x;
      this.currentDraftShape.endY = pt.y;
    }
    this.redrawCaptureCanvas();
  }

  onCaptureCanvasMouseUp() {
    if (!this.isDrawingShape || !this.currentDraftShape) return;
    this.isDrawingShape = false;
    this.captureShapes.push(this.currentDraftShape);
    this.currentDraftShape = null;
    this.updateCaptureToolbarState();
    this.redrawCaptureCanvas();
  }

  undoCaptureShape() {
    if (this.captureShapes.length === 0) return;
    this.captureShapes.pop();
    // Re-sequence numbered markers
    let numCounter = 1;
    this.captureShapes.forEach((s) => {
      if (s.type === 'number') s.number = numCounter++;
    });
    this.updateCaptureToolbarState();
    this.redrawCaptureCanvas();
  }

  clearCaptureShapes() {
    this.captureShapes = [];
    this.currentDraftShape = null;
    this.updateCaptureToolbarState();
    this.redrawCaptureCanvas();
  }

  redrawCaptureCanvas() {
    const canvas = this.dom.screenAnnotationCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const allShapes = [...this.captureShapes];
    if (this.currentDraftShape) allShapes.push(this.currentDraftShape);

    for (const shape of allShapes) {
      this.drawShapeOnContext(ctx, shape);
    }
  }

  drawShapeOnContext(ctx, shape) {
    ctx.save();
    ctx.strokeStyle = shape.color || '#ef4444';
    ctx.fillStyle = shape.color || '#ef4444';
    ctx.lineWidth = shape.lineWidth || 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (shape.type === 'pen' && Array.isArray(shape.points) && shape.points.length > 0) {
      ctx.beginPath();
      ctx.moveTo(shape.points[0].x, shape.points[0].y);
      for (let i = 1; i < shape.points.length; i++) {
        ctx.lineTo(shape.points[i].x, shape.points[i].y);
      }
      ctx.stroke();
    } else if (shape.type === 'rect') {
      const x = Math.min(shape.startX, shape.endX);
      const y = Math.min(shape.startY, shape.endY);
      const w = Math.abs(shape.endX - shape.startX);
      const h = Math.abs(shape.endY - shape.startY);
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = shape.color + '18';
      ctx.fillRect(x, y, w, h);
    } else if (shape.type === 'arrow') {
      const dx = shape.endX - shape.startX;
      const dy = shape.endY - shape.startY;
      const angle = Math.atan2(dy, dx);
      const headLen = Math.max(14, (shape.lineWidth || 4) * 4);

      ctx.beginPath();
      ctx.moveTo(shape.startX, shape.startY);
      ctx.lineTo(shape.endX, shape.endY);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(shape.endX, shape.endY);
      ctx.lineTo(
        shape.endX - headLen * Math.cos(angle - Math.PI / 6),
        shape.endY - headLen * Math.sin(angle - Math.PI / 6)
      );
      ctx.lineTo(
        shape.endX - headLen * Math.cos(angle + Math.PI / 6),
        shape.endY - headLen * Math.sin(angle + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fill();
    } else if (shape.type === 'number') {
      const radius = 16;
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 2;

      ctx.beginPath();
      ctx.arc(shape.x, shape.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = shape.color || '#ef4444';
      ctx.fill();

      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      ctx.shadowColor = 'transparent';
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 14px Inter, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(shape.number || 1), shape.x, shape.y + 0.5);
    }

    ctx.restore();
  }

  insertCaptureMarkdownSyntax(mdAction) {
    const textarea = this.dom.captureTaskDesc;
    if (!textarea) return;
    const start = textarea.selectionStart || 0;
    const end = textarea.selectionEnd || 0;
    const selected = textarea.value.substring(start, end);

    let replacement = '';
    if (mdAction === 'bold') {
      replacement = `**${selected || 'bold text'}**`;
    } else if (mdAction === 'italic') {
      replacement = `*${selected || 'italic text'}*`;
    } else if (mdAction === 'code') {
      replacement = `\`${selected || 'code'}\``;
    } else if (mdAction === 'list') {
      replacement = `\n- ${selected || 'List item'}`;
    } else if (mdAction === 'numref') {
      const nextNum = Math.max(1, this.getNextCaptureNumber() - 1);
      replacement = `**(${nextNum})** ${selected}`;
    }

    textarea.setRangeText(replacement, start, end, 'end');
    textarea.focus();
  }

  async compositeAnnotatedScreenshotDataUrl() {
    const baseImg = this.dom.captureBaseImage;
    const overlayCanvas = this.dom.screenAnnotationCanvas;
    if (!baseImg || !overlayCanvas) return '';

    const w = overlayCanvas.width || baseImg.naturalWidth || 1280;
    const h = overlayCanvas.height || baseImg.naturalHeight || 800;

    const outCanvas = document.createElement('canvas');
    outCanvas.width = w;
    outCanvas.height = h;
    const ctx = outCanvas.getContext('2d');
    if (!ctx) return '';

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    try {
      ctx.drawImage(baseImg, 0, 0, w, h);
    } catch (err) {
      console.warn('[Slideshow] Could not draw baseImg onto composite canvas:', err);
    }
    ctx.drawImage(overlayCanvas, 0, 0, w, h);

    return outCanvas.toDataURL('image/png', 0.92);
  }

  async uploadAnnotatedCapture(dataUrl) {
    const api = window.apiClient;
    const headers = api ? api.getHeaders() : { 'Content-Type': 'application/json' };

    const res = await fetch('/api/screen-guides/upload-capture', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        dataUrl,
        appId: this.activeApp?.id || 'tourxel',
        projectId: api?.projectId || ''
      })
    });

    if (!res.ok) {
      throw new Error(`Upload failed (${res.status})`);
    }
    const data = await res.json();
    return data.publicUrl;
  }

  async saveCaptureTaskOrReply() {
    if (this.isSavingCaptureTask) return;

    if (this.captureContext === 'task') {
      const titleVal = (this.dom.captureTaskTitle?.value || '').trim();
      if (!titleVal) {
        this.showToast('Please enter a Title for the report.', 'error');
        this.dom.captureTaskTitle?.focus();
        return;
      }
    }

    this.isSavingCaptureTask = true;
    const saveBtn = this.dom.btnSaveCaptureTask;
    const originalBtnHtml = saveBtn ? saveBtn.innerHTML : '';
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Saving Capture...</span>';
    }

    try {
      // 1. Composite base screenshot + canvas annotations and upload
      const dataUrl = await this.compositeAnnotatedScreenshotDataUrl();
      let publicScreenshotUrl = '';
      if (dataUrl) {
        publicScreenshotUrl = await this.uploadAnnotatedCapture(dataUrl);
      }

      // 2. If in 'reply' mode, attach screenshot to reply composer
      if (this.captureContext === 'reply') {
        if (publicScreenshotUrl) {
          this.replyScreenshotUrls.push(publicScreenshotUrl);
          this.renderReplyScreenshotsPreview();
        }
        const descText = (this.dom.captureTaskDesc?.value || '').trim();
        if (descText && this.dom.taskReplyInput) {
          this.dom.taskReplyInput.value = descText;
        }
        this.closeScreenCaptureModal();
        this.switchRightPanelMode('tasks');
        this.showToast('Annotated screen capture attached to reply!', 'success');
        return;
      }

      // 3. In 'task' mode, create the new Bug Report / Feature Request comment on the active app
      const title = (this.dom.captureTaskTitle?.value || '').trim();
      const rawDesc = (this.dom.captureTaskDesc?.value || '').trim();
      const screen = this.catalog[this.currentIndex];
      const slideNo = screen ? screen.no : '';
      const route = screen ? screen.route : '';
      const activePageId = this.getCurrentSlidePageIdentifier();
      const targetAppId = this.activeApp?.id || 'tourxel-screen-guides-app';

      let fullDescription = rawDesc;
      if (publicScreenshotUrl) {
        fullDescription = fullDescription
          ? `${fullDescription}\n\n![Annotated Screen Capture](${publicScreenshotUrl})`
          : `![Annotated Screen Capture](${publicScreenshotUrl})`;
      }

      const categoryLabel = this.captureTaskType === 'Feature' ? 'Feature Request' : 'Bug Report';
      const metadata = [
        { key: 'title', value: title },
        { key: 'description', value: fullDescription },
        { key: 'screenshotUrl', value: publicScreenshotUrl },
        { key: 'pageId', value: activePageId },
        { key: 'slideNo', value: slideNo },
        { key: 'route', value: route },
        { key: 'appId', value: targetAppId }
      ];

      let createdTask = null;
      const api = window.apiClient;

      if (api && api.isAuthenticated() && api.projectId) {
        try {
          const payload = {
            content: `${title}\n\n${fullDescription}`,
            category: categoryLabel,
            status: 'Open',
            projectId: api.projectId,
            relatedEntityName: 'App',
            relatedEntityId: targetAppId,
            metadata
          };

          const res = await fetch('/api/proxy/comments', {
            method: 'POST',
            headers: api.getHeaders(),
            body: JSON.stringify(payload)
          });

          if (res.ok) {
            const savedComment = await res.json();
            if (savedComment && (savedComment.id || savedComment._id)) {
              createdTask = this.mapCommentToTask(savedComment);
            }
          }
        } catch (err) {
          console.warn('[Slideshow] Backend comment save fallback to local:', err);
        }
      }

      if (!createdTask) {
        createdTask = {
          id: `local-${Date.now()}`,
          type: this.captureTaskType,
          title,
          description: fullDescription,
          content: `${title}\n\n${fullDescription}`,
          status: 'Open',
          isApproved: null,
          createdDate: new Date(),
          createdBy: api?.user?.id || 'local-user',
          creatorName: api?.user?.email || 'Developer',
          screenshotUrl: publicScreenshotUrl,
          pageId: activePageId,
          slideNo,
          route,
          appId: targetAppId,
          metadata,
          subComments: []
        };
      }

      // Prepend to tasks list & persist local backup
      this.appTasks = [createdTask, ...this.appTasks.filter((t) => t.id !== createdTask.id)];
      this.saveLocalBackupTasks(targetAppId, this.appTasks);

      this.closeScreenCaptureModal();
      this.updateTaskCountsUI();

      // Automatically open the right-side Report & Request panel to show the newly saved task
      this.switchRightPanelMode('tasks');
      this.closeTaskDetails();
      this.renderTasksList();

      this.showToast(`${categoryLabel} saved to ${this.activeApp?.name || 'Active App'}!`, 'success');
    } catch (err) {
      console.error('[Slideshow] Failed to save capture task:', err);
      this.showToast(`Failed to save report: ${err.message}`, 'error');
    } finally {
      this.isSavingCaptureTask = false;
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalBtnHtml;
      }
    }
  }

  // ==========================================================================
  // UTILITIES
  // ==========================================================================

  showToast(message, type = 'info') {
    if (!this.dom.toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon =
      type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle';
    const iconColor =
      type === 'success' ? 'var(--accent-emerald)' : type === 'error' ? 'var(--accent-rose)' : 'var(--accent-primary)';

    toast.innerHTML = `
      <i class="fas ${icon}" style="color: ${iconColor}; font-size: 14px;"></i>
      <span>${this.escapeHtml(message)}</span>
    `;
    this.dom.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      toast.style.transition = 'all 0.25s ease';
      setTimeout(() => toast.remove(), 250);
    }, 3200);
  }

  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.slideshowApp = new ScreenGuidesSlideshowApp();
});
