/**
 * screen-guides-router.js
 * Express router and catalog parser for TourXel Screen Guides Slideshow Harness.
 */

const express = require('express');
const path = require('path');
const fs = require('fs');

const DEFAULT_GUIDES_DIR = '/Users/tanselozkusaksiz/Projects/tourxel/code/RapiderRepo/TourXel_Rapider/documentation/screen_guides';
const DEFAULT_MANUAL_DIR = '/Users/tanselozkusaksiz/Projects/tourxel/code/RapiderRepo/TourXel_Rapider/documentation/reference_manual';

const MODULE_DEFINITIONS = [
  { id: '01', min: 1, max: 3, nameTr: 'Kimlik Doğrulama & Sistem Yönetim Panelleri', nameEn: 'Authentication & System Dashboards', icon: 'fas fa-tachometer-alt' },
  { id: '02', min: 10, max: 16, nameTr: 'Teklif & Fiyatlandırma Motoru', nameEn: 'Quotation Engine Suite', icon: 'fas fa-calculator' },
  { id: '03', min: 20, max: 28, nameTr: 'Operasyon & Lojistik Yönetim Paketi', nameEn: 'Operations & Logistics Management Suite', icon: 'fas fa-cogs' },
  { id: '04', min: 30, max: 32, nameTr: 'Müşteri & Cari Hesap Yönetimi', nameEn: 'Customer Management Suite', icon: 'fas fa-users' },
  { id: '05', min: 40, max: 55, nameTr: 'Sistem Tanımları & Konfigürasyon', nameEn: 'System Setup & Configuration Suite', icon: 'fas fa-sliders-h' },
  { id: '06', min: 60, max: 67, nameTr: 'Yönetim & Personel Paneli', nameEn: 'Management Suite', icon: 'fas fa-user-shield' },
  { id: '07', min: 70, max: 71, nameTr: 'FIT Özel Münferit Gruplar', nameEn: 'FIT Bespoke Groups Suite', icon: 'fas fa-user-friends' },
  { id: '08', min: 80, max: 83, nameTr: 'Bildirimler & Otomasyon Uyarıları', nameEn: 'Notifications & Automated Alerts Suite', icon: 'fas fa-bell' },
  { id: '09', min: 90, max: 99, nameTr: 'Finansal & Yönetim Raporları', nameEn: 'Financial & Management Reports Suite', icon: 'fas fa-chart-line' }
];

function getModuleForNumber(noStr) {
  const num = parseInt(noStr, 10);
  for (const m of MODULE_DEFINITIONS) {
    if (num >= m.min && num <= m.max) {
      return m;
    }
  }
  return { id: '99', nameTr: 'Diğer Rehberler', nameEn: 'Other Guides', icon: 'fas fa-folder' };
}

