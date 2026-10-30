/**
 * ============================================================================
 * Rapider App Harness — App Store Image Capture & S3 Publisher Service
 * ============================================================================
 * Automates 6:4 aspect ratio (1200px x 800px) screenshot capturing for apps:
 *   1. Captures Home/Overview page as Cover Image (`cover.png`)
 *   2. Captures up to 5 subsequent pages as Preview Images (`<route>.png`)
 *   3. Uploads images to DigitalOcean Spaces / S3 under `apps/${appKey}/img/`
 *   4. Updates `app.manifest.json` with `coverImage`, `coverImageUrl`,
 *      `thumbnailUrl`, `images`, `screenshots`, `thumbnails`.
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');

let playwright;
try {
  playwright = require('playwright');
} catch (e) {
  try {
    playwright = require(path.resolve(__dirname, 'node_modules/playwright'));
  } catch (e2) {
    try {
      playwright = require(path.resolve(__dirname, '../rapider-app-harness/node_modules/playwright'));
    } catch (e3) {
      console.error('[store-image-capture] Failed to resolve playwright:', e3.message);
    }
  }
}

/**
 * Loads credentials from .env in monorepo or harness
 */
function loadHarnessCredentials() {
  const possiblePaths = [
    path.resolve(__dirname, '.env'),
    path.resolve(__dirname, '../rapider-apps/.env'),
    path.resolve(__dirname, '../.env'),
    path.resolve(__dirname, '../../.env')
  ];

  const env = {};
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf8');
      for (const line of content.split('\n')) {
        const m = line.match(/^([^=]+)=(.*)$/);
        if (m) {
          const k = m[1].trim();
          const v = m[2].trim().replace(/^['"](.*)['"]$/, '$1');
          if (!env[k]) env[k] = v;
        }
      }
    }
  }

  return {
    backendUrl: env.BACKEND_URL || env.RAPIDER_TEST_API_URL || 'https://dev.api.rappider.com',
    username: env.HARNESS_TEST_EMAIL || env.RAPIDER_TEST_EMAIL || 't.ozkusaksiz@gmail.com',
    password: env.HARNESS_TEST_PASSWORD || env.RAPIDER_TEST_PASSWORD || 'Ulysses1707!$!',
    projectId: env.HARNESS_TEST_PROJECT_ID || env.RAPIDER_TEST_PROJECT_ID || 'ba7b7573-3d92-4fc7-a903-1edb0c2da4aa'
  };
}

/**
 * Obtains an authenticated token from Rapider API
 */
let cachedAuthToken = null;
let tokenExpiry = 0;

