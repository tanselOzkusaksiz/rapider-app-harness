# Rappider Application Test Harness (Local Runner)

A dedicated, lightweight local wrapper and test harness designed to run, test, and debug any Rappider UI application directly from its `app.manifest.json` and `pages/**/*.html` files, without requiring sync-back to the cloud or running inside `rapider-ui`.

---

## Features

- **Decoupled & Fast**: Runs entirely on its own HTTP server (`http://localhost:3300`), freeing developers from the heavy `rapider-ui` platform.
- **Identical Styling & Runtime**: Implements the exact same CSS stack as `rapider-ui`:
  - Tailored `rapider-tailwind-theme.css` with real-time CSS variables for light and dark modes
  - Live Tailwind v4 browser compiler CDN
  - `ng-zorro-antd.min.css`
  - Proprietary web components bundle (`rapider-components.js` containing `<rapider-list-grid>`, `<rapider-chart>`, etc.)
  - FontAwesome 6 Pro kit
- **Complete `window.rapiderApi` Bridge**:
  - `find(entityName, filter)`
  - `findById(entityName, id, filter)`
  - `create(entityName, body)`
  - `updateById(entityName, id, body)`
  - `deleteById(entityName, id)`
  - `count(entityName, where)`
  - `showNotification({ type, message })` (Interactive animated toasts)
  - `navigate(route)` (Smooth client routing with parameterized routes like `accounts/:id`)
  - `showPageModal(modalConfig)` (Centered modal rendering child pages)
  - `showPageDrawer(drawerConfig)` (Sliding drawer overlay)
  - `showPageSplitter(splitterConfig)` (Split-pane layout)
  - `broadcast(eventName, payload)` & `on(eventName, callback)` (Cross-iframe event bus)
- **Automated Authentication & Project Connection**:
  - Connects to local `http://localhost:8081` (LoopBack 4 server) or remote `https://dev.api.rappider.com`.
  - Credentials login (`POST /users/login`), automatic project discovery (`GET /projects`), and project-scoped token generation (`POST /users/change-active-project`).
  - Direct token entry mode and offline mock mode.
  - Session persistence in `localStorage`.
- **Integrated DevTools & API Inspector**:
  - Real-time table logging every outgoing `rapiderApi` call with method, model name, mapped `datatableName`, latency, HTTP status, and formatted JSON payload inspector.
  - UI event logger capturing broadcasts, navigation, and modal actions.
  - Data model and raw manifest inspector.
- **Multi-App Harnessing**:
  - Dynamically scans `../rapider-apps` to allow switching between any application (CRM, LMS, etc.) directly in the header dropdown, or pass a custom app directory via `--app=...`.

---

## Quick Start

### 1. Install Dependencies
```bash
cd rapider-app-harness
npm install
```

### 2. Start the Harness
```bash
npm start
```
By default, the server runs on `http://localhost:3300` and targets `rapider-app-crm-sys-comprehensive-crm-system` with backend `http://localhost:8081`.

### Custom Parameters
```bash
# Target a specific app folder
node server.js --app=../rapider-apps/rapider-app-lms-a-learning-management-system

# Use a custom port and remote dev backend
node server.js --port=3400 --backend=https://dev.api.rappider.com
```

---

## How it Works

1. **Manifest Parsing**: The harness loads `app.manifest.json` from the root of the targeted application folder. It extracts:
   - Metadata (`name`, `iconUrl`, `description`)
   - `webPages`: Populates the sidebar navigation with links to all registered pages.
   - `dataModels`: Maps entity model names (`Account`, `Opportunity`) to database tables (`crm_Account`, `crm_Opportunity`).
2. **Page Sandbox**: When a page is clicked, the server prepares the HTML file, injecting the controlled CSS runtime and `window.rapiderApi` SDK before loading it into an isolated `<iframe>`.
3. **API Proxy**: When `window.rapiderApi.find('Account')` is invoked in the page, it sends a message to the harness host. The harness translates `Account` -> `crm_Account`, attaches the active project's Bearer JWT, dispatches the HTTP query to `/project-data-manager/crm_Account`, and returns the resolved data back to the page's promise.
