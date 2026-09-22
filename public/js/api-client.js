/**
 * api-client.js
 * Dedicated API Client for Rappider App Harness.
 * Communicates with backend endpoints via the harness reverse proxy (/api/proxy/*).
 */

class HarnessApiClient {
  constructor() {
    this.backendUrl = 'http://localhost:8081';
    this.token = null;
    this.projectId = null;
    this.projectApiUrl = null;
    this.user = null;
    this.projects = [];
    this.listeners = [];
    this.apiHistory = [];

    this.loadSession();
  }

  onApiEvent(listener) {
    this.listeners.push(listener);
  }

  notifyApiEvent(event) {
    this.apiHistory.unshift(event);
    if (this.apiHistory.length > 200) this.apiHistory.pop();
    this.listeners.forEach(fn => fn(event));
  }

  /**
   * Save credentials to LocalStorage
   */
  saveSession() {
    const session = {
      backendUrl: this.backendUrl,
      token: this.token,
      projectId: this.projectId,
      projectApiUrl: this.projectApiUrl,
      user: this.user
    };
    localStorage.setItem('rappider_harness_session', JSON.stringify(session));
  }

  /**
   * Load credentials from LocalStorage
   */
  loadSession() {
    try {
      const stored = localStorage.getItem('rappider_harness_session');
      if (stored) {
        const session = JSON.parse(stored);
        this.backendUrl = session.backendUrl || 'http://localhost:8081';
        this.token = session.token || null;
        this.projectId = session.projectId || null;
        this.projectApiUrl = session.projectApiUrl || null;
        this.user = session.user || null;
      }
    } catch (e) {
      console.warn('Failed to parse stored harness session:', e);
    }
  }

  clearSession() {
    this.token = null;
    this.projectId = null;
    this.projectApiUrl = null;
    this.user = null;
    localStorage.removeItem('rappider_harness_session');
  }

  isAuthenticated() {
    return !!this.token && !!this.projectId;
  }

  /**
   * Helper to decode JWT token payload safely
   */
  decodeJwtPayload(token) {
    try {
      if (!token || typeof token !== 'string') return null;
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const payloadBase64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(atob(payloadBase64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
      return JSON.parse(json);
    } catch (e) {
      return null;
    }
  }

  /**
   * Login by credentials (email + password)
   */
  async login(username, password, backendUrl = this.backendUrl) {
    this.backendUrl = backendUrl.replace(/\/$/, '');
    const startTime = Date.now();

    try {
      const response = await fetch('/api/proxy/users/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-target-backend-url': this.backendUrl
        },
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();
      const duration = Date.now() - startTime;

      if (!response.ok) {
        throw new Error(data.error?.message || data.message || 'Login failed');
      }

      this.token = data.authenticationToken;
      this.user = { username, loginDate: data.loginDate };

      // Extract embedded project from token
      const tokenPayload = this.decodeJwtPayload(this.token);
      if (tokenPayload?.projectId) {
        this.projectId = tokenPayload.projectId;
      }

      // 1. Fetch people associated with the user
      const people = await this.fetchUserPeople();
      if (people && people.length > 0) {
        this.personId = people[0].id;
        await this.changeActivePerson(this.personId);
      }

      // 2. Fetch projects to populate project selector
      await this.fetchUserProjects();

      // If user has a matching project in list, select it; otherwise select first
      if (this.projects.length > 0) {
        const matchingProject = this.projects.find(p => p.id === this.projectId);
        if (!matchingProject) {
          await this.changeActiveProject(this.projects[0].id);
        }
      }

      this.saveSession();
      return { success: true, user: this.user, projects: this.projects };
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  }



  /**
   * Fetch people for the current user
   */
  async fetchUserPeople() {
    if (!this.token) return [];

    try {
      const response = await fetch('/api/proxy/users/people', {
        headers: {
          'Authorization': this.token,
          'x-target-backend-url': this.backendUrl
        }
      });

      if (response.ok) {
        const data = await response.json();
        return Array.isArray(data) ? data : (data.people || []);
      }
    } catch (e) {
      console.warn('Failed to fetch people list:', e);
    }
    return [];
  }

  /**
   * Switch active person context
   */
  async changeActivePerson(personId) {
    if (!this.token) return;

    try {
      const response = await fetch('/api/proxy/users/change-active-person', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.token,
          'x-target-backend-url': this.backendUrl
        },
        body: JSON.stringify({ personId })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.authenticationToken) {
          this.token = data.authenticationToken;
        }
      }
    } catch (e) {
      console.warn('Failed to refresh token on active person switch:', e);
    }
  }

  /**
   * Fetch available projects for current user
   */
  async fetchUserProjects() {
    if (!this.token) return [];

    try {
      const filter = {
        fields: { id: true, name: true },
        order: ["createdDate DESC"],
        limit: 10
      };

      const response = await fetch(`/api/proxy/projects?filter=${encodeURIComponent(JSON.stringify(filter))}`, {
        headers: {
          'Authorization': this.token,
          'x-target-backend-url': this.backendUrl
        }
      });

      if (response.ok) {
        const data = await response.json();
        this.projects = Array.isArray(data) ? data : (data.projects || []);
        return this.projects;
      }
    } catch (e) {
      console.warn('Failed to fetch projects list:', e);
    }
    return [];
  }

  /**
   * Search projects by name
   */
  async searchProjects(searchTerm) {
    if (!this.token) return [];

    try {
      const filter = {
        where: { name: { like: `.*${searchTerm}.*`, options: "i" } },
        fields: { id: true, name: true },
        order: ["createdDate DESC"],
        limit: 20
      };

      const response = await fetch(`/api/proxy/projects?filter=${encodeURIComponent(JSON.stringify(filter))}`, {
        headers: {
          'Authorization': this.token,
          'x-target-backend-url': this.backendUrl
        }
      });

      if (response.ok) {
        return await response.json();
      }
    } catch (e) {
      console.warn('Failed to search projects:', e);
    }
    return [];
  }

  /**
   * Switch active project context and acquire project-scoped token
   */
  async changeActiveProject(projectId) {
    this.projectId = projectId;
    if (!this.token) return;

    try {
      const response = await fetch('/api/proxy/users/change-active-project', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.token,
          'x-target-backend-url': this.backendUrl
        },
        body: JSON.stringify({ projectId })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.authenticationToken) {
          this.token = data.authenticationToken;
        }
      }
    } catch (e) {
      console.warn('Failed to refresh project token on switch:', e);
    }

