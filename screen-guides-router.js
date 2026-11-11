/**
 * screen-guides-router.js
 * App-agnostic Express router for the Rapider Screen Guide Harness (/screen-guide).
 * Dynamically resolves any selected Rapider App to its repository folder and loads
 * its `screen-guide.manifest.json` definition, markdown guides, reference manuals, and images.
 */

const express = require('express');
const path = require('path');
const fs = require('fs');

const RAPIDER_APPS_ROOT = path.resolve(__dirname, '../rapider-apps');
const DEFAULT_TOURXEL_REPO = path.join(RAPIDER_APPS_ROOT, 'APPS', 'TourXel');
const DEFAULT_GUIDES_DIR = path.join(DEFAULT_TOURXEL_REPO, 'documentation', 'screen_guides');
const DEFAULT_MANUAL_DIR = path.join(DEFAULT_TOURXEL_REPO, 'documentation', 'reference_manual');

/**
 * Scan ../rapider-apps/APPS and ../rapider-apps for all local application repositories
 */
function discoverLocalAppRepos() {
  const repos = [];
  const baseDirs = [path.join(RAPIDER_APPS_ROOT, 'APPS'), RAPIDER_APPS_ROOT];
  const seenDirs = new Set();

  for (const baseDir of baseDirs) {
    if (!fs.existsSync(baseDir)) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(baseDir, { withFileTypes: true });
    } catch (_) {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'APPS' || entry.name === 'node_modules') {
        continue;
      }
      const appDir = path.join(baseDir, entry.name);
      if (seenDirs.has(appDir)) continue;

      const appManifestPath = path.join(appDir, 'app.manifest.json');
      const rootSgManifest = path.join(appDir, 'screen-guide.manifest.json');
      const existingSgManifest = fs.existsSync(rootSgManifest) ? rootSgManifest : null;

      if (!fs.existsSync(appManifestPath) && !existingSgManifest) {
        continue;
      }

      seenDirs.add(appDir);
      let appManifest = {};
      if (fs.existsSync(appManifestPath)) {
        try {
          appManifest = JSON.parse(fs.readFileSync(appManifestPath, 'utf8'));
        } catch (_) {}
      }

      repos.push({
        folderName: entry.name,
        appDir,
        appId: appManifest.id || appManifest.applicationDefinitionId || '',
        applicationDefinitionId: appManifest.applicationDefinitionId || appManifest.id || '',
        key: appManifest.key || entry.name,
        domainKey: appManifest.domainKey || '',
        name: appManifest.name || entry.name,
        description: appManifest.description || '',
        githubRepo: appManifest.githubRepo || null,
        hasScreenGuideManifest: Boolean(existingSgManifest),
        screenGuideManifestPath: existingSgManifest
      });
    }
  }

  return repos;
}

/**
 * Resolve a requested application (by appId, appKey, appName, folderName, or repoUrl)
 * to its local repository folder.
 */