function parseCatalog(guidesDir = DEFAULT_GUIDES_DIR) {
  const trIndexPath = path.join(guidesDir, 'SCREEN_GUIDES_INDEX_TR.md');
  const enIndexPath = path.join(guidesDir, 'SCREEN_GUIDES_INDEX.md');

  if (!fs.existsSync(trIndexPath)) {
    console.warn(`[ScreenGuides] Index file not found: ${trIndexPath}`);
    return { screens: [], modules: MODULE_DEFINITIONS };
  }

  const trContent = fs.readFileSync(trIndexPath, 'utf8');
  let enContent = '';
  if (fs.existsSync(enIndexPath)) {
    enContent = fs.readFileSync(enIndexPath, 'utf8');
  }

  // Parse English table to extract English titles
  const enTitlesByNo = {};
  if (enContent) {
    const enLines = enContent.split('\n');
    let inEnTable = false;
    for (const line of enLines) {
      if (line.includes('| Number | Screen Name & Module |')) {
        inEnTable = true;
        continue;
      }
      if (!inEnTable) continue;
      if (!line.trim().startsWith('|') || line.includes(':---')) continue;
      const parts = line.split('|').map(s => s.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
      if (parts.length >= 2) {
        const no = parts[0].replace(/\*\*/g, '').trim();
        const title = parts[1].replace(/\*\*/g, '').trim();
        if (no && title) {
          enTitlesByNo[no] = title;
        }
      }
    }
  }

  // List existing files in images and raw_captures
  const imagesDir = path.join(guidesDir, 'images');
  const rawDir = path.join(guidesDir, 'raw_captures');
  const allImages = fs.existsSync(imagesDir) ? fs.readdirSync(imagesDir) : [];
  const allRaws = fs.existsSync(rawDir) ? fs.readdirSync(rawDir) : [];

  const screens = [];
  const trLines = trContent.split('\n');
  let inTable = false;

  for (const line of trLines) {
    if (line.includes('| No | Ekran Adı & Modül |')) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (!line.trim().startsWith('|') || line.includes(':---')) continue;

    const parts = line.split('|').map(s => s.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
    if (parts.length >= 6) {
      const no = parts[0].replace(/\*\*/g, '').trim();
      const titleTr = parts[1].replace(/\*\*/g, '').trim();

      const enMatch = parts[2].match(/\[(.*?)\]\((.*?)\)/);
      const enGuide = enMatch ? enMatch[2] : '';

      const trMatch = parts[3].match(/\[(.*?)\]\((.*?)\)/);
      const trGuide = trMatch ? trMatch[2] : '';

      const route = parts[4].replace(/`/g, '').trim();

      const manualMatch = parts[5].match(/\[(.*?)\]\((.*?)\)/);
      const manual = manualMatch ? manualMatch[2] : '';
      const manualFile = manual ? path.basename(manual) : '';

      const prefix = trGuide.replace(/_screen_guide_tr\.md$/, '').replace(/_screen_guide\.md$/, '');

      // Locate annotated image
      const annotatedCandidate = `${prefix}_annotated.png`;
      const hasAnnotated = allImages.includes(annotatedCandidate);
      const annotatedImage = hasAnnotated ? annotatedCandidate : (allImages.find(f => f.startsWith(prefix) && f.includes('annotated')) || '');

      // Locate raw image
      const rawCandidate = `${prefix}.png`;
      const hasRaw = allRaws.includes(rawCandidate);
      const rawImage = hasRaw ? rawCandidate : (allRaws.find(f => f.startsWith(prefix)) || '');

      // Locate section images
      const sectionImages = allImages
        .filter(f => f.startsWith(prefix + '_sec') && f.endsWith('.png'))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

      const mod = getModuleForNumber(no);
      const titleEn = enTitlesByNo[no] || titleTr;

      screens.push({
        no,
        index: screens.length,
        titleTr,
        titleEn,
        route,
        manual,
        manualFile,
        trGuide,
        enGuide,
        prefix,
        annotatedImage,
        rawImage,
        sectionImages,
        module: {
          id: mod.id,
          nameTr: mod.nameTr,
          nameEn: mod.nameEn,
          icon: mod.icon
        }
      });
    }
  }

  return { screens, modules: MODULE_DEFINITIONS };
}

function createScreenGuidesRouter(customGuidesDir, customManualDir) {
  const router = express.Router();
  const guidesDir = customGuidesDir || process.env.SCREEN_GUIDES_DIR || DEFAULT_GUIDES_DIR;
  const manualDir = customManualDir || process.env.MANUAL_DIR || DEFAULT_MANUAL_DIR;

  console.log(`[ScreenGuides] Initializing router with:`);
  console.log(`  Guides Directory: ${guidesDir}`);
  console.log(`  Manual Directory: ${manualDir}`);

  // 1. Catalog Endpoint
  router.get('/catalog', (req, res) => {
    try {
      const catalog = parseCatalog(guidesDir);
      res.json(catalog);
    } catch (err) {
      console.error('[ScreenGuides] Error parsing catalog:', err);
      res.status(500).json({ error: 'Failed to parse screen guides catalog', message: err.message });
    }
  });

  // 2. Markdown File Content Endpoint
  router.get('/markdown/:filename', (req, res) => {
    try {
      const filename = path.basename(req.params.filename);
      const filePath = path.join(guidesDir, filename);

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Markdown file not found', filename });
      }

      const content = fs.readFileSync(filePath, 'utf8');
      res.setHeader('Content-Type', 'text/markdown; charset=UTF-8');
      res.send(content);
    } catch (err) {
      console.error('[ScreenGuides] Error reading markdown file:', err);
      res.status(500).json({ error: 'Failed to read markdown file', message: err.message });
    }
  });

  // 3. Reference Manual Markdown Content Endpoint
  router.get('/manual/:filename', (req, res) => {
    try {
      const filename = path.basename(req.params.filename);
      const filePath = path.join(manualDir, filename);

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Reference manual file not found', filename });
      }

      const content = fs.readFileSync(filePath, 'utf8');
      res.setHeader('Content-Type', 'text/markdown; charset=UTF-8');
      res.send(content);
    } catch (err) {
      console.error('[ScreenGuides] Error reading manual file:', err);
      res.status(500).json({ error: 'Failed to read manual file', message: err.message });
    }
  });

  // 4. Image Serving Endpoints
  router.get('/image/:type/:filename', (req, res) => {
    const { type, filename } = req.params;
    const cleanFilename = path.basename(filename);

    let targetDir = path.join(guidesDir, 'images');
    if (type === 'raw' || type === 'raw_captures') {
      targetDir = path.join(guidesDir, 'raw_captures');
    }

    const filePath = path.join(targetDir, cleanFilename);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Content-Type', 'image/png');
      return res.sendFile(filePath);
    }

    // Fallback: check other folder if not found in requested
    const altDir = (type === 'raw' || type === 'raw_captures')
      ? path.join(guidesDir, 'images')
      : path.join(guidesDir, 'raw_captures');
    const altFilePath = path.join(altDir, cleanFilename);
    if (fs.existsSync(altFilePath) && fs.statSync(altFilePath).isFile()) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Content-Type', 'image/png');
      return res.sendFile(altFilePath);
    }

    res.status(404).json({ error: 'Image not found', type, filename: cleanFilename });
  });

  // Direct static folder mounts for images and raw_captures
  router.use('/images', express.static(path.join(guidesDir, 'images'), { maxAge: '1d' }));
  router.use('/raw_captures', express.static(path.join(guidesDir, 'raw_captures'), { maxAge: '1d' }));

  return router;
}

module.exports = {
  createScreenGuidesRouter,
  parseCatalog,
  DEFAULT_GUIDES_DIR,
  DEFAULT_MANUAL_DIR
};