async function getAuthToken(creds) {
  const now = Date.now();
  if (cachedAuthToken && now < tokenExpiry) {
    return cachedAuthToken;
  }

  console.log(`[store-image-capture] Authenticating with ${creds.backendUrl} as ${creds.username}...`);
  const loginRes = await fetch(`${creds.backendUrl}/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: creds.username, password: creds.password })
  });

  const loginData = await loginRes.json();
  if (!loginRes.ok) {
    throw new Error('Login failed: ' + (loginData.error?.message || JSON.stringify(loginData)));
  }

  let token = loginData.authenticationToken;

  // Change to active person if needed
  try {
    const peopleRes = await fetch(`${creds.backendUrl}/users/people`, {
      headers: { 'Authorization': token }
    });
    const peopleData = await peopleRes.json();
    const people = Array.isArray(peopleData) ? peopleData : (peopleData.people || []);
    if (people.length > 0) {
      const personRes = await fetch(`${creds.backendUrl}/users/change-active-person`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': token },
        body: JSON.stringify({ personId: people[0].id })
      });
      const pData = await personRes.json();
      if (pData.authenticationToken) token = pData.authenticationToken;
    }
  } catch (e) {
    console.warn('[store-image-capture] Warning switching person:', e.message);
  }

  // Change to active project
  if (creds.projectId) {
    try {
      const projectRes = await fetch(`${creds.backendUrl}/users/change-active-project`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': token },
        body: JSON.stringify({ projectId: creds.projectId })
      });
      const prData = await projectRes.json();
      if (prData.authenticationToken) token = prData.authenticationToken;
    } catch (e) {
      console.warn('[store-image-capture] Warning switching project:', e.message);
    }
  }

  cachedAuthToken = token;
  tokenExpiry = now + (30 * 60 * 1000); // 30 minutes cache
  console.log('[store-image-capture] Successfully acquired auth token.');
  return token;
}

/**
 * Uploads a buffer to DigitalOcean Spaces S3 bucket via presigned upload URL
 */
async function uploadToS3({ fileName, buffer, appKey, creds, token }) {
  console.log(`[store-image-capture] Requesting presigned S3 URL for: ${fileName} under apps/${appKey}/img...`);
  
  const presignRes = await fetch(`${creds.backendUrl}/file-management/public-upload-url`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token
    },
    body: JSON.stringify({
      fileName,
      contentType: 'image/png',
      type: `apps/${appKey}/img`
    })
  });

  if (!presignRes.ok) {
    const errText = await presignRes.text();
    throw new Error(`Failed to get presigned S3 URL: ${presignRes.status} ${errText}`);
  }

  const presignData = await presignRes.json();
  const uploadUrl = presignData.uploadUrl;
  const publicUrl = presignData.publicUrl;

  console.log(`[store-image-capture] Uploading ${buffer.length} bytes to S3 Spaces...`);
  const s3PutRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'image/png',
      'x-amz-acl': 'public-read'
    },
    body: buffer
  });

  if (!s3PutRes.ok) {
    throw new Error(`S3 PUT failed with status: ${s3PutRes.status} ${s3PutRes.statusText}`);
  }

  console.log(`[store-image-capture] S3 upload verified: ${publicUrl}`);
  return { publicUrl, key: presignData.key, id: presignData.id };
}

/**
 * Main Capture Function
 * 
 * @param {Object} options
 * @param {string} options.appPath - Absolute or relative path to the app directory
 * @param {number} [options.harnessPort=3300] - Port where harness server is running
 * @param {Function} [options.onProgress] - Optional progress callback ({ step, total, message })
 * @returns {Promise<Object>} Result object with coverImage, previewImages, manifestUpdated
 */
async function captureAppStoreImages(options = {}) {
  const {
    appPath: inputAppPath,
    harnessPort = process.env.PORT || 3300,
    onProgress = () => {}
  } = options;

  if (!inputAppPath) {
    throw new Error('appPath is required');
  }

  const appPath = path.resolve(inputAppPath);
  const manifestPath = path.join(appPath, 'app.manifest.json');

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found at: ${manifestPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const appFolder = path.basename(appPath);
  const appKey = manifest.key || appFolder.replace(/^rapider-app-/, '');
  const appName = manifest.name || appKey;

  const rawPages = manifest.webPages || manifest.pages || [];
  if (rawPages.length === 0) {
    throw new Error(`No web pages found in manifest: ${manifestPath}`);
  }

  // Determine Home Page (Cover): prioritize overview/dashboard/home or first page
  let homePage = rawPages.find(p => ['overview', 'dashboard', 'home', 'index'].includes((p.route || '').toLowerCase()));
  if (!homePage) {
    homePage = rawPages[0];
  }

  // Determine up to 5 subsequent pages for Preview
  const otherPages = rawPages.filter(p => p !== homePage);
  // Prioritize pages with displayOnMenu !== false
  const menuPages = otherPages.filter(p => p.displayOnMenu !== false && p.displayInMenu !== false);
  const nonMenuPages = otherPages.filter(p => p.displayOnMenu === false || p.displayInMenu === false);
  const candidatePreviews = [...menuPages, ...nonMenuPages];
  const previewPages = candidatePreviews.slice(0, 5);

  const pagesToCapture = [
    { page: homePage, isCover: true, roleName: 'Cover Image (Home Page)' },
    ...previewPages.map((p, idx) => ({ page: p, isCover: false, roleName: `Preview ${idx + 1} (${p.name || p.route})` }))
  ];

  console.log(`\n===========================================================`);
  console.log(`📸 STARTING APP STORE IMAGE CAPTURE FOR: ${appName}`);
  console.log(`   App Key:       ${appKey}`);
  console.log(`   App Folder:    ${appFolder}`);
  console.log(`   Cover Page:    ${homePage.name || homePage.route} (#/${homePage.route})`);
  console.log(`   Preview Pages: ${previewPages.map(p => p.route).join(', ') || 'none'}`);
  console.log(`   Aspect Ratio:  6:4 (1200px width x 800px height)`);
  console.log(`===========================================================\n`);

  onProgress({ step: 0, total: pagesToCapture.length, message: 'Authenticating with Rapider API...' });

  const creds = loadHarnessCredentials();
  const token = await getAuthToken(creds);

  if (!playwright || !playwright.chromium) {
    throw new Error('Playwright Chromium is not installed or available.');
  }

  // Launch browser with exact 1200x800 viewport (6:4 aspect ratio)
  const browser = await playwright.chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    viewport: { width: 1200, height: 800 },
    deviceScaleFactor: 1
  });

  // Inject session into localStorage so the harness immediately loads authenticated
  await context.addInitScript(({ token, projectId, backendUrl }) => {
    try {
      localStorage.setItem('rappider_harness_session', JSON.stringify({
        token,
        projectId,
        backendUrl,
        email: 't.ozkusaksiz@gmail.com'
      }));
    } catch (e) {}
  }, { token, projectId: creds.projectId, backendUrl: creds.backendUrl });

  const page = await context.newPage();

  // Local storage directories for fallback/QA documentation
  const localScreenshotsDir = path.join(appPath, 'screenshots');
  if (!fs.existsSync(localScreenshotsDir)) fs.mkdirSync(localScreenshotsDir, { recursive: true });

  const docsScreenshotsDir = path.resolve(__dirname, '../rapider-apps/rapider-apps-development/docs', appKey, 'screenshots');
  if (!fs.existsSync(docsScreenshotsDir)) fs.mkdirSync(docsScreenshotsDir, { recursive: true });

  let coverResult = null;
  const previewResults = [];

  try {
    for (let i = 0; i < pagesToCapture.length; i++) {
      const item = pagesToCapture[i];
      const p = item.page;
      const route = p.route;
      const fileName = item.isCover ? 'cover.png' : `${route}.png`;

      onProgress({
        step: i + 1,
        total: pagesToCapture.length,
        message: `Capturing [${i + 1}/${pagesToCapture.length}]: ${item.roleName}...`
      });

      console.log(`[${i + 1}/${pagesToCapture.length}] Capturing ${item.roleName} (#/${route})...`);

      const targetUrl = `http://localhost:${harnessPort}/?appPath=${encodeURIComponent(appPath)}#/${route}`;
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Clean harness chrome and expand iframe to full 1200x800 viewport
      await page.addStyleTag({
        content: `
          #header-bar, #sidebar, #devtools-drawer, #e2e-drawer, #toast-container, #modal-overlay, #workspace-search-modal, #json-viewer-modal, #auth-modal, #e2e-report-modal {
            display: none !important;
          }
          #app-shell {
            display: block !important;
            width: 1200px !important;
            height: 800px !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: hidden !important;
          }
          #main-viewport, #viewport-container {
            width: 1200px !important;
            height: 800px !important;
            max-width: 1200px !important;
            max-height: 800px !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            overflow: hidden !important;
          }
          #sandbox-iframe {
            width: 1200px !important;
            height: 800px !important;
            border: none !important;
            display: block !important;
          }
        `
      });

      // Wait for iframe content to be ready
      const iframeHandle = await page.waitForSelector('#sandbox-iframe', { timeout: 12000 });
      const frame = await iframeHandle.contentFrame();
      if (frame) {
        await frame.waitForLoadState('domcontentloaded').catch(() => null);
        // Allow SWR data bindings and CSS animations to settle
        await page.waitForTimeout(1000);
      } else {
        await page.waitForTimeout(1500);
      }

      // Capture high-definition screenshot buffer
      const screenshotBuffer = await page.screenshot({ type: 'png' });

      // Save local backup copies
      fs.writeFileSync(path.join(localScreenshotsDir, fileName), screenshotBuffer);
      fs.writeFileSync(path.join(docsScreenshotsDir, fileName), screenshotBuffer);

      // Upload to DigitalOcean Spaces / S3
      const uploadRes = await uploadToS3({
        fileName,
        buffer: screenshotBuffer,
        appKey,
        creds,
        token
      });

      const captureInfo = {
        roleName: item.roleName,
        route,
        fileName,
        publicUrl: uploadRes.publicUrl,
        key: uploadRes.key,
        dimensions: { width: 1200, height: 800, aspectRatio: '6:4' }
      };

      if (item.isCover) {
        coverResult = captureInfo;
      } else {
        previewResults.push(captureInfo);
      }
    }
  } finally {
    await browser.close();
  }

  // Update app.manifest.json with all fields
  console.log(`\n▶ Updating ${manifestPath} with captured S3 URLs...`);
  const coverPublicUrl = coverResult?.publicUrl || '';
  const previewPublicUrls = previewResults.map(p => p.publicUrl);
  const allPublicUrls = [coverPublicUrl, ...previewPublicUrls].filter(Boolean);

  manifest.coverImage = coverPublicUrl;
  manifest.coverImageUrl = coverPublicUrl;
  manifest.thumbnailUrl = coverPublicUrl;

  manifest.images = allPublicUrls;
  manifest.screenshots = allPublicUrls;
  manifest.thumbnails = allPublicUrls;

  // Also sync metadata if present
  if (manifest.metadata && typeof manifest.metadata === 'object' && !Array.isArray(manifest.metadata)) {
    manifest.metadata.coverImageUrl = coverPublicUrl;
    manifest.metadata.thumbnailUrl = coverPublicUrl;
    manifest.metadata.images = allPublicUrls;
  }

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`✅ Successfully updated ${manifestPath}`);

  return {
    success: true,
    appName,
    appKey,
    appPath,
    manifestPath,
    aspectRatio: '6:4 (1200px x 800px)',
    coverImage: coverResult,
    previewImages: previewResults,
    allImages: allPublicUrls,
    capturedCount: pagesToCapture.length
  };
}

module.exports = {
  captureAppStoreImages,
  loadHarnessCredentials,
  getAuthToken,
  uploadToS3
};
