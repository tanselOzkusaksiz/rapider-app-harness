const fs = require('fs');
const path = require('path');

/**
 * Loads test credentials from local harness .env or process.env
 */
function loadTestCredentials() {
  const envPath = path.resolve(__dirname, '.env');
  const envConfig = {};

  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const val = match[2].trim().replace(/^['"](.*)['"]$/, '$1');
        envConfig[key] = val;
      }
    }
  }

  const email = envConfig.HARNESS_TEST_EMAIL || envConfig.RAPIDER_TEST_EMAIL || process.env.HARNESS_TEST_EMAIL || process.env.RAPIDER_TEST_EMAIL || '';
  const password = envConfig.HARNESS_TEST_PASSWORD || envConfig.RAPIDER_TEST_PASSWORD || process.env.HARNESS_TEST_PASSWORD || process.env.RAPIDER_TEST_PASSWORD || '';
  const projectId = envConfig.HARNESS_TEST_PROJECT_ID || envConfig.RAPIDER_TEST_PROJECT_ID || process.env.HARNESS_TEST_PROJECT_ID || process.env.RAPIDER_TEST_PROJECT_ID || '';
  const backendUrl = envConfig.BACKEND_URL || envConfig.RAPIDER_TEST_API_URL || process.env.BACKEND_URL || process.env.RAPIDER_TEST_API_URL || 'https://dev.api.rappider.com';

  return { email, password, projectId, backendUrl };
}

/**
 * Ensures user is authenticated in the harness before executing test suites.
 * Executes login as Step 0 if no valid token exists.
 */
async function ensureAuthenticated(page, appKey = 'rapider-app-hrs-a-hr-services') {
  console.log('\n===========================================================');
  console.log('🔑 STEP 0: Authentication Pre-flight Check');
  console.log('===========================================================');

  const appUrl = `http://localhost:3300/?app=${appKey}`;
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // 1. Check if token already exists in localStorage or window.apiClient
  let isAuth = await page.evaluate(() => {
    try {
      if (window.apiClient && typeof window.apiClient.isAuthenticated === 'function') {
        if (window.apiClient.isAuthenticated()) return true;
      }
      const sessionStr = localStorage.getItem('rappider_harness_session');
      if (sessionStr) {
        const session = JSON.parse(sessionStr);
        if (session && session.token && session.projectId) return true;
      }
    } catch (e) {}
    return false;
  });

  if (isAuth) {
    console.log('  ✅ Active session and token verified. User is already authenticated.');
    await page.evaluate(() => {
      const modal = document.getElementById('auth-modal');
      if (modal) modal.classList.add('hidden');
      if (window.harness && typeof window.harness.closeAuthModal === 'function') {
        window.harness.closeAuthModal();
      }
    });
    return true;
  }

  // 2. No token: execute login as the first step
  console.log('  ⚠️ No active token found. Initiating automated login step...');
  const creds = loadTestCredentials();

  if (!creds.email || !creds.password) {
    throw new Error('Test login credentials missing from rapider-app-harness/.env! Please check RAPIDER_TEST_EMAIL and RAPIDER_TEST_PASSWORD.');
  }

  console.log(`  🔐 Authenticating with account: ${creds.email}`);

  const loginResult = await page.evaluate(async ({ email, password, backendUrl, projectId }) => {
    try {
      if (window.apiClient) {
        await window.apiClient.login(email, password, backendUrl);
        if (projectId) {
          await window.apiClient.changeActiveProject(projectId);
        } else {
          const projects = await window.apiClient.fetchUserProjects();
          if (projects && projects.length > 0) {
            await window.apiClient.changeActiveProject(projects[0].id);
          }
        }
        if (window.harness) {
          window.harness.isOfflineMode = false;
          window.harness.populateProjectSelect();
          window.harness.updateAuthBadge();
          window.harness.closeAuthModal();
        }
        return { success: true };
      }
      return { success: false, error: 'window.apiClient unavailable' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }, creds);

  if (!loginResult || !loginResult.success) {
    console.warn(`  ⚠️ In-page apiClient login attempt returned: ${loginResult?.error}. Attempting UI form fallback...`);
    const userField = await page.$('#auth-username');
    const passField = await page.$('#auth-password');
    const submitBtn = await page.$('#btn-submit-login');

    if (userField && passField && submitBtn) {
      await userField.fill(creds.email);
      await passField.fill(creds.password);
      await submitBtn.click();
      await page.waitForTimeout(2500);
    }
  }

  // 3. Confirm authentication & close modal
  isAuth = await page.evaluate(() => {
    try {
      if (window.apiClient && typeof window.apiClient.isAuthenticated === 'function') {
        return window.apiClient.isAuthenticated();
      }
      const sessionStr = localStorage.getItem('rappider_harness_session');
      if (sessionStr) {
        const session = JSON.parse(sessionStr);
        return !!(session && session.token);
      }
    } catch (e) {}
    return false;
  });

  // Ensure auth-modal is completely hidden so it never blocks tests
  await page.evaluate(() => {
    const modal = document.getElementById('auth-modal');
    if (modal) modal.classList.add('hidden');
    if (window.harness && typeof window.harness.closeAuthModal === 'function') {
      window.harness.closeAuthModal();
    }
  });

  if (isAuth) {
    console.log('  ✅ Authentication step completed successfully! Token acquired and saved.');
  } else {
    console.warn('  ⚠️ Warning: Could not confirm token verification. Proceeding with caution...');
  }

  await page.waitForTimeout(500);
  return isAuth;
}

module.exports = {
  loadTestCredentials,
  ensureAuthenticated
};
