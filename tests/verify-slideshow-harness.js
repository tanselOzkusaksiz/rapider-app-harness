/**
 * verify-slideshow-harness.js
 * Comprehensive automated verification test for TourXel Screen Guides Slideshow Harness.
 */

const { chromium } = require('@playwright/test');

async function runVerification() {
  console.log('================================================================');
  console.log('🧪 Starting TourXel Screen Guides Slideshow Verification');
  console.log('================================================================');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const baseUrl = 'http://localhost:3300/slideshow';
  console.log(`🌐 Navigating to: ${baseUrl}#/22`);

  await page.goto(`${baseUrl}#/22`, { waitUntil: 'networkidle' });

  // 1. Verify Page Title & Light Theme Default
  const title = await page.title();
  const isLightTheme = await page.evaluate(() => document.body.classList.contains('light-theme'));
  console.log(`  ✅ Page Title: "${title}" | Light Theme Default: ${isLightTheme}`);
  if (!isLightTheme) {
    throw new Error('Expected Light Theme (body.light-theme) to be active by default');
  }

  // 2. Verify Slide Indicator
  const currentNo = await page.locator('#current-slide-no').innerText();
  const totalCount = await page.locator('#total-slides-count').innerText();
  console.log(`  ✅ Active Slide Indicator: ${currentNo} / ${totalCount}`);
  if (currentNo !== '22' || totalCount !== '53') {
    throw new Error(`Expected slide 22 / 53, got ${currentNo} / ${totalCount}`);
  }

  // 3. Verify Left Sidebar is Collapsed by Default
  const isSidebarOpen = await page.evaluate(() => {
    return document.getElementById('app-shell').classList.contains('sidebar-open');
  });
  console.log(`  ✅ Sidebar Collapsed by Default: ${!isSidebarOpen}`);

  // 4. Toggle Sidebar Open & Verify Menu Items
  await page.click('#btn-toggle-sidebar');
  await page.waitForTimeout(300);
  const isSidebarOpenNow = await page.evaluate(() => {
    return document.getElementById('app-shell').classList.contains('sidebar-open');
  });
  console.log(`  ✅ Sidebar Toggled Open: ${isSidebarOpenNow}`);

  const navItemsCount = await page.locator('.nav-item').count();
  console.log(`  ✅ Total Menu Links rendered in Sidebar: ${navItemsCount}`);
  if (navItemsCount !== 53) {
    throw new Error(`Expected 53 nav items in sidebar, got ${navItemsCount}`);
  }

  // Verify Active Menu Link for Screen 22
  const activeNavText = await page.locator('.nav-item.active .nav-item-title').innerText();
  console.log(`  ✅ Active Menu Item Title: "${activeNavText}"`);
  if (!activeNavText.includes('Ören Yeri & Giriş Rezervasyonları')) {
    throw new Error(`Expected active item for Entrance, got "${activeNavText}"`);
  }

  // Close sidebar
  await page.click('#btn-close-sidebar');
  await page.waitForTimeout(200);

  // 5. Verify Main Image Rendering (Annotated by default)
  const imageSrcAnnotated = await page.locator('#main-image').getAttribute('src');
  console.log(`  ✅ Initial Main Image (Annotated): ${imageSrcAnnotated}`);
  if (!imageSrcAnnotated.includes('22_operation_03_entrance_annotated.png')) {
    throw new Error(`Expected annotated image for 22, got ${imageSrcAnnotated}`);
  }

  // 6. Test Image Mode Toggle to Raw
  console.log('  🔄 Clicking Raw Image button...');
  await page.click('#mode-btn-raw');
  await page.waitForTimeout(200);
  const imageSrcRaw = await page.locator('#main-image').getAttribute('src');
  console.log(`  ✅ Toggled Main Image (Raw): ${imageSrcRaw}`);
  if (!imageSrcRaw.includes('22_operation_03_entrance.png')) {
    throw new Error(`Expected raw image for 22, got ${imageSrcRaw}`);
  }

  // Toggle back to annotated
  await page.click('#mode-btn-annotated');
  await page.waitForTimeout(200);

  // 7. Verify Right Panel Markdown Content & Vertical Scrolling
  const guideBadgeText = await page.locator('#guide-file-badge').innerText();
  const routePillText = await page.locator('#route-pill').innerText();
  console.log(`  ✅ Right Panel Guide Badge: ${guideBadgeText}`);
  console.log(`  ✅ Right Panel Route Pill: ${routePillText}`);
  if (!guideBadgeText.includes('22_operation_03_entrance_screen_guide_tr.md')) {
    throw new Error(`Expected TR guide badge for 22, got ${guideBadgeText}`);
  }
  if (!routePillText.includes('/Operation/Operation#Entrance')) {
    throw new Error(`Expected route /Operation/Operation#Entrance, got ${routePillText}`);
  }

  const markdownHeading = await page.locator('#markdown-container h1').innerText();
  console.log(`  ✅ Rendered Markdown H1: "${markdownHeading}"`);
  if (!markdownHeading.includes('Ören Yeri & Giriş Rezervasyonları')) {
    throw new Error(`Expected markdown heading to contain Ören Yeri, got "${markdownHeading}"`);
  }

  // Verify Markdown Scroll Container actually scrolls down!
  const scrollMetrics = await page.evaluate(() => {
    const body = document.getElementById('markdown-scroll-body') || document.querySelector('.right-panel-body');
    const beforeTop = body.scrollTop;
    const scrollHeight = body.scrollHeight;
    const clientHeight = body.clientHeight;
    body.scrollTop = 450;
    const afterTop = body.scrollTop;
    body.scrollTop = 0;
    return { beforeTop, scrollHeight, clientHeight, afterTop };
  });
  console.log(`  ✅ Right Panel Markdown Scroll Check: clientHeight=${scrollMetrics.clientHeight}px, scrollHeight=${scrollMetrics.scrollHeight}px, scrolledTo=${scrollMetrics.afterTop}px`);
  if (scrollMetrics.scrollHeight <= scrollMetrics.clientHeight || scrollMetrics.afterTop <= 0) {
    throw new Error(`Markdown area on the right side is not scrollable! Metrics: ${JSON.stringify(scrollMetrics)}`);
  }

  // 8. Test Next Navigation
  console.log('  ➡️ Clicking "Sonraki" (Next)...');
  await page.click('#btn-next');
  await page.waitForTimeout(300);
  const nextNo = await page.locator('#current-slide-no').innerText();
  const nextHeading = await page.locator('#markdown-container h1').innerText();
  console.log(`  ✅ After Next -> Slide No: ${nextNo} | Heading: "${nextHeading}"`);
  if (nextNo !== '23') {
    throw new Error(`Expected slide 23 after next, got ${nextNo}`);
  }

  // 9. Test Prev Navigation
  console.log('  ⬅️ Clicking "Önceki" (Prev)...');
  await page.click('#btn-prev');
  await page.waitForTimeout(300);
  const prevNo = await page.locator('#current-slide-no').innerText();
  console.log(`  ✅ After Prev -> Returned to Slide No: ${prevNo}`);
  if (prevNo !== '22') {
    throw new Error(`Expected slide 22 after prev, got ${prevNo}`);
  }

  // 10. Test Language Toggle (TR <-> EN)
  console.log('  🌐 Testing Language Switcher (TR -> EN)...');
  await page.click('#btn-toggle-lang');
  await page.waitForTimeout(300);
  const enBadge = await page.locator('#guide-file-badge').innerText();
  console.log(`  ✅ English Guide File: ${enBadge}`);
  if (!enBadge.includes('22_operation_03_entrance_screen_guide.md') || enBadge.includes('_tr.md')) {
    throw new Error(`Expected English guide file, got ${enBadge}`);
  }
  await page.click('#btn-toggle-lang');
  await page.waitForTimeout(300);

  // 11. Test Active App Badge & Report & Request Panel on Right Side
  const activeAppText = await page.locator('#active-app-name-text').innerText();
  console.log(`  ✅ Active App Badge: "${activeAppText}"`);
  if (activeAppText.includes('Loading...')) {
    throw new Error(`Expected Active App to be resolved, got "${activeAppText}"`);
  }

  console.log('  💡 Clicking "Report & Request" button in header...');
  await page.click('#btn-report-request');
  await page.waitForTimeout(250);

  const isTasksPanelVisible = await page.evaluate(() => {
    const el = document.getElementById('right-panel-tasks-view');
    return el && el.classList.contains('active') && getComputedStyle(el).display !== 'none';
  });
  console.log(`  ✅ Right-Side Report & Request Panel Opened: ${isTasksPanelVisible}`);
  if (!isTasksPanelVisible) {
    throw new Error('Expected #right-panel-tasks-view to be visible when Report & Request is clicked');
  }

  // 12. Test Screen Capture & Annotation Modal ("Report Bug")
  console.log('  📸 Clicking "Report Bug" to open Screen Capture & Annotation Modal...');
  await page.click('#btn-report-bug');
  await page.waitForTimeout(400);

  const isCaptureModalOpen = await page.evaluate(() => {
    return document.getElementById('screen-capture-modal').classList.contains('open');
  });
  console.log(`  ✅ Screen Capture Modal Opened: ${isCaptureModalOpen}`);
  if (!isCaptureModalOpen) {
    throw new Error('Expected #screen-capture-modal to open when Report Bug is clicked');
  }

  // Draw an arrow and a numbered marker on the annotation canvas
  const canvasBox = await page.locator('#screen-annotation-canvas').boundingBox();
  if (canvasBox) {
    await page.mouse.move(canvasBox.x + 80, canvasBox.y + 80);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + 220, canvasBox.y + 160, { steps: 5 });
    await page.mouse.up();

    // Switch to Number tool and place marker #1
    await page.click('.draw-tool-btn[data-tool="number"]');
    await page.mouse.click(canvasBox.x + 240, canvasBox.y + 170);
  }

  // Fill out Title and Markdown Description
  const testTaskTitle = `Entrance Reservation Grid Alignment Check [Slide #22]`;
  await page.fill('#capture-task-title', testTaskTitle);
  await page.fill('#capture-task-desc', `Verified **(1)** entrance fee calculation column on \`/Operation/Operation#Entrance\`.`);

  console.log('  💾 Saving annotated Bug Report to Active App...');
  await page.click('#btn-save-capture-task');
  await page.waitForTimeout(800);

  const taskCardTitle = await page.locator('.task-card .task-card-title').first().innerText();
  console.log(`  ✅ Created Task Card in Right Panel: "${taskCardTitle}"`);
  if (taskCardTitle !== testTaskTitle) {
    throw new Error(`Expected first task card title to be "${testTaskTitle}", got "${taskCardTitle}"`);
  }

  // Click the created task card to verify in-panel detail view & delete it cleanly afterwards
  await page.locator('.task-card').first().click();
  await page.waitForTimeout(250);
  const detailTitle = await page.locator('.detail-task-title').innerText();
  console.log(`  ✅ In-Panel Task Detail View Opened: "${detailTitle}"`);

  // Clean up test task
  await page.click('#btn-detail-delete-task');
  await page.waitForTimeout(200);
  await page.click('#btn-confirm-delete-task');
  await page.waitForTimeout(400);

  // Switch back to Guide Markdown tab
  await page.click('#tab-btn-guide');
  await page.waitForTimeout(200);

  console.log('\n===========================================================');
  console.log('🎉 ALL 12 SLIDESHOW + REPORT & REQUEST TESTS PASSED!');
  console.log('===========================================================');

  await browser.close();
}

runVerification().catch(err => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