function resolveAppRepo(query = {}) {
  const repos = discoverLocalAppRepos();
  const rawId = String(query.appId || query.applicationDefinitionId || '').trim().toLowerCase();
  const rawKey = String(query.appKey || query.key || '').trim().toLowerCase();
  const rawName = String(query.appName || query.name || '').trim().toLowerCase();
  const rawFolder = String(query.folderName || query.app || '').trim().toLowerCase();
  const rawRepo = String(query.repoUrl || query.repo || '').trim().toLowerCase();

  if (query.appPath && path.isAbsolute(query.appPath) && fs.existsSync(query.appPath)) {
    const matched = repos.find(r => r.appDir === query.appPath);
    if (matched) return matched;
    return {
      folderName: path.basename(query.appPath),
      appDir: query.appPath,
      appId: rawId,
      key: rawKey || path.basename(query.appPath),
      name: query.appName || path.basename(query.appPath)
    };
  }

  // 1. Exact ID match
  if (rawId) {
    const byId = repos.find(r =>
      (r.appId && r.appId.toLowerCase() === rawId) ||
      (r.applicationDefinitionId && r.applicationDefinitionId.toLowerCase() === rawId)
    );
    if (byId) return byId;
  }

  // 2. Exact key / folderName / domainKey match
  for (const candidate of [rawFolder, rawKey, rawName].filter(Boolean)) {
    const exact = repos.find(r =>
      r.folderName.toLowerCase() === candidate ||
      (r.key && r.key.toLowerCase() === candidate) ||
      (r.domainKey && r.domainKey.toLowerCase() === candidate) ||
      (r.name && r.name.toLowerCase() === candidate)
    );
    if (exact) return exact;
  }

  // 3. GitHub repo match
  if (rawRepo) {
    const byRepo = repos.find(r => {
      if (!r.githubRepo) return false;
      const url = String(r.githubRepo.url || '').toLowerCase();
      const fullName = String(r.githubRepo.fullName || '').toLowerCase();
      const repoName = String(r.githubRepo.repo || '').toLowerCase();
      return (url && rawRepo.includes(url)) ||
             (fullName && rawRepo.includes(fullName)) ||
             (repoName && rawRepo === repoName);
    });
    if (byRepo) return byRepo;
  }

  // 4. Normalized alphanumeric match (e.g. "TourXel Tour Management" -> "tourxel")
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const candidate of [rawKey, rawName, rawFolder].map(norm).filter(Boolean)) {
    const fuzzy = repos.find(r => {
      const rKey = norm(r.key);
      const rName = norm(r.name);
      const rFolder = norm(r.folderName);
      return (rKey && (candidate === rKey || candidate.includes(rKey) || rKey.includes(candidate))) ||
             (rName && (candidate === rName || candidate.includes(rName) || rName.includes(candidate))) ||
             (rFolder && (candidate === rFolder));
    });
    if (fuzzy) return fuzzy;
  }

  return null;
}

/**
 * Locate and parse `screen-guide.manifest.json` inside an app repository directory.
 */
function loadScreenGuideManifestForApp(appRepo) {
  if (!appRepo || !appRepo.appDir) {
    return {
      found: false,
      error: 'APP_REPO_NOT_FOUND',
      message: 'Could not locate a local repository directory for the selected application.',
      checkedPaths: []
    };
  }

  const appDir = appRepo.appDir;
  const candidatePaths = [
    path.join(appDir, 'screen-guide.manifest.json')
  ];

  const foundPath = candidatePaths.find(p => fs.existsSync(p));
  if (!foundPath) {
    return {
      found: false,
      error: 'SCREEN_GUIDE_MANIFEST_NOT_FOUND',
      message: `No screen-guide.manifest.json found for application "${appRepo.name || appRepo.key || appRepo.folderName}".`,
      app: {
        appId: appRepo.appId,
        key: appRepo.key,
        name: appRepo.name,
        folderName: appRepo.folderName,
        appDir
      },
      checkedPaths: candidatePaths.map(p => path.relative(RAPIDER_APPS_ROOT, p))
    };
  }

  const rawManifest = JSON.parse(fs.readFileSync(foundPath, 'utf8'));
  const normalized = normalizeManifestToCatalog(rawManifest, appRepo, foundPath);

  return {
    found: true,
    manifestPath: foundPath,
    relativeManifestPath: path.relative(appDir, foundPath),
    app: {
      appId: rawManifest.appId || appRepo.appId || '',
      key: rawManifest.appKey || appRepo.key || appRepo.folderName,
      name: rawManifest.appName || appRepo.name || appRepo.folderName,
      folderName: appRepo.folderName,
      appDir
    },
    manifest: rawManifest,
    modules: normalized.modules,
    screens: normalized.screens
  };
}

/**
 * Normalize `screen-guide.manifest.json` into both rich manifest structures and
 * normalized module/screen items for the Screen Guide UI.
 */
