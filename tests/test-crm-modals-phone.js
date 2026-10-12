/**
 * Automated QA Pass: Verify Rapider Components & Phone Input in CRM Modals
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { ensureAuthenticated } = require('../harness-auth-helper.js');

const APP_KEY = 'rapider-app-crm-sys-comprehensive-crm-system';
const HARNESS_URL = `http://localhost:3300/?app=${APP_KEY}#/leads`;
const OUT_DIR = path.resolve(__dirname, '../test-results/crm');

function uploadToSpaces(localPath, spacesKeyName) {
  try {
    let envContent = '';
    const envPaths = [
      path.resolve(__dirname, '../../rapider-server/rappider/.server.env'),
      path.resolve(__dirname, '../.env')
    ];
    for (const p of envPaths) {
      if (fs.existsSync(p)) {
        envContent += '\n' + fs.readFileSync(p, 'utf8');
      }
    }
    const keyMatch = envContent.match(/SPACES_KEY=(.+)/);
    const secretMatch = envContent.match(/SPACES_SECRET=(.+)/);
    if (!keyMatch || !secretMatch) return null;

    const spacesKey = keyMatch[1].trim();
    const spacesSecret = secretMatch[1].trim();
    const timestamp = Date.now();
    const fileName = `${spacesKeyName}_${timestamp}.png`;
    const s3Path = `s3://rapider/_qa_assets/2026-10-12/${fileName}`;

    execSync(
      `AWS_ACCESS_KEY_ID=${spacesKey} AWS_SECRET_ACCESS_KEY=${spacesSecret} aws s3 cp ${localPath} ${s3Path} --endpoint-url=https://nyc3.digitaloceanspaces.com --acl public-read`,
      { stdio: 'pipe' }
    );
    return `https://rapider.nyc3.digitaloceanspaces.com/_qa_assets/2026-10-12/${fileName}`;
  } catch (err) {
    console.error('Spaces upload error:', err.message);
    return null;
  }
}

async function run() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('Launching browser to test CRM Modals Rapider Components...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Step 0: Ensure authenticated
  console.log('Ensuring authentication...');
  await ensureAuthenticated(page, APP_KEY);

  // Navigate to Leads page
  console.log('Navigating to Leads page...');
  await page.goto(HARNESS_URL, { waitUntil: 'load' });
  await page.waitForTimeout(3000);

  // Access the inner iframe where the app runs
  const frames = page.frames();
  const appFrame = frames.find(f => f.url().includes('leads.html') || f.name() === 'app-iframe') || page;

  console.log('Auditing Lead page for Rapider Components...');
  const componentsCheck = await appFrame.evaluate(() => {
    const hasRapiderKanban = !!document.querySelector('rapider-kanban');
    const phoneInputs = Array.from(document.querySelectorAll('rapider-phone-input')).map(el => el.id);
    const plainInputs = Array.from(document.querySelectorAll('input')).filter(el => {
      const idOrName = (el.id + ' ' + el.name).toLowerCase();
      return (idOrName.includes('phone') || idOrName.includes('mobile')) && el.tagName === 'INPUT';
    }).map(el => el.id);

    return {
      hasRapiderKanban,
      rapiderPhoneCount: phoneInputs.length,
      phoneInputs,
      plainPhoneCount: plainInputs.length,
      plainInputs
    };
  });

  console.log('Leads Page Rapider Components Check:', JSON.stringify(componentsCheck, null, 2));

  // Trigger New Lead Modal
  console.log('Opening New Lead Modal...');
  await appFrame.evaluate(() => {
    const btn = document.getElementById('btnNewLead') || document.querySelector('[data-action="new-lead"]');
    if (btn) btn.click();
    const modal = document.getElementById('createLeadModal') || document.getElementById('newLeadModal');
    if (modal) modal.classList.remove('hidden');
  });
  await page.waitForTimeout(1000);

  const newLeadModalPath = path.join(OUT_DIR, 'new_lead_modal_phone_component.png');
  await page.screenshot({ path: newLeadModalPath, fullPage: false });
  const newLeadModalUrl = uploadToSpaces(newLeadModalPath, 'crm_new_lead_modal_rapider_phone');
  console.log('New Lead Modal Screenshot Uploaded:', newLeadModalUrl);

  // Close New Lead Modal & Trigger Edit Lead Modal
  console.log('Opening Edit Lead Modal (matching user screenshot)...');
  await appFrame.evaluate(() => {
    const createModal = document.getElementById('createLeadModal') || document.getElementById('newLeadModal');
    if (createModal) createModal.classList.add('hidden');
    
    const editModal = document.getElementById('editLeadModal');
    if (editModal) {
      document.getElementById('editLeadId').value = 'lead-sample-1';
      document.getElementById('editLeadFirst').value = 'Joshua';
      document.getElementById('editLeadLast').value = 'Doe';
      document.getElementById('editLeadCompany').value = 'Acme';
      document.getElementById('editLeadEmail').value = '';
      document.getElementById('editLeadPhone').value = '+1 (555) 012-3456';
      document.getElementById('editLeadSource').value = 'Website';
      document.getElementById('editLeadStatus').value = 'New';
      editModal.classList.remove('hidden');
    }
  });
  await page.waitForTimeout(1500);

  const editLeadModalPath = path.join(OUT_DIR, 'edit_lead_modal_phone_component.png');
  await page.screenshot({ path: editLeadModalPath, fullPage: false });
  const editLeadModalUrl = uploadToSpaces(editLeadModalPath, 'crm_edit_lead_modal_rapider_phone');
  console.log('Edit Lead Modal Screenshot Uploaded:', editLeadModalUrl);

  await browser.close();
  console.log('\n✅ Component QA Pass Complete!');
  return { newLeadModalUrl, editLeadModalUrl, componentsCheck };
}

run().catch(err => {
  console.error('QA Runner error:', err);
  process.exit(1);
});