    this.saveSession();
  }

  /**
   * Execute dynamic Project Data Manager API call
   * Maps LoopBack operations: find, findById, create, updateById, deleteById, count
   */
  async executeProjectDataManagerCall(operation, dataTableName, payload = {}) {
    let method = 'GET';
    let path = `project-data-manager/${dataTableName}`;
    let body = null;

    switch (operation) {
      case 'find':
        method = 'GET';
        if (payload.filter) {
          path += `?filter=${encodeURIComponent(JSON.stringify(payload.filter))}`;
        }
        break;

      case 'findById':
        method = 'GET';
        path += `/${payload.id}`;
        if (payload.filter) {
          path += `?filter=${encodeURIComponent(JSON.stringify(payload.filter))}`;
        }
        break;

      case 'create':
        method = 'POST';
        body = payload.body;
        break;

      case 'update':
      case 'updateById':
        method = 'PATCH';
        path += `/${payload.id}`;
        body = payload.body;
        break;

      case 'deleteById':
        method = 'DELETE';
        path += `/${payload.id}`;
        break;

      case 'count':
        method = 'GET';
        path += `/count`;
        if (payload.where) {
          path += `?where=${encodeURIComponent(JSON.stringify(payload.where))}`;
        }
        break;

      default:
        throw new Error(`Unsupported operation: ${operation}`);
    }

    return await this.executeRawApiCall(method, path, body, {
      operation,
      entityName: payload.entityName || dataTableName,
      dataTableName
    });
  }

  /**
   * Low-level raw API request routed through the proxy
   */
  async executeRawApiCall(method, relativePath, body = null, meta = {}) {
    const startTime = Date.now();
    const reqId = Math.random().toString(36).substr(2, 8);
    const cleanPath = relativePath.replace(/^\//, '');

    const eventRecord = {
      id: reqId,
      timestamp: new Date(),
      method: method.toUpperCase(),
      path: `/${cleanPath}`,
      operation: meta.operation || 'request',
      entityName: meta.entityName || '',
      dataTableName: meta.dataTableName || '',
      requestBody: body,
      status: 'PENDING',
      statusCode: null,
      duration: null,
      response: null,
      error: null
    };

    this.notifyApiEvent(eventRecord);

    try {
      const headers = {
        'x-target-backend-url': this.backendUrl
      };

      if (this.token) {
        headers['Authorization'] = this.token;
      }

      const fetchOptions = {
        method: method.toUpperCase(),
        headers
      };

      if (body && !['GET', 'HEAD'].includes(method.toUpperCase())) {
        headers['Content-Type'] = 'application/json';
        fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
      }

      const response = await fetch(`/api/proxy/${cleanPath}`, fetchOptions);
      const duration = Date.now() - startTime;
      eventRecord.duration = duration;
      eventRecord.statusCode = response.status;

      let responseData = null;
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        responseData = await response.json();
      } else {
        responseData = await response.text();
      }

      if (!response.ok) {
        const errorMsg = (responseData && typeof responseData === 'object' && (responseData.error?.message || responseData.message)) 
          || `HTTP ${response.status}: ${response.statusText}`;

        eventRecord.status = 'ERROR';
        eventRecord.error = errorMsg;
        eventRecord.response = responseData;
        this.notifyApiEvent(eventRecord);
        throw new Error(errorMsg);
      }

      eventRecord.status = 'SUCCESS';
      eventRecord.response = responseData;
      this.notifyApiEvent(eventRecord);

      return responseData;
    } catch (err) {
      eventRecord.duration = Date.now() - startTime;
      if (eventRecord.status !== 'ERROR') {
        eventRecord.status = 'ERROR';
        eventRecord.error = err.message;
      }
      this.notifyApiEvent(eventRecord);
      throw err;
    }
  }
}

// Attach to window
window.apiClient = new HarnessApiClient();