function normalizeManifestToCatalog(manifest, appRepo, manifestPath) {
  const rawModules = Array.isArray(manifest.modules) ? manifest.modules : [];
  const modules = rawModules.map((m, idx) => {
    const iconRaw = m.icon || 'fa-folder';
    const icon = iconRaw.startsWith('fa-') ? `fas ${iconRaw}` : iconRaw;
    const nameEn = (m.title && m.title.en) || m.nameEn || m.title || m.id || `Module ${idx + 1}`;
    const nameTr = (m.title && m.title.tr) || m.nameTr || nameEn;
    return {
      id: String(m.id || idx + 1),
      order: m.order || idx + 1,
      icon,
      nameEn,
      nameTr,
      title: { en: nameEn, tr: nameTr }
    };
  });

  const modulesById = new Map(modules.map(m => [m.id, m]));
  const rawScreens = Array.isArray(manifest.screens) ? manifest.screens : [];

  const screens = rawScreens.map((s, idx) => {
    const no = String(s.no || s.number || String(idx + 1).padStart(2, '0'));
    const titleEn = (s.title && s.title.en) || s.titleEn || (typeof s.title === 'string' ? s.title : '') || `Screen ${no}`;
    const titleTr = (s.title && s.title.tr) || s.titleTr || titleEn;

    const mdEnPath = (s.markdown && s.markdown.en) || s.enGuide || '';
    const mdTrPath = (s.markdown && s.markdown.tr) || s.trGuide || mdEnPath;

    const annotatedRel = (s.images && s.images.annotated) || s.annotatedImage || '';
    const rawRel = (s.images && s.images.raw) || s.rawImage || '';
    const rawSections = (s.images && Array.isArray(s.images.sections)) ? s.images.sections : (Array.isArray(s.sectionImages) ? s.sectionImages : []);

    const sections = rawSections.map((sec, sIdx) => {
      if (typeof sec === 'string') {
        return {
          index: sIdx + 1,
          file: path.basename(sec),
          path: sec,
          label: { en: `Section ${sIdx + 1}`, tr: `Bölüm ${sIdx + 1}` }
        };
      }
      return {
        index: sec.index || sIdx + 1,
        file: sec.file || path.basename(sec.path || ''),
        path: sec.path || sec.file || '',
        label: {
          en: (sec.label && sec.label.en) || (typeof sec.label === 'string' ? sec.label : `Section ${sIdx + 1}`),
          tr: (sec.label && sec.label.tr) || (typeof sec.label === 'string' ? sec.label : `Bölüm ${sIdx + 1}`)
        }
      };
    });

    const manualObj = s.referenceManual || {};
    const manualPath = manualObj.path || s.manual || '';
    const manualFile = manualObj.file || (manualPath ? path.basename(manualPath) : '');
    const manualTitle = manualObj.title || manualFile;

    const mod = modulesById.get(String(s.moduleId || '')) ||
                (s.module ? {
                  id: String(s.module.id || 'other'),
                  nameEn: s.module.nameEn || 'General',
                  nameTr: s.module.nameTr || 'Genel',
                  icon: s.module.icon || 'fas fa-folder'
                } : {
                  id: 'other',
                  nameEn: 'Other Guides',
                  nameTr: 'Diğer Rehberler',
                  icon: 'fas fa-folder'
                });

    return {
      no,
      id: s.id || path.basename(mdEnPath, '.md') || `screen_${no}`,
      index: idx,
      order: s.order || idx + 1,
      moduleId: mod.id,
      route: s.route || '',
      title: { en: titleEn, tr: titleTr },
      titleEn,
      titleTr,
      markdown: { en: mdEnPath, tr: mdTrPath },
      enGuide: path.basename(mdEnPath),
      trGuide: path.basename(mdTrPath),
      images: {
        annotated: annotatedRel,
        raw: rawRel,
        sections
      },
      annotatedImage: path.basename(annotatedRel),
      rawImage: path.basename(rawRel),
      sectionImages: sections.map(sec => sec.file),
      referenceManual: {
        title: manualTitle,
        file: manualFile,
        path: manualPath
      },
      manual: manualPath,
      manualFile,
      module: {
        id: mod.id,
        nameEn: mod.nameEn,
        nameTr: mod.nameTr,
        icon: mod.icon
      }
    };
  });

  return { modules, screens };
}

