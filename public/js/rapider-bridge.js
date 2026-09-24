/**
 * rapider-bridge.js
 * Host-Side Message Broker for Rapider App Harness.
 * Listens for messages dispatched from sandboxed iframes and routes them to apiClient or harness UI.
 */

class RapiderBridge {
  constructor() {
    this.activeManifest = null;
    this.modelMap = new Map(); // entityName -> datatableName
    this.trackedIframes = new Set();
    this.uiEventListeners = [];

    this.initMessageListener();
  }

  setManifest(manifest) {
    this.activeManifest = manifest;
    this.modelMap.clear();

    if (manifest && Array.isArray(manifest.dataModels)) {
      manifest.dataModels.forEach(model => {
        const entityName = model.name;
        const tableName = model.datatableName || model.dataTableName || model.name;
        if (entityName) {
          this.modelMap.set(entityName, tableName);
          // Also map lower-cased & exact table name
          this.modelMap.set(entityName.toLowerCase(), tableName);
          this.modelMap.set(tableName, tableName);
        }
      });
    }
  }

  registerIframe(iframeEl) {
    if (iframeEl && iframeEl.contentWindow) {
      this.trackedIframes.add(iframeEl);
    }
  }

  unregisterIframe(iframeEl) {
    this.trackedIframes.delete(iframeEl);
  }

  onUiEvent(listener) {
    this.uiEventListeners.push(listener);
  }

  notifyUiEvent(event) {
    this.uiEventListeners.forEach(fn => fn(event));
  }

  resolveTableName(entityName) {
    if (!entityName) return '';
    if (this.modelMap.has(entityName)) {
      return this.modelMap.get(entityName);
    }
    const lower = entityName.toLowerCase();
    if (this.modelMap.has(lower)) {
      return this.modelMap.get(lower);
    }
    return entityName;
  }

  initMessageListener() {
    window.addEventListener('message', async (event) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;

      // 1. RAPIDER_API_REQUEST: Proxies CRUD calls from iframe to backend
      if (data.type === 'RAPIDER_API_REQUEST') {
        const { reqId, operation, entityName, payload = {} } = data;

        if (!operation || !entityName) {
          if (event.source) {
            event.source.postMessage({
              type: 'RAPIDER_API_ERROR',
              reqId,
              error: 'Operation and entityName are required.'
            }, '*');
          }
          return;
        }

        const dataTableName = this.resolveTableName(entityName);
        payload.entityName = entityName;

        try {
          // If offline / demo mode
          if (window.harness && window.harness.isOfflineMode) {
            const mockResponse = this.generateMockResponse(operation, entityName, payload);
            if (event.source) {
              event.source.postMessage({
                type: 'RAPIDER_API_RESPONSE',
                reqId,
                payload: mockResponse
              }, '*');
            }
            return;
          }

          // Execute real API call
          const response = await window.apiClient.executeProjectDataManagerCall(
            operation,
            dataTableName,
            payload
          );

          if (event.source) {
            event.source.postMessage({
              type: 'RAPIDER_API_RESPONSE',
              reqId,
              payload: response
            }, '*');
          }
        } catch (error) {
          console.error(`[RapiderBridge] API call failed for ${entityName} (${operation}):`, error);
          if (event.source) {
            event.source.postMessage({
              type: 'RAPIDER_API_ERROR',
              reqId,
              error: error.message || 'API request failed.'
            }, '*');
          }
        }
      }

      // 2. RAPIDER_UI_ACTION: Handles navigate, showNotification, showPageModal, etc.
      else if (data.type === 'RAPIDER_UI_ACTION') {
        const action = data.action || {};
        const payload = action.payload || {};

        this.notifyUiEvent({
          type: 'UI_ACTION',
          actionType: action.type,
          payload,
          timestamp: new Date()
        });

        if (action.type === 'showNotification' && payload.notification) {
          if (window.harness) {
            window.harness.showToast(payload.notification);
          }
        } else if (action.type === 'navigate' && payload.route) {
          if (window.harness) {
            window.harness.navigate(payload.route, payload);
          }
        } else if (action.type === 'showPageModal' && payload.pageModal) {
          if (window.harness) {
            window.harness.showPageModal(payload.pageModal);
          }
        } else if (action.type === 'showPageDrawer' && payload.pageDrawer) {
          if (window.harness) {
            window.harness.showPageDrawer(payload.pageDrawer);
          }
        } else if (action.type === 'showPageSplitter' && payload.pageSplitter) {
          if (window.harness) {
            window.harness.showPageSplitter(payload.pageSplitter);
          }
        }
      }

      // 3. RAPIDER_BROADCAST: Relays broadcast events across all active iframes
      else if (data.type === 'RAPIDER_BROADCAST') {
        this.notifyUiEvent({
          type: 'BROADCAST',
          eventName: data.eventName,
          payload: data.payload,
          timestamp: new Date()
        });

        // Broadcast to all active iframes
        this.broadcastToAllIframes({
          type: 'RAPIDER_BROADCAST_RECEIVE',
          eventName: data.eventName,
          payload: data.payload
        });
      }
    });
  }

  broadcastToAllIframes(message) {
    this.trackedIframes.forEach(iframe => {
      try {
        if (iframe && iframe.contentWindow) {
          iframe.contentWindow.postMessage(message, '*');
        }
      } catch (e) {
        console.warn('[RapiderBridge] Failed to post message to iframe:', e);
      }
    });
  }

  syncDarkMode(isDark) {
    this.broadcastToAllIframes({
      type: 'TOGGLE_DARK_MODE',
      isDark
    });
  }

  generateMockResponse(operation, entityName, payload) {
    switch (operation) {
      case 'find':
        return [
          { id: 'mock-1', name: `Sample ${entityName} 1`, status: 'Active', createdAt: new Date().toISOString() },
          { id: 'mock-2', name: `Sample ${entityName} 2`, status: 'Pending', createdAt: new Date().toISOString() }
        ];
      case 'findById':
        return { id: payload.id || 'mock-1', name: `Sample ${entityName}`, status: 'Active' };
      case 'create':
        return { id: 'mock-new-' + Math.random().toString(36).substr(2, 6), ...payload.body };
      case 'updateById':
        return { id: payload.id, ...payload.body };
      case 'deleteById':
        return { count: 1 };
      case 'count':
        return 5;
      default:
        return {};
    }
  }
}

window.rapiderBridge = new RapiderBridge();