/**
 * Safely resolve a relative path inside `appDir` without allowing directory traversal.
 */
function resolveSafeAppFile(appDir, relOrFile, fallbackDirs = []) {
  if (!appDir || !relOrFile) return null;
  const normalizedAppDir = path.resolve(appDir);

  // 1. Direct relative path inside appDir
  const directCandidate = path.resolve(normalizedAppDir, relOrFile.replace(/^\/+/, ''));
  if (directCandidate.startsWith(normalizedAppDir) && fs.existsSync(directCandidate) && fs.statSync(directCandidate).isFile()) {
    return directCandidate;
  }

  // 2. Basename inside fallback directories
  const base = path.basename(relOrFile);
  for (const dir of fallbackDirs) {
    const fullDir = path.isAbsolute(dir) ? dir : path.resolve(normalizedAppDir, dir);
    const candidate = path.resolve(fullDir, base);
    if (candidate.startsWith(normalizedAppDir) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return null;
}

function createScreenGuidesRouter(customGuidesDir, customManualDir) {
  const router = express.Router();
  const fallbackGuidesDir = customGuidesDir || process.env.SCREEN_GUIDES_DIR || DEFAULT_GUIDES_DIR;
  const fallbackManualDir = customManualDir || process.env.MANUAL_DIR || DEFAULT_MANUAL_DIR;

  console.log(`[ScreenGuide] Initializing app-agnostic Screen Guide router:`);
  console.log(`  Default TourXel Repo: ${DEFAULT_TOURXEL_REPO}`);

  /**
   * Helper to get the active app repository from request query/headers
   */
  function getAppRepoForRequest(req, allowFallbackToTourXel = false) {
    const query = {
      appId: req.query.appId || req.headers['x-app-id'],
      appKey: req.query.appKey || req.query.key || req.headers['x-app-key'],
      appName: req.query.appName || req.query.name || req.headers['x-app-name'],
      folderName: req.query.folderName || req.query.app,
      appPath: req.query.appPath,
      repoUrl: req.query.repoUrl
    };
    const hasExplicitFilter = Boolean(query.appId || query.appKey || query.appName || query.folderName || query.appPath || query.repoUrl);
    if (hasExplicitFilter) {
      return resolveAppRepo(query);
    }
    if (allowFallbackToTourXel) {
      return resolveAppRepo({ appKey: 'tourxel', folderName: 'TourXel' });
    }
    return null;
  }

  // 0. List local app repositories and whether they have a `screen-guide.manifest.json`
  router.get('/apps', (req, res) => {
    try {
      const repos = discoverLocalAppRepos();
      res.json({ apps: repos });
    } catch (err) {
      res.status(500).json({ error: 'Failed to scan local app repositories', message: err.message });
    }
  });

  // 1. Canonical Manifest Endpoint (`/api/screen-guide/manifest` & `/api/screen-guide/catalog`)
  const handleManifestOrCatalog = (req, res) => {
    try {
      const hasAppParam = Boolean(
        req.query.appId || req.query.appKey || req.query.key ||
        req.query.appName || req.query.name || req.query.folderName ||
        req.query.app || req.query.appPath ||
        req.headers['x-app-id'] || req.headers['x-app-key']
      );

      // If caller explicitly passed an app identifier, resolve strictly for that app
      const appRepo = hasAppParam
        ? getAppRepoForRequest(req, false)
        : getAppRepoForRequest(req, true);

      if (!appRepo) {
        return res.status(200).json({
          found: false,
          error: 'APP_REPO_NOT_FOUND',
          message: `No local repository found matching the selected application (${req.query.appName || req.query.appKey || req.query.appId || 'Unknown'}).`,
          requested: {
            appId: req.query.appId || '',
            appKey: req.query.appKey || '',
            appName: req.query.appName || '',
            folderName: req.query.folderName || ''
          },
          checkedPaths: ['rapider-apps/APPS/<app>/screen-guide.manifest.json', 'rapider-apps/<app>/screen-guide.manifest.json']
        });
      }

      const result = loadScreenGuideManifestForApp(appRepo);
      return res.json(result);
    } catch (err) {
      console.error('[ScreenGuide] Error loading screen-guide.manifest.json:', err);
      res.status(500).json({
        found: false,
        error: 'MANIFEST_PARSE_ERROR',
        message: err.message
      });
    }
  };

  router.get('/manifest', handleManifestOrCatalog);
  router.get('/catalog', handleManifestOrCatalog);

  // 2. Generic App-Scoped Asset Endpoint (`/api/screen-guide/asset?appKey=...&path=...`)
  router.get('/asset', (req, res) => {
    try {
      const relPath = req.query.path || req.query.file || '';
      if (!relPath) {
        return res.status(400).json({ error: 'Missing path query parameter' });
      }
      const appRepo = getAppRepoForRequest(req, true);
      if (!appRepo) {
        return res.status(404).json({ error: 'App repository not found' });
      }

      const filePath = resolveSafeAppFile(appRepo.appDir, relPath, [
        'documentation/screen_guides',
        'documentation/screen_guides/images',
        'documentation/screen_guides/raw_captures',
        'documentation/reference_manual'
      ]);

      if (!filePath) {
        return res.status(404).json({ error: 'Asset not found', path: relPath, app: appRepo.folderName });
      }

      if (filePath.endsWith('.md')) {
        res.setHeader('Content-Type', 'text/markdown; charset=UTF-8');
        res.setHeader('Cache-Control', 'no-cache');
        return res.send(fs.readFileSync(filePath, 'utf8'));
      }
      if (filePath.endsWith('.json')) {
        res.setHeader('Content-Type', 'application/json; charset=UTF-8');
        return res.send(fs.readFileSync(filePath, 'utf8'));
      }

      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.sendFile(filePath);
    } catch (err) {
      console.error('[ScreenGuide] Error serving asset:', err);
      res.status(500).json({ error: 'Failed to serve asset', message: err.message });
    }
  });

  // 3. Markdown File Content Endpoint
  router.get('/markdown/:filename', (req, res) => {
    try {
      const rawParam = req.params.filename;
      const appRepo = getAppRepoForRequest(req, true);
      let filePath = null;

      if (appRepo) {
        filePath = resolveSafeAppFile(appRepo.appDir, rawParam, [
          'documentation/screen_guides',
          'docs/screen_guides',
          '.'
        ]);
      }

      if (!filePath) {
        const candidate = path.join(fallbackGuidesDir, path.basename(rawParam));
        if (fs.existsSync(candidate)) filePath = candidate;
      }

      if (!filePath || !fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Markdown file not found', filename: rawParam });
      }

      const content = fs.readFileSync(filePath, 'utf8');
      res.setHeader('Content-Type', 'text/markdown; charset=UTF-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.send(content);
    } catch (err) {
      console.error('[ScreenGuide] Error reading markdown file:', err);
      res.status(500).json({ error: 'Failed to read markdown file', message: err.message });
    }
  });

  // 4. Reference Manual Markdown Content Endpoint
  router.get('/manual/:filename', (req, res) => {
    try {
      const rawParam = req.params.filename;
      const appRepo = getAppRepoForRequest(req, true);
      let filePath = null;

      if (appRepo) {
        filePath = resolveSafeAppFile(appRepo.appDir, rawParam, [
          'documentation/reference_manual',
          'docs/reference_manual',
          'documentation/screen_guides'
        ]);
      }

      if (!filePath) {
        const candidate = path.join(fallbackManualDir, path.basename(rawParam));
        if (fs.existsSync(candidate)) filePath = candidate;
      }

      if (!filePath || !fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Reference manual file not found', filename: rawParam });
      }

      const content = fs.readFileSync(filePath, 'utf8');
      res.setHeader('Content-Type', 'text/markdown; charset=UTF-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.send(content);
    } catch (err) {
      console.error('[ScreenGuide] Error reading manual file:', err);
      res.status(500).json({ error: 'Failed to read manual file', message: err.message });
    }
  });

  // 5. Image Serving Endpoint (`/image/:type/:filename`)
  router.get('/image/:type/:filename', (req, res) => {
    const { type, filename } = req.params;
    const cleanFilename = path.basename(filename);
    const appRepo = getAppRepoForRequest(req, true);

    const isRaw = (type === 'raw' || type === 'raw_captures');
    const preferredDirs = isRaw
      ? ['documentation/screen_guides/raw_captures', 'documentation/screen_guides/images', 'docs/screen_guides/raw_captures', 'docs/screen_guides/images']
      : ['documentation/screen_guides/images', 'documentation/screen_guides/raw_captures', 'docs/screen_guides/images', 'docs/screen_guides/raw_captures'];

    if (appRepo) {
      const resolved = resolveSafeAppFile(appRepo.appDir, cleanFilename, preferredDirs);
      if (resolved) {
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('Content-Type', 'image/png');
        return res.sendFile(resolved);
      }
    }

    // Fallback to default guidesDir
    const targetDir = isRaw ? path.join(fallbackGuidesDir, 'raw_captures') : path.join(fallbackGuidesDir, 'images');
    const filePath = path.join(targetDir, cleanFilename);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('Content-Type', 'image/png');
      return res.sendFile(filePath);
    }

    const altDir = isRaw ? path.join(fallbackGuidesDir, 'images') : path.join(fallbackGuidesDir, 'raw_captures');
    const altFilePath = path.join(altDir, cleanFilename);
    if (fs.existsSync(altFilePath) && fs.statSync(altFilePath).isFile()) {
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('Content-Type', 'image/png');
      return res.sendFile(altFilePath);
    }

    res.status(404).json({ error: 'Image not found', type, filename: cleanFilename });
  });

  // Direct static folder mounts for images and raw_captures
  if (fs.existsSync(path.join(fallbackGuidesDir, 'images'))) {
    router.use('/images', express.static(path.join(fallbackGuidesDir, 'images'), { maxAge: '1h' }));
  }
  if (fs.existsSync(path.join(fallbackGuidesDir, 'raw_captures'))) {
    router.use('/raw_captures', express.static(path.join(fallbackGuidesDir, 'raw_captures'), { maxAge: '1h' }));
  }

  // In-memory fallback store for captured screenshots when offline
  const memoryCaptures = new Map();

  router.get('/captures/:filename', (req, res) => {
    const filename = path.basename(req.params.filename);
    const buf = memoryCaptures.get(filename);
    if (!buf) {
      return res.status(404).json({ error: 'Capture not found' });
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(buf);
  });

  // 6. Upload Annotated Screen Capture to S3 via Backend Presigned URL
  router.post('/upload-capture', express.json({ limit: '50mb' }), async (req, res) => {
    try {
      const { dataUrl, fileName, appId } = req.body || {};
      if (!dataUrl || typeof dataUrl !== 'string') {
        return res.status(400).json({ error: 'Missing dataUrl in request body' });
      }

      const base64Match = dataUrl.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
      const base64Data = base64Match ? base64Match[1] : dataUrl;
      const buffer = Buffer.from(base64Data, 'base64');
      const safeFileName = path.basename(fileName || `app-screen-capture-${appId || 'app'}-${Date.now()}.png`);

      memoryCaptures.set(safeFileName, buffer);
      if (memoryCaptures.size > 50) {
        const oldestKey = memoryCaptures.keys().next().value;
        memoryCaptures.delete(oldestKey);
      }

      const targetBaseUrl = (
        req.headers['x-target-backend-url'] ||
        process.env.BACKEND_URL ||
        process.env.RAPIDER_TEST_API_URL ||
        'https://dev.api.rappider.com'
      ).replace(/\/$/, '');
      const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';

      if (authHeader) {
        try {
          const presignRes = await fetch(`${targetBaseUrl}/file-management/public-upload-url`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': authHeader
            },
            body: JSON.stringify({
              fileName: safeFileName,
              contentType: 'image/png',
              type: 'task',
              parentEntityId: appId || 'screen-guide',
              isProjectFile: false
            }),
            signal: AbortSignal.timeout(6000)
          });

          if (presignRes.ok) {
            const presignData = await presignRes.json();
            if (presignData.uploadUrl && presignData.publicUrl) {
              let putRes = await fetch(presignData.uploadUrl, {
                method: 'PUT',
                headers: {
                  'Content-Type': 'image/png',
                  'x-amz-acl': 'public-read'
                },
                body: buffer,
                signal: AbortSignal.timeout(8000)
              });
              if (!putRes.ok) {
                putRes = await fetch(presignData.uploadUrl, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'image/png' },
                  body: buffer,
                  signal: AbortSignal.timeout(8000)
                });
              }
              if (putRes.ok) {
                return res.json({
                  publicUrl: presignData.publicUrl,
                  key: presignData.key,
                  id: presignData.id,
                  storage: 's3'
                });
              }
            }
          }
        } catch (s3Err) {
          console.warn('[ScreenGuide] S3 upload fallback to local capture URL:', s3Err.message);
        }
      }

      const host = req.get('host') || 'localhost:3300';
      const protocol = req.protocol || 'http';
      const fallbackUrl = `${protocol}://${host}/api/screen-guide/captures/${encodeURIComponent(safeFileName)}`;
      return res.json({
        publicUrl: fallbackUrl,
        key: safeFileName,
        storage: 'local'
      });
    } catch (err) {
      console.error('[ScreenGuide] Upload capture error:', err);
      return res.status(500).json({ error: 'Failed to upload capture', message: err.message });
    }
  });

  // 7. Comment PATCH proxy that preserves null fields (e.g. isApproved: null when reopening a task)
  router.patch('/comments/:id', express.json(), async (req, res) => {
    try {
      const commentId = req.params.id;
      const targetBaseUrl = (
        req.headers['x-target-backend-url'] ||
        process.env.BACKEND_URL ||
        process.env.RAPIDER_TEST_API_URL ||
        'https://dev.api.rappider.com'
      ).replace(/\/$/, '');
      const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';

      const backendRes = await fetch(`${targetBaseUrl}/comments/${encodeURIComponent(commentId)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { 'Authorization': authHeader } : {})
        },
        body: JSON.stringify(req.body || {})
      });

      const text = await backendRes.text();
      res.status(backendRes.status);
      try {
        return res.json(text ? JSON.parse(text) : {});
      } catch {
        return res.send(text);
      }
    } catch (err) {
      console.error('[ScreenGuide] Comment patch proxy error:', err);
      return res.status(502).json({ error: 'Comment Patch Proxy Error', message: err.message });
    }
  });

  return router;
}

module.exports = {
  createScreenGuidesRouter,
  discoverLocalAppRepos,
  resolveAppRepo,
  loadScreenGuideManifestForApp,
  DEFAULT_GUIDES_DIR,
  DEFAULT_MANUAL_DIR
};
